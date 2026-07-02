import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type RepoFile, type RepoState } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { changeLabel, localStateVerdict } from "../lib/git";
import { Card, ChangePill, DiffStat, ErrorNote, GuidanceBanner, Mono, Spinner, StatusPill } from "../components/ui";
import { NetworkToolbar } from "../components/NetworkToolbar";
import { WorkflowStrip } from "../components/WorkflowStrip";
import type { Light } from "../lib/git";

function errText(err: unknown): string {
  if (err instanceof ApiError) return err.detail ? `${err.message} — ${err.detail}` : err.message;
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function LocalStatusPage() {
  const { name, root } = useLocalRepo();
  const qc = useQueryClient();
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const query = useQuery({
    queryKey: ["local-state", root],
    queryFn: () => api.local.getState(),
    enabled: !!root,
    refetchOnWindowFocus: true,
  });

  const branchesQuery = useQuery({
    queryKey: ["local-branches", root],
    queryFn: () => api.local.getBranches(),
    enabled: !!root,
  });

  function refreshAll(next?: RepoState) {
    if (next) qc.setQueryData(["local-state", root], next);
    qc.invalidateQueries({ queryKey: ["local-state", root] });
    qc.invalidateQueries({ queryKey: ["local-branches", root] });
    qc.invalidateQueries({ queryKey: ["local-graph"] });
  }

  const checkoutM = useMutation({
    mutationFn: (ref: string) => api.local.checkout(ref),
    onSuccess: (next, ref) => {
      refreshAll(next);
      setNote({ kind: "ok", text: `Switched to ${ref}.` });
    },
    onError: (e) =>
      setNote({
        kind: "err",
        text: `${errText(e)} Tip: stash your changes first if the switch is blocked by local edits.`,
      }),
  });

  const s = query.data;
  const branches = branchesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Working tree</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">{name}</h1>
          {s && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              <label>On branch</label>
              <select
                className="rounded-lg border border-line bg-card px-2 py-1 font-mono text-sm font-medium text-ink focus-visible:border-accent"
                value={s.detached ? "" : s.branch ?? ""}
                disabled={checkoutM.isPending}
                onChange={(e) => e.target.value && checkoutM.mutate(e.target.value)}
              >
                {s.detached && <option value="">(detached HEAD)</option>}
                {branches.map((b) => (
                  <option key={b.ref} value={b.ref}>
                    {b.name}
                    {b.isRemote ? "  (remote)" : ""}
                  </option>
                ))}
              </select>
              {s.upstream && (
                <span>
                  tracking <Mono>{s.upstream}</Mono>
                </span>
              )}
              {checkoutM.isPending && <span className="text-xs">switching…</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                await api.local.openInEditor();
              } catch (e) {
                setNote({ kind: "err", text: errText(e) });
              }
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            Open in VS Code
          </button>
          <button
            onClick={() => query.refetch()}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {query.isLoading && <Spinner label="Reading the working tree…" />}
      {query.isError && <ErrorNote error={query.error} />}
      {note && <p className={`text-sm ${note.kind === "ok" ? "text-ok" : "text-danger"}`}>{note.text}</p>}

      {s && (
        <>
          {/* The workflow at a glance: change → commit → push */}
          <WorkflowStrip state={s} />

          <GuidanceBanner verdict={localStateVerdict(s)} />

          <Card className="p-4">
            <NetworkToolbar state={s} />
          </Card>

          <StashSection state={s} onChanged={refreshAll} onNote={setNote} />

          <section>
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">Where's the issue?</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <AttentionItems state={s} />
            </div>
          </section>

          <FileGroups state={s} />
        </>
      )}
    </div>
  );
}

// Stash: park work-in-progress safely, restore it later. Shown whenever there
// is something to stash or something stashed.
function StashSection({
  state: s,
  onChanged,
  onNote,
}: {
  state: RepoState;
  onChanged: (next?: RepoState) => void;
  onNote: (n: { kind: "ok" | "err"; text: string }) => void;
}) {
  const { root } = useLocalRepo();
  const navigate = useNavigate();
  const dirty = s.staged.length + s.unstaged.length + s.untracked.length;

  const stashesQuery = useQuery({
    queryKey: ["local-stashes", root],
    queryFn: () => api.local.stashList(),
    enabled: !!root && s.stashCount > 0,
  });

  const qcInvalidate = () => onChanged();

  const saveM = useMutation({
    mutationFn: () => api.local.stashSave(),
    onSuccess: (next) => {
      onChanged(next);
      onNote({ kind: "ok", text: "Changes stashed. Restore them any time with “Restore”." });
    },
    onError: (e) => onNote({ kind: "err", text: errText(e) }),
  });

  const popM = useMutation({
    mutationFn: (ref?: string) => api.local.stashPop(ref),
    onSuccess: (res) => {
      onChanged(res.state);
      if (res.conflicts) {
        onNote({ kind: "err", text: "Restoring the stash caused conflicts — opening the resolver." });
        navigate("/local/conflicts");
      } else {
        onNote({ kind: "ok", text: "Stash restored to your working tree." });
      }
    },
    onError: (e) => onNote({ kind: "err", text: errText(e) }),
  });

  const dropM = useMutation({
    mutationFn: (ref: string) => api.local.stashDrop(ref),
    onSuccess: (next) => {
      onChanged(next);
      qcInvalidate();
      onNote({ kind: "ok", text: "Stash deleted." });
    },
    onError: (e) => onNote({ kind: "err", text: errText(e) }),
  });

  if (dirty === 0 && s.stashCount === 0) return null;
  const busy = saveM.isPending || popM.isPending || dropM.isPending;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold text-ink">Stash — park work for later</h2>
          <p className="mt-0.5 text-xs text-muted">
            Safely set aside uncommitted changes (e.g. to switch branches), then restore them when you're ready.
          </p>
        </div>
        {dirty > 0 && (
          <button
            disabled={busy}
            onClick={() => saveM.mutate()}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
          >
            {saveM.isPending ? "Stashing…" : `Stash ${dirty} change${dirty === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      {s.stashCount > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {(stashesQuery.data ?? []).map((st) => (
            <li key={st.ref} className="flex items-center gap-2">
              <Mono>{st.ref}</Mono>
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{st.message}</span>
              <button
                disabled={busy}
                onClick={() => popM.mutate(st.ref)}
                className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50"
              >
                Restore
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete ${st.ref}? Its changes will be lost.`)) dropM.mutate(st.ref);
                }}
                className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-muted hover:bg-paper hover:text-danger disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          ))}
          {stashesQuery.isLoading && <Spinner />}
        </ul>
      )}
    </Card>
  );
}

// Turns the raw state into a short list of actionable "go here next" cards.
function AttentionItems({ state: s }: { state: RepoState }) {
  const items: Array<{ light: Light; title: string; body: string; to?: string; cta?: string }> = [];

  if (s.conflicted.length > 0) {
    items.push({
      light: "danger",
      title: `${s.conflicted.length} conflict${s.conflicted.length === 1 ? "" : "s"}`,
      body: "These files changed on both sides and must be resolved before the merge can finish.",
      to: "/local/conflicts",
      cta: "Resolve conflicts",
    });
  }
  if (s.behind > 0) {
    items.push({
      light: "warn",
      title: `${s.behind} to pull`,
      body: `The upstream has ${s.behind} commit${s.behind === 1 ? "" : "s"} you don't have yet. Pull to catch up.`,
    });
  }
  if (s.ahead > 0) {
    items.push({
      light: "ok",
      title: `${s.ahead} to push`,
      body: `You have ${s.ahead} commit${s.ahead === 1 ? "" : "s"} not on the upstream yet. Use Push above to share them.`,
    });
  }
  const dirty = s.staged.length + s.unstaged.length + s.untracked.length;
  if (dirty > 0) {
    items.push({
      light: "neutral",
      title: `${dirty} uncommitted change${dirty === 1 ? "" : "s"}`,
      body: "Review what changed, stage what belongs together, and commit it.",
      to: "/local/changes",
      cta: "Review changes",
    });
  }
  if (items.length === 0) {
    items.push({
      light: "ok",
      title: "All clear — what's next?",
      body: "Clean tree, in sync. Edit files in your editor and come back to review, or explore the history and branches.",
    });
  }

  return (
    <>
      {items.map((it, i) => (
        <Card key={i} className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">{it.title}</h3>
            <StatusPill light={it.light}>{it.light === "danger" ? "blocked" : it.light === "warn" ? "attention" : it.light === "ok" ? "ok" : "info"}</StatusPill>
          </div>
          <p className="text-sm text-muted">{it.body}</p>
          {it.to && it.cta ? (
            <Link
              to={it.to}
              className="self-start rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {it.cta} →
            </Link>
          ) : it.light === "ok" && it.title.startsWith("All clear") ? (
            <div className="flex flex-wrap gap-2">
              <Link to="/local/graph" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
                View history
              </Link>
              <Link to="/local/branches" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
                Branches
              </Link>
            </div>
          ) : null}
        </Card>
      ))}
    </>
  );
}

function FileGroups({ state: s }: { state: RepoState }) {
  const groups: Array<{ title: string; files: RepoFile[] }> = [
    { title: "Conflicted", files: s.conflicted },
    { title: "Staged", files: s.staged },
    { title: "Changed (not staged)", files: s.unstaged },
    { title: "New (untracked)", files: s.untracked },
  ].filter((g) => g.files.length > 0);

  if (groups.length === 0) return null;

  return (
    <section className="space-y-4">
      {groups.map((g) => (
        <Card key={g.title} className="p-4">
          <h3 className="mb-2 font-display text-sm font-semibold text-ink">
            {g.title} <span className="text-muted">({g.files.length})</span>
          </h3>
          <ul className="space-y-1.5">
            {g.files.map((f) => {
              const cl = changeLabel(f.change);
              return (
                <li key={f.path} className="flex items-center gap-2">
                  <ChangePill light={cl.light}>{cl.text}</ChangePill>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.path}</span>
                  <DiffStat added={f.added} removed={f.removed} />
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </section>
  );
}
