// Vercel serverless entry. Vercel serves the static Vite build (dist/) and
// routes every /api/* request to this catch-all function, which hands it to the
// same Express app used in dev and in the standalone Node server.
//
// The app is loaded via a cached dynamic import inside a try/catch so that any
// load-time or request-time error is returned as readable JSON instead of an
// opaque FUNCTION_INVOCATION_FAILED.

import type { IncomingMessage, ServerResponse } from "node:http";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let appPromise: Promise<Handler> | null = null;

async function getApp(): Promise<Handler> {
  if (!appPromise) {
    appPromise = import("../server/app").then((m) => m.createApiApp() as unknown as Handler);
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // The Express routes are all prefixed with /api; restore it if stripped.
    if (req.url && !req.url.startsWith("/api")) {
      req.url = "/api" + (req.url.startsWith("/") ? "" : "/") + req.url;
    }
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
    }
    res.end(JSON.stringify({ error: "function_crash", message, stack }));
  }
}
