import { Router } from "express";
import type { Connection, GitBranchStat, GitCommitRef, GitRepository, ListResponse, PullRequest } from "../azdo";
import { gitGet, gitPost, AzdoError } from "../azdo";
import { asyncRoute, requireConnection } from "../session";
import { mapBranch, shortRef } from "../util";

const EMPTY_LIST: ListResponse<never> = { count: 0, value: [] };

// Azure returns 404 from stats/branches and commits for an empty (no-commit)
// repository. Treat that as "no branches / no commits" instead of an error.
async function tolerate404<T>(p: Promise<ListResponse<T>>): Promise<ListResponse<T>> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AzdoError && e.status === 404) return EMPTY_LIST as ListResponse<T>;
    throw e;
  }
}

// mergeParams so :repoId from the parent mount is available here.
const router = Router({ mergeParams: true });

router.use(requireConnection);

// GET /api/repos/:repoId/branches
// Returns every branch with ahead/behind vs the repo's default branch.
router.get(
  "/branches",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId } = req.params;

    const [repo, stats] = await Promise.all([
      gitGet<GitRepository>(c, `/repositories/${encodeURIComponent(repoId)}`),
      tolerate404(gitGet<ListResponse<GitBranchStat>>(c, `/repositories/${encodeURIComponent(repoId)}/stats/branches`)),
    ]);

    const branches = stats.value.map(mapBranch).sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1; // default first
      const da = a.lastCommit?.date ? Date.parse(a.lastCommit.date) : 0;
      const db = b.lastCommit?.date ? Date.parse(b.lastCommit.date) : 0;
      return db - da; // most recently updated next
    });

    res.json({
      repoId,
      repoName: repo.name,
      defaultBranch: shortRef(repo.defaultBranch),
      webUrl: repo.webUrl || null,
      branches,
    });
  })
);

// GET /api/repos/:repoId/compare?base=main&target=feature
// Diff between two branches on the server (ahead/behind + changed files), to
// preview a merge before opening a PR and avoid surprise conflicts.
interface AzdoDiff {
  aheadCount?: number;
  behindCount?: number;
  commonCommit?: string;
  changes?: Array<{ item?: { path?: string; isFolder?: boolean }; changeType?: string }>;
}

router.get(
  "/compare",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId } = req.params;
    const base = typeof req.query.base === "string" ? req.query.base : "";
    const target = typeof req.query.target === "string" ? req.query.target : "";
    if (!base || !target) {
      res.status(400).json({ error: "missing_refs", message: "A base and a target branch are required." });
      return;
    }

    const diff = await gitGet<AzdoDiff>(c, `/repositories/${encodeURIComponent(repoId)}/diffs/commits`, {
      baseVersion: base,
      baseVersionType: "branch",
      targetVersion: target,
      targetVersionType: "branch",
      "$top": 200,
      diffCommonCommit: true,
    });

    const files = (diff.changes || [])
      .filter((ch) => ch.item && ch.item.path && !ch.item.isFolder)
      .map((ch) => ({ path: ch.item!.path as string, changeType: ch.changeType || "edit" }));

    res.json({
      base,
      target,
      ahead: diff.aheadCount ?? 0,
      behind: diff.behindCount ?? 0,
      commonCommit: diff.commonCommit ? diff.commonCommit.slice(0, 8) : null,
      files,
    });
  })
);

// GET /api/repos/:repoId/commits?branch=NAME&top=20
// Recent commits on a branch, for the schematic commit graph.
router.get(
  "/commits",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId } = req.params;
    const branch = typeof req.query.branch === "string" ? req.query.branch : undefined;
    const top = Math.min(Number(req.query.top) || 15, 50);

    const query: Record<string, string | number> = { "$top": top };
    if (branch) {
      query["searchCriteria.itemVersion.version"] = branch;
      query["searchCriteria.itemVersion.versionType"] = "branch";
    }

    const commits = await tolerate404(
      gitGet<ListResponse<GitCommitRef>>(c, `/repositories/${encodeURIComponent(repoId)}/commits`, query)
    );

    res.json(
      commits.value.map((commit) => ({
        id: commit.commitId.slice(0, 8),
        fullId: commit.commitId,
        message: (commit.comment || "").split("\n")[0],
        author: commit.author?.name || commit.committer?.name || "Unknown",
        date: commit.author?.date || commit.committer?.date || null,
      }))
    );
  })
);

// POST /api/repos/:repoId/revert  { commitId, branch, message? }
// Undo a commit on Azure the safe way: Azure computes the opposite change on
// a new revert branch, then we open a PR from it into the branch. Nothing on
// the branch itself changes until someone completes that PR.
interface AzdoRevert {
  revertId: number;
  status: string; // queued | inProgress | completed | failed | ...
  detailedStatus?: { failureMessage?: string };
}

router.post(
  "/revert",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId } = req.params;
    const commitId = typeof req.body?.commitId === "string" ? req.body.commitId.trim() : "";
    const branch = typeof req.body?.branch === "string" ? req.body.branch.trim() : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!commitId || !branch) {
      res.status(400).json({ error: "missing_fields", message: "A commit id and a branch are required." });
      return;
    }

    const repo = await gitGet<GitRepository>(c, `/repositories/${encodeURIComponent(repoId)}`);
    const suffix = Math.random().toString(36).slice(2, 7);
    const generatedRefName = `refs/heads/revert/${commitId.slice(0, 8)}-${suffix}`;

    const revert = await gitPost<AzdoRevert>(c, `/repositories/${repo.id}/reverts`, {
      generatedRefName,
      ontoRefName: `refs/heads/${branch}`,
      repository: { id: repo.id, name: repo.name },
      source: { commitList: [{ commitId }] },
    });

    // Azure computes the revert asynchronously — poll briefly until it lands.
    let status = revert.status;
    let failure: string | undefined;
    for (let i = 0; i < 20 && (status === "queued" || status === "inProgress"); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const cur = await gitGet<AzdoRevert>(c, `/repositories/${repo.id}/reverts/${revert.revertId}`);
      status = cur.status;
      failure = cur.detailedStatus?.failureMessage;
    }
    if (status !== "completed") {
      res.status(409).json({
        error: "revert_failed",
        message:
          failure ||
          `Azure couldn't create the revert (status: ${status}). This usually means the commit conflicts with newer changes on ${branch} — revert it locally instead and resolve the conflicts there.`,
      });
      return;
    }

    const pr = await gitPost<PullRequest>(c, `/repositories/${repo.id}/pullrequests`, {
      sourceRefName: generatedRefName,
      targetRefName: `refs/heads/${branch}`,
      title: `Revert: ${message || commitId.slice(0, 8)}`,
      description: `Undoes commit ${commitId} on \`${branch}\`.\n\nCreated with Git Helper — complete this PR to apply the undo.`,
    });

    res.json({
      prId: pr.pullRequestId,
      title: pr.title,
      revertBranch: generatedRefName.replace("refs/heads/", ""),
    });
  })
);

export default router;
