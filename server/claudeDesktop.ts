// One-click "Connect Claude Desktop": registers Git Helper's MCP server in
// claude_desktop_config.json so the user can drive their repos from Claude
// Desktop with no API key. Works from the packaged desktop app too:
// process.execPath is the app's own runtime (Electron runs as plain Node with
// ELECTRON_RUN_AS_NODE=1), so users don't need Node installed.

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Connection } from "./azdo";

function configPath(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

// The bundled MCP server ships next to the desktop server; in dev it lives in
// the repo's mcp/ folder.
function findBundle(): string | null {
  const candidates = [
    path.join(__dirname, "mcp", "git-helper-mcp.mjs"), // packaged desktop (next to server.cjs)
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
  message: string;
}

export async function connectClaudeDesktop(connection: Connection | null): Promise<ConnectResult> {
  const bundle = findBundle();
  if (!bundle) {
    throw new Error("The MCP bundle is missing. From the repo, run `npm run mcp:build` first (packaged apps include it automatically).");
  }

  const cfgPath = configPath();
  if (!existsSync(path.dirname(cfgPath))) {
    throw new Error("Claude Desktop doesn't appear to be installed on this machine — install it from claude.ai/download first.");
  }

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
  return {
    ok: true,
    configPath: cfgPath,
    azureIncluded,
    message: `Connected. Restart Claude Desktop, then ask it e.g. "what's the status of my repos?"${azureIncluded ? " Azure DevOps tools are included." : ""}`,
  };
}
