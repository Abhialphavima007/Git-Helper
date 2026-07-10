import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type RepoState, type ScenarioReport } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { timeAgo } from "../lib/git";
import { Card, ErrorNote, Mono, Spinner } from "../components/ui";
import { ConfirmDialog, ConfirmRow } from "../components/ConfirmDialog";

// The repo doctor. Fetches first (so ahead/behind is honest), detects known
// awkward situations, explains each in plain language with the exact git
// command it would run, and never executes anything without a confirm —
// destructive ones demand typed confirmation. Every action lands in the
// history panel below with a "how to undo" note.

const BEHIND_WARN = 10;
const BEHIND_LOUD = 30;

type DialogKind = "reset-remote" | "discard-all" | "move-commits" | null;

export function RecoveryPage() {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [moveName, setMoveName] = useState("");
  const [rescueBranch, setRescueBranch] = useState("");
  const [checkoutPick, setCheckoutPick] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const scan = useQuery({
    queryKey: ["local-scenarios", root],
    queryFn: () => api.local.scenarios(true),
    enabled: !!root,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const log = useQuery({
    queryKey: ["local-actions", root],
    queryFn: () => api.local.actions(),
    enabled: !!root,
  });

  function refreshAll(next?: RepoState) {
    if (next) qc.setQueryData(["local-state", root], next);
    else qc.invalidateQueries({ queryKey: ["local-state", root] });
    qc.invalidateQueries({ queryKey: ["local-graph"] });
    qc.invalidateQueries({ queryKey: ["local-branches"] });
    qc.invalidateQueries({ queryKey: ["local-scenarios", root] });
    qc.invalidateQueries({ queryKey: ["local-actions", root] });
  }

  function ok(text: string) {
    setNotice(text);
    setActionError(null);
    setDialog(null);
  }
  function fail(e: unknown) {
    setActionError(e);
    setDialog(null);
  }

  const resetRemoteM = useMutation({
    mutationFn: () => api.local.resetToRemote(),
    onSuccess: (r) => {
      refreshAll(r.state);
      ok(`Done — the branch now matches its remote exactly. (Changed your mind? Rescue point: ${r.prevHead.slice(0, 8)} in Undo & restore.)`);
    },
    onError: fail,
  });

  const discardAllM = useMutation({
    mutationFn: () => api.local.discardAll(),
    onSuccess: (state) => {
      refreshAll(state);
      ok("All uncommitted changes were discarded. The working tree is clean.");
    },
    onError: fail,
  });

  const stashInsteadM = useMutation({
    mutationFn: () => api.local.stashSave("Recovery: set aside instead of discarding"),
    onSuccess: (state) => {
      refreshAll(state);
      ok("Changes were stashed instead — nothing lost. Restore them any time from Status → Stash.");
    },
    onError: fail,
  });

  const moveCommitsM = useMutation({
    mutationFn: (name: string) => api.local.moveCommits(name),
    onSuccess: (r) => {
      refreshAll(r.state);
      ok(`Your commits now live on "${r.state.branch}" and the original branch matches its remote again.`);
    },
    onError: fail,
  });

  const checkoutM = useMutation({
    mutationFn: (name: string) => api.local.checkout(name),
    onSuccess: (state) => {
      refreshAll(state);
      ok(`Now on branch ${state.branch}.`);
    },
    onError: fail,
  });

  const rescueBranchM = useMutation({
    mutationFn: (name: string) => api.local.createBranch(name),
    onSuccess: (state) => {
      refreshAll(state);
      ok(`Saved — your work now lives on branch "${state.branch}". Nothing can be lost anymore.`);
    },
    onError: fail,
  });

  const stashPopM = useMutation({
    mutationFn: (ref: string) => api.local.stashPop(ref),
    onSuccess: (res) => {
      refreshAll(res.state);
      if (res.conflicts) {
        navigate("/local/conflicts");
        return;
      }
      ok("Stash restored — the changes are back in your working tree.");
    },
    onError: fail,
  });

  const busy =
    resetRemoteM.isPending ||
    discardAllM.isPending ||
    stashInsteadM.isPending ||
    moveCommitsM.isPending ||
    checkoutM.isPending ||
    rescueBranchM.isPending ||
    stashPopM.isPending;

  const s = scan.data;

  // Which scenarios apply right now?
  const showResetRemote = !!s && !s.detached && !!s.upstream && s.ahead > 0 && s.clean;
  const noiseOnly = showResetRemote && s!.aheadFiles.length === 0;
  const showAccidentalMerge = !!s && s.headIsMergeByUser && s.ahead > 0;
  const showUndoLast = !!s && !s.detached && s.ahead > 0 && !s.headIsMergeByUser;
  const showDiscardAll = !!s && s.dirtyFiles.length > 0;
  const showWrongBranch = !!s && s.looksLikeOthersBranch && s.ahead > 0 && !s.detached;
  const showDetached = !!s && s.detached;
  const showBehind = !!s && !s.detached && s.behind >= BEHIND_WARN;
  const showStash = !!s && s.stashCount > 0;
  const anyScenario =
    showResetRemote || showAccidentalMerge || showUndoLast || showDiscardAll || showWrongBranch || showDetached || showBehind || showStash;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Recovery &amp; sync</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">Repo check-up</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Git Helper fetched the latest remote info, then checked this repository for situations that usually
            confuse people. Each card explains what's going on, shows the exact command it would run, and asks
            before doing anything.
          </p>
        </div>
        <button
          onClick={() => scan.refetch()}
          disabled={scan.isFetching}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
        >
          {scan.isFetching ? "Scanning…" : "Re-scan"}
        </button>
      </header>

      {scan.isLoading && <Spinner label="Fetching from the remote and scanning…" />}
      {scan.isError && <ErrorNote error={scan.error} />}
      {s?.fetchError && (
        <p className="rounded-xl bg-warn/10 px-4 py-2.5 text-sm text-ink">⚠ {s.fetchError}</p>
      )}
      {notice && (
        <div className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ink">
          {notice}
          <button onClick={() => setNotice(null)} className="ml-3 text-xs font-medium text-muted hover:text-ink">
            dismiss
          </button>
        </div>
      )}
      {actionError != null && <ErrorNote error={actionError} />}

      {s && !anyScenario && (
        <Card className="flex items-center gap-3 p-6">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-ok/10 text-lg">✓</span>
          <div>
            <h2 className="font-display text-base font-semibold text-ink">All clear</h2>
            <p className="text-sm text-muted">
              No awkward situations detected — branch <Mono>{s.branch ?? "?"}</Mono> is{" "}
              {s.upstream ? `↑${s.ahead} ↓${s.behind} vs ${s.upstream}` : "not tracking a remote"}, working tree{" "}
              {s.clean ? "clean" : "has changes"}.
            </p>
          </div>
        </Card>
      )}

      {s && (
        <div className="space-y-4">
          {/* Scenario 7: behind remote */}
          {showBehind && (
            <ScenarioCard
              tone={s.behind >= BEHIND_LOUD ? "red" : "yellow"}
              title={`Your copy is outdated by ${s.behind} commits`}
              light={s.behind >= BEHIND_LOUD ? "red" : "yellow"}
            >
              <Expl>
                The remote <Mono>{s.upstream}</Mono> has moved on while this copy stood still. The longer you
                wait, the more likely a conflict when you finally sync.
              </Expl>
              {s.ahead > 0 ? (
                <Expl label="You also have local commits:">
                  Pulling will <b>merge</b> the remote's {s.behind} commits with your {s.ahead} — both sides are
                  kept and git combines them (you may be asked to resolve overlaps). That's the safe, normal
                  thing to do here.
                </Expl>
              ) : (
                <Expl label="Good news:">
                  You have no local-only commits, so pulling simply moves you forward — no merging, nothing to
                  lose.
                </Expl>
              )}
              <CmdRow cmd="git pull" />
              <div className="flex gap-2">
                <Link to="/local" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover">
                  Go to Status → Pull
                </Link>
              </div>
            </ScenarioCard>
          )}

          {/* Scenario 2: accidental merge commit */}
          {showAccidentalMerge && (
            <ScenarioCard tone="yellow" title="Your last commit is a merge — accidental pull?" light="yellow">
              <Expl>
                The newest commit on <Mono>{s.branch}</Mono> is a merge commit made by you. This often happens
                when you click Pull while the branch had local changes. <b>The remote is NOT affected until you
                push</b> — right now this only exists on your machine.
              </Expl>
              <Expl label="Your options:">
                If it was intentional, just keep working (or push). If it was an accident, undo it below — the
                branch goes back to exactly what the remote has.
              </Expl>
              <CmdRow cmd={`git reset --hard ${s.upstream}`} />
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={busy || !s.clean}
                  onClick={() => setDialog("reset-remote")}
                  className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  Undo the merge (reset to remote)
                </button>
                <Link to="/local" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
                  Keep it — go push
                </Link>
              </div>
              {!s.clean && <p className="text-xs text-muted">Undo is disabled while you have uncommitted changes — stash or discard them first.</p>}
            </ScenarioCard>
          )}

          {/* Scenario 1 + 10: reset to remote */}
          {showResetRemote && !showAccidentalMerge && (
            <ScenarioCard
              tone={noiseOnly ? "green" : "yellow"}
              title={
                noiseOnly
                  ? "Your local commits change nothing — safe to clean up"
                  : `${s.ahead} local commit${s.ahead === 1 ? "" : "s"} not on the remote`
              }
              light={noiseOnly ? "green" : "yellow"}
            >
              <Expl>
                Branch <Mono>{s.branch}</Mono> is {s.ahead} commit{s.ahead === 1 ? "" : "s"} ahead of{" "}
                <Mono>{s.upstream}</Mono>. If these commits shouldn't exist (test commits, an accidental merge,
                changes that cancel out), you can make the branch identical to the remote again.
              </Expl>
              <div>
                <p className="text-xs font-medium text-muted">Commits that would be discarded:</p>
                <ul className="mt-1 space-y-1">
                  {s.aheadCommits.slice(0, 6).map((c) => (
                    <li key={c.full} className="text-sm text-ink">
                      <Mono>{c.id}</Mono> {c.subject} <span className="text-xs text-muted">· {c.author}</span>
                    </li>
                  ))}
                  {s.aheadCommits.length > 6 && <li className="text-xs text-muted">…and {s.aheadCommits.length - 6} more</li>}
                </ul>
              </div>
              {noiseOnly ? (
                <p className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ink">
                  ✓ <b>Safe — no file changes will be lost.</b> The net difference between your branch and the
                  remote is empty: these commits cancel themselves out.
                </p>
              ) : (
                <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-ink">
                  <p className="font-medium text-danger">⚠ These file changes exist only in your local commits and would be lost:</p>
                  <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-xs">
                    {s.aheadFiles.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-muted">
                    Want to keep them but off this branch? Use "Move commits to a new branch" below if shown, or
                    revert instead from Undo &amp; restore.
                  </p>
                </div>
              )}
              <CmdRow cmd={`git reset --hard ${s.upstream}`} />
              <button
                disabled={busy}
                onClick={() => setDialog("reset-remote")}
                className={`w-fit rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${
                  noiseOnly ? "bg-accent hover:bg-accent-hover" : "bg-danger hover:opacity-90"
                }`}
              >
                Reset to remote…
              </button>
            </ScenarioCard>
          )}

          {/* Scenario 3: undo last commit */}
          {showUndoLast && (
            <ScenarioCard tone="blue" title="Committed too early or with the wrong message?" light="green">
              <Expl>
                Your newest commit{s.ahead > 1 ? "s haven't" : " hasn't"} been pushed yet, so{" "}
                {s.ahead > 1 ? "the last one" : "it"} can be taken back without anyone noticing.{" "}
                <b>Your changes stay staged; only the commit is undone.</b> (Already-pushed commits are blocked
                from this — revert those instead.)
              </Expl>
              <CmdRow cmd="git reset --soft HEAD~1" />
              <Link to="/local/undo" className="w-fit rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
                Open Undo &amp; restore → Undo last commit
              </Link>
            </ScenarioCard>
          )}

          {/* Scenario 5: wrong branch */}
          {showWrongBranch && (
            <ScenarioCard tone="yellow" title={`This looks like ${s.dominantAuthor?.name ?? "someone else"}'s branch`} light="yellow">
              <Expl>
                {s.dominantAuthor?.share ?? 0}% of the recent pushed commits on <Mono>{s.branch}</Mono> were
                authored by <b>{s.dominantAuthor?.name}</b> — but your {s.ahead} newest commit
                {s.ahead === 1 ? " is" : "s are"} local-only. If you meant to work on your own branch, move your
                commits to a fresh one and put this branch back the way it was.
              </Expl>
              <CmdRow cmd={`git branch <new-name> && git reset --hard ${s.upstream} && git checkout <new-name>`} />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={moveName}
                  onChange={(e) => setMoveName(e.target.value)}
                  placeholder={`${(s.userName || "my").split(" ")[0].toLowerCase()}/${(s.branch ?? "work").replace(/[^\w-]/g, "-")}-fix`}
                  className="rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-sm text-ink focus-visible:border-accent"
                />
                <button
                  disabled={busy || !moveName.trim()}
                  onClick={() => setDialog("move-commits")}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Move my {s.ahead} commit{s.ahead === 1 ? "" : "s"} to this new branch…
                </button>
              </div>
            </ScenarioCard>
          )}

          {/* Scenario 6: detached HEAD */}
          {showDetached && (
            <ScenarioCard tone="red" title="You're not on any branch (detached HEAD)" light="red">
              <Expl>
                The repo is parked on a specific commit instead of a branch. <b>Commits made here can be lost</b>{" "}
                when you switch away. Either save this spot to a new branch (keeps everything), or jump back to
                an existing branch.
              </Expl>
              <CmdRow cmd="git checkout -b <new-branch>   (save)   ·   git checkout <branch>   (leave)" />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={rescueBranch}
                  onChange={(e) => setRescueBranch(e.target.value)}
                  placeholder="rescue/my-work"
                  className="rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-sm text-ink focus-visible:border-accent"
                />
                <button
                  disabled={busy || !rescueBranch.trim()}
                  onClick={() => rescueBranchM.mutate(rescueBranch.trim())}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Save my work to this branch
                </button>
                <span className="text-xs text-muted">or</span>
                <select
                  value={checkoutPick}
                  onChange={(e) => setCheckoutPick(e.target.value)}
                  className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink focus-visible:border-accent"
                >
                  <option value="">Jump to existing branch…</option>
                  {s.localBranches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy || !checkoutPick}
                  onClick={() => checkoutM.mutate(checkoutPick)}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
                >
                  Check out
                </button>
              </div>
            </ScenarioCard>
          )}

          {/* Scenario 4: discard all */}
          {showDiscardAll && (
            <ScenarioCard tone="yellow" title={`${s.dirtyFiles.length} uncommitted file change${s.dirtyFiles.length === 1 ? "" : "s"}`} light="yellow">
              <Expl>
                If these edits are unwanted, you can wipe the working tree back to the last commit. If you're
                even slightly unsure, <b>stash instead</b> — it's fully reversible.
              </Expl>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-paper px-3 py-2 font-mono text-xs text-ink">
                {s.dirtyFiles.map((f) => (
                  <div key={f}>{f}</div>
                ))}
              </div>
              <CmdRow cmd="git restore --staged --worktree . && git clean -fd" />
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={busy}
                  onClick={() => stashInsteadM.mutate()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Stash instead (safe)
                </button>
                <button
                  disabled={busy}
                  onClick={() => setDialog("discard-all")}
                  className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  Discard everything…
                </button>
              </div>
            </ScenarioCard>
          )}

          {/* Scenario 9: forgotten stashes */}
          {showStash && (
            <ScenarioCard tone="blue" title={`${s.stashCount} stashed change set${s.stashCount === 1 ? "" : "s"} waiting`} light="green">
              <Expl>
                You set changes aside earlier — don't forget them. Restoring puts them back into your working
                tree (a clash opens the conflict resolver; nothing is lost).
              </Expl>
              <div className="space-y-1.5">
                {s.stashes.map((st) => (
                  <div key={st.ref} className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2">
                    <Mono>{st.ref}</Mono>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{st.message}</span>
                    <button
                      disabled={busy}
                      onClick={() => stashPopM.mutate(st.ref)}
                      className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-card disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </ScenarioCard>
          )}
        </div>
      )}

      {/* Action history with how-to-undo notes */}
      <section>
        <h2 className="font-display text-base font-semibold text-ink">What Git Helper did in this repo</h2>
        <p className="mt-1 text-sm text-muted">Every action, newest first, each with the way back.</p>
        <div className="mt-3 space-y-2">
          {(log.data ?? []).length === 0 && (
            <Card className="p-4 text-sm text-muted">Nothing yet — actions you run will appear here with undo notes.</Card>
          )}
          {(log.data ?? []).map((e, i) => (
            <Card key={`${e.ts}-${i}`} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{e.action}</span>
                <span className="text-xs text-muted">{timeAgo(e.ts)}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{e.detail}</p>
              <p className="mt-1.5 text-xs text-ink">
                <span className="font-medium text-accent">How to undo:</span> {e.undo}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* Confirmations */}
      {dialog === "reset-remote" && s && (
        <ConfirmDialog
          title={`Reset ${s.branch} to ${s.upstream}`}
          confirmLabel="Yes, reset to remote"
          danger={s.aheadFiles.length > 0}
          busy={resetRemoteM.isPending}
          requireText={s.aheadFiles.length > 0 ? "reset" : undefined}
          onConfirm={() => resetRemoteM.mutate()}
          onCancel={() => setDialog(null)}
        >
          <ConfirmRow label="What will happen:">
            Your branch pointer moves back to exactly <span className="font-mono text-xs">{s.upstream}</span>,
            discarding {s.ahead} local commit{s.ahead === 1 ? "" : "s"}. Runs:{" "}
            <span className="font-mono text-xs">git reset --hard {s.upstream}</span>
          </ConfirmRow>
          <ConfirmRow label="What it affects:">
            Only your local copy — the remote is untouched.{" "}
            {s.aheadFiles.length === 0
              ? "No file content differs from the remote, so nothing is lost."
              : `${s.aheadFiles.length} file(s) differ from the remote and those local versions WILL be lost.`}
          </ConfirmRow>
          <ConfirmRow label="Way back:">
            The old position stays in git's journal (~90 days) — Undo &amp; restore → Rescue.
          </ConfirmRow>
        </ConfirmDialog>
      )}

      {dialog === "discard-all" && s && (
        <ConfirmDialog
          title={`Discard all ${s.dirtyFiles.length} uncommitted change${s.dirtyFiles.length === 1 ? "" : "s"}`}
          confirmLabel="Yes, discard everything"
          danger
          busy={discardAllM.isPending}
          requireText="discard"
          onConfirm={() => discardAllM.mutate()}
          onCancel={() => setDialog(null)}
        >
          <ConfirmRow label="What will happen:">
            Every edited file goes back to the last commit and every untracked file/folder is deleted. Runs:{" "}
            <span className="font-mono text-xs">git restore --staged --worktree . &amp;&amp; git clean -fd</span>
          </ConfirmRow>
          <ConfirmRow label="What it affects:">
            Your uncommitted work only — commits and the remote are untouched.
          </ConfirmRow>
          <ConfirmRow label="Way back:">
            <b className="text-danger">None.</b> Uncommitted changes are unrecoverable once discarded — Stash
            instead if unsure.
          </ConfirmRow>
        </ConfirmDialog>
      )}

      {dialog === "move-commits" && s && (
        <ConfirmDialog
          title={`Move ${s.ahead} commit${s.ahead === 1 ? "" : "s"} to "${moveName.trim()}"`}
          confirmLabel="Yes, move my commits"
          busy={moveCommitsM.isPending}
          onConfirm={() => moveCommitsM.mutate(moveName.trim())}
          onCancel={() => setDialog(null)}
        >
          <ConfirmRow label="What will happen:">
            A new branch <span className="font-mono text-xs">{moveName.trim()}</span> is created holding your
            commits, <span className="font-mono text-xs">{s.branch}</span> is put back to exactly{" "}
            <span className="font-mono text-xs">{s.upstream}</span>, and you're switched to the new branch.
          </ConfirmRow>
          <ConfirmRow label="What it affects:">
            Only your local copy — nothing is pushed. No work is lost; it just changes address.
          </ConfirmRow>
        </ConfirmDialog>
      )}
    </div>
  );
}

// ---- presentation helpers ----

function ScenarioCard({
  title,
  tone,
  light,
  children,
}: {
  title: string;
  tone: "red" | "yellow" | "green" | "blue";
  light: "red" | "yellow" | "green";
  children: ReactNode;
}) {
  const border =
    tone === "red" ? "border-danger/40" : tone === "yellow" ? "border-warn/40" : "border-line";
  const dot = light === "red" ? "bg-danger" : light === "yellow" ? "bg-warn" : "bg-ok";
  return (
    <Card className={`space-y-3 border p-5 ${border}`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

function Expl({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <p className="text-sm text-muted">
      {label && <span className="font-medium text-ink">{label} </span>}
      {children}
    </p>
  );
}

function CmdRow({ cmd }: { cmd: string }) {
  return (
    <p className="w-fit rounded-lg bg-paper px-3 py-1.5 font-mono text-xs text-ink" title="The exact git command this action runs">
      $ {cmd}
    </p>
  );
}
