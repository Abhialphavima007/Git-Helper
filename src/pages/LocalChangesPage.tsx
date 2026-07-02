import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, ApiError, type RepoFile } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { changeLabel } from "../lib/git";
import { Card, ChangePill, DiffStat, ErrorNote, Mono, Spinner } from "../components/ui";
import { DiffView } from "../components/DiffView";
import { WorkflowStrip } from "../components/WorkflowStrip";

// A read-focused, GitHub-style overview of everything that changed in the
// working tree: per-file +/- counts and inline red/green diffs.
export function LocalChangesPage() {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["local-state", root],
    queryFn: () => api.local.getState(),
    enabled: !!root,
  });

  const discardM = useMutation({
    mutationFn: (files: string[]) => api.local.discard(files),
    onSuccess: (next) => {
      qc.setQueryData(["local-state", root], next);
      setActionError(null);
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Discard failed."),
  });

  function confirmDiscard(file: RepoFile) {
    const what = file.change === "untracked" ? "delete this new file" : "throw away all changes to this file";
    if (window.confirm(`Discard ${file.path}?\n\nThis will ${what}. This cannot be undone.`)) {
      discardM.mutate([file.path]);
    }
  }

  const s = query.data;

  // Each row knows whether to fetch the staged or working-tree diff.
  const rows: Array<{ file: RepoFile; staged: boolean; bucket: string }> = [];
  if (s) {
    for (const f of s.conflicted) rows.push({ file: f, staged: false, bucket: "Conflicted" });
    for (const f of s.staged) rows.push({ file: f, staged: true, bucket: "Staged" });
    for (const f of s.unstaged) rows.push({ file: f, staged: false, bucket: "Not staged" });
    for (const f of s.untracked) rows.push({ file: f, staged: false, bucket: "Untracked" });
  }

  const totalAdded = rows.reduce((n, r) => n + (r.file.added ?? 0), 0);
  const totalRemoved = rows.reduce((n, r) => n + (r.file.removed ?? 0), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Changes</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">Working-tree changes</h1>
          {s && (
            <p className="mt-1 text-sm text-muted">
              {rows.length} file{rows.length === 1 ? "" : "s"} changed ·{" "}
              <span className="font-mono text-ok">+{totalAdded}</span>{" "}
              <span className="font-mono text-danger">−{totalRemoved}</span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => query.refetch()}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <Link
            to="/local/commit"
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Stage &amp; commit →
          </Link>
        </div>
      </header>

      {query.isLoading && <Spinner label="Reading changes…" />}
      {query.isError && <ErrorNote error={query.error} />}
      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {s && <WorkflowStrip state={s} />}

      {s && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">
          No changes — the working tree is clean.
        </Card>
      )}

      {s && s.conflicted.length > 0 && (
        <Card className="border-danger/30 bg-danger-bg p-4">
          <p className="text-sm font-semibold text-danger">
            {s.conflicted.length} file{s.conflicted.length === 1 ? "" : "s"} in conflict
          </p>
          <p className="mt-0.5 text-sm text-ink">
            <Link to="/local/conflicts" className="font-medium text-accent hover:text-accent-hover">
              Resolve them →
            </Link>
          </p>
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="divide-y divide-line p-0">
          {rows.map((r) => {
            const cl = changeLabel(r.file.change);
            const key = `${r.bucket}:${r.file.path}`;
            const isOpen = expanded === key;
            return (
              <div key={key}>
                <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper">
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <ChangePill light={cl.light}>{cl.text}</ChangePill>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{r.file.path}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted">{r.bucket}</span>
                    <DiffStat added={r.file.added} removed={r.file.removed} />
                    <span className="shrink-0 text-muted">{isOpen ? "▾" : "▸"}</span>
                  </button>
                  {!r.file.conflicted && (
                    <button
                      onClick={() => confirmDiscard(r.file)}
                      disabled={discardM.isPending}
                      title="Throw away this change (cannot be undone)"
                      className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs font-medium text-muted hover:bg-danger-bg hover:text-danger disabled:opacity-50"
                    >
                      Discard
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="px-4 pb-3">
                    {r.file.conflicted ? (
                      <p className="p-3 text-xs text-muted">
                        This file has conflict markers. Use the{" "}
                        <Link to="/local/conflicts" className="text-accent hover:text-accent-hover">
                          conflict resolver
                        </Link>
                        .
                      </p>
                    ) : (
                      <DiffView file={r.file.path} staged={r.staged} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {s && !s.upstream && rows.length > 0 && (
        <p className="text-xs text-muted">
          Tip: commit these on a branch, then push to publish to <Mono>origin</Mono>.
        </p>
      )}
    </div>
  );
}
