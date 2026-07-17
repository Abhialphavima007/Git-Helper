import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type AutoCommitConfig } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { Card } from "./ui";
import { timeAgo } from "../lib/git";

// Per-repo automatic commits: off by default. Daily / every-2-days / custom
// weekdays — each at a time you pick — or dynamic (commit soon after changes
// appear). Committing only; it never pushes.

type ScheduleKind = "daily" | "alternate" | "custom" | "onChange";

const WEEKDAYS = [
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
  { d: 0, label: "Sun" },
];

export function AutoCommitCard() {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const reposQuery = useQuery({
    queryKey: ["local-repos-config"],
    queryFn: () => api.local.listRepos(),
    enabled: !!root,
    refetchInterval: 60_000, // pick up lastRun updates from the scheduler
  });

  const cfg: AutoCommitConfig | undefined = reposQuery.data?.repos.find((r) => r.root === root)?.autoCommit;
  const enabled = !!cfg?.enabled;

  // Current selections, derived from the stored config (with legacy mapping).
  const kind: ScheduleKind =
    !cfg || cfg.mode === "onChange"
      ? cfg?.mode === "onChange"
        ? "onChange"
        : "daily"
      : cfg.mode === "schedule"
        ? cfg.days && cfg.days.length > 0
          ? "custom"
          : (cfg.everyDays ?? 1) >= 2
            ? "alternate"
            : "daily"
        : cfg.everyHours === 48 // legacy interval configs
          ? "alternate"
          : "daily";
  const atTime = cfg?.atTime ?? "18:00";
  const days = cfg?.days ?? [1, 2, 3, 4, 5];

  const saveM = useMutation({
    mutationFn: (config: Pick<AutoCommitConfig, "enabled" | "mode" | "everyHours" | "atTime" | "everyDays" | "days">) =>
      api.local.setAutoCommit(root!, config),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["local-repos-config"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save."),
  });

  function save(next: { on?: boolean; kind?: ScheduleKind; atTime?: string; days?: number[] }) {
    const on = next.on ?? enabled;
    const k = next.kind ?? kind;
    const t = next.atTime ?? atTime;
    const d = next.days ?? days;
    if (k === "onChange") {
      saveM.mutate({ enabled: on, mode: "onChange", everyHours: 24 });
    } else if (k === "custom") {
      if (d.length === 0) {
        setError("Pick at least one weekday.");
        return;
      }
      saveM.mutate({ enabled: on, mode: "schedule", everyHours: 24, atTime: t, everyDays: 1, days: d });
    } else {
      saveM.mutate({ enabled: on, mode: "schedule", everyHours: k === "alternate" ? 48 : 24, atTime: t, everyDays: k === "alternate" ? 2 : 1 });
    }
  }

  function toggleDay(d: number) {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    save({ days: next });
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-ink">Auto-commit</h2>
          <p className="mt-0.5 text-xs text-muted">
            Commit outstanding changes automatically for this repo. Never pushes, and never touches merges or
            conflicts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <select
              value={kind}
              disabled={saveM.isPending}
              onChange={(e) => save({ kind: e.target.value as ScheduleKind })}
              className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink focus-visible:border-accent"
            >
              <option value="daily">Daily</option>
              <option value="alternate">Every 2 days</option>
              <option value="custom">Custom days…</option>
              <option value="onChange">When changes appear (dynamic)</option>
            </select>
          )}
          <button
            role="switch"
            aria-checked={enabled}
            disabled={saveM.isPending}
            onClick={() => save({ on: !enabled })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-accent" : "bg-line"}`}
            title={enabled ? "Disable auto-commit" : "Enable auto-commit"}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                enabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Time + custom-days controls for scheduled kinds */}
      {enabled && kind !== "onChange" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            Commit at
            <input
              type="time"
              value={atTime}
              disabled={saveM.isPending}
              onChange={(e) => e.target.value && save({ atTime: e.target.value })}
              className="rounded-lg border border-line bg-card px-2 py-1 text-sm text-ink focus-visible:border-accent"
            />
            <span className="font-normal">(your local time)</span>
          </label>
          {kind === "custom" && (
            <div className="flex items-center gap-1" role="group" aria-label="Days to auto-commit on">
              {WEEKDAYS.map((w) => (
                <button
                  key={w.d}
                  onClick={() => toggleDay(w.d)}
                  disabled={saveM.isPending}
                  aria-pressed={days.includes(w.d)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    days.includes(w.d) ? "bg-accent text-white" : "bg-paper text-muted hover:text-ink"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {enabled && cfg?.lastResult && (
        <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
          Last run{cfg.lastRun ? ` ${timeAgo(cfg.lastRun)}` : ""}: {cfg.lastResult}
        </p>
      )}
      {enabled && !cfg?.lastResult && (
        <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
          {kind === "onChange"
            ? "Watching — commits shortly after changes appear."
            : `Scheduled for ${atTime}${kind === "alternate" ? ", every 2 days" : kind === "custom" ? " on the selected days" : " every day"}. Runs while the app (or desktop app) is open.`}
        </p>
      )}
    </Card>
  );
}
