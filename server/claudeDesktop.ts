// One-click "Connect Claude Desktop": registers Git Helper's MCP server in
// claude_desktop_config.json so the user can drive their repos from Claude
// Desktop with no API key. Works from the packaged desktop app too:
// process.execPath is the app's own runtime (Electron runs as plain Node with
// ELECTRON_RUN_AS_NODE=1), so users don't need Node installed.

import { promises as fs } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { Connection } from "./azdo";

// Claude Desktop keeps its config in memory and rewrites the file — an entry
// added while it's running gets wiped. Detect that so we can warn the user to
// quit it first (or force-quit it for them when they ask).
function isClaudeDesktopRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("tasklist", ["/FI", "IMAGENAME eq claude.exe", "/FO", "CSV", "/NH"], (err, out) =>
        resolve(!err && /claude\.exe/i.test(out))
      );
    } else {
      execFile("pgrep", ["-xi", "Claude"], (err, out) => resolve(!err && out.trim().length > 0));
    }
  });
}

function configPath(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

// Where the Claude Desktop app itself lives (null if not found).
function claudeAppPath(): string | null {
  if (process.platform === "win32") {
    const base = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "AnthropicClaude");
    const stub = path.join(base, "claude.exe");
    if (existsSync(stub)) return stub;
    // Squirrel layout: app-<version>\claude.exe — pick the newest.
    try {
      const versions = readdirSync(base)
        .filter((d) => d.startsWith("app-"))
        .sort()
        .reverse();
      for (const v of versions) {
        const exe = path.join(base, v, "claude.exe");
        if (existsSync(exe)) return exe;
      }
    } catch {
      /* not installed */
    }
    return null;
  }
  if (process.platform === "darwin") {
    return existsSync("/Applications/Claude.app") ? "/Applications/Claude.app" : null;
  }
  return null;
}

// The Microsoft Store (MSIX) install lives under the ACL-protected
// WindowsApps folder — the only reliable way in is its AppsFolder id.
function storeAppId(): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-Command", "(Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1).AppID"],
      { windowsHide: true, timeout: 15_000 },
      (err, out) => {
        const id = (out || "").trim();
        resolve(!err && id.includes("!") ? id : null);
      }
    );
  });
}

// Installed = the app exists (classic or Store install), or its config
// folder does (covers Linux and unusual locations).
async function claudeInstalled(): Promise<boolean> {
  if (claudeAppPath() !== null) return true;
  if (existsSync(path.dirname(configPath()))) return true;
  return (await storeAppId()) !== null;
}

// Start Claude Desktop so the freshly-written MCP entry gets picked up.
async function launchClaudeDesktop(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const exe = claudeAppPath();
      if (exe) {
        spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
        return true;
      }
      const appId = await storeAppId();
      if (appId) {
        spawn("explorer.exe", [`shell:AppsFolder\\${appId}`], { detached: true, stdio: "ignore" }).unref();
        return true;
      }
      return false;
    }
    if (process.platform === "darwin") {
      spawn("open", ["-a", "Claude"], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
  } catch {
    /* best effort */
  }
  return false;
}

// Force-quit Claude Desktop. Deliberately NOT graceful: a graceful quit makes
// Claude rewrite its config on the way out (wiping the entry we just added) —
// a hard kill leaves the file exactly as written. Only ever called when the
// user explicitly clicks "Quit Claude Desktop for me".
function quitClaudeDesktop(): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("taskkill", ["/F", "/IM", "claude.exe", "/T"], () => resolve());
    } else {
      execFile("pkill", ["-9", "-xi", "Claude"], () => resolve());
    }
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The bundled MCP server ships next to the desktop server; in dev it lives in
// the repo's mcp/ folder.
function findBundle(): string | null {
  // __dirname exists in the CJS desktop bundle but not under ESM dev servers.
  const selfDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
  const candidates = [
    path.join(selfDir, "mcp", "git-helper-mcp.mjs"), // packaged desktop (next to server.cjs)
    path.join(process.cwd(), "mcp", "git-helper-mcp.mjs"), // dev from repo root
    path.join(process.cwd(), "..", "mcp", "git-helper-mcp.mjs"),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export interface ConnectResult {
  ok: boolean;
  configPath: string;
  azureIncluded: boolean;
  claudeWasRunning: boolean;
  launched: boolean;
  canForceQuit: boolean; // Claude is running — offer "quit it for me & connect"
  message: string;
}

export async function connectClaudeDesktop(
  connection: Connection | null,
  opts: { forceQuit?: boolean } = {}
): Promise<ConnectResult> {
  const bundle = findBundle();
  if (!bundle) {
    throw new Error("The MCP bundle is missing. From the repo, run `npm run mcp:build` first (packaged apps include it automatically).");
  }

  const cfgPath = configPath();
  if (!(await claudeInstalled())) {
    throw new Error("Claude Desktop doesn't appear to be installed on this machine — install it from claude.ai/download, sign in once, then click Connect again.");
  }

  // Claude rewrites its config from memory when it exits — writing while it
  // runs gets wiped. With the user's explicit permission we hard-quit it
  // (hard on purpose: a graceful quit is exactly what triggers the rewrite).
  let running = await isClaudeDesktopRunning();
  if (running && opts.forceQuit) {
    await quitClaudeDesktop();
    await wait(1500);
    running = await isClaudeDesktopRunning();
  }

  // Fresh machine where Claude is installed but was never run: the config
  // folder doesn't exist yet. Create it instead of refusing.
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });

  let config: Record<string, unknown> = {};
  if (existsSync(cfgPath)) {
    await fs.copyFile(cfgPath, cfgPath + ".backup");
    try {
      config = JSON.parse(await fs.readFile(cfgPath, "utf8"));
    } catch {
      throw new Error("Claude Desktop's config file exists but couldn't be read — fix or remove it and try again.");
    }
  }

  const servers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};

  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
  if (connection) {
    env.AZDO_ORG = connection.org;
    env.AZDO_PROJECT = connection.project;
    env.AZDO_PAT = connection.pat;
  } else {
    // Preserve previously-stored Azure credentials on re-connect.
    const prev = servers["git-helper"] as { env?: Record<string, string> } | undefined;
    for (const k of ["AZDO_ORG", "AZDO_PROJECT", "AZDO_PAT"]) {
      if (prev?.env?.[k]) env[k] = prev.env[k];
    }
  }

  servers["git-helper"] = { command: process.execPath, args: [bundle], env };
  config.mcpServers = servers;

  await fs.writeFile(cfgPath, JSON.stringify(config, null, 2), "utf8");

  const azureIncluded = !!env.AZDO_PAT;

  if (running) {
    // Still running and the user hasn't asked us to quit it.
    return {
      ok: true,
      configPath: cfgPath,
      azureIncluded,
      claudeWasRunning: true,
      launched: false,
      canForceQuit: true,
      message:
        "Claude Desktop is currently running, and it overwrites this setting when it exits. Quit it completely (File → Exit) and connect again — or let Git Helper do it with the button below.",
    };
  }

  // Not running (or we just quit it): finish the job by starting Claude
  // Desktop so the connection is live without any manual steps.
  const launched = await launchClaudeDesktop();
  const message = launched
    ? `Connected — Claude Desktop is starting now. Once it's up, look for “git-helper” under Settings → Developer and just ask e.g. "what's the status of my repos?"${azureIncluded ? " Azure DevOps tools are included." : ""}`
    : `Connected. Start Claude Desktop, then ask it e.g. "what's the status of my repos?"${azureIncluded ? " Azure DevOps tools are included." : ""}`;

  return { ok: true, configPath: cfgPath, azureIncluded, claudeWasRunning: false, launched, canForceQuit: false, message };
}

// Remove Git Helper from Claude Desktop's config (the reverse of connect).
export async function disconnectClaudeDesktop(): Promise<ConnectResult> {
  const cfgPath = configPath();
  if (!existsSync(cfgPath)) {
    return { ok: true, configPath: cfgPath, azureIncluded: false, claudeWasRunning: false, launched: false, canForceQuit: false, message: "Nothing to disconnect — Claude Desktop has no Git Helper entry." };
  }

  await fs.copyFile(cfgPath, cfgPath + ".backup");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(await fs.readFile(cfgPath, "utf8"));
  } catch {
    throw new Error("Claude Desktop's config file couldn't be read — fix or remove it manually.");
  }

  const servers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  const existed = "git-helper" in servers;
  delete servers["git-helper"];
  config.mcpServers = servers;
  await fs.writeFile(cfgPath, JSON.stringify(config, null, 2), "utf8");

  const claudeWasRunning = await isClaudeDesktopRunning();
  const message = !existed
    ? "Nothing to disconnect — Claude Desktop had no Git Helper entry."
    : claudeWasRunning
      ? "Removed. Claude Desktop is running, so quit it completely (File → Exit) and click Disconnect once more to make sure it doesn't restore the entry on exit — then start it again."
      : "Disconnected. Git Helper will no longer appear in Claude Desktop.";

  return { ok: true, configPath: cfgPath, azureIncluded: false, claudeWasRunning, launched: false, canForceQuit: claudeWasRunning && existed, message };
}
