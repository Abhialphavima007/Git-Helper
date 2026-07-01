// A stateless, encrypted-cookie session — the whole session lives in an
// AES-256-GCM encrypted cookie instead of server memory. This is what makes the
// app work on serverless hosts (Vercel), where each request may hit a fresh
// instance with no shared memory. It stays API-compatible with how the routes
// use `req.session` (read/write fields + `destroy()`).

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Connection, IdentityRef } from "./azdo";

export interface AppSession {
  connection?: Connection;
  me?: IdentityRef;
  localRepo?: { root: string; name: string };
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
    return obj && typeof obj === "object" ? obj : {};
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
    const secret = process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";
    const key = keyFrom(secret);
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
    (res as unknown as { end: (...a: unknown[]) => unknown }).end = (...args: unknown[]) => {
      if (!wrote && !res.headersSent) {
        wrote = true;
        const payload: Record<string, unknown> = {};
        for (const k of Object.keys(session)) payload[k] = (session as Record<string, unknown>)[k];
        const hasData = !cleared && Object.keys(payload).length > 0;
        try {
          if (hasData) {
            res.setHeader("Set-Cookie", serializeCookie(COOKIE, encrypt(JSON.stringify(payload), key), { maxAge: MAX_AGE_S, secure }));
          } else if (existing) {
            res.setHeader("Set-Cookie", serializeCookie(COOKIE, "", { maxAge: 0, secure }));
          }
        } catch {
          /* headers already sent — nothing we can do */
        }
      }
      return (origEnd as (...a: unknown[]) => unknown)(...args);
    };

    next();
  };
}
