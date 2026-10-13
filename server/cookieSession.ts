// A stateless, encrypted-cookie session — the whole session lives in an
// AES-256-GCM encrypted cookie instead of server memory. This is what makes the
// app work on serverless hosts (Vercel), where each request may hit a fresh
// instance with no shared memory. It stays API-compatible with how the routes
// use `req.session` (read/write fields + `destroy()`).

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import type { Connection, IdentityRef } from "./azdo";
import { IS_HOSTED } from "./env";

export interface AppSession {
  connection?: Connection;
  me?: IdentityRef;
  localRepo?: { root: string; name: string };
  // Hosted deployments: each visitor's own assistant key, private to their
  // encrypted session cookie (same mechanism as the PAT).
  assistantKey?: { provider: "anthropic" | "gemini"; key: string };
  destroy: (cb?: () => void) => void;
}

// Make req.session typed everywhere.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session: AppSession;
    }
  }
}

const COOKIE = "azdo.sess";
const MAX_AGE_S = 60 * 60 * 8; // 8 hours

function keyFrom(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

// The key that encrypts the session cookie (which carries the PAT).
//  - SESSION_SECRET when set.
//  - Hosted without it: refuse — a well-known fallback would let anyone who
//    gets hold of a cookie decrypt the PAT or forge a session.
//  - Local/desktop without it: a random secret generated once per machine and
//    kept in the user's profile, so sessions still survive app restarts.
const SECRET_FILE = path.join(os.homedir(), ".azdo-git-helper", "session.key");

function localSecret(): string {
  try {
    const saved = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {
    /* first run */
  }
  const fresh = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(SECRET_FILE, fresh, { encoding: "utf8", mode: 0o600 });
  } catch {
    /* read-only profile: the secret just lasts for this process */
  }
  return fresh;
}

let sessionKey: Buffer | null = null;

// The per-machine key, for other local-only stores that need to encrypt a
// secret at rest (saved connections). Never used on hosted deployments.
export function localSessionKey(): Buffer {
  return keyFrom(process.env.SESSION_SECRET || localSecret());
}

function getSessionKey(): Buffer | null {
  if (sessionKey) return sessionKey;
  const secret = process.env.SESSION_SECRET || (IS_HOSTED ? null : localSecret());
  if (!secret) return null;
  sessionKey = keyFrom(secret);
  return sessionKey;
}

function encrypt(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decrypt(token: string, key: Buffer): Record<string, unknown> {
  try {
    const buf = Buffer.from(token, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    const obj = JSON.parse(dec);
    if (!obj || typeof obj !== "object") return {};
    // The expiry travels inside the encrypted payload, so a copied cookie
    // stops working after MAX_AGE_S of inactivity even if the browser keeps it.
    const { exp, ...data } = obj as Record<string, unknown>;
    if (typeof exp !== "number" || exp < Math.floor(Date.now() / 1000)) return {};
    return data;
  } catch {
    return {}; // tampered / wrong key / malformed → empty session
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${Math.floor(opts.maxAge)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function cookieSession() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = getSessionKey();
    if (!key) {
      res.status(500).json({
        error: "server_misconfigured",
        message: "SESSION_SECRET is not set on this deployment. Set it to a long random string and redeploy.",
      });
      return;
    }

    // Session handling must never crash the request — wrap the whole setup.
    try {
      const existing = readCookie(req, COOKIE);
      const data = existing ? decrypt(existing, key) : {};

      let cleared = false;
      const session = { ...data } as Record<string, unknown> & AppSession;
      Object.defineProperty(session, "destroy", {
        enumerable: false,
        value: (cb?: () => void) => {
          for (const k of Object.keys(session)) delete (session as Record<string, unknown>)[k];
          cleared = true;
          if (cb) cb();
        },
      });
      req.session = session;

      // Emit the (re)encrypted cookie right before the response flushes.
      const secure = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
      const origEnd = res.end.bind(res);
      let wrote = false;
      (res as unknown as { end: (...a: unknown[]) => unknown }).end = function (...args: unknown[]) {
        try {
          if (!wrote && !res.headersSent) {
            wrote = true;
            const payload: Record<string, unknown> = {};
            for (const k of Object.keys(session)) payload[k] = (session as Record<string, unknown>)[k];
            const hasData = !cleared && Object.keys(payload).length > 0;
            if (hasData) {
              payload.exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
              res.setHeader("Set-Cookie", serializeCookie(COOKIE, encrypt(JSON.stringify(payload), key), { maxAge: MAX_AGE_S, secure }));
            } else if (existing) {
              res.setHeader("Set-Cookie", serializeCookie(COOKIE, "", { maxAge: 0, secure }));
            }
          }
        } catch {
          /* never let cookie writing break the response */
        }
        return (origEnd as (...a: unknown[]) => unknown)(...args);
      };
    } catch {
      // Fall back to a no-op session so routes can still respond.
      if (!req.session) {
        const noop = {} as Record<string, unknown> & AppSession;
        Object.defineProperty(noop, "destroy", { enumerable: false, value: () => {} });
        req.session = noop;
      }
    }

    next();
  };
}
