// Starts the full app (API + built frontend) on a local port, in-process.
// Bundled by scripts/build-desktop.mjs into desktop/server.cjs, which the
// Electron main process requires. Running here on the user's own machine means
// local-git mode is fully enabled (VERCEL/HOSTED are not set).

import express from "express";
import path from "node:path";
import { createApiApp } from "./app";

export function startServer(distPath: string, port = 0): Promise<number> {
  const server = express();

  // API first, then the static build with SPA fallback.
  server.use(createApiApp());
  server.use(express.static(distPath));
  server.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));

  return new Promise((resolve) => {
    const srv = server.listen(port, "127.0.0.1", () => {
      const addr = srv.address();
      resolve(typeof addr === "object" && addr ? addr.port : Number(port));
    });
  });
}
