import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type PullRequestInfo } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { prStatusVerdict, timeAgo, voteVerdict } from "../lib/git";
import { Card, ErrorNote, GuidanceBanner, Mono, Spinner, StatusDot, StatusPill } from "../components/ui";

export function PullRequestDetailPage() {
  const { selectedRepoId } = useConnection();
  const params = useParams();
  const prId = Number(params.prId);

  const prQuery = useQuery({
    queryKey: ["pr", selectedRepoId, prId],
    queryFn: () => api.getPullRequest(selectedRepoId!, prId),
    enabled: !!selectedRepoId && Number.isFinite(prId),
  });

  const threadsQuery = useQuery({
    queryKey: ["threads", selectedRepoId, prId],
    queryFn: () => api.getThreads(selectedRepoId!, prId),
    enabled: !!selectedRepoId && Number.isFinite(prId),
  });

  return (
    <div className="space-y-6">
      <Link to="/pulls" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover">
        ← All pull requests
      </Link>

      {prQuery.isLoading && <Spinner label="Loading pull request…" />}
      {prQuery.isError && <ErrorNote error={prQuery.error} />}

      {prQuery.data && (
        <>
          <header>
            <p className="font-mono text-xs text-muted">!{prQuery.data.id}</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-ink">{prQuery.data.title}</h1>
            <p className="mt-2 text-sm text-muted">
              <Mono>{prQuery.data.sourceBranch}</Mono> → <Mono>{prQuery.data.targetBranch}</Mono> · opened by{" "}
              {prQuery.data.createdBy?.name ?? "Unknown"} · {timeAgo(prQuery.data.creationDate)}
            </p>
          </header>

          <GuidanceBanner verdict={prStatusVerdict(prQuery.data)} />

          {prQuery.data.status === "active" && (
            <CompletePr repoId={selectedRepoId!} pr={prQuery.data} />
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-5 md:col-span-2">
              <h2 className="font-display text-sm font-semibold text-ink">Description</h2>
              {prQuery.data.description ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{prQuery.data.description}</p>
              ) : (
                <p className="mt-2 text-sm text-muted">No description was added.</p>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="font-display text-sm font-semibold text-ink">Reviewers</h2>
              {prQuery.data.reviewers.length === 0 && (
                <p className="mt-2 text-sm text-muted">No reviewers assigned.</p>
              )}
              <ul className="mt-3 space-y-2">
                {prQuery.data.reviewers.map((r) => {
                  const v = voteVerdict(r.vote);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <StatusDot light={v.light} />
                        <span className="truncate text-sm text-ink">{r.name}</span>
                        {r.isRequired && (
                          <span className="rounded bg-line px-1 py-0.5 text-[10px] uppercase text-muted">req</span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{v.text}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <section>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-ink">Comments</h2>
              {threadsQuery.isFetching && <span className="text-xs text-muted">refreshing…</span>}
            </div>

            {threadsQuery.isLoading && (
              <div className="mt-3">
                <Spinner />
              </div>
            )}
            {threadsQuery.isError && (
              <div className="mt-3">
                <ErrorNote error={threadsQuery.error} hint="Couldn't load the comment threads for this PR." />
              </div>
            )}
            {threadsQuery.data && threadsQuery.data.length === 0 && (
              <Card className="mt-3 p-6 text-center text-sm text-muted">No comments yet.</Card>
            )}
            {threadsQuery.data && threadsQuery.data.length > 0 && (
              <div className="mt-3 space-y-3">
                {threadsQuery.data.map((t) => (
                  <Card key={t.id} className="p-4">
                    {t.filePath && (
                      <p className="mb-2 font-mono text-xs text-muted">on {t.filePath}</p>
                    )}
                    <div className="space-y-3">
                      {t.comments.map((c) => (
                        <div key={c.id}>
                          <p className="text-xs text-muted">
                            <span className="font-medium text-ink">{c.author}</span> · {timeAgo(c.publishedDate)}
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{c.content}</p>
                        </div>
                      ))}
                    </div>
                    {t.status && t.status !== "active" && (
                      <div className="mt-3">
                        <StatusPill light={t.status === "fixed" || t.status === "closed" ? "ok" : "neutral"}>
                          {t.status}
                        </StatusPill>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const STRATEGY_LABELS: Array<{ value: string; label: string }> = [
  { value: "noFastForward", label: "Merge (no fast-forward)" },
  { value: "squash", label: "Squash commit" },
  { value: "rebase", label: "Rebase" },
  { value: "rebaseMerge", label: "Semi-linear (rebase + merge)" },
];

// Complete (merge) an active PR on Azure DevOps.
function CompletePr({ repoId, pr }: { repoId: string; pr: PullRequestInfo }) {
  const qc = useQueryClient();
  const [strategy, setStrategy] = useState("noFastForward");
  const [deleteSource, setDeleteSource] = useState(true);

  const completeM = useMutation({
    mutationFn: () =>
      api.completePullRequest(repoId, pr.id, { mergeStrategy: strategy, deleteSourceBranch: deleteSource }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr", repoId, pr.id] });
      qc.invalidateQueries({ queryKey: ["prs"] });
      qc.invalidateQueries({ queryKey: ["branches", repoId] });
    },
  });

  const canMerge = pr.mergeStatus === "succeeded";

  return (
    <Card className="p-5">
      <h2 className="font-display text-sm font-semibold text-ink">Complete this pull request</h2>
      <p className="mt-1 text-sm text-muted">
        Merge <Mono>{pr.sourceBranch}</Mono> into <Mono>{pr.targetBranch}</Mono> on Azure DevOps.
        {!canMerge && " This can't merge yet — resolve conflicts or wait for checks."}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">
          Strategy{" "}
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="ml-1 rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink focus-visible:border-accent"
          >
            {STRATEGY_LABELS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} />
          Delete source branch
        </label>
        <button
          onClick={() => completeM.mutate()}
          disabled={completeM.isPending || !canMerge}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {completeM.isPending ? "Completing…" : "Complete merge"}
        </button>
      </div>

      {completeM.isError && (
        <div className="mt-3">
          <ErrorNote error={completeM.error} hint="Completing a PR needs a PAT with Code: Read & write and merge permission." />
        </div>
      )}
      {completeM.isSuccess && (
        <p className="mt-3 text-sm font-medium text-ok">Merged. The pull request is now completed.</p>
      )}
    </Card>
  );
}
