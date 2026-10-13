// Starts the full app (API + built frontend) on a local port, in-process.
// Bundled by scripts/build-desktop.mjs into desktop/server.cjs, which the
// Electron main process requires. Running here on the user's own machine means
// local-git mode is fully enabled (VERCEL/HOSTED are not set).

import crypto from "node:crypto";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import { createApiApp } from "./app";

const LAUNCH_COOKIE = "gh.launch";

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx !== -1 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function sameToken(a: string | null, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Only the app's own window may use the API. The Electron main process opens
// the window with ?launch=<token>; that first request swaps the token for an
// HttpOnly, SameSite=Strict cookie and redirects to "/". Every /api call must
// then carry the cookie, so other programs and web pages on this machine can't
// drive the server even if they find its port.
function launchGate(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (typeof req.query.launch === "string") {
      if (sameToken(req.query.launch, token)) {
        res.setHeader("Set-Cookie", `${LAUNCH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`);
      }
      res.redirect(302, "/");
      return;
    }
    if (req.path.startsWith("/api") && !sameToken(readCookie(req, LAUNCH_COOKIE), token)) {
      res.status(401).json({ error: "unauthorized", message: "This API only answers the Git Helper window." });
      return;
    }
    next();
  };
}

export function startServer(distPath: string, port = 0, launchToken?: string): Promise<number> {
  const server = express();

  if (launchToken) server.use(launchGate(launchToken));

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
