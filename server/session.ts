import type { NextFunction, Request, Response } from "express";
import type { Connection, IdentityRef } from "./azdo";
import { AzdoError } from "./azdo";
import { GitError } from "./git";

// Augment express-session with the data we store server-side.
declare module "express-session" {
  interface SessionData {
    connection?: Connection;
    me?: IdentityRef;
    // Local-git mode: the validated work-tree root the developer opened.
    localRepo?: { root: string; name: string };
  }
}

// Guard for routes that need an active connection. Attaches it to res.locals.
export function requireConnection(req: Request, res: Response, next: NextFunction): void {
  const connection = req.session.connection;
  if (!connection) {
    res.status(401).json({
      error: "not_connected",
      message: "No Azure DevOps connection. Connect with an organization, project, and PAT first.",
    });
    return;
  }
  res.locals.connection = connection;
  next();
}

// Guard for local-git routes. Attaches the repo root to res.locals.
export function requireLocalRepo(req: Request, res: Response, next: NextFunction): void {
  const repo = req.session.localRepo;
  if (!repo) {
    res.status(409).json({
      error: "no_local_repo",
      message: "No local repository is open. Open a folder that contains a Git repository first.",
    });
    return;
  }
  res.locals.repoRoot = repo.root;
  next();
}

// Wrap async route handlers so thrown errors reach the error middleware.
export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

// Central error handler: never leak a raw Azure DevOps error without structure.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AzdoError) {
    res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({
      error: "azure_devops_error",
      status: err.status,
      message: err.message,
      detail: safeDetail(err.body),
    });
    return;
  }
  if (err instanceof GitError) {
    res.status(422).json({
      error: "git_error",
      message: err.message,
      detail: err.stderr ? safeDetail(err.stderr) : undefined,
    });
    return;
  }
  const message = err instanceof Error ? err.message : "Unexpected server error";
  res.status(500).json({ error: "server_error", message });
}

// Azure DevOps error bodies are sometimes JSON ({ message }), sometimes HTML.
function safeDetail(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {
    /* not JSON */
  }
  return body.length > 400 ? body.slice(0, 400) + "…" : body;
}
