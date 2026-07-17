import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type AutoCommitConfig, type ReposList } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { Card } from "./ui";
import { timeAgo } from "../lib/git";

// Per-repo automatic commits: off by default. Daily / every-2-days / custom
// weekdays — each at a time you pick — or dynamic (commit soon after changes
// appear). Can be pinned to one branch (defaults to the branch you're on when
// enabling). Committing only; it never pushes.
//
// Every control writes optimistically into the query cache first, so chips,
// selects and the time field reflect a click instantly — the server save
// happens in the background and the cache is reconciled afterwards.

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

type SaveConfig = Pick<AutoCommitConfig, "enabled" | "mode" | "everyHours" | "atTime" | "everyDays" | "days" | "branch">;

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

  // Current branch (shares the Status page's cache) + branch list for the picker.
  const stateQuery = useQuery({
    queryKey: ["local-state", root],
    queryFn: () => api.local.getState(),
    enabled: !!root,
    staleTime: 15_000,
  });
  const branchesQuery = useQuery({
    queryKey: ["local-branches", root],
    queryFn: () => api.local.getBranches(),
    enabled: !!root,
    staleTime: 60_000,
  });

  const cfg: AutoCommitConfig | undefined = reposQuery.data?.repos.find((r) => r.root === root)?.autoCommit;
  const enabled = !!cfg?.enabled;
  const currentBranch = stateQuery.data?.branch ?? null;
  const localBranches = (branchesQuery.data ?? []).filter((b) => !b.isRemote).map((b) => b.name);

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
  // Branch to pin to: stored choice, else the branch you're on right now.
  const branchSel = cfg?.enabled ? (cfg.branch ?? "") : (currentBranch ?? "");

  const saveM = useMutation({
    mutationFn: (config: SaveConfig) => api.local.setAutoCommit(root!, config),
    // Optimistic: reflect the change in the cache immediately.
    onMutate: async (config) => {
      setError(null);
      await qc.cancelQueries({ queryKey: ["local-repos-config"] });
      const prev = qc.getQueryData<ReposList>(["local-repos-config"]);
      qc.setQueryData<ReposList>(["local-repos-config"], (old) =>
        old
          ? {
              ...old,
              repos: old.repos.map((r) =>
                r.root === root ? { ...r, autoCommit: { ...r.autoCommit, ...config } } : r
              ),
            }
          : old
      );
      return { prev };
    },
    onError: (e, _config, ctx) => {
      if (ctx?.prev) qc.setQueryData(["local-repos-config"], ctx.prev);
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["local-repos-config"] });
    },
  });

  function save(next: { on?: boolean; kind?: ScheduleKind; atTime?: string; days?: number[]; branch?: string }) {
    const on = next.on ?? enabled;
    const k = next.kind ?? kind;
    const t = next.atTime ?? atTime;
    const d = next.days ?? days;
    const b = next.branch ?? branchSel;
    const base = { enabled: on, branch: b || undefined };
    if (k === "onChange") {
      saveM.mutate({ ...base, mode: "onChange", everyHours: 24 });
    } else if (k === "custom") {
      if (d.length === 0) {
        setError("Pick at least one weekday.");
        return;
      }
      saveM.mutate({ ...base, mode: "schedule", everyHours: 24, atTime: t, everyDays: 1, days: d });
    } else {
      saveM.mutate({
        ...base,
        mode: "schedule",
        everyHours: k === "alternate" ? 48 : 24,
        atTime: t,
        everyDays: k === "alternate" ? 2 : 1,
      });
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

      {/* Branch + time + custom-days controls */}
      {enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-xs font-medium text-muted">
            On branch
            <select
              value={branchSel}
              onChange={(e) => save({ branch: e.target.value })}
              title="Auto-commit only runs while this branch is checked out"
              className="max-w-[160px] truncate rounded-lg border border-line bg-card px-2 py-1 font-mono text-xs text-ink focus-visible:border-accent"
            >
              <option value="">Any branch</option>
              {localBranches.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {b === currentBranch ? " (current)" : ""}
                </option>
              ))}
              {branchSel && !localBranches.includes(branchSel) && <option value={branchSel}>{branchSel}</option>}
            </select>
          </label>
          {kind !== "onChange" && (
            <label className="flex items-center gap-2 text-xs font-medium text-muted">
              Commit at
              <input
                type="time"
                value={atTime}
                onChange={(e) => e.target.value && save({ atTime: e.target.value })}
                className="rounded-lg border border-line bg-card px-2 py-1 text-sm text-ink focus-visible:border-accent"
              />
              <span className="font-normal">(local time)</span>
            </label>
          )}
          {kind === "custom" && (
            <div className="flex items-center gap-1" role="group" aria-label="Days to auto-commit on">
              {WEEKDAYS.map((w) => (
                <button
                  key={w.d}
                  onClick={() => toggleDay(w.d)}
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
            : `Scheduled for ${atTime}${kind === "alternate" ? ", every 2 days" : kind === "custom" ? " on the selected days" : " every day"}${branchSel ? ` on ${branchSel}` : ""}. Runs while the app (or desktop app) is open.`}
        </p>
      )}
    </Card>
  );
}
