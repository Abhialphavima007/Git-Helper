// Git Helper as an MCP server for Claude Desktop (and any MCP client).
// Runs over stdio; Claude Desktop launches it and calls these tools when you
// chat ("commit my changes in payments-service", "open a PR into main").
// No Anthropic API key involved — inference runs on the user's Claude app.
//
// Repos come from the same registry the app uses (~/.azdo-git-helper/repos.json);
// tools take an optional repo name, defaulting to the last-opened repo.
// Azure DevOps tools activate when AZDO_ORG / AZDO_PROJECT / AZDO_PAT are set
// in the MCP server's env (claude_desktop_config.json).
//
// Safety: the same rules as the in-app assistant — nothing destructive is
// exposed (no discard, no branch deletion, no history rewriting, no PR
// completion), and conflicted/merging repos are reported, not "fixed".

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listRepos } from "./repoStore";
import {
  getState,
  getBranches,
  getGraph,
  checkoutBranch,
  createBranch,
  mergeBranch,
  stage,
  stageAll,
  commit,
  stashSave,
  stashPop,
  compareBranches,
  fetchRemote,
  pull,
  push,
} from "./localGit";
import { azureAuthArgs } from "./git";
import type { Connection, GitBranchStat, GitRepository, ListResponse, PullRequest } from "./azdo";
import { gitGet, gitPost } from "./azdo";
import { mapPullRequest } from "./util";

const server = new McpServer({ name: "git-helper", version: "1.0.0" });

// ---------- helpers ----------

const azure: Connection | null =
  process.env.AZDO_ORG && process.env.AZDO_PROJECT && process.env.AZDO_PAT
    ? { org: process.env.AZDO_ORG, project: process.env.AZDO_PROJECT, pat: process.env.AZDO_PAT }
    : null;

async function resolveRepoRoot(repoName?: string): Promise<{ root: string; name: string }> {
  const { repos, lastOpened } = await listRepos();
  if (repos.length === 0) {
    throw new Error("No repositories are registered in Git Helper yet. Open or clone one in the Git Helper app first.");
  }
  if (repoName) {
    const hit = repos.find((r) => r.name.toLowerCase() === repoName.toLowerCase());
    if (!hit) {
      throw new Error(`No repository named "${repoName}". Known repositories: ${repos.map((r) => r.name).join(", ")}`);
    }
    return hit;
  }
  const def = repos.find((r) => r.root === lastOpened) ?? repos[0];
  return def;
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });
const repoParam = z
  .string()
  .optional()
  .describe("Repository name from list_repositories. Omit to use the most recently opened repo.");

// ---------- local tools ----------

server.registerTool(
  "list_repositories",
  { description: "List the local repositories registered in Git Helper (cloned or opened by the user)." },
  async () => {
    const { repos, lastOpened } = await listRepos();
    return ok(repos.map((r) => ({ name: r.name, path: r.root, isDefault: r.root === lastOpened })));
  }
);

server.registerTool(
  "get_repo_status",
  {
    description:
      "Working-tree status of a repository: current branch, upstream, ahead/behind, staged/unstaged/untracked/conflicted files, stash count, last commit.",
    inputSchema: { repo: repoParam },
  },
  async ({ repo }) => {
    const { root, name } = await resolveRepoRoot(repo);
    const s = await getState(root);
    return ok({
      repo: name,
      branch: s.branch,
      detached: s.detached,
      upstream: s.upstream,
      ahead: s.ahead,
      behind: s.behind,
      staged: s.staged.map((f) => f.path),
      unstaged: s.unstaged.map((f) => f.path),
      untracked: s.untracked.map((f) => f.path),
      conflicted: s.conflicted.map((f) => f.path),
      mergeInProgress: s.merging,
      stashCount: s.stashCount,
      lastCommit: s.headCommit,
    });
  }
);

server.registerTool(
  "list_branches",
  { description: "List local and remote branches with ahead/behind and last commit.", inputSchema: { repo: repoParam } },
  async ({ repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const b = await getBranches(root);
    return ok(b.map((x) => ({ name: x.name, ref: x.ref, current: x.current, remoteOnly: x.isRemote, ahead: x.ahead, behind: x.behind })));
  }
);

server.registerTool(
  "create_branch",
  { description: "Create a new branch from the current one and switch to it.", inputSchema: { name: z.string(), repo: repoParam } },
  async ({ name, repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const s = await createBranch(root, name);
    return ok({ ok: true, nowOn: s.branch });
  }
);

server.registerTool(
  "checkout_branch",
  {
    description: "Switch to a branch (use the ref from list_branches; remote-only refs like origin/x become local tracking branches).",
    inputSchema: { ref: z.string(), repo: repoParam },
  },
  async ({ ref, repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const s = await checkoutBranch(root, ref);
    return ok({ ok: true, nowOn: s.branch });
  }
);

server.registerTool(
  "stage_files",
  { description: "Stage files for commit — specific paths, or everything.", inputSchema: { files: z.array(z.string()).optional(), all: z.boolean().optional(), repo: repoParam } },
  async ({ files, all, repo }) => {
    const { root } = await resolveRepoRoot(repo);
    if (all) await stageAll(root);
    else await stage(root, files ?? []);
    const s = await getState(root);
    return ok({ staged: s.staged.map((f) => f.path) });
  }
);

server.registerTool(
  "commit_changes",
  { description: "Commit the staged files with a message (stage first if needed).", inputSchema: { message: z.string(), repo: repoParam } },
  async ({ message, repo }) => {
    const { root } = await resolveRepoRoot(repo);
    return ok({ committed: await commit(root, message) });
  }
);

server.registerTool(
  "merge_branch",
  {
    description: "Merge the named branch into the CURRENT branch. Conflicts are reported — the user resolves them in Git Helper's Resolve conflicts screen.",
    inputSchema: { name: z.string(), repo: repoParam },
  },
  async ({ name, repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const r = await mergeBranch(root, name);
    return ok({ ok: r.ok, conflicts: r.conflicts, conflictedFiles: r.state.conflicted.map((f) => f.path) });
  }
);

server.registerTool(
  "compare_branches",
  { description: "Compare two branches: ahead/behind, the commits and files the compare branch adds over the base.", inputSchema: { base: z.string(), compare: z.string(), repo: repoParam } },
  async ({ base, compare, repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const r = await compareBranches(root, base, compare);
    return ok({ ahead: r.ahead, behind: r.behind, commits: r.commits.slice(0, 20).map((c) => c.subject), files: r.files.map((f) => `${f.path} +${f.added} -${f.removed}`) });
  }
);

server.registerTool(
  "get_history",
  { description: "Recent commit history of the current branch.", inputSchema: { limit: z.number().int().max(50).optional(), repo: repoParam } },
  async ({ limit, repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const g = await getGraph(root, limit ?? 15, false);
    return ok(g.map((c) => ({ id: c.id, subject: c.subject, author: c.author, date: c.date, refs: c.refs })));
  }
);

server.registerTool(
  "stash_changes",
  { description: "Stash all uncommitted changes (including new files) so the tree is clean.", inputSchema: { repo: repoParam } },
  async ({ repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const s = await stashSave(root);
    return ok({ ok: true, stashCount: s.stashCount });
  }
);

server.registerTool(
  "restore_stash",
  { description: "Restore the most recent stash into the working tree.", inputSchema: { repo: repoParam } },
  async ({ repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const r = await stashPop(root);
    return ok({ ok: r.ok, conflicts: r.conflicts });
  }
);

server.registerTool(
  "git_fetch",
  { description: "Fetch the latest refs from the remote (changes nothing locally).", inputSchema: { repo: repoParam } },
  async ({ repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const s = await fetchRemote(root, azure ? azureAuthArgs(azure.pat) : []);
    return ok({ ahead: s.ahead, behind: s.behind });
  }
);

server.registerTool(
  "git_pull",
  { description: "Pull the upstream's commits into the current branch.", inputSchema: { repo: repoParam } },
  async ({ repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const r = await pull(root, azure ? azureAuthArgs(azure.pat) : []);
    return ok({ ok: r.ok, conflicts: r.conflicts });
  }
);

server.registerTool(
  "git_push",
  { description: "Push the current branch's commits to the remote (publishes a new branch automatically).", inputSchema: { repo: repoParam } },
  async ({ repo }) => {
    const { root } = await resolveRepoRoot(repo);
    const s = await push(root, azure ? azureAuthArgs(azure.pat) : []);
    return ok({ ok: true, ahead: s.ahead, upstream: s.upstream });
  }
);

// ---------- Azure DevOps tools (need AZDO_ORG / AZDO_PROJECT / AZDO_PAT) ----------

if (azure) {
  server.registerTool(
    "azure_list_repositories",
    { description: `List repositories in the Azure DevOps project "${azure.project}".` },
    async () => {
      const repos = await gitGet<ListResponse<GitRepository>>(azure, "/repositories");
      return ok(repos.value.map((r) => ({ id: r.id, name: r.name, defaultBranch: r.defaultBranch })));
    }
  );

  server.registerTool(
    "azure_list_branches",
    { description: "List branches of an Azure DevOps repository with ahead/behind vs the default branch.", inputSchema: { repositoryName: z.string() } },
    async ({ repositoryName }) => {
      const stats = await gitGet<ListResponse<GitBranchStat>>(azure, `/repositories/${encodeURIComponent(repositoryName)}/stats/branches`);
      return ok(stats.value.map((b) => ({ name: b.name, ahead: b.aheadCount, behind: b.behindCount, isDefault: b.isBaseVersion })));
    }
  );

  server.registerTool(
    "azure_list_pull_requests",
    { description: "List pull requests of an Azure DevOps repository.", inputSchema: { repositoryName: z.string(), status: z.enum(["active", "completed", "abandoned", "all"]).optional() } },
    async ({ repositoryName, status }) => {
      const prs = await gitGet<ListResponse<PullRequest>>(azure, `/repositories/${encodeURIComponent(repositoryName)}/pullrequests`, {
        "searchCriteria.status": status ?? "active",
        "$top": 25,
      });
      return ok(prs.value.map((p) => {
        const m = mapPullRequest(p);
        return { id: m.id, title: m.title, status: m.status, mergeStatus: m.mergeStatus, source: m.sourceBranch, target: m.targetBranch };
      }));
    }
  );

  server.registerTool(
    "azure_create_pull_request",
    {
      description: "Create a pull request on Azure DevOps (how branches merge in the cloud; a human completes it).",
      inputSchema: { repositoryName: z.string(), source: z.string(), target: z.string(), title: z.string(), description: z.string().optional() },
    },
    async ({ repositoryName, source, target, title, description }) => {
      const toRef = (b: string) => (b.startsWith("refs/") ? b : `refs/heads/${b}`);
      const pr = await gitPost<PullRequest>(azure, `/repositories/${encodeURIComponent(repositoryName)}/pullrequests`, {
        sourceRefName: toRef(source),
        targetRefName: toRef(target),
        title,
        description,
      });
      return ok({ created: true, id: pr.pullRequestId, title: pr.title });
    }
  );
}

// ---------- start ----------

const transport = new StdioServerTransport();
await server.connect(transport);
