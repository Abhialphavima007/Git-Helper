import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type RepoState } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { timeAgo } from "../lib/git";
import { Card, ErrorNote, Mono, Spinner } from "../components/ui";

// One page that collects every way to take something back — from harmless
// (unstage) to nuclear (hard reset) — each explained in plain language so
// nobody has to know the git command behind it.

type ResetMode = "soft" | "mixed" | "hard";

const RESET_MODES: Array<{ mode: ResetMode; label: string; blurb: string }> = [
  { mode: "soft", label: "Keep the work, staged", blurb: "The undone commits disappear, but every change from them stays staged — ready to re-commit differently." },
  { mode: "mixed", label: "Keep the work, as edits", blurb: "The undone commits disappear and their changes come back as normal unsaved edits you can pick through." },
  { mode: "hard", label: "Discard everything", blurb: "The commits AND all their changes are thrown away, along with any uncommitted edits. Use only when you're sure." },
];

export function LocalUndoPage() {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preselect = params.get("commit") ?? "";

  const stateQuery = useQuery({
    queryKey: ["local-state", root],
    queryFn: () => api.local.getState(),
    enabled: !!root,
  });

  // Recent commits on the current branch, for the pickers.
  const graphQuery = useQuery({
    queryKey: ["local-graph", root, 50, false, "", false],
    queryFn: () => api.local.getGraph(50, false),
    enabled: !!root,
  });

  const reflogQuery = useQuery({
    queryKey: ["local-reflog", root],
    queryFn: () => api.local.reflog(30),
    enabled: !!root,
  });

  const s = stateQuery.data;
  const commits = graphQuery.data ?? [];

  const [revertPick, setRevertPick] = useState(preselect);
  const [resetPick, setResetPick] = useState(preselect);
  const [resetMode, setResetMode] = useState<ResetMode>("mixed");
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [showReflog, setShowReflog] = useState(false);

  function refreshAll(next?: RepoState) {
    if (next) qc.setQueryData(["local-state", root], next);
    else qc.invalidateQueries({ queryKey: ["local-state", root] });
    qc.invalidateQueries({ queryKey: ["local-graph"] });
    qc.invalidateQueries({ queryKey: ["local-branches"] });
    qc.invalidateQueries({ queryKey: ["local-reflog", root] });
  }

  const undoCommitM = useMutation({
    mutationFn: () => api.local.undoCommit(),
    onSuccess: (next) => {
      refreshAll(next);
      setActionError(null);
      setNotice("Last commit undone — its changes are staged again, ready on the Commit page.");
    },
    onError: (e) => setActionError(e),
  });

  const revertM = useMutation({
    mutationFn: (id: string) => api.local.revertCommit(id),
    onSuccess: (res) => {
      refreshAll(res.state);
      setActionError(null);
      if (res.conflicts) {
        navigate("/local/conflicts");
        return;
      }
      setNotice("Done — a new commit was created that cancels the picked one. Push when you're ready.");
    },
    onError: (e) => setActionError(e),
  });

  const resetM = useMutation({
    mutationFn: (args: { id: string; mode: ResetMode; force?: boolean }) =>
      api.local.reset(args.id, args.mode, args.force ?? false),
    onSuccess: (next) => {
      refreshAll(next);
      setActionError(null);
      setNotice("Branch rewound. Check Status to see where you are now.");
    },
    onError: (e) => setActionError(e),
  });

  const busy = undoCommitM.isPending || revertM.isPending || resetM.isPending;

  const canUndoLast = !!s?.headCommit && (!s.upstream || s.ahead > 0);

  const commitOptions = useMemo(
    () =>
      commits.map((c) => ({
        value: c.full,
        label: `${c.id} — ${c.subject.length > 60 ? c.subject.slice(0, 60) + "…" : c.subject}`,
      })),
    [commits]
  );

  function commitSelect(value: string, onChange: (v: string) => void, placeholder: string) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-xs text-ink focus-visible:border-accent"
      >
        <option value="">{placeholder}</option>
        {commitOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Undo &amp; restore</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">Take something back</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Git almost never loses work — there's a right-sized undo for every situation. They're ordered from
          mild to drastic; each one says when to use it.
        </p>
      </header>

      {stateQuery.isLoading && <Spinner label="Reading repository…" />}
      {stateQuery.isError && <ErrorNote error={stateQuery.error} />}
      {notice && (
        <div className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ink">
          {notice}
          <button onClick={() => setNotice(null)} className="ml-3 text-xs font-medium text-muted hover:text-ink">
            dismiss
          </button>
        </div>
      )}
      {actionError != null && <ErrorNote error={actionError} />}

      {s && (
        <div className="space-y-4">
          {/* 1. Unstage */}
          <UndoCard
            step="1"
            title="Unstage files"
            danger={false}
            when="You added files to the next commit (staged them) but changed your mind about including some."
            what="Takes files back out of the next commit. Your edits are untouched — they just won't be committed yet."
          >
            <Link to="/local/changes" className="inline-block rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
              Go to Changes → use “Unstage” {s.staged.length > 0 && `(${s.staged.length} staged now)`}
            </Link>
          </UndoCard>

          {/* 2. Stash */}
          <UndoCard
            step="2"
            title="Set changes aside (stash)"
            danger={false}
            when="Your edits aren't ready, but you need a clean repo — to switch branches, pull, or try something else."
            what="Tucks ALL current changes into a drawer. Nothing is lost; bring them back any time with Restore."
          >
            <Link to="/local" className="inline-block rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
              Go to Status → “Stash changes” {s.stashCount > 0 && `(${s.stashCount} stashed now)`}
            </Link>
          </UndoCard>

          {/* 3. Discard */}
          <UndoCard
            step="3"
            title="Discard uncommitted changes"
            danger
            when="You edited files and the edits turned out to be wrong — you want the files back the way the last commit had them."
            what="Deletes the selected edits permanently. This is the one undo that CANNOT itself be undone — if unsure, stash instead."
          >
            <Link to="/local/changes" className="inline-block rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
              Go to Changes → use “Discard” per file
            </Link>
          </UndoCard>

          {/* 4. Undo last commit */}
          <UndoCard
            step="4"
            title="Undo the last commit"
            danger={false}
            when="You just committed and immediately noticed a problem — wrong files, bad message, too early. Works only while the commit hasn't been pushed."
            what="Removes the commit but keeps every change from it staged, so you can fix things and commit again. Nothing is lost."
          >
            {s.headCommit ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted">
                  Last commit: <Mono>{s.headCommit.id}</Mono> {s.headCommit.subject}
                </span>
                <button
                  disabled={busy || !canUndoLast}
                  onClick={() => {
                    if (window.confirm("Undo the last commit? Its changes stay staged, so nothing is lost.")) undoCommitM.mutate();
                  }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Undo last commit
                </button>
                {!canUndoLast && (
                  <span className="text-xs text-muted">
                    Already pushed — use “Revert a commit” below instead.
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">No commits in this repository yet.</p>
            )}
          </UndoCard>

          {/* 5. Revert */}
          <UndoCard
            step="5"
            title="Revert a commit"
            danger={false}
            when="A commit (even an old one, even one that's already pushed and shared) turned out to be a mistake."
            what="Creates a NEW commit that does the exact opposite of the picked one. History isn't rewritten, so it's always safe — this is the right tool for anything already pushed. If the undo clashes with newer changes you'll be taken to the conflict resolver."
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">{commitSelect(revertPick, setRevertPick, "Pick the commit to cancel out…")}</div>
              <button
                disabled={busy || !revertPick}
                onClick={() => {
                  const c = commits.find((x) => x.full === revertPick);
                  if (window.confirm(`Revert "${c?.subject ?? revertPick.slice(0, 8)}"?\n\nA new commit will be created that cancels it. Your other commits are untouched.`))
                    revertM.mutate(revertPick);
                }}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {revertM.isPending ? "Reverting…" : "Revert commit"}
              </button>
            </div>
          </UndoCard>

          {/* 6. Reset */}
          <UndoCard
            step="6"
            title="Rewind the branch to a commit (reset)"
            danger
            when="The last few commits should never have happened, and none of them have been pushed yet — you want the branch back at an earlier point."
            what="Moves the branch pointer back to the commit you pick. What happens to the undone work depends on the option below. Blocked automatically if it would rewind commits that are already pushed (revert those instead)."
          >
            <div className="space-y-3">
              {commitSelect(resetPick, setResetPick, "Pick the commit to rewind to (it becomes the newest)…")}
              <div className="grid gap-2 sm:grid-cols-3">
                {RESET_MODES.map((m) => (
                  <label
                    key={m.mode}
                    className={`cursor-pointer rounded-lg border p-3 text-sm transition-colors ${
                      resetMode === m.mode ? "border-accent bg-accent/5" : "border-line hover:bg-paper"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium text-ink">
                      <input
                        type="radio"
                        name="reset-mode"
                        checked={resetMode === m.mode}
                        onChange={() => setResetMode(m.mode)}
                        className="accent-[rgb(var(--accent))]"
                      />
                      {m.label}
                      {m.mode === "hard" && (
                        <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-danger">destructive</span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{m.blurb}</span>
                  </label>
                ))}
              </div>
              <button
                disabled={busy || !resetPick}
                onClick={() => {
                  const c = commits.find((x) => x.full === resetPick);
                  const extra =
                    resetMode === "hard"
                      ? "\n\n⚠ DISCARD EVERYTHING: the undone commits AND any uncommitted edits are thrown away."
                      : "\n\nThe undone commits' changes are kept, as described in the option you chose.";
                  if (window.confirm(`Rewind the branch to ${c ? `"${c.subject}"` : resetPick.slice(0, 8)}?${extra}`))
                    resetM.mutate({ id: resetPick, mode: resetMode });
                }}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  resetMode === "hard" ? "bg-danger hover:opacity-90" : "bg-accent hover:bg-accent-hover"
                }`}
              >
                {resetM.isPending ? "Rewinding…" : "Rewind branch"}
              </button>
            </div>
          </UndoCard>

          {/* 7. Reflog rescue */}
          <UndoCard
            step="7"
            title="Rescue: recent positions of your branch"
            danger
            when="Something went really wrong — a bad rewind, a merge you regret — and you want the repo back the way it was 10 minutes ago."
            what="Git quietly records every place your branch has been (each commit, merge, pull, rewind…) and keeps it for ~90 days. Jumping back here discards uncommitted edits, but even a jump can be un-jumped from this same list."
          >
            {!showReflog ? (
              <button
                onClick={() => setShowReflog(true)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
              >
                Show recent positions
              </button>
            ) : reflogQuery.isLoading ? (
              <Spinner label="Reading the journal…" />
            ) : reflogQuery.isError ? (
              <ErrorNote error={reflogQuery.error} />
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
                {(reflogQuery.data ?? []).map((e, i) => (
                  <div
                    key={`${e.selector}-${i}`}
                    className="flex items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0"
                  >
                    <Mono>{e.short}</Mono>
                    <span className="min-w-0 flex-1 truncate text-ink" title={e.subject}>
                      {e.subject}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted sm:inline">{e.date ? timeAgo(e.date) : ""}</span>
                    {i === 0 ? (
                      <span className="shrink-0 rounded bg-line px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted">now</span>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Jump the repo back to this point?\n\n${e.subject}\n\nUncommitted edits will be discarded. You can jump forward again from this same list.`
                            )
                          )
                            resetM.mutate({ id: e.hash, mode: "hard", force: true });
                        }}
                        className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-paper"
                      >
                        Jump here
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </UndoCard>
        </div>
      )}
    </div>
  );
}

function UndoCard({
  step,
  title,
  when,
  what,
  danger,
  children,
}: {
  step: string;
  title: string;
  when: string;
  what: string;
  danger: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
            danger ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent"
          }`}
        >
          {step}
        </span>
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        {danger && (
          <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-danger">
            careful
          </span>
        )}
      </div>
      <dl className="mt-2.5 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="shrink-0 font-medium text-muted">When:</dt>
          <dd className="text-ink">{when}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-medium text-muted">What it does:</dt>
          <dd className="text-muted">{what}</dd>
        </div>
      </dl>
      <div className="mt-3">{children}</div>
    </Card>
  );
}
