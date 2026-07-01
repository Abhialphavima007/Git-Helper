import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { branchVerdict, timeAgo } from "../lib/git";
import { Card, ErrorNote, GuidanceBanner, Mono, Spinner } from "../components/ui";
import { CommitGraph } from "../components/CommitGraph";

export function DashboardPage() {
  const { selectedRepo, selectedRepoId } = useConnection();
  const [focus, setFocus] = useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["branches", selectedRepoId],
    queryFn: () => api.getBranches(selectedRepoId!),
    enabled: !!selectedRepoId,
  });

  // Default the focus branch to the most recently updated non-default branch.
  useEffect(() => {
    const data = branchesQuery.data;
    if (!data) return;
    const inList = focus && data.branches.some((b) => b.name === focus);
    if (inList) return;
    const firstNonDefault = data.branches.find((b) => !b.isDefault);
    setFocus((firstNonDefault ?? data.branches[0])?.name ?? null);
  }, [branchesQuery.data, focus]);

  const commitsQuery = useQuery({
    queryKey: ["commits", selectedRepoId, focus],
    queryFn: () => api.getCommits(selectedRepoId!, focus!),
    enabled: !!selectedRepoId && !!focus,
  });

  if (!selectedRepo) {
    return <EmptyRepo />;
  }

  const data = branchesQuery.data;
  const branch = data?.branches.find((b) => b.name === focus) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Repository status</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">{selectedRepo.name}</h1>
      </header>

      {branchesQuery.isLoading && <Spinner label="Reading branch status…" />}
      {branchesQuery.isError && <ErrorNote error={branchesQuery.error} />}

      {data && branch && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted">Looking at</label>
            <select
              className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-medium text-ink focus-visible:border-accent"
              value={focus ?? ""}
              onChange={(e) => setFocus(e.target.value)}
            >
              {data.branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted">
              compared with <Mono>{data.defaultBranch}</Mono>
            </span>
          </div>

          <GuidanceBanner verdict={branchVerdict(branch, data.defaultBranch)} />

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-display text-sm font-semibold text-ink">How far apart are they?</h2>
              <div className="mt-3">
                <CommitGraph
                  branch={branch.name}
                  defaultBranch={data.defaultBranch}
                  ahead={branch.aheadCount}
                  behind={branch.behindCount}
                />
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold text-ink">Recent commits</h2>
                {commitsQuery.isFetching && <span className="text-xs text-muted">refreshing…</span>}
              </div>
              {commitsQuery.isLoading && (
                <div className="mt-3">
                  <Spinner />
                </div>
              )}
              {commitsQuery.isError && (
                <div className="mt-3">
                  <ErrorNote error={commitsQuery.error} />
                </div>
              )}
              {commitsQuery.data && commitsQuery.data.length === 0 && (
                <p className="mt-3 text-sm text-muted">No commits found on this branch.</p>
              )}
              {commitsQuery.data && commitsQuery.data.length > 0 && (
                <ul className="mt-3 space-y-3">
                  {commitsQuery.data.slice(0, 8).map((c) => (
                    <li key={c.id} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{c.message || "(no message)"}</p>
                        <p className="text-xs text-muted">
                          <Mono>{c.id}</Mono> · {c.author} · {timeAgo(c.date)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted">
              {data.branches.length} branch{data.branches.length === 1 ? "" : "es"} in this repository.
            </p>
            <div className="flex gap-2">
              <Link
                to="/branches"
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
              >
                View all branches
              </Link>
              <Link
                to="/pulls"
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
              >
                View pull requests
              </Link>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function EmptyRepo() {
  return (
    <Card className="p-8 text-center">
      <h1 className="font-display text-lg font-semibold text-ink">No repository selected</h1>
      <p className="mt-2 text-sm text-muted">
        This project has no repositories the token can read, or none is selected yet. Pick one from the sidebar.
      </p>
    </Card>
  );
}
