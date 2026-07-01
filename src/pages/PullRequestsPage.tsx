import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type PullRequestInfo } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { prStatusVerdict, reviewSummary, timeAgo } from "../lib/git";
import { Card, ErrorNote, Mono, Spinner, StatusPill } from "../components/ui";

type Scope = "all" | "mine" | "assigned";
const STATUSES = ["active", "completed", "abandoned", "all"] as const;

export function PullRequestsPage() {
  const { selectedRepo, selectedRepoId, me } = useConnection();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("active");
  const [scope, setScope] = useState<Scope>("all");

  const query = useQuery({
    queryKey: ["prs", selectedRepoId, status],
    queryFn: () => api.getPullRequests(selectedRepoId!, status),
    enabled: !!selectedRepoId,
  });

  const visible = useMemo(() => {
    const list = query.data ?? [];
    if (scope === "mine") return list.filter((pr) => pr.createdBy?.id === me?.id);
    if (scope === "assigned") return list.filter((pr) => pr.reviewers.some((r) => r.id === me?.id));
    return list;
  }, [query.data, scope, me]);

  if (!selectedRepo) {
    return <Card className="p-8 text-center text-sm text-muted">Select a repository from the sidebar.</Card>;
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Pull requests</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">{selectedRepo.name}</h1>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-card p-0.5">
          {(["all", "mine", "assigned"] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                scope === s ? "bg-accent/10 text-accent" : "text-muted hover:text-ink"
              }`}
            >
              {s === "all" ? "All" : s === "mine" ? "Created by me" : "Assigned to me"}
            </button>
          ))}
        </div>
        <select
          className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-medium text-ink focus-visible:border-accent"
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading && <Spinner label="Loading pull requests…" />}
      {query.isError && <ErrorNote error={query.error} />}

      {query.data && (
        <div className="space-y-2">
          {visible.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} />
          ))}
          {visible.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-sm font-medium text-ink">Nothing here right now</p>
              <p className="mt-1 text-sm text-muted">
                No {status === "all" ? "" : status} pull requests
                {scope === "mine" ? " you created" : scope === "assigned" ? " assigned to you" : ""}.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function PullRequestRow({ pr }: { pr: PullRequestInfo }) {
  const verdict = prStatusVerdict(pr);
  return (
    <Link to={`/pulls/${pr.id}`} className="block">
      <Card className="p-4 transition-colors hover:border-accent/40">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted">!{pr.id}</span>
              <span className="truncate text-sm font-medium text-ink">{pr.title}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              <Mono>{pr.sourceBranch}</Mono> → <Mono>{pr.targetBranch}</Mono> · {pr.createdBy?.name ?? "Unknown"} ·{" "}
              {timeAgo(pr.creationDate)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <StatusPill light={verdict.light}>{verdict.headline}</StatusPill>
            <span className="text-xs text-muted">{reviewSummary(pr.reviewers)}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
