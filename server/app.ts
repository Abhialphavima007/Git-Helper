import express from "express";
import type { Request, Response, NextFunction } from "express";
import connectRoutes from "./routes/connect";
import branchRoutes from "./routes/branches";
import pullRequestRoutes from "./routes/pullRequests";
import localRoutes from "./routes/local";
import cloneRoutes from "./routes/clone";
import fsRoutes from "./routes/fs";
import assistantRoutes from "./routes/assistant";
import { errorHandler } from "./session";
import { cookieSession } from "./cookieSession";
import { IS_HOSTED } from "./env";
import { startAutoCommitScheduler } from "./autoCommit";

export { IS_HOSTED };

// Builds the Azure DevOps proxy as a single Express app.
// Used three ways:
//   - dev:        mounted as Vite middleware (see vite.config.ts)
//   - prod (node): mounted in server.ts alongside the static build
//   - serverless: exported as a Vercel function (see api/[...path].ts)
// The PAT lives only in an encrypted session cookie, never readable by the browser.
// Resilient JSON body parser. Works both when the runtime already parsed the
// body into req.body (some serverless platforms) and when we get a raw stream
// (dev / standalone Node). Avoids the empty-POST-body pitfall on Vercel.
function jsonBody() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const anyReq = req as unknown as { body?: unknown };
    if (anyReq.body !== undefined && anyReq.body !== null) {
      if (typeof anyReq.body === "string") {
        try {
          anyReq.body = JSON.parse(anyReq.body);
        } catch {
          anyReq.body = {};
        }
      }
      return next();
    }
    if (req.method === "GET" || req.method === "HEAD" || req.readableEnded) {
      anyReq.body = {};
      return next();
    }
    let data = "";
    req.on("data", (c) => {
      data += c;
    });
    req.on("end", () => {
      try {
        anyReq.body = data ? JSON.parse(data) : {};
      } catch {
        anyReq.body = {};
      }
      next();
    });
    req.on("error", () => {
      anyReq.body = {};
      next();
    });
  };
}

export function createApiApp() {
  const app = express();
  app.use(jsonBody());
  app.use(cookieSession());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Tells the client which features are available in this deployment.
  app.get("/api/config", (_req, res) => res.json({ localEnabled: !IS_HOSTED }));

  // Auth / connection / repo listing
  app.use("/api", connectRoutes);

  // Repo-scoped resources
  app.use("/api/repos/:repoId", branchRoutes);
  app.use("/api/repos/:repoId/pullrequests", pullRequestRoutes);

  // Desktop-only local-git features — omitted on hosted deployments.
  if (!IS_HOSTED) {
    app.use("/api/local", localRoutes); // status, changes, commit, branches, compare, conflicts
    app.use("/api", cloneRoutes); // clone an Azure repo to this machine
    app.use("/api/fs", fsRoutes); // folder picker
    startAutoCommitScheduler(); // per-repo scheduled/dynamic auto-commits
  }

  // AI assistant (works hosted with Azure tools; local adds git tools).
  app.use("/api/assistant", assistantRoutes);

  // Any unmatched /api request → structured JSON 404 (never an opaque HTML 404),
  // which also makes routing problems obvious.
  app.use("/api", (req, res) => {
    res.status(404).json({
      error: "route_not_found",
      message: "No matching API route.",
      detail: `${req.method} ${req.originalUrl}`,
    });
  });

  app.use(errorHandler);

  return app;
}
