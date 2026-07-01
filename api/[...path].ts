// Vercel serverless entry. Vercel serves the static Vite build (dist/) and
// routes every /api/* request to this catch-all function, which hands it to the
// same Express app used in dev and in the standalone Node server.

import type { IncomingMessage, ServerResponse } from "node:http";
import { createApiApp } from "../server/app";

const app = createApiApp() as unknown as (req: IncomingMessage, res: ServerResponse) => void;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // The Express app's routes are all prefixed with /api. Vercel usually passes
  // the full path, but restore the prefix defensively if it was stripped.
  if (req.url && !req.url.startsWith("/api")) {
    req.url = "/api" + (req.url.startsWith("/") ? "" : "/") + req.url;
  }
  return app(req, res);
}
