// The serverless request handler. This file is bundled (with the whole Express
// app and its deps) into a single self-contained ESM file at build time
// (scripts/build-api.mjs → api/_app.mjs), which the Vercel function imports.
// Bundling avoids ESM's "cannot resolve relative import" problem on Vercel.

import type { IncomingMessage, ServerResponse } from "node:http";
import { createApiApp } from "./app";

const app = createApiApp() as unknown as (req: IncomingMessage, res: ServerResponse) => void;

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  try {
    // The Express routes are all prefixed with /api; restore it if stripped.
    if (req.url && !req.url.startsWith("/api")) {
      req.url = "/api" + (req.url.startsWith("/") ? "" : "/") + req.url;
    }
    app(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
    }
    res.end(JSON.stringify({ error: "function_crash", message }));
  }
}
