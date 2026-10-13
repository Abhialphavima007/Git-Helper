// Blocks requests to the API that don't come from the app's own page.
//
// The local/desktop server can read, write and run git in folders on this
// machine, so a web page the user happens to have open must not be able to
// reach it — neither by posting to http://127.0.0.1:<port> directly (CSRF)
// nor by pointing its own domain at 127.0.0.1 (DNS rebinding).
//
//  - Host: off hosted deployments only loopback names are accepted
//    (plus anything listed in ALLOWED_HOSTS, comma-separated).
//  - Sec-Fetch-Site: browsers mark cross-site requests; only same-origin
//    (or direct navigation, "none") is allowed through.
//  - Origin: state-changing requests that carry an Origin must come from
//    this same host.
//  - Content-Type: state-changing requests with a body must be JSON, which a
//    cross-site form or "simple" fetch can't send without a CORS preflight.

import type { Request, Response, NextFunction } from "express";
import { IS_HOSTED } from "./env";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const EXTRA_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function deny(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

export function requestGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = (req.headers.host || "").toLowerCase();

    if (!IS_HOSTED) {
      const name = hostnameOf(host);
      if (!name || !(LOOPBACK_HOSTS.has(name) || EXTRA_HOSTS.has(name) || EXTRA_HOSTS.has(host))) {
        deny(res, 403, "untrusted_host", "This server only answers requests addressed to localhost.");
        return;
      }
    }

    const fetchSite = req.headers["sec-fetch-site"];
    if (typeof fetchSite === "string" && fetchSite !== "same-origin" && fetchSite !== "none") {
      deny(res, 403, "cross_site_request", "Requests from other websites are not allowed.");
      return;
    }

    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let originHost = "";
        try {
          originHost = new URL(origin).host.toLowerCase();
        } catch {
          /* "null" or malformed — rejected below */
        }
        const forwardedHost = String(req.headers["x-forwarded-host"] || "").toLowerCase();
        if (originHost !== host && !(IS_HOSTED && forwardedHost && originHost === forwardedHost)) {
          deny(res, 403, "cross_origin_request", "Requests from other websites are not allowed.");
          return;
        }
      }

      const length = Number(req.headers["content-length"] || 0);
      const hasBody = length > 0 || req.headers["transfer-encoding"] !== undefined;
      const type = String(req.headers["content-type"] || "").toLowerCase();
      if (hasBody && !type.startsWith("application/json")) {
        deny(res, 415, "unsupported_media_type", "Requests must be sent as JSON.");
        return;
      }
    }

    next();
  };
}
