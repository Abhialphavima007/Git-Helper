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

// eslint-disable-next-line no-console
console.log("Bundled desktop/server.cjs");
