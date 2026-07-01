import express from "express";
import session from "express-session";
import connectRoutes from "./routes/connect";
import branchRoutes from "./routes/branches";
import pullRequestRoutes from "./routes/pullRequests";
import localRoutes from "./routes/local";
import cloneRoutes from "./routes/clone";
import fsRoutes from "./routes/fs";
import { errorHandler } from "./session";

// Builds the Azure DevOps proxy as a single Express app.
// Used two ways:
//   - dev:  mounted as Vite middleware (see vite.config.ts)
//   - prod: mounted in server.ts alongside the static build
// In both cases the PAT lives only in the server-side session, never in the browser.
export function createApiApp() {
  const SESSION_SECRET =
    process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";

  const app = express();
  app.use(express.json());

  app.use(
    session({
      name: "azdo.sid",
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false, // set true behind HTTPS in production
        maxAge: 1000 * 60 * 60 * 8, // 8 hours
      },
    })
  );

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Auth / connection / repo listing
  app.use("/api", connectRoutes);

  // Repo-scoped resources
  app.use("/api/repos/:repoId", branchRoutes);
  app.use("/api/repos/:repoId/pullrequests", pullRequestRoutes);

  // Local-git mode: operate on a work tree on this machine.
  app.use("/api/local", localRoutes);

  // Clone an Azure repo to the local machine (bridges remote -> local mode).
  app.use("/api", cloneRoutes);

  // Local filesystem browsing for the folder picker.
  app.use("/api/fs", fsRoutes);

  app.use(errorHandler);

  return app;
}
