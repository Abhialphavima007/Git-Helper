// Bundle the in-process server into desktop/server.cjs (self-contained CommonJS)
// so the Electron main process can require it without needing the TypeScript
// toolchain or the server/ tree at runtime.

import { build } from "esbuild";

await build({
  entryPoints: ["server/desktopServer.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "desktop/server.cjs",
  logLevel: "info",
});

// The MCP server ships inside the desktop app so "Connect Claude Desktop"
// works for people who only downloaded the installer.
await build({
  entryPoints: ["server/mcp.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "desktop/mcp/git-helper-mcp.mjs",
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

// eslint-disable-next-line no-console
console.log("Bundled desktop/server.cjs + desktop/mcp/git-helper-mcp.mjs");
