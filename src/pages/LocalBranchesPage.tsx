import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type LocalBranch } from "../api/client";
import { ApiError } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { timeAgo } from "../lib/git";
import { Card, ErrorNote, Mono, Spinner } from "../components/ui";

export function LocalBranchesPage() {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["local-branches", root],
    queryFn: () => api.local.getBranches(),
    enabled: !!root,
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["local-branches", root] });
    qc.invalidateQueries({ queryKey: ["local-state", root] });
    qc.invalidateQueries({ queryKey: ["local-graph"] });
  }

  function errText(err: unknown): string {
    if (err instanceof ApiError) return err.detail ? `${err.message} — ${err.detail}` : err.message;
    return err instanceof Error ? err.message : "Something went wrong.";
  }

  const checkoutM = useMutation({
    mutationFn: (name: string) => api.local.checkout(name),
    onSuccess: (_d, name) => {
      invalidateAll();
      setNote({ kind: "ok", text: `Switched to ${name}.` });
    },
    onError: (e) => setNote({ kind: "err", text: errText(e) }),
  });

  const createM = useMutation({
    mutationFn: (name: string) => api.local.createBranch(name),
    onSuccess: (_d, name) => {
      invalidateAll();
      setNewName("");
      setNote({ kind: "ok", text: `Created and switched to ${name}.` });
    },
    onError: (e) => setNote({ kind: "err", text: errText(e) }),
  });

  const mergeM = useMutation({
    mutationFn: (name: string) => api.local.merge(name),
    onSuccess: (res, name) => {
      invalidateAll();
      if (res.conflicts) {
        setNote({ kind: "err", text: `Merging ${name} caused conflicts — opening the resolver.` });
        navigate("/local/conflicts");
      } else {
        setNote({ kind: "ok", text: `Merged ${name} into the current branch.` });
      }
    },
    onError: (e) => setNote({ kind: "err", text: errText(e) }),
  });

  const deleteM = useMutation({
    mutationFn: (name: string) => api.local.deleteBranch(name, false),
    onSuccess: (_d, name) => {
      invalidateAll();
      setNote({ kind: "ok", text: `Deleted ${name}.` });
    },
    onError: (e) => setNote({ kind: "err", text: errText(e) }),
  });

  const busy = checkoutM.isPending || createM.isPending || mergeM.isPending || deleteM.isPending;
  const branches = branchesQuery.data ?? [];
  const current = branches.find((b) => b.current);

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Branches</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">Manage branches</h1>
        {current && (
          <p className="mt-1 text-sm text-muted">
            On <Mono>{current.name}</Mono>. Merges land here.
          </p>
        )}
      </header>

      <Card className="p-4">
        <label className="mb-1 block text-sm font-medium text-ink">Create a branch from the current one</label>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink focus-visible:border-accent"
            placeholder="feature/my-change"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            spellCheck={false}
          />
          <button
            disabled={busy || !newName.trim()}
            onClick={() => createM.mutate(newName.trim())}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </Card>

      {note && <p className={`text-sm ${note.kind === "ok" ? "text-ok" : "text-danger"}`}>{note.text}</p>}

      {branchesQuery.isLoading && <Spinner label="Loading branches…" />}
      {branchesQuery.isError && <ErrorNote error={branchesQuery.error} />}

      <div className="space-y-2">
        {branches.map((b) => (
          <BranchRow
            key={b.name}
            branch={b}
            isCurrent={!!b.current}
            busy={busy}
            expanded={expanded === b.name}
            onToggle={() => setExpanded(expanded === b.name ? null : b.name)}
            onSwitch={() => checkoutM.mutate(b.name)}
            onMerge={() => mergeM.mutate(b.name)}
            onDelete={() => deleteM.mutate(b.name)}
          />
        ))}
      </div>
    </div>
  );
}

function BranchRow({
  branch,
  isCurrent,
  busy,
  expanded,
  onToggle,
  onSwitch,
  onMerge,
  onDelete,
}: {
  branch: LocalBranch;
  isCurrent: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSwitch: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const { root } = useLocalRepo();
  const commitsQuery = useQuery({
    queryKey: ["branch-commits", root, branch.name],
    queryFn: () => api.local.branchCommits(branch.name),
    enabled: expanded,
  });

  const btn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-50";

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button onClick={onToggle} className="truncate font-mono text-sm font-medium text-ink hover:text-accent">
              {expanded ? "▾" : "▸"} {branch.name}
            </button>
            {isCurrent && (
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent">
                current
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted">
            {branch.upstream ? (
              <>
                ↑{branch.ahead} ↓{branch.behind} vs <Mono>{branch.upstream}</Mono> ·{" "}
              </>
            ) : (
              "no upstream · "
            )}
            {branch.lastCommit ? (
              <>
                <Mono>{branch.lastCommit.id}</Mono> {branch.lastCommit.message} · {timeAgo(branch.lastCommit.date)}
              </>
            ) : (
              "no commits"
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!isCurrent && (
            <>
              <button className={btn} disabled={busy} onClick={onSwitch}>
                Switch
              </button>
              <button className={btn} disabled={busy} onClick={onMerge}>
                Merge into current
              </button>
              <button className={btn} disabled={busy} onClick={onDelete}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-line pt-3">
          {commitsQuery.isLoading && <Spinner label="Loading commits…" />}
          {commitsQuery.isError && <ErrorNote error={commitsQuery.error} />}
          {commitsQuery.data && (
            <>
              <p className="mb-2 text-xs text-muted">
                {commitsQuery.data.base
                  ? `Commits on this branch not in ${commitsQuery.data.base}:`
                  : "Recent commits:"}
              </p>
              {commitsQuery.data.commits.length === 0 ? (
                <p className="text-xs text-muted">No unique commits — even with the base branch.</p>
              ) : (
                <ul className="space-y-1.5">
                  {commitsQuery.data.commits.map((c) => (
                    <li key={c.id} className="flex gap-2 text-xs">
                      <Mono>{c.id}</Mono>
                      <span className="min-w-0 flex-1 truncate text-ink">{c.subject}</span>
                      <span className="shrink-0 text-muted">{timeAgo(c.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
