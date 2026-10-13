import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type BranchInfo, type CommitInfo } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { useLocalRepo } from "../context/LocalRepoContext";
import { branchVerdict, prStatusVerdict, timeAgo } from "../lib/git";
import { Card, ErrorNote, GuidanceBanner, Mono, SearchInput, Spinner, StatusPill } from "../components/ui";
import { CommitGraph } from "../components/CommitGraph";
import { CreatePrModal } from "../components/CreatePrModal";
import { CloneModal } from "../components/CloneModal";

// The Azure DevOps home for one repository: where the branch you care about
// stands against the default branch, what moved recently, and what's waiting
// for review — with the next step one click away.
export function DashboardPage() {
  const { selectedRepo, selectedRepoId, project } = useConnection();
  const { localEnabled } = useLocalRepo();
  const navigate = useNavigate();
  const [focus, setFocus] = useState<string | null>(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [prOpen, setPrOpen] = useState(false);
  const [cloning, setCloning] = useState(false);

  const branchesQuery = useQuery({
    queryKey: ["branches", selectedRepoId],
    queryFn: () => api.getBranches(selectedRepoId!),
    enabled: !!selectedRepoId,
  });

  // Default the focus branch to the most recently updated non-default branch.
  useEffect(() => {
    const data = branchesQuery.data;
    if (!data) return;
    const inList = focus && data.branches.some((b) => b.name === focus);
    if (inList) return;
    const firstNonDefault = data.branches.find((b) => !b.isDefault);
    setFocus((firstNonDefault ?? data.branches[0])?.name ?? null);
  }, [branchesQuery.data, focus]);

  const commitsQuery = useQuery({
    queryKey: ["commits", selectedRepoId, focus],
    queryFn: () => api.getCommits(selectedRepoId!, focus!),
    enabled: !!selectedRepoId && !!focus,
  });

  const prsQuery = useQuery({
    queryKey: ["prs", selectedRepoId, "active"],
    queryFn: () => api.getPullRequests(selectedRepoId!, "active"),
    enabled: !!selectedRepoId,
  });

  const data = branchesQuery.data;
  const branch = data?.branches.find((b) => b.name === focus) ?? null;

  // Branches that need a look: the furthest behind first, then the furthest ahead.
  const attention = useMemo(() => {
    const list = (data?.branches ?? []).filter((b) => !b.isDefault && (b.aheadCount > 0 || b.behindCount > 0));
    return list.sort((a, b) => b.behindCount - a.behindCount || b.aheadCount - a.aheadCount).slice(0, 5);
  }, [data]);

  const branchOptions = useMemo(() => {
    const list = data?.branches ?? [];
    const term = branchSearch.trim().toLowerCase();
    return term ? list.filter((b) => b.name.toLowerCase().includes(term)) : list;
  }, [data, branchSearch]);

  if (!selectedRepo) {
    return <EmptyRepo />;
  }

  const openPrs = prsQuery.data?.length ?? null;
  const prsOnFocus = branch ? (prsQuery.data ?? []).filter((pr) => pr.sourceBranch === branch.name) : [];

  return (
    <div className="space-y-6">
      {/* Header: what this is, and the things you most often do next */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Repository status</p>
          <h1 className="mt-1 truncate font-display text-2xl font-bold text-ink">{selectedRepo.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>{project}</span>
            {selectedRepo.defaultBranch && (
              <>
                <span className="text-line">·</span>
                <span>
                  default <Mono>{selectedRepo.defaultBranch}</Mono>
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedRepo.webUrl && (
            <a
              href={selectedRepo.webUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
            >
              Open in Azure DevOps ↗
            </a>
          )}
          {localEnabled && (
            <button
              onClick={() => setCloning(true)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
            >
              Clone to local
            </button>
          )}
          {data && branch && !branch.isDefault && (
            <button
              onClick={() => setPrOpen(true)}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              New pull request
            </button>
          )}
        </div>
      </header>

      {branchesQuery.isLoading && <Spinner label="Reading branch status…" />}
      {branchesQuery.isError && <ErrorNote error={branchesQuery.error} />}

      {data && data.branches.length === 0 && (
        <Card className="p-8 text-center">
          <h2 className="font-display text-lg font-semibold text-ink">No branches yet</h2>
          <p className="mt-2 text-sm text-muted">
            <span className="font-medium text-ink">{selectedRepo.name}</span> has no commits yet — it's an empty
            repository. Pick another repository from the sidebar, or push an initial commit to get started.
          </p>
        </Card>
      )}

      {data && branch && (
        <>
          {/* At a glance */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Branches" value={data.branches.length} to="/branches" hint="View all" />
            <StatTile
              label="Open pull requests"
              value={openPrs ?? "…"}
              to="/pulls"
              hint={prsQuery.isError ? "Couldn't load" : "Review"}
            />
            <StatTile
              label={`Ahead of ${data.defaultBranch}`}
              value={branch.isDefault ? "—" : branch.aheadCount}
              tone={!branch.isDefault && branch.aheadCount > 0 ? "ok" : undefined}
              hint={branch.isDefault ? "Default branch" : branch.aheadCount > 0 ? "Ready to review" : "Nothing new"}
              to="/compare"
            />
            <StatTile
              label={`Behind ${data.defaultBranch}`}
              value={branch.isDefault ? "—" : branch.behindCount}
              tone={!branch.isDefault && branch.behindCount > 0 ? "warn" : undefined}
              hint={branch.isDefault ? "Default branch" : branch.behindCount > 0 ? "Needs an update" : "Up to date"}
              to="/compare"
            />
          </div>

          {/* Focus branch */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-muted">Looking at</label>
              <select
                className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-medium text-ink focus-visible:border-accent"
                value={focus ?? ""}
                onChange={(e) => setFocus(e.target.value)}
              >
                {branchOptions.length === 0 && <option value="">No branch matches</option>}
                {branchOptions.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <span className="text-sm text-muted">
                compared with <Mono>{data.defaultBranch}</Mono>
              </span>
              {data.branches.length > 8 && (
                <SearchInput
                  value={branchSearch}
                  onChange={setBranchSearch}
                  placeholder="Find a branch…"
                  className="w-full sm:ml-auto sm:w-56"
                />
              )}
            </div>
            <div className="mt-3">
              <GuidanceBanner verdict={branchVerdict(branch, data.defaultBranch)} />
            </div>
            {prsOnFocus.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                {prsOnFocus.length === 1 ? "There's already a pull request from this branch: " : "Open pull requests from this branch: "}
                {prsOnFocus.map((pr, i) => (
                  <span key={pr.id}>
                    {i > 0 && ", "}
                    <Link to={`/pulls/${pr.id}`} className="font-medium text-accent hover:text-accent-hover">
                      !{pr.id} {pr.title}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Left: divergence + branches at a glance */}
            <div className="space-y-4 lg:col-span-2">
              <Card className="p-5">
                <h2 className="font-display text-sm font-semibold text-ink">How far apart are they?</h2>
                <div className="mt-3">
                  <CommitGraph
                    branch={branch.name}
                    defaultBranch={data.defaultBranch}
                    ahead={branch.aheadCount}
                    behind={branch.behindCount}
                  />
                </div>
                {!branch.isDefault && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to="/compare"
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                    >
                      See the changes
                    </Link>
                    {branch.aheadCount > 0 && prsOnFocus.length === 0 && (
                      <button
                        onClick={() => setPrOpen(true)}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
                      >
                        Open a pull request
                      </button>
                    )}
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-sm font-semibold text-ink">Branches to look at</h2>
                  <Link to="/branches" className="text-xs font-medium text-accent hover:text-accent-hover">
                    All {data.branches.length} →
                  </Link>
                </div>
                {attention.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">Every branch is in step with {data.defaultBranch}.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-line">
                    {attention.map((b) => (
                      <BranchGlance key={b.name} branch={b} defaultBranch={data.defaultBranch} active={b.name === branch.name} onPick={() => setFocus(b.name)} />
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* Right: recent commits + open PRs */}
            <div className="space-y-4 lg:col-span-3">
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-sm font-semibold text-ink">
                    Recent commits <span className="font-normal text-muted">on {branch.name}</span>
                  </h2>
                  <Link to="/history" className="text-xs font-medium text-accent hover:text-accent-hover">
                    Full history →
                  </Link>
                </div>
                {commitsQuery.isLoading && (
                  <div className="mt-3">
                    <Spinner />
                  </div>
                )}
                {commitsQuery.isError && (
                  <div className="mt-3">
                    <ErrorNote error={commitsQuery.error} />
                  </div>
                )}
                {commitsQuery.data && commitsQuery.data.length === 0 && (
                  <p className="mt-3 text-sm text-muted">No commits found on this branch.</p>
                )}
                {commitsQuery.data && commitsQuery.data.length > 0 && (
                  <>
                    <ul className="mt-3 space-y-3">
                      {commitsQuery.data.slice(0, 6).map((c) => (
                        <CommitRow key={c.id} commit={c} repoId={selectedRepoId!} branch={branch.name} />
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-muted">
                      <b>Undo</b> asks Azure to prepare the opposite change and opens a pull request with it — nothing on
                      the branch changes until that PR is completed.
                    </p>
                  </>
                )}
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-sm font-semibold text-ink">Open pull requests</h2>
                  <Link to="/pulls" className="text-xs font-medium text-accent hover:text-accent-hover">
                    All pull requests →
                  </Link>
                </div>
                {prsQuery.isLoading && (
                  <div className="mt-3">
                    <Spinner />
                  </div>
                )}
                {prsQuery.isError && (
                  <div className="mt-3">
                    <ErrorNote error={prsQuery.error} />
                  </div>
                )}
                {prsQuery.data && prsQuery.data.length === 0 && (
                  <p className="mt-3 text-sm text-muted">Nothing waiting for review.</p>
                )}
                {prsQuery.data && prsQuery.data.length > 0 && (
                  <ul className="mt-3 divide-y divide-line">
                    {prsQuery.data.slice(0, 5).map((pr) => {
                      const v = prStatusVerdict(pr);
                      return (
                        <li key={pr.id}>
                          <Link to={`/pulls/${pr.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-paper">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-ink">
                                <span className="font-mono text-xs text-muted">!{pr.id}</span> {pr.title}
                              </span>
                              <span className="block truncate text-xs text-muted">
                                <Mono>{pr.sourceBranch}</Mono> → <Mono>{pr.targetBranch}</Mono> · {pr.createdBy?.name ?? "Unknown"} ·{" "}
                                {timeAgo(pr.creationDate)}
                              </span>
                            </span>
                            <StatusPill light={v.light}>{v.headline}</StatusPill>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      {prOpen && data && branch && selectedRepoId && (
        <CreatePrModal
          repoId={selectedRepoId}
          source={branch.name}
          defaultTarget={data.defaultBranch}
          targets={data.branches.map((b) => b.name)}
          onClose={() => setPrOpen(false)}
          onCreated={(prId) => {
            setPrOpen(false);
            navigate(`/pulls/${prId}`);
          }}
        />
      )}
      {cloning && <CloneModal repo={selectedRepo} onClose={() => setCloning(false)} />}
    </div>
  );
}

// A headline number with its label; the number wears ink, the tone is a dot.
function StatTile({
  label,
  value,
  hint,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  to?: string;
  tone?: "ok" | "warn";
}) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 flex items-center gap-2 font-display text-2xl font-bold text-ink">
        {tone && <span className={`h-2 w-2 rounded-full ${tone === "ok" ? "bg-ok" : "bg-warn"}`} aria-hidden />}
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </>
  );
  if (!to) return <Card className="p-4">{body}</Card>;
  return (
    <Link to={to} className="block">
      <Card className="h-full p-4 transition-colors hover:border-accent/40">{body}</Card>
    </Link>
  );
}

function BranchGlance({
  branch,
  defaultBranch,
  active,
  onPick,
}: {
  branch: BranchInfo;
  defaultBranch: string;
  active: boolean;
  onPick: () => void;
}) {
  const v = branchVerdict(branch, defaultBranch);
  return (
    <li>
      <button
        onClick={onPick}
        className={`-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-paper ${active ? "bg-accent/5" : ""}`}
        title="Look at this branch"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs text-ink">{branch.name}</span>
          <span className="block text-xs text-muted">
            {branch.aheadCount > 0 && <span className="text-ok">↑{branch.aheadCount}</span>}
            {branch.aheadCount > 0 && branch.behindCount > 0 && " "}
            {branch.behindCount > 0 && <span className="text-warn">↓{branch.behindCount}</span>}
            {branch.lastCommit?.date ? ` · ${timeAgo(branch.lastCommit.date)}` : ""}
          </span>
        </span>
        <StatusPill light={v.light}>{v.headline}</StatusPill>
      </button>
    </li>
  );
}

// One commit in the "Recent commits" card, with a cloud Undo: Azure prepares
// a revert branch and we open a PR from it — the safe, reviewable undo.
function CommitRow({ commit, repoId, branch }: { commit: CommitInfo; repoId: string; branch: string }) {
  const [error, setError] = useState<string | null>(null);

  const revertM = useMutation({
    mutationFn: () =>
      api.revertAzureCommit(repoId, { commitId: commit.fullId, branch, message: commit.message }),
    onSuccess: () => setError(null),
    onError: (e) => setError(e instanceof Error ? e.message : "The undo failed."),
  });

  return (
    <li className="flex gap-3">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink" title={commit.message}>{commit.message || "(no message)"}</p>
        <p className="text-xs text-muted">
          <Mono>{commit.id}</Mono> · {commit.author} · {timeAgo(commit.date)} ·{" "}
          <Link to={`/history?commit=${commit.fullId}`} className="font-medium text-accent hover:text-accent-hover">
            what changed
          </Link>
        </p>
        {revertM.data && (
          <p className="mt-1 text-xs text-ok">
            Revert ready —{" "}
            <Link to={`/pulls/${revertM.data.prId}`} className="font-medium text-accent hover:underline">
              complete PR #{revertM.data.prId}
            </Link>{" "}
            to apply the undo.
          </p>
        )}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
      {!revertM.data && (
        <button
          disabled={revertM.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Undo "${commit.message}" on ${branch}?\n\nAzure will prepare the opposite change on a new branch and a pull request will be opened — the branch itself only changes when that PR is completed.`
              )
            )
              revertM.mutate();
          }}
          className="h-fit shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-muted hover:bg-paper hover:text-ink disabled:opacity-50"
          title="Create a revert PR that cancels this commit"
        >
          {revertM.isPending ? "Undoing…" : "↩ Undo"}
        </button>
      )}
    </li>
  );
}

function EmptyRepo() {
  return (
    <Card className="p-8 text-center">
      <h1 className="font-display text-lg font-semibold text-ink">No repository selected</h1>
      <p className="mt-2 text-sm text-muted">
        This project has no repositories the token can read, or none is selected yet. Pick one from the sidebar.
      </p>
    </Card>
  );
}
