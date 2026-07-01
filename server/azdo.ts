// Thin wrapper around the Azure DevOps REST API v7.1.
// Auth uses Basic auth with an empty username and the PAT as the password.

export const API_VERSION = "7.1";

export interface Connection {
  org: string;
  project: string;
  pat: string;
}

export class AzdoError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Azure DevOps API error (${status})`);
    this.name = "AzdoError";
    this.status = status;
    this.body = body;
  }
}

function authHeader(pat: string): string {
  return "Basic " + Buffer.from(":" + pat).toString("base64");
}

type Query = Record<string, string | number | boolean | undefined>;

function buildUrl(base: string, path: string, query: Query, version: string): string {
  const url = new URL(base + path);
  url.searchParams.set("api-version", version);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(
  c: Connection,
  base: string,
  path: string,
  query: Query,
  version: string,
  opts: RequestOptions = {}
): Promise<T> {
  const url = buildUrl(base, path, query, version);
  const headers: Record<string, string> = {
    Authorization: authHeader(c.pat),
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new AzdoError(0, e instanceof Error ? e.message : "Network request failed");
  }
  if (!res.ok) {
    throw new AzdoError(res.status, await res.text());
  }
  // Some endpoints (e.g. a missing project) return an HTML sign-in page with 200.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new AzdoError(res.status, "Expected JSON but received a non-JSON response (check org/project/PAT).");
  }
  return (await res.json()) as T;
}

// Project-scoped Git API base: .../{org}/{project}/_apis/git
function gitBase(c: Connection): string {
  return `https://dev.azure.com/${encodeURIComponent(c.org)}/${encodeURIComponent(c.project)}/_apis/git`;
}

// Org-scoped base: .../{org}/_apis
function orgBase(c: Connection): string {
  return `https://dev.azure.com/${encodeURIComponent(c.org)}/_apis`;
}

// Default to GA "7.1". Pass a preview string (e.g. "7.1-preview") for
// preview-only resources such as /connectionData.
export function gitGet<T>(c: Connection, path: string, query: Query = {}, version: string = API_VERSION): Promise<T> {
  return request<T>(c, gitBase(c), path, query, version);
}

export function orgGet<T>(c: Connection, path: string, query: Query = {}, version: string = API_VERSION): Promise<T> {
  return request<T>(c, orgBase(c), path, query, version);
}

export function gitPost<T>(c: Connection, path: string, body: unknown, query: Query = {}, version: string = API_VERSION): Promise<T> {
  return request<T>(c, gitBase(c), path, query, version, { method: "POST", body });
}

export function gitPatch<T>(c: Connection, path: string, body: unknown, query: Query = {}, version: string = API_VERSION): Promise<T> {
  return request<T>(c, gitBase(c), path, query, version, { method: "PATCH", body });
}

// ---- Response shapes (only the fields we use) ----

export interface ListResponse<T> {
  count: number;
  value: T[];
}

export interface GitUserDate {
  name?: string;
  email?: string;
  date?: string;
}

export interface GitCommitRef {
  commitId: string;
  comment?: string;
  author?: GitUserDate;
  committer?: GitUserDate;
}

export interface GitRepository {
  id: string;
  name: string;
  defaultBranch?: string; // e.g. "refs/heads/main"
  webUrl?: string;
  project?: { id: string; name: string };
}

export interface GitBranchStat {
  name: string; // short name, e.g. "feature/login"
  aheadCount: number;
  behindCount: number;
  isBaseVersion: boolean;
  commit?: GitCommitRef;
}

export interface IdentityRef {
  id: string;
  displayName?: string;
  uniqueName?: string;
  imageUrl?: string;
}

export interface ReviewerRef extends IdentityRef {
  vote: number; // 10 approved, 5 approved w/ suggestions, 0 none, -5 waiting, -10 rejected
  isRequired?: boolean;
  hasDeclined?: boolean;
}

export interface PullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: "active" | "abandoned" | "completed" | "all" | string;
  isDraft?: boolean;
  createdBy?: IdentityRef;
  creationDate?: string;
  sourceRefName: string; // "refs/heads/..."
  targetRefName: string;
  mergeStatus?: string; // succeeded | conflicts | queued | rejectedByPolicy | notSet | failure
  reviewers?: ReviewerRef[];
  repository?: GitRepository;
  lastMergeSourceCommit?: { commitId: string };
}

export interface CommentThread {
  id: number;
  status?: string; // active | fixed | wontFix | closed | pending | byDesign | unknown
  isDeleted?: boolean;
  threadContext?: { filePath?: string } | null;
  comments?: Array<{
    id: number;
    parentCommentId?: number;
    author?: IdentityRef;
    content?: string;
    publishedDate?: string;
    commentType?: string; // text | system | codeChange
    isDeleted?: boolean;
  }>;
}

export interface ConnectionData {
  authenticatedUser?: IdentityRef;
  authorizedUser?: IdentityRef;
}
