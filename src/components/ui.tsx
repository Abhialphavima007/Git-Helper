import type { ReactNode } from "react";
import type { Light, Verdict } from "../lib/git";
import { ApiError } from "../api/client";

const lightStyles: Record<Light, { dot: string; pill: string; banner: string }> = {
  ok: { dot: "bg-ok", pill: "bg-ok-bg text-ok", banner: "bg-ok-bg border-ok/30" },
  warn: { dot: "bg-warn", pill: "bg-warn-bg text-warn", banner: "bg-warn-bg border-warn/30" },
  danger: { dot: "bg-danger", pill: "bg-danger-bg text-danger", banner: "bg-danger-bg border-danger/30" },
  neutral: { dot: "bg-muted", pill: "bg-line text-muted", banner: "bg-card border-line" },
};

export function StatusDot({ light }: { light: Light }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${lightStyles[light].dot}`} aria-hidden />;
}

export function StatusPill({ light, children }: { light: Light; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${lightStyles[light].pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${lightStyles[light].dot}`} aria-hidden />
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-card shadow-card ${className}`}>{children}</div>
  );
}

// The signature element: a plain-language banner that says what to do next.
export function GuidanceBanner({ verdict }: { verdict: Verdict }) {
  const s = lightStyles[verdict.light];
  return (
    <div className={`rounded-xl border ${s.banner} px-4 py-3`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
        <div>
          <p className="font-display text-sm font-semibold text-ink">{verdict.headline}</p>
          <p className="mt-0.5 text-sm text-muted">{verdict.detail}</p>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden />
      {label || "Loading…"}
    </div>
  );
}

// Never shows a raw API error without a translated explanation.
export function ErrorNote({ error, hint }: { error: unknown; hint?: string }) {
  const status = error instanceof ApiError ? error.status : undefined;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const detail = error instanceof ApiError ? error.detail : undefined;

  const explanation =
    hint ||
    (status === 401
      ? "Your session ended or the token is no longer valid. Connect again."
      : status === 403
      ? "The token doesn't have permission for this. It needs at least Code (Read) access."
      : status === 404
      ? "Azure DevOps couldn't find that — check the organization, project, or repository name."
      : "Azure DevOps returned an error. The original message is shown below.");

  return (
    <div className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3">
      <p className="font-display text-sm font-semibold text-danger">Couldn't load this</p>
      <p className="mt-0.5 text-sm text-ink">{explanation}</p>
      <p className="mt-2 font-mono text-xs text-muted">
        {message}
        {detail ? ` — ${detail}` : ""}
      </p>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[0.85em]">{children}</span>;
}

// A compact colored tag for a file's change type (modified / added / …).
export function ChangePill({ light, children }: { light: Light; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${lightStyles[light].pill}`}
    >
      {children}
    </span>
  );
}

// GitHub-style added/removed line counts (green +, red −).
export function DiffStat({ added, removed }: { added?: number; removed?: number }) {
  if (added === undefined && removed === undefined) return null;
  return (
    <span className="shrink-0 font-mono text-[11px]">
      <span className="text-ok">+{added ?? 0}</span> <span className="text-danger">−{removed ?? 0}</span>
    </span>
  );
}
