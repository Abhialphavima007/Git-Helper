import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type AutoCommitConfig } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { Card } from "./ui";
import { timeAgo } from "../lib/git";

// Per-repo automatic commits: off by default; enable daily, alternate-day,
// custom-interval, or dynamic (commit soon after changes appear).
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

  const saveM = useMutation({
    mutationFn: (config: Pick<AutoCommitConfig, "enabled" | "mode" | "everyHours">) =>
      api.local.setAutoCommit(root!, config),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["local-repos-config"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save."),
  });

  function schedule(): string {
    if (!cfg) return "daily";
    if (cfg.mode === "onChange") return "onChange";
    if (cfg.everyHours === 48) return "alternate";
    return "daily";
  }

  function applySchedule(value: string, on: boolean) {
    if (value === "onChange") saveM.mutate({ enabled: on, mode: "onChange", everyHours: 24 });
    else if (value === "alternate") saveM.mutate({ enabled: on, mode: "interval", everyHours: 48 });
    else saveM.mutate({ enabled: on, mode: "interval", everyHours: 24 });
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
              value={schedule()}
              disabled={saveM.isPending}
              onChange={(e) => applySchedule(e.target.value, true)}
              className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink focus-visible:border-accent"
            >
              <option value="daily">Daily</option>
              <option value="alternate">Every 2 days</option>
              <option value="onChange">When changes appear (dynamic)</option>
            </select>
          )}
          <button
            role="switch"
            aria-checked={enabled}
            disabled={saveM.isPending}
            onClick={() => applySchedule(schedule(), !enabled)}
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

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {enabled && cfg?.lastResult && (
        <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
          Last run{cfg.lastRun ? ` ${timeAgo(cfg.lastRun)}` : ""}: {cfg.lastResult}
        </p>
      )}
      {enabled && !cfg?.lastResult && (
        <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
          Scheduled. Auto-commits run while the app (or desktop app) is open.
        </p>
      )}
    </Card>
  );
}
