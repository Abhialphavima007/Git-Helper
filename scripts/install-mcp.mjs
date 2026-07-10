// Register the Git Helper MCP server in Claude Desktop's config.
// Merges an entry into claude_desktop_config.json (backing it up first) —
// existing servers and preferences are preserved. Restart Claude Desktop after.
//
// Optional Azure DevOps tools: set AZDO_ORG / AZDO_PROJECT / AZDO_PAT when
// running this script and they'll be written into the server's env, e.g.
//   AZDO_ORG=fabrikam AZDO_PROJECT="Online Store" AZDO_PAT=xxx npm run mcp:install

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(here, "..", "mcp", "git-helper-mcp.mjs");
if (!existsSync(bundle)) {
  console.error("Bundle missing — run `npm run mcp:build` first (or use `npm run mcp:install` which does both).");
  process.exit(1);
}

const configPath =
  process.platform === "win32"
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
    : path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");

if (!existsSync(path.dirname(configPath))) {
  console.error(`Claude Desktop doesn't appear to be installed (missing ${path.dirname(configPath)}).`);
  process.exit(1);
}

let config = {};
if (existsSync(configPath)) {
  copyFileSync(configPath, configPath + ".backup");
  config = JSON.parse(readFileSync(configPath, "utf8"));
  console.log(`Backed up existing config to ${configPath}.backup`);
}

config.mcpServers = config.mcpServers ?? {};

const env = {};
if (process.env.AZDO_ORG && process.env.AZDO_PROJECT && process.env.AZDO_PAT) {
  env.AZDO_ORG = process.env.AZDO_ORG;
  env.AZDO_PROJECT = process.env.AZDO_PROJECT;
  env.AZDO_PAT = process.env.AZDO_PAT;
  console.log(`Azure DevOps tools enabled for ${env.AZDO_ORG}/${env.AZDO_PROJECT}`);
} else if (config.mcpServers["git-helper"]?.env) {
  // Keep previously-configured Azure credentials on re-install.
  Object.assign(env, config.mcpServers["git-helper"].env);
}

config.mcpServers["git-helper"] = {
  command: "node",
  args: [bundle],
  ...(Object.keys(env).length ? { env } : {}),
};

writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
console.log(`Registered "git-helper" MCP server in ${configPath}`);
console.log("Restart Claude Desktop, then ask it e.g. \"what's the status of my repos?\"");
