import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type AzureCompareFile } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { changeLabel } from "../lib/git";
import { Card, ChangePill, ErrorNote, Mono, Spinner } from "../components/ui";
import { CreatePrModal } from "../components/CreatePrModal";

// Compare two branches on Azure DevOps (server-side diff) to preview a merge —
// what's ahead/behind and which files differ — before opening a PR, so you can
// catch overlaps that would conflict.
export function AzureComparePage() {
  const { selectedRepo, selectedRepoId } = useConnection();
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("");
  const [prOpen, setPrOpen] = useState(false);

  const branchesQuery = useQuery({
    queryKey: ["branches", selectedRepoId],
    queryFn: () => api.getBranches(selectedRepoId!),
    enabled: !!selectedRepoId,
  });

  const data = branchesQuery.data;
  const names = useMemo(() => (data?.branches ?? []).map((b) => b.name), [data]);

  useEffect(() => {
    if (!names.length || !data) return;
    setBase((prev) => (prev && names.includes(prev) ? prev : data.defaultBranch));
    setTarget((prev) => (prev && names.includes(prev) ? prev : names.find((n) => n !== data.defaultBranch) ?? names[0]));
  }, [names, data]);

  const sameRef = base === target;
  const compareQuery = useQuery({
    queryKey: ["azure-compare", selectedRepoId, base, target],
    queryFn: () => api.compareAzure(selectedRepoId!, base, target),
    enabled: !!selectedRepoId && !!base && !!target && !sameRef,
  });

  if (!selectedRepo) {
    return <Card className="p-8 text-center text-sm text-muted">Select a repository from the sidebar.</Card>;
  }

  const cmp = compareQuery.data;

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Compare</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">Compare branches — {selectedRepo.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Preview what one branch would bring into another before opening a pull request.
        </p>
      </header>

      {branchesQuery.isLoading && <Spinner label="Loading branches…" />}
      {branchesQuery.isError && <ErrorNote error={branchesQuery.error} />}

      {names.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Base (merge into)" value={base} onChange={setBase} options={names} />
            <span className="pb-2 text-muted">←</span>
            <Select label="Target (merge from)" value={target} onChange={setTarget} options={names} />
            <button
              onClick={() => {
                const b = base;
                setBase(target);
                setTarget(b);
              }}
              className="ml-auto rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-paper"
            >
              ⇄ Swap
            </button>
          </div>
          {sameRef && <p className="mt-2 text-xs text-warn">Pick two different branches.</p>}
        </Card>
      )}

      {compareQuery.isFetching && <Spinner label="Comparing on Azure DevOps…" />}
      {compareQuery.isError && <ErrorNote error={compareQuery.error} />}

      {cmp && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm text-ink">
              <span className="font-mono">{cmp.target}</span> is{" "}
              <b className="text-ok">{cmp.ahead} ahead</b> and{" "}
              <b className="text-warn">{cmp.behind} behind</b> <span className="font-mono">{cmp.base}</span>
              {cmp.commonCommit && (
                <span className="text-muted"> · common ancestor <Mono>{cmp.commonCommit}</Mono></span>
              )}
            </div>
            <button
              onClick={() => setPrOpen(true)}
              disabled={cmp.ahead === 0}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              title={cmp.ahead === 0 ? "Nothing to merge" : `Open a PR from ${cmp.target} into ${cmp.base}`}
            >
              Open pull request →
            </button>
          </Card>

          {cmp.behind > 0 && (
            <Card className="border-warn/30 bg-warn-bg p-4 text-sm text-ink">
              Heads up: <span className="font-mono">{cmp.target}</span> is {cmp.behind} behind{" "}
              <span className="font-mono">{cmp.base}</span>. Files changed on both sides are the ones likely to
              conflict — check the list below, and consider updating <span className="font-mono">{cmp.target}</span>{" "}
              first.
            </Card>
          )}

          {cmp.files.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted">
              No file differences — <Mono>{cmp.target}</Mono> introduces nothing over <Mono>{cmp.base}</Mono>.
            </Card>
          ) : (
            <Card className="divide-y divide-line p-0">
              <div className="px-4 py-2.5 text-sm font-semibold text-ink">Files changed ({cmp.files.length})</div>
              {cmp.files.map((f) => (
                <FileRow key={f.path} file={f} />
              ))}
            </Card>
          )}
        </>
      )}

      {prOpen && selectedRepoId && cmp && (
        <CreatePrModal
          repoId={selectedRepoId}
          source={cmp.target}
          defaultTarget={cmp.base}
          targets={names.filter((n) => n !== cmp.target)}
          onClose={() => setPrOpen(false)}
          onCreated={() => setPrOpen(false)}
        />
      )}
    </div>
  );
}

function Select({
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

function FileRow({ file }: { file: AzureCompareFile }) {
  const change = normalizeChange(file.changeType);
  const cl = changeLabel(change);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <ChangePill light={cl.light}>{cl.text}</ChangePill>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{file.path}</span>
    </div>
  );
}

function normalizeChange(t: string): "added" | "deleted" | "modified" | "renamed" {
  const s = t.toLowerCase();
  if (s.includes("add")) return "added";
  if (s.includes("delete")) return "deleted";
  if (s.includes("rename")) return "renamed";
  return "modified";
}
