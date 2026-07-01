import { Router } from "express";
import type { CommentThread, Connection, ListResponse, PullRequest } from "../azdo";
import { gitGet, gitPost, gitPatch } from "../azdo";
import { asyncRoute, requireConnection } from "../session";
import { mapPullRequest, mapThreads } from "../util";

const router = Router({ mergeParams: true });

router.use(requireConnection);

const ALLOWED_STATUS = new Set(["active", "completed", "abandoned", "all"]);
const MERGE_STRATEGIES = new Set(["noFastForward", "squash", "rebase", "rebaseMerge"]);

function toRef(branch: string): string {
  return branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
}

// GET /api/repos/:repoId/pullrequests?status=active|completed|abandoned|all
router.get(
  "/",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId } = req.params;
    const statusParam = typeof req.query.status === "string" ? req.query.status : "active";
    const status = ALLOWED_STATUS.has(statusParam) ? statusParam : "active";

    const prs = await gitGet<ListResponse<PullRequest>>(
      c,
      `/repositories/${encodeURIComponent(repoId)}/pullrequests`,
      { "searchCriteria.status": status, "$top": 50 }
    );

    res.json(prs.value.map(mapPullRequest));
  })
);

// POST /api/repos/:repoId/pullrequests  { source, target, title, description? }
// Create a pull request — the Azure way to merge one branch into another.
router.post(
  "/",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId } = req.params;
    const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
    const target = typeof req.body?.target === "string" ? req.body.target.trim() : "";
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!source || !target || !title) {
      res.status(400).json({ error: "missing_fields", message: "A source branch, target branch, and title are required." });
      return;
    }
    if (source === target) {
      res.status(400).json({ error: "same_branch", message: "The source and target branches must be different." });
      return;
    }
    const pr = await gitPost<PullRequest>(
      c,
      `/repositories/${encodeURIComponent(repoId)}/pullrequests`,
      {
        sourceRefName: toRef(source),
        targetRefName: toRef(target),
        title,
        description: typeof req.body?.description === "string" ? req.body.description : undefined,
      }
    );
    res.json(mapPullRequest(pr));
  })
);

// POST /api/repos/:repoId/pullrequests/:prId/complete  { mergeStrategy?, deleteSourceBranch? }
// Complete (merge) a pull request in Azure DevOps.
router.post(
  "/:prId/complete",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId, prId } = req.params;
    const mergeStrategy =
      typeof req.body?.mergeStrategy === "string" && MERGE_STRATEGIES.has(req.body.mergeStrategy)
        ? req.body.mergeStrategy
        : "noFastForward";
    const deleteSourceBranch = !!req.body?.deleteSourceBranch;

    // Completion needs the current head of the source branch.
    const current = await gitGet<PullRequest>(
      c,
      `/repositories/${encodeURIComponent(repoId)}/pullrequests/${encodeURIComponent(prId)}`
    );
    if (!current.lastMergeSourceCommit?.commitId) {
      res.status(409).json({
        error: "not_ready",
        message: "Azure DevOps hasn't finished computing this merge yet. Refresh in a moment and try again.",
      });
      return;
    }

    const updated = await gitPatch<PullRequest>(
      c,
      `/repositories/${encodeURIComponent(repoId)}/pullrequests/${encodeURIComponent(prId)}`,
      {
        status: "completed",
        lastMergeSourceCommit: { commitId: current.lastMergeSourceCommit.commitId },
        completionOptions: { mergeStrategy, deleteSourceBranch, bypassPolicy: false },
      }
    );
    res.json(mapPullRequest(updated));
  })
);

// GET /api/repos/:repoId/pullrequests/:prId
router.get(
  "/:prId",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId, prId } = req.params;
    const pr = await gitGet<PullRequest>(
      c,
      `/repositories/${encodeURIComponent(repoId)}/pullrequests/${encodeURIComponent(prId)}`
    );
    res.json(mapPullRequest(pr));
  })
);

// GET /api/repos/:repoId/pullrequests/:prId/threads  -> comment threads
router.get(
  "/:prId/threads",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId, prId } = req.params;
    const threads = await gitGet<ListResponse<CommentThread>>(
      c,
      `/repositories/${encodeURIComponent(repoId)}/pullRequests/${encodeURIComponent(prId)}/threads`
    );
    res.json(mapThreads(threads.value));
  })
);

export default router;
