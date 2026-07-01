// Typed client for the local proxy. All calls are same-origin via the Vite proxy.

export class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.message as string)) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data?.detail);
  }
  return data as T;
}

// ---- Types ----

export interface MeInfo {
  id: string;
  name: string | null;
}

export interface RepoInfo {
  id: string;
  name: string;
  defaultBranch: string | null;
  webUrl: string | null;
}

export interface ConnectionState {
  connected: boolean;
  org: string | null;
  project: string | null;
  me: MeInfo | null;
}

export interface ConnectResult extends ConnectionState {
  repos: RepoInfo[];
}

export interface CommitInfo {
  id: string;
  message: string;
  author: string;
  date: string | null;
}

export interface BranchInfo {
  name: string;
  aheadCount: number;
  behindCount: number;
  isDefault: boolean;
  lastCommit: CommitInfo | null;
}

export interface BranchesResult {
  repoId: string;
  repoName: string;
  defaultBranch: string;
  webUrl: string | null;
  branches: BranchInfo[];
}

export interface ReviewerInfo {
  id: string;
  name: string;
  vote: number;
  isRequired: boolean;
}

export interface PullRequestInfo {
  id: number;
  title: string;
  description: string;
  status: string;
  isDraft: boolean;
  mergeStatus: string;
  sourceBranch: string;
  targetBranch: string;
  createdBy: { id: string; name: string } | null;
  creationDate: string | null;
  reviewers: ReviewerInfo[];
}

export interface ThreadComment {
  id: number;
  author: string;
  content: string;
  publishedDate: string | null;
}

export interface ThreadInfo {
  id: number;
  status: string | null;
  filePath: string | null;
  comments: ThreadComment[];
}

// ---- Local-git types ----

export type FileChange = "modified" | "added" | "deleted" | "renamed" | "untracked" | "typechange";

export interface RepoFile {
  path: string;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  change: FileChange;
  origPath?: string;
  added?: number;
  removed?: number;
}

export interface RepoState {
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: RepoFile[];
  unstaged: RepoFile[];
  untracked: RepoFile[];
  conflicted: RepoFile[];
  clean: boolean;
  merging: boolean;
}

export interface LocalBranch {
  name: string;
  ref: string;
  current: boolean;
  isRemote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommit: { id: string; message: string; date: string | null } | null;
}

export interface AzureCompareFile {
  path: string;
  changeType: string;
}

export interface AzureCompareResult {
  base: string;
  target: string;
  ahead: number;
  behind: number;
  commonCommit: string | null;
  files: AzureCompareFile[];
}

export interface GraphCommit {
  id: string;
  full: string;
  parents: string[];
  author: string;
  date: string | null;
  subject: string;
  refs: string[];
}

export interface ConflictFile {
  path: string;
  hasBase: boolean;
  hasOurs: boolean;
  hasTheirs: boolean;
}

export interface ConflictContent {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  merged: string;
}

export interface LocalRepoState {
  open: boolean;
  root: string | null;
  name: string | null;
}

export interface StoredRepo {
  root: string;
  name: string;
  addedAt: string;
}

export interface ReposList {
  repos: StoredRepo[];
  lastOpened: string | null;
  current: string | null;
}

export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListing {
  path: string;
  parent: string | null;
  isWindows: boolean;
  drives?: string[];
  entries: FsEntry[];
  home: string;
  error?: string;
}

export interface CloneJob {
  id: string;
  repoName: string;
  status: "cloning" | "done" | "error";
  phase: string;
  percent: number;
  message: string;
  dest: string;
  error?: string;
}

export interface Remote {
  name: string;
  url: string;
  isAzure: boolean;
}

export interface BranchActionResult {
  ok: boolean;
  conflicts: boolean;
  state: RepoState;
}

export interface CommitSummary {
  id: string;
  subject: string;
  author: string;
  date: string | null;
}

export interface BranchCommits {
  branch: string;
  base: string | null;
  commits: CommitSummary[];
}

export interface CompareFile {
  path: string;
  added: number;
  removed: number;
  change: FileChange;
}

export interface CompareResult {
  base: string;
  compare: string;
  ahead: number;
  behind: number;
  mergeBase: string | null;
  commits: CommitSummary[];
  files: CompareFile[];
}

// ---- Calls ----

export const api = {
  getConfig: () => http<{ localEnabled: boolean }>("/api/config"),

  getConnection: () => http<ConnectionState>("/api/connection"),

  connect: (body: { org: string; project: string; pat: string }) =>
    http<ConnectResult>("/api/connect", { method: "POST", body: JSON.stringify(body) }),

  disconnect: () => http<void>("/api/disconnect", { method: "POST" }),

  getRepos: () => http<RepoInfo[]>("/api/repos"),

  getBranches: (repoId: string) =>
    http<BranchesResult>(`/api/repos/${encodeURIComponent(repoId)}/branches`),

  getCommits: (repoId: string, branch: string, top = 12) =>
    http<CommitInfo[]>(
      `/api/repos/${encodeURIComponent(repoId)}/commits?branch=${encodeURIComponent(branch)}&top=${top}`
    ),

  getPullRequests: (repoId: string, status: string) =>
    http<PullRequestInfo[]>(
      `/api/repos/${encodeURIComponent(repoId)}/pullrequests?status=${encodeURIComponent(status)}`
    ),

  getPullRequest: (repoId: string, prId: number) =>
    http<PullRequestInfo>(
      `/api/repos/${encodeURIComponent(repoId)}/pullrequests/${prId}`
    ),

  getThreads: (repoId: string, prId: number) =>
    http<ThreadInfo[]>(
      `/api/repos/${encodeURIComponent(repoId)}/pullrequests/${prId}/threads`
    ),

  compareAzure: (repoId: string, base: string, target: string) =>
    http<AzureCompareResult>(
      `/api/repos/${encodeURIComponent(repoId)}/compare?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`
    ),

  createPullRequest: (
    repoId: string,
    body: { source: string; target: string; title: string; description?: string }
  ) =>
    http<PullRequestInfo>(`/api/repos/${encodeURIComponent(repoId)}/pullrequests`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  completePullRequest: (
    repoId: string,
    prId: number,
    body: { mergeStrategy?: string; deleteSourceBranch?: boolean }
  ) =>
    http<PullRequestInfo>(
      `/api/repos/${encodeURIComponent(repoId)}/pullrequests/${prId}/complete`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  // ---- Clone an Azure repo to local ----
  clone: {
    defaults: () => http<{ baseDir: string }>("/api/clone/defaults"),
    start: (repoName: string, parentDir: string) =>
      http<{ jobId: string; dest: string }>("/api/clone", {
        method: "POST",
        body: JSON.stringify({ repoName, parentDir }),
      }),
    status: (jobId: string) => http<CloneJob>(`/api/clone/${encodeURIComponent(jobId)}`),
  },

  // ---- Filesystem browsing (folder picker) ----
  fs: {
    browse: (path?: string) =>
      http<FsListing>(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  },

  // ---- Local-git mode ----
  local: {
    getRepo: () => http<LocalRepoState>("/api/local/repo"),

    listRepos: () => http<ReposList>("/api/local/repos"),

    select: (root: string) =>
      http<{ open: boolean; root: string; name: string }>("/api/local/select", {
        method: "POST",
        body: JSON.stringify({ root }),
      }),

    remove: (root: string) =>
      http<ReposList>("/api/local/remove", { method: "POST", body: JSON.stringify({ root }) }),

    open: (path: string) =>
      http<{ open: boolean; root: string; name: string }>("/api/local/open", {
        method: "POST",
        body: JSON.stringify({ path }),
      }),

    close: () => http<void>("/api/local/close", { method: "POST" }),

    getState: () => http<RepoState>("/api/local/state"),

    getBranches: () => http<LocalBranch[]>("/api/local/branches"),

    getGraph: (limit = 60, all = true) =>
      http<GraphCommit[]>(`/api/local/graph?limit=${limit}&all=${all ? 1 : 0}`),

    getDiff: (file: string, staged: boolean) =>
      http<{ file: string; staged: boolean; diff: string }>(
        `/api/local/diff?file=${encodeURIComponent(file)}&staged=${staged ? 1 : 0}`
      ),

    stage: (files: string[]) =>
      http<RepoState>("/api/local/stage", { method: "POST", body: JSON.stringify({ files }) }),

    stageAll: () =>
      http<RepoState>("/api/local/stage", { method: "POST", body: JSON.stringify({ all: true }) }),

    unstage: (files: string[]) =>
      http<RepoState>("/api/local/unstage", { method: "POST", body: JSON.stringify({ files }) }),

    commit: (message: string) =>
      http<{ committed: { id: string; subject: string }; state: RepoState }>("/api/local/commit", {
        method: "POST",
        body: JSON.stringify({ message }),
      }),

    getConflicts: () => http<ConflictFile[]>("/api/local/conflicts"),

    getConflict: (file: string) =>
      http<ConflictContent>(`/api/local/conflict?file=${encodeURIComponent(file)}`),

    resolve: (file: string, content: string) =>
      http<{ resolved: string; state: RepoState }>("/api/local/resolve", {
        method: "POST",
        body: JSON.stringify({ file, content }),
      }),

    getRemotes: () => http<Remote[]>("/api/local/remotes"),

    branchCommits: (name: string) =>
      http<BranchCommits>(`/api/local/branch-commits?name=${encodeURIComponent(name)}`),

    checkout: (name: string) =>
      http<RepoState>("/api/local/checkout", { method: "POST", body: JSON.stringify({ name }) }),

    createBranch: (name: string, from?: string) =>
      http<RepoState>("/api/local/branch", { method: "POST", body: JSON.stringify({ name, from }) }),

    deleteBranch: (name: string, force = false) =>
      http<RepoState>("/api/local/branch/delete", { method: "POST", body: JSON.stringify({ name, force }) }),

    merge: (name: string) =>
      http<BranchActionResult>("/api/local/merge", { method: "POST", body: JSON.stringify({ name }) }),

    compare: (base: string, compare: string) =>
      http<CompareResult>(
        `/api/local/compare?base=${encodeURIComponent(base)}&compare=${encodeURIComponent(compare)}`
      ),

    compareDiff: (base: string, compare: string, file: string) =>
      http<{ file: string; diff: string }>(
        `/api/local/compare-diff?base=${encodeURIComponent(base)}&compare=${encodeURIComponent(compare)}&file=${encodeURIComponent(file)}`
      ),

    fetch: () => http<RepoState>("/api/local/fetch", { method: "POST" }),
    pull: () => http<BranchActionResult>("/api/local/pull", { method: "POST" }),
    push: () => http<RepoState>("/api/local/push", { method: "POST" }),

    openInEditor: (root?: string) =>
      http<{ ok: boolean }>("/api/local/open-in-editor", {
        method: "POST",
        body: JSON.stringify(root ? { root } : {}),
      }),
  },
};
