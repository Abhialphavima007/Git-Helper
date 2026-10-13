import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, type AzureChangeKind, type CommitInfo } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { timeAgo } from "../lib/git";
import { Card, ChangePill, ErrorNote, Mono, Spinner } from "../components/ui";
import { DiffLines, OpenInWindowButton } from "../components/DiffView";
import { FolderRow, groupByFolder } from "../components/FileGroups";

const PAGE = 30;

// Commit history of an Azure DevOps branch — the remote twin of the local
// History page. Pick a branch, filter, and load older commits page by page.
export function AzureHistoryPage() {
  const { selectedRepo, selectedRepoId } = useConnection();
  const [branch, setBranch] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pages, setPages] = useState(1);
  // ?commit=<id> opens a commit straight away (links from the dashboard).
  const [params, setParams] = useSearchParams();
  const selected = params.get("commit");
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("commit", id);
    else next.delete("commit");
    setParams(next, { replace: true });
  };

  const branchesQuery = useQuery({
    queryKey: ["branches", selectedRepoId],
    queryFn: () => api.getBranches(selectedRepoId!),
    enabled: !!selectedRepoId,
  });

  // Start on the default branch; reset paging when the branch or repo changes.
  useEffect(() => {
    if (branchesQuery.data) setBranch((b) => b ?? branchesQuery.data.defaultBranch);
  }, [branchesQuery.data]);
  useEffect(() => {
    setBranch(null);
    setPages(1);
  }, [selectedRepoId]);

  const commitsQuery = useQuery({
    queryKey: ["azure-history", selectedRepoId, branch, pages],
    queryFn: async () => {
      // Pages are fetched together so the list stays one ordered array.
      const chunks = await Promise.all(
        Array.from({ length: pages }, (_, i) => api.getCommits(selectedRepoId!, branch!, PAGE, i * PAGE))
      );
      return chunks.flat();
    },
    enabled: !!selectedRepoId && !!branch,
    placeholderData: (prev) => prev,
  });

  const commits = useMemo(() => {
    const list = commitsQuery.data ?? [];
    const term = filter.trim().toLowerCase();
    return term
      ? list.filter((c) => c.message.toLowerCase().includes(term) || c.author.toLowerCase().includes(term) || c.id.startsWith(term))
      : list;
  }, [commitsQuery.data, filter]);

  const lastPageFull = (commitsQuery.data?.length ?? 0) >= pages * PAGE;

  if (!selectedRepo) {
    return <Card className="p-8 text-center text-sm text-muted">Select a repository from the sidebar.</Card>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">History</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">{selectedRepo.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus-visible:border-accent"
            value={branch ?? ""}
            onChange={(e) => {
              setBranch(e.target.value);
              setPages(1);
            }}
            disabled={!branchesQuery.data}
          >
            {!branchesQuery.data && <option value="">Loading branches…</option>}
            {branchesQuery.data?.branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm focus-visible:border-accent sm:w-56"
            placeholder="Filter by message, author or id…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </header>

      {branchesQuery.isError && <ErrorNote error={branchesQuery.error} />}
      {commitsQuery.isError && <ErrorNote error={commitsQuery.error} />}
      {(branchesQuery.isLoading || (commitsQuery.isLoading && !commitsQuery.data)) && <Spinner label="Loading history…" />}

      {commitsQuery.data && branch && (
        <>
          <p className="text-sm text-muted">
            Commits on <Mono>{branch}</Mono> · {commits.length} shown · click one to see what it changed
            {selectedRepo.webUrl && (
              <>
                {" · "}
                <a
                  href={`${selectedRepo.webUrl}/commits?itemVersion=GB${encodeURIComponent(branch)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent hover:text-accent-hover"
                >
                  Open in Azure DevOps ↗
                </a>
              </>
            )}
          </p>

          {commits.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted">No commits match.</Card>
          ) : (
            <Card className="divide-y divide-line">
              {commits.map((c) => (
                <CommitRow key={c.fullId} commit={c} webUrl={selectedRepo.webUrl} selected={selected === c.fullId} onSelect={() => select(selected === c.fullId ? null : c.fullId)} />
              ))}
            </Card>
          )}

          {lastPageFull && !filter && (
            <div className="text-center">
              <button
                disabled={commitsQuery.isFetching}
                onClick={() => setPages((p) => p + 1)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
              >
                {commitsQuery.isFetching ? "Loading…" : "Show older commits"}
              </button>
            </div>
          )}
        </>
      )}

      {selected && selectedRepoId && (
        <AzureCommitDetail repoId={selectedRepoId} commitId={selected} webUrl={selectedRepo.webUrl} onClose={() => select(null)} />
      )}
    </div>
  );
}

function CommitRow({ commit, webUrl, selected, onSelect }: { commit: CommitInfo; webUrl: string | null; selected: boolean; onSelect: () => void }) {
  return (
    <div
      className={`flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors ${selected ? "bg-accent/10" : "hover:bg-paper"}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-accent ${selected ? "bg-accent" : "bg-card"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink" title={commit.message}>
          {commit.message || "(no message)"}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {webUrl ? (
            <a href={`${webUrl}/commit/${commit.fullId}`} target="_blank" rel="noreferrer" className="hover:text-accent" onClick={(e) => e.stopPropagation()}>
              <Mono>{commit.id}</Mono>
            </a>
          ) : (
            <Mono>{commit.id}</Mono>
          )}
          {" · "}
          {commit.author}
          {commit.date ? ` · ${timeAgo(commit.date)}` : ""}
        </p>
      </div>
    </div>
  );
}

const KIND_PILL: Record<AzureChangeKind, { text: string; light: "ok" | "warn" | "danger" | "neutral" }> = {
  added: { text: "added", light: "ok" },
  modified: { text: "modified", light: "warn" },
  deleted: { text: "deleted", light: "danger" },
  renamed: { text: "renamed", light: "neutral" },
};

// Side panel for one Azure commit: message, people, and the changed files
// grouped by folder — each opening to a red/green line diff.
function AzureCommitDetail({ repoId, commitId, webUrl, onClose }: { repoId: string; commitId: string; webUrl: string | null; onClose: () => void }) {
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  const toggleFolder = (folder: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const query = useQuery({
    queryKey: ["azure-commit", repoId, commitId],
    queryFn: () => api.getAzureCommit(repoId, commitId),
  });
  const d = query.data;
  const total = d ? d.files.length : 0;

  return createPortal(
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l border-line bg-card shadow-2xl sm:w-[min(640px,92vw)]"
      role="dialog"
      aria-label="Commit details"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-muted">
            commit <Mono>{d?.fullId ?? commitId}</Mono>
          </p>
          {d && (
            <>
              <h2 className="mt-1 font-display text-lg font-semibold text-ink">{d.subject || "(no message)"}</h2>
              <p className="mt-0.5 text-sm text-muted">
                {d.author}
                {d.authorEmail ? ` <${d.authorEmail}>` : ""} · {timeAgo(d.date)}
                {d.parents.length > 1 ? " · merge commit" : ""}
              </p>
              {webUrl && (
                <a href={`${webUrl}/commit/${d.fullId}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-accent hover:text-accent-hover">
                  Open in Azure DevOps ↗
                </a>
              )}
            </>
          )}
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-paper hover:text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isLoading && (
          <div className="p-5">
            <Spinner label="Reading the commit…" />
          </div>
        )}
        {query.isError && (
          <div className="p-5">
            <ErrorNote error={query.error} />
          </div>
        )}
        {d && (
          <>
            {d.body && <p className="whitespace-pre-wrap border-b border-line px-5 py-3 text-sm text-ink">{d.body}</p>}
            <div className="px-5 py-3 text-sm font-semibold text-ink">
              {total} file{total === 1 ? "" : "s"} changed{" "}
              <span className="text-xs font-normal text-muted">
                {[d.counts.added && `${d.counts.added} added`, d.counts.modified && `${d.counts.modified} edited`, d.counts.deleted && `${d.counts.deleted} deleted`].filter(Boolean).join(" · ")}
              </span>
            </div>
            {d.parents.length > 1 && (
              <p className="px-5 pb-2 text-xs text-muted">Merge commit — diffs are against its first parent ({d.parents[0]}).</p>
            )}
            <div className="divide-y divide-line border-t border-line">
              {groupByFolder(d.files, (f) => f.path).map((g) => {
                const folderOpen = g.folder === "" || openFolders.has(g.folder) || total <= 12;
                return (
                  <div key={g.folder || "(root)"}>
                    {g.folder !== "" && (
                      <FolderRow folder={g.folder} count={g.items.length} open={folderOpen} onToggle={() => toggleFolder(g.folder)} />
                    )}
                    {folderOpen &&
                      g.items.map((f) => {
                        const isOpen = openFile === f.path;
                        const pill = KIND_PILL[f.kind];
                        return (
                          <div key={f.path} className={g.folder ? "border-t border-line" : ""}>
                            <button
                              onClick={() => setOpenFile(isOpen ? null : f.path)}
                              className={`flex w-full items-center gap-3 py-2.5 pr-5 text-left hover:bg-paper ${g.folder ? "pl-10" : "pl-5"}`}
                            >
                              <ChangePill light={pill.light}>{pill.text}</ChangePill>
                              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={f.from ? `${f.from} → ${f.path}` : f.path}>
                                {g.folder ? f.path.slice(g.folder.length + 1) : f.path}
                              </span>
                              <span className="shrink-0 text-muted">{isOpen ? "▾" : "▸"}</span>
                            </button>
                            {isOpen && (
                              <div className="px-5 pb-3">
                                <AzureFileDiffView repoId={repoId} commitId={d.fullId} path={f.path} from={f.from} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
              {total === 0 && <p className="px-5 py-4 text-sm text-muted">No file changes in this commit.</p>}
            </div>
          </>
        )}
      </div>
    </aside>,
    document.body
  );
}

function AzureFileDiffView({ repoId, commitId, path, from }: { repoId: string; commitId: string; path: string; from: string | null }) {
  const query = useQuery({
    queryKey: ["azure-commit-diff", repoId, commitId, path, from ?? ""],
    queryFn: () => api.getAzureCommitDiff(repoId, commitId, path, from),
  });
  if (query.isLoading) return <Spinner />;
  if (query.isError || !query.data) return <ErrorNote error={query.error} />;
  const v = query.data;
  return (
    <div>
      <div className="mb-1 flex justify-end">
        <OpenInWindowButton target={{ file: path, azureRepo: repoId, commit: commitId, from: from ?? undefined }} />
      </div>
      {v.binary ? (
        <p className="rounded-lg bg-ink/[0.03] p-3 text-xs text-muted">Binary file — no line diff. Open it in Azure DevOps to download it.</p>
      ) : v.tooLarge ? (
        <p className="rounded-lg bg-ink/[0.03] p-3 text-xs text-muted">This file is too large or too different to diff here — open it in Azure DevOps.</p>
      ) : (
        <DiffLines diff={v.diff} />
      )}
    </div>
  );
}
