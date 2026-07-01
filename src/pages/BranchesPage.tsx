import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type BranchInfo } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { branchVerdict, timeAgo } from "../lib/git";
import { Card, ErrorNote, Mono, Spinner, StatusPill } from "../components/ui";
import { CreatePrModal } from "../components/CreatePrModal";

export function BranchesPage() {
  const { selectedRepo, selectedRepoId } = useConnection();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [prSource, setPrSource] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["branches", selectedRepoId],
    queryFn: () => api.getBranches(selectedRepoId!),
    enabled: !!selectedRepoId,
  });

  const allBranchNames = useMemo(() => (query.data?.branches ?? []).map((b) => b.name), [query.data]);

  const filtered = useMemo(() => {
    const list = query.data?.branches ?? [];
    const term = filter.trim().toLowerCase();
    return term ? list.filter((b) => b.name.toLowerCase().includes(term)) : list;
  }, [query.data, filter]);

  if (!selectedRepo) {
    return <Card className="p-8 text-center text-sm text-muted">Select a repository from the sidebar.</Card>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Branches</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">{selectedRepo.name}</h1>
        </div>
        <input
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm focus-visible:border-accent sm:w-56"
          placeholder="Filter branches…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </header>

      {query.isLoading && <Spinner label="Loading branches…" />}
      {query.isError && <ErrorNote error={query.error} />}

      {query.data && (
        <>
          <p className="text-sm text-muted">
            Compared against <Mono>{query.data.defaultBranch}</Mono> · {filtered.length} shown
          </p>
          <div className="space-y-2">
            {filtered.map((b) => (
              <BranchRow
                key={b.name}
                branch={b}
                defaultBranch={query.data!.defaultBranch}
                onNewPr={() => setPrSource(b.name)}
              />
            ))}
            {filtered.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted">No branches match “{filter}”.</Card>
            )}
          </div>
        </>
      )}

      {prSource && selectedRepoId && query.data && (
        <CreatePrModal
          repoId={selectedRepoId}
          source={prSource}
          defaultTarget={query.data.defaultBranch}
          targets={allBranchNames.filter((n) => n !== prSource)}
          onClose={() => setPrSource(null)}
          onCreated={(prId) => {
            setPrSource(null);
            navigate(`/pulls/${prId}`);
          }}
        />
      )}
    </div>
  );
}

function BranchRow({
  branch,
  defaultBranch,
  onNewPr,
}: {
  branch: BranchInfo;
  defaultBranch: string;
  onNewPr: () => void;
}) {
  const verdict = branchVerdict(branch, defaultBranch);
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm font-medium text-ink">{branch.name}</span>
          {branch.isDefault && (
            <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted">
              default
            </span>
          )}
        </div>
        {branch.lastCommit && (
          <p className="mt-1 truncate text-xs text-muted">
            {branch.lastCommit.message || "(no message)"} · {branch.lastCommit.author} ·{" "}
            {timeAgo(branch.lastCommit.date)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {!branch.isDefault && (
          <span className="font-mono text-xs text-muted">
            ↑{branch.aheadCount} ↓{branch.behindCount}
          </span>
        )}
        <StatusPill light={verdict.light}>{verdict.headline}</StatusPill>
        {!branch.isDefault && (
          <button
            onClick={onNewPr}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
          >
            New PR
          </button>
        )}
      </div>
    </Card>
  );
}
