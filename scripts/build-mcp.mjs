// Bundle the MCP server (server/mcp.ts + deps) into one self-contained ESM
// file that Claude Desktop can launch with plain `node` — no tsx, no
// node_modules needed at runtime.

import { build } from "esbuild";

await build({
  entryPoints: ["server/mcp.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "mcp/git-helper-mcp.mjs",
  banner: {
    js: [
      "import { createRequire as __cr } from 'module';",
      "import { fileURLToPath as __ftu } from 'url';",
      "import { dirname as __dn } from 'path';",
      "const require = __cr(import.meta.url);",
      "const __filename = __ftu(import.meta.url);",
      "const __dirname = __dn(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});

console.log("Bundled mcp/git-helper-mcp.mjs");
