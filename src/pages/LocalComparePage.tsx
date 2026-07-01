import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type CompareFile } from "../api/client";
import { ApiError } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { changeLabel, timeAgo } from "../lib/git";
import { Card, ChangePill, DiffStat, ErrorNote, Mono, Spinner } from "../components/ui";
import { DiffLines } from "../components/DiffView";

// GitHub-style "compare branches": pick a base and a branch to compare, see the
// commits and file changes it introduces, then merge it into the base.
export function LocalComparePage() {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const branchesQuery = useQuery({
    queryKey: ["local-branches", root],
    queryFn: () => api.local.getBranches(),
    enabled: !!root,
  });

  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);
  const current = branches.find((b) => b.current);

  const [base, setBase] = useState("");
  const [compare, setCompare] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Sensible defaults once branches load: base = main/master/default, compare = current.
  useEffect(() => {
    if (!branches.length) return;
    const names = branches.map((b) => b.name);
    const preferredBase = ["main", "master", "develop"].find((n) => names.includes(n)) ?? names[0];
    setBase((prev) => (prev && names.includes(prev) ? prev : preferredBase));
    setCompare((prev) => (prev && names.includes(prev) ? prev : current?.name ?? names[0]));
  }, [branches, current]);

  const sameRef = base === compare;
  const compareQuery = useQuery({
    queryKey: ["local-compare", root, base, compare],
    queryFn: () => api.local.compare(base, compare),
    enabled: !!root && !!base && !!compare && !sameRef,
  });

  function errText(err: unknown): string {
    if (err instanceof ApiError) return err.detail ? `${err.message} — ${err.detail}` : err.message;
    return err instanceof Error ? err.message : "Something went wrong.";
  }

  const mergeM = useMutation({
    mutationFn: async () => {
      // git merges into the *current* branch, so switch to base first if needed.
      if (current?.name !== base) await api.local.checkout(base);
      return api.local.merge(compare);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["local-branches", root] });
      qc.invalidateQueries({ queryKey: ["local-state", root] });
      qc.invalidateQueries({ queryKey: ["local-graph"] });
      qc.invalidateQueries({ queryKey: ["local-compare", root] });
      if (res.conflicts) {
        setNote({ kind: "err", text: `Merge hit conflicts — opening the resolver.` });
        navigate("/local/conflicts");
      } else {
        setNote({ kind: "ok", text: `Merged ${compare} into ${base}.` });
      }
    },
    onError: (e) => setNote({ kind: "err", text: errText(e) }),
  });

  const data = compareQuery.data;

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Compare</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">Compare branches</h1>
        <p className="mt-1 text-sm text-muted">
          See what one branch adds over another — the commits and file changes — then merge.
        </p>
      </header>

      {branchesQuery.isLoading && <Spinner label="Loading branches…" />}
      {branchesQuery.isError && <ErrorNote error={branchesQuery.error} />}

      {branches.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <BranchSelect label="Base (merge into)" value={base} onChange={setBase} options={branches.map((b) => b.name)} />
            <span className="pb-2 text-muted">←</span>
            <BranchSelect label="Compare (merge from)" value={compare} onChange={setCompare} options={branches.map((b) => b.name)} />
            <button
              onClick={() => {
                const b = base;
                setBase(compare);
                setCompare(b);
              }}
              className="ml-auto rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-paper"
            >
              ⇄ Swap
            </button>
          </div>
          {sameRef && <p className="mt-2 text-xs text-warn">Pick two different branches to compare.</p>}
        </Card>
      )}

      {note && <p className={`text-sm ${note.kind === "ok" ? "text-ok" : "text-danger"}`}>{note.text}</p>}

      {compareQuery.isFetching && <Spinner label="Comparing…" />}
      {compareQuery.isError && <ErrorNote error={compareQuery.error} />}

      {data && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm text-ink">
              <span className="font-mono">{data.compare}</span> is{" "}
              <b className="text-ok">{data.ahead} ahead</b> and{" "}
              <b className="text-warn">{data.behind} behind</b>{" "}
              <span className="font-mono">{data.base}</span>
              {data.mergeBase && (
                <span className="text-muted">
                  {" "}· common ancestor <Mono>{data.mergeBase}</Mono>
                </span>
              )}
            </div>
            <button
              disabled={mergeM.isPending || data.ahead === 0}
              onClick={() => mergeM.mutate()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              title={data.ahead === 0 ? "Nothing to merge" : `Merge ${data.compare} into ${data.base}`}
            >
              {mergeM.isPending
                ? "Merging…"
                : current?.name === base
                ? `Merge ${data.compare} into ${data.base}`
                : `Switch to ${data.base} & merge ${data.compare}`}
            </button>
          </Card>

          {data.ahead === 0 && (
            <Card className="p-6 text-center text-sm text-muted">
              <Mono>{data.compare}</Mono> has no commits that <Mono>{data.base}</Mono> doesn't already have.
            </Card>
          )}

          {data.commits.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-2 font-display text-sm font-semibold text-ink">
                Commits {data.compare} adds ({data.commits.length})
              </h2>
              <ul className="space-y-1.5">
                {data.commits.map((c) => (
                  <li key={c.id} className="flex gap-2 text-xs">
                    <Mono>{c.id}</Mono>
                    <span className="min-w-0 flex-1 truncate text-ink">{c.subject}</span>
                    <span className="shrink-0 text-muted">{c.author} · {timeAgo(c.date)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.files.length > 0 && (
            <Card className="divide-y divide-line p-0">
              <div className="px-4 py-2.5 text-sm font-semibold text-ink">
                Files changed ({data.files.length})
              </div>
              {data.files.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  base={data.base}
                  compare={data.compare}
                  open={expanded === f.path}
                  onToggle={() => setExpanded(expanded === f.path ? null : f.path)}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function BranchSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-card px-2.5 py-2 font-mono text-sm text-ink focus-visible:border-accent"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileRow({
  file,
  base,
  compare,
  open,
  onToggle,
}: {
  file: CompareFile;
  base: string;
  compare: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { root } = useLocalRepo();
  const cl = changeLabel(file.change);
  const diffQuery = useQuery({
    queryKey: ["local-compare-diff", root, base, compare, file.path],
    queryFn: () => api.local.compareDiff(base, compare, file.path),
    enabled: open,
  });

  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-paper">
        <ChangePill light={cl.light}>{cl.text}</ChangePill>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{file.path}</span>
        <DiffStat added={file.added} removed={file.removed} />
        <span className="shrink-0 text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          {diffQuery.isLoading && <Spinner />}
          {diffQuery.isError && <ErrorNote error={diffQuery.error} />}
          {diffQuery.data && <DiffLines diff={diffQuery.data.diff} />}
        </div>
      )}
    </div>
  );
}
