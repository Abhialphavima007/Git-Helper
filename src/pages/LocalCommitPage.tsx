import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type RepoFile, type RepoState } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { changeLabel } from "../lib/git";
import { Card, ChangePill, DiffStat, ErrorNote, Mono, Spinner } from "../components/ui";
import { DiffView } from "../components/DiffView";

export function LocalCommitPage() {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [justCommitted, setJustCommitted] = useState<{ id: string; subject: string } | null>(null);

  const stateQuery = useQuery({
    queryKey: ["local-state", root],
    queryFn: () => api.local.getState(),
    enabled: !!root,
  });

  function applyState(next: RepoState) {
    qc.setQueryData(["local-state", root], next);
  }

  const mutation = useMutation({
    mutationFn: async (fn: () => Promise<RepoState>) => fn(),
    onSuccess: (next) => {
      applyState(next);
      setActionError(null);
    },
    onError: (err) => setActionError(err),
  });

  const [amendMode, setAmendMode] = useState(false);

  const commitMutation = useMutation({
    mutationFn: (msg: string) => (amendMode ? api.local.amend(msg) : api.local.commit(msg)),
    onSuccess: (res) => {
      applyState(res.state);
      setJustCommitted(res.committed);
      setMessage("");
      setAmendMode(false);
      setActionError(null);
      // The graph and branch views are now stale.
      qc.invalidateQueries({ queryKey: ["local-graph"] });
      qc.invalidateQueries({ queryKey: ["local-branches"] });
    },
    onError: (err) => setActionError(err),
  });

  const undoMutation = useMutation({
    mutationFn: () => api.local.undoCommit(),
    onSuccess: (next) => {
      applyState(next);
      setActionError(null);
      setJustCommitted(null);
      qc.invalidateQueries({ queryKey: ["local-graph"] });
      qc.invalidateQueries({ queryKey: ["local-branches"] });
    },
    onError: (err) => setActionError(err),
  });

  const s = stateQuery.data;
  const busy = mutation.isPending || commitMutation.isPending || undoMutation.isPending;
  const subject = message.split("\n")[0];
  const subjectLen = subject.trim().length;
  // Undo/amend only make sense for a commit that hasn't been pushed yet.
  const canRewrite = !!s?.headCommit && (!s.upstream || s.ahead > 0);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Commit</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">Stage &amp; commit changes</h1>
        </div>
        <Link to="/local" className="text-sm font-medium text-accent hover:text-accent-hover">
          ← Status
        </Link>
      </header>

      {stateQuery.isLoading && <Spinner label="Reading changes…" />}
      {stateQuery.isError && <ErrorNote error={stateQuery.error} />}
      {actionError != null && <ErrorNote error={actionError} />}

      {justCommitted && (
        <div className="rounded-xl border border-ok/30 bg-ok-bg px-4 py-3">
          <p className="text-sm font-semibold text-ok">Committed <Mono>{justCommitted.id}</Mono></p>
          <p className="mt-0.5 text-sm text-ink">{justCommitted.subject}</p>
          <p className="mt-1 text-xs text-muted">
            Ready to share it?{" "}
            <Link to="/local" className="font-medium text-accent hover:text-accent-hover">
              Go to Status to Push →
            </Link>
          </p>
        </div>
      )}

      {s && (
        <>
          {/* Staged */}
          <FileSection
            title="Staged — will be committed"
            files={s.staged}
            empty="Nothing staged yet. Stage changes below to include them in your commit."
            staged
            expanded={expanded}
            setExpanded={setExpanded}
            busy={busy}
            onAction={(files) => mutation.mutate(() => api.local.unstage(files))}
            actionLabel="Unstage"
            onActionAll={s.staged.length > 0 ? () => mutation.mutate(() => api.local.unstage(s.staged.map((f) => f.path))) : undefined}
            actionAllLabel="Unstage all"
          />

          {/* Unstaged + untracked */}
          <FileSection
            title="Changes — not staged"
            files={[...s.unstaged, ...s.untracked]}
            empty="No unstaged changes."
            staged={false}
            expanded={expanded}
            setExpanded={setExpanded}
            busy={busy}
            onAction={(files) => mutation.mutate(() => api.local.stage(files))}
            actionLabel="Stage"
            onActionAll={
              s.unstaged.length + s.untracked.length > 0
                ? () => mutation.mutate(() => api.local.stageAll())
                : undefined
            }
            actionAllLabel="Stage all"
          />

          {s.conflicted.length > 0 && (
            <Card className="border-danger/30 bg-danger-bg p-4">
              <p className="text-sm font-semibold text-danger">
                {s.conflicted.length} unresolved conflict{s.conflicted.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-sm text-ink">
                Resolve conflicts before committing the merge.{" "}
                <Link to="/local/conflicts" className="font-medium text-accent hover:text-accent-hover">
                  Go to conflict resolver →
                </Link>
              </p>
            </Card>
          )}

          {/* Commit box */}
          <Card className="p-5">
            <h2 className="font-display text-sm font-semibold text-ink">
              {amendMode ? "Amend the last commit" : "Commit message"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {amendMode
                ? "The staged changes and this message will replace the last commit."
                : "A good first line is a short summary in the imperative — “Add login retry”, not “added stuff”. Leave a blank line before any longer explanation."}
            </p>
            <textarea
              className="mt-3 h-32 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink focus-visible:border-accent"
              placeholder="Summarize the change…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className={subjectLen > 72 ? "text-warn" : "text-muted"}>
                Summary line: {subjectLen} char{subjectLen === 1 ? "" : "s"}
                {subjectLen > 72 ? " — consider keeping it under 72" : ""}
              </span>
              <span className="text-muted">{s.staged.length} file{s.staged.length === 1 ? "" : "s"} staged</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                disabled={busy || subjectLen === 0 || (!amendMode && s.staged.length === 0)}
                onClick={() => commitMutation.mutate(message.trim())}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {commitMutation.isPending ? (amendMode ? "Amending…" : "Committing…") : amendMode ? "Amend commit" : "Commit"}
              </button>
              {canRewrite && (
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={amendMode}
                    onChange={(e) => {
                      setAmendMode(e.target.checked);
                      if (e.target.checked && !message.trim() && s.headCommit) setMessage(s.headCommit.subject);
                    }}
                  />
                  Amend the last commit instead
                </label>
              )}
            </div>
            {!amendMode && s.staged.length === 0 && (
              <p className="mt-2 text-xs text-muted">Stage at least one file to commit.</p>
            )}
          </Card>

          {/* Last commit: undo (soft) while it hasn't been pushed */}
          {s.headCommit && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs text-muted">Last commit</p>
                <p className="truncate text-sm text-ink">
                  <Mono>{s.headCommit.id}</Mono> {s.headCommit.subject}
                </p>
              </div>
              <button
                disabled={busy || !canRewrite}
                title={
                  canRewrite
                    ? "Undo the commit but keep its changes staged"
                    : "Already pushed — undoing would rewrite shared history"
                }
                onClick={() => {
                  if (window.confirm("Undo the last commit? Its changes stay staged, so nothing is lost.")) {
                    undoMutation.mutate();
                  }
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
              >
                {undoMutation.isPending ? "Undoing…" : "Undo last commit"}
              </button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function FileSection({
  title,
  files,
  empty,
  staged,
  expanded,
  setExpanded,
  busy,
  onAction,
  actionLabel,
  onActionAll,
  actionAllLabel,
}: {
  title: string;
  files: RepoFile[];
  empty: string;
  staged: boolean;
  expanded: string | null;
  setExpanded: (v: string | null) => void;
  busy: boolean;
  onAction: (files: string[]) => void;
  actionLabel: string;
  onActionAll?: () => void;
  actionAllLabel?: string;
}) {
  const key = (f: RepoFile) => `${staged ? "s" : "u"}:${f.path}`;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-ink">
          {title} <span className="text-muted">({files.length})</span>
        </h2>
        {onActionAll && actionAllLabel && (
          <button
            disabled={busy}
            onClick={onActionAll}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50"
          >
            {actionAllLabel}
          </button>
        )}
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f) => {
            const cl = changeLabel(f.change);
            const isOpen = expanded === key(f);
            return (
              <li key={key(f)} className="py-2">
                <div className="flex items-center gap-2">
                  <ChangePill light={cl.light}>{cl.text}</ChangePill>
                  <button
                    onClick={() => setExpanded(isOpen ? null : key(f))}
                    className="min-w-0 flex-1 truncate text-left font-mono text-xs text-ink hover:text-accent"
                    title="Show diff"
                  >
                    {f.path}
                  </button>
                  <DiffStat added={f.added} removed={f.removed} />
                  <button
                    disabled={busy}
                    onClick={() => onAction([f.path])}
                    className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50"
                  >
                    {actionLabel}
                  </button>
                </div>
                {isOpen && f.change !== "untracked" && (
                  <div className="mt-2">
                    <DiffView file={f.path} staged={staged} />
                  </div>
                )}
                {isOpen && f.change === "untracked" && (
                  <p className="mt-2 p-3 text-xs text-muted">New file — not yet tracked, so there's no diff to show.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
