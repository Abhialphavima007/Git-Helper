import { defineConfig, type PluginOption, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApiApp } from "./server/app";

// Mount the Express proxy directly inside Vite so the whole app runs from one
// command on one origin (no separate backend, no CORS, no proxy table). Only
// /api/* is delegated to Express; Vite serves everything else.
//
// Mounted for BOTH `vite dev` and `vite preview`, so previewing the build still
// has a working API. (Production uses server.ts, which mounts the same app.)
function apiMiddleware(): PluginOption {
  const mount = (server: ViteDevServer | PreviewServer) => {
    const api = createApiApp() as unknown as (
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: unknown) => void
    ) => void;
    server.middlewares.use((req, res, next) => {
      if (req.url && req.url.startsWith("/api")) return api(req, res, next);
      next();
    });
  };

  return {
    name: "azdo-api-middleware",
    configureServer(server) {
      mount(server);
    },
    configurePreviewServer(server) {
      mount(server);
    },
  };
}

export default defineConfig({
  plugins: [react(), apiMiddleware()],
  server: { port: 5173 },
  preview: { port: 4173 },
});
