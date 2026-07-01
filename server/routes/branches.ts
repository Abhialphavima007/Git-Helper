import { Router } from "express";
import type { Connection, GitBranchStat, GitCommitRef, GitRepository, ListResponse } from "../azdo";
import { gitGet, AzdoError } from "../azdo";
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
        message: (commit.comment || "").split("\n")[0],
        author: commit.author?.name || commit.committer?.name || "Unknown",
        date: commit.author?.date || commit.committer?.date || null,
      }))
    );
  })
);

export default router;
