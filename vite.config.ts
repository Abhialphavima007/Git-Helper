import { defineConfig, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApiApp } from "./server/app";

// Mount the Express proxy directly inside Vite's dev server so the whole app
// runs from one command on one origin (no separate backend, no CORS, no proxy
// table). Only /api/* is delegated to Express; Vite serves everything else.
function apiMiddleware(): PluginOption {
  return {
    name: "azdo-api-middleware",
    configureServer(server: ViteDevServer) {
      const api = createApiApp() as unknown as (
        req: IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void
      ) => void;
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith("/api")) return api(req, res, next);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiMiddleware()],
  server: { port: 5173 },
});
