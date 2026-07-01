import { Router } from "express";
import type { Request } from "express";
import { resolveRepo, azureAuthArgs, openInEditor } from "../git";
import { listRepos, addRepo, setLastOpened, removeRepo } from "../repoStore";
import {
  getState,
  getBranches,
  getGraph,
  listConflicts,
  getConflict,
  resolveConflict,
  stage,
  stageAll,
  unstage,
  commit,
  diffFile,
  getRemotes,
  checkoutBranch,
  createBranch,
  mergeBranch,
  deleteBranch,
  fetchRemote,
  pull,
  push,
  branchCommits,
  compareBranches,
  compareFileDiff,
} from "../localGit";
import { asyncRoute, requireLocalRepo } from "../session";

const router = Router();

// POST /api/local/open  { path }
// Validate a folder is a git work tree, remember it in the persistent registry,
// and make it the current selection.
router.post(
  "/open",
  asyncRoute(async (req, res) => {
    const inputPath = req.body?.path;
    if (!inputPath || typeof inputPath !== "string") {
      res.status(400).json({ error: "missing_path", message: "Provide the path to a local Git repository." });
      return;
    }
    const repo = await resolveRepo(inputPath);
    await addRepo(repo.root, repo.name);
    req.session.localRepo = repo;
    res.json({ open: true, root: repo.root, name: repo.name });
  })
);

// GET /api/local/repo  -> which repo is currently selected (if any)
router.get("/repo", (req, res) => {
  const repo = req.session.localRepo;
  res.json({ open: !!repo, root: repo?.root ?? null, name: repo?.name ?? null });
});

// GET /api/local/repos -> the full known-repository list + last opened + current
router.get(
  "/repos",
  asyncRoute(async (req, res) => {
    const { repos, lastOpened } = await listRepos();
    res.json({ repos, lastOpened, current: req.session.localRepo?.root ?? null });
  })
);

// POST /api/local/select  { root }  -> make a known repo the current one
router.post(
  "/select",
  asyncRoute(async (req, res) => {
    const root = typeof req.body?.root === "string" ? req.body.root : "";
    if (!root) {
      res.status(400).json({ error: "missing_root", message: "A repository is required." });
      return;
    }
    const hit = await setLastOpened(root);
    if (!hit) {
      res.status(404).json({ error: "unknown_repo", message: "That repository isn't in the list." });
      return;
    }
    req.session.localRepo = { root: hit.root, name: hit.name };
    res.json({ open: true, root: hit.root, name: hit.name });
  })
);

// POST /api/local/remove  { root }  -> forget a repo (does not delete files)
router.post(
  "/remove",
  asyncRoute(async (req, res) => {
    const root = typeof req.body?.root === "string" ? req.body.root : "";
    const { repos, lastOpened } = await removeRepo(root);
    if (req.session.localRepo?.root === root) req.session.localRepo = undefined;
    res.json({ repos, lastOpened, current: req.session.localRepo?.root ?? null });
  })
);

// POST /api/local/close  -> deselect the current repo (keeps it in the list)
router.post("/close", (req, res) => {
  req.session.localRepo = undefined;
  res.status(204).end();
});

// POST /api/local/open-in-editor  { root? }
// Open a known repo in VS Code; defaults to the currently selected one.
router.post(
  "/open-in-editor",
  asyncRoute(async (req, res) => {
    const requested = typeof req.body?.root === "string" ? req.body.root : "";
    let root = requested;
    if (requested) {
      const { repos } = await listRepos();
      if (!repos.some((r) => r.root === requested)) {
        res.status(404).json({ error: "unknown_repo", message: "That repository isn't in the list." });
        return;
      }
    } else {
      root = req.session.localRepo?.root ?? "";
      if (!root) {
        res.status(409).json({ error: "no_local_repo", message: "No repository is selected." });
        return;
      }
    }
    await openInEditor(root);
    res.json({ ok: true });
  })
);

// Everything below needs an open repo.
router.use(requireLocalRepo);

// GET /api/local/state  -> branch, ahead/behind, file groups, conflict flags
router.get(
  "/state",
  asyncRoute(async (_req, res) => {
    res.json(await getState(res.locals.repoRoot as string));
  })
);

// GET /api/local/branches
router.get(
  "/branches",
  asyncRoute(async (_req, res) => {
    res.json(await getBranches(res.locals.repoRoot as string));
  })
);

// GET /api/local/graph?limit=60&all=1
router.get(
  "/graph",
  asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 300);
    const all = req.query.all !== "0";
    res.json(await getGraph(res.locals.repoRoot as string, limit, all));
  })
);

// GET /api/local/diff?file=...&staged=1
router.get(
  "/diff",
  asyncRoute(async (req, res) => {
    const file = typeof req.query.file === "string" ? req.query.file : "";
    if (!file) {
      res.status(400).json({ error: "missing_file", message: "A file is required." });
      return;
    }
    const staged = req.query.staged === "1" || req.query.staged === "true";
    res.json({ file, staged, diff: await diffFile(res.locals.repoRoot as string, file, staged) });
  })
);

// POST /api/local/stage   { files: string[] } | { all: true }
router.post(
  "/stage",
  asyncRoute(async (req, res) => {
    const root = res.locals.repoRoot as string;
    if (req.body?.all) {
      await stageAll(root);
    } else {
      await stage(root, asFileList(req.body?.files));
    }
    res.json(await getState(root));
  })
);

// POST /api/local/unstage   { files: string[] }
router.post(
  "/unstage",
  asyncRoute(async (req, res) => {
    const root = res.locals.repoRoot as string;
    await unstage(root, asFileList(req.body?.files));
    res.json(await getState(root));
  })
);

// POST /api/local/commit   { message }
router.post(
  "/commit",
  asyncRoute(async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "empty_message", message: "A commit message is required." });
      return;
    }
    const root = res.locals.repoRoot as string;
    const result = await commit(root, message);
    res.json({ committed: result, state: await getState(root) });
  })
);

// GET /api/local/conflicts  -> list of conflicted files with which stages exist
router.get(
  "/conflicts",
  asyncRoute(async (_req, res) => {
    res.json(await listConflicts(res.locals.repoRoot as string));
  })
);

// GET /api/local/conflict?file=...  -> base/ours/theirs/merged content
router.get(
  "/conflict",
  asyncRoute(async (req, res) => {
    const file = typeof req.query.file === "string" ? req.query.file : "";
    if (!file) {
      res.status(400).json({ error: "missing_file", message: "A file is required." });
      return;
    }
    res.json(await getConflict(res.locals.repoRoot as string, file));
  })
);

// POST /api/local/resolve   { file, content }
router.post(
  "/resolve",
  asyncRoute(async (req, res) => {
    const file = typeof req.body?.file === "string" ? req.body.file : "";
    const content = typeof req.body?.content === "string" ? req.body.content : null;
    if (!file || content === null) {
      res.status(400).json({ error: "missing_fields", message: "A file and resolved content are required." });
      return;
    }
    const root = res.locals.repoRoot as string;
    await resolveConflict(root, file, content);
    res.json({ resolved: file, state: await getState(root) });
  })
);

// ---- Branches ----

// GET /api/local/remotes
router.get(
  "/remotes",
  asyncRoute(async (_req, res) => {
    res.json(await getRemotes(res.locals.repoRoot as string));
  })
);

// GET /api/local/branch-commits?name=feature
router.get(
  "/branch-commits",
  asyncRoute(async (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name : "";
    if (!name) {
      res.status(400).json({ error: "missing_name", message: "A branch name is required." });
      return;
    }
    res.json(await branchCommits(res.locals.repoRoot as string, name));
  })
);

// POST /api/local/checkout  { name }
router.post(
  "/checkout",
  asyncRoute(async (req, res) => {
    const name = requireName(req, res);
    if (name === null) return;
    res.json(await checkoutBranch(res.locals.repoRoot as string, name));
  })
);

// POST /api/local/branch  { name, from? }   -> create + switch
router.post(
  "/branch",
  asyncRoute(async (req, res) => {
    const name = requireName(req, res);
    if (name === null) return;
    const from = typeof req.body?.from === "string" && req.body.from ? req.body.from : undefined;
    res.json(await createBranch(res.locals.repoRoot as string, name, from));
  })
);

// POST /api/local/branch/delete  { name, force? }
router.post(
  "/branch/delete",
  asyncRoute(async (req, res) => {
    const name = requireName(req, res);
    if (name === null) return;
    await deleteBranch(res.locals.repoRoot as string, name, !!req.body?.force);
    res.json(await getState(res.locals.repoRoot as string));
  })
);

// POST /api/local/merge  { name }   -> merge name into current branch
router.post(
  "/merge",
  asyncRoute(async (req, res) => {
    const name = requireName(req, res);
    if (name === null) return;
    res.json(await mergeBranch(res.locals.repoRoot as string, name));
  })
);

// GET /api/local/compare?base=main&compare=feature
router.get(
  "/compare",
  asyncRoute(async (req, res) => {
    const base = typeof req.query.base === "string" ? req.query.base : "";
    const compare = typeof req.query.compare === "string" ? req.query.compare : "";
    if (!base || !compare) {
      res.status(400).json({ error: "missing_refs", message: "Both a base and a compare branch are required." });
      return;
    }
    res.json(await compareBranches(res.locals.repoRoot as string, base, compare));
  })
);

// GET /api/local/compare-diff?base=&compare=&file=
router.get(
  "/compare-diff",
  asyncRoute(async (req, res) => {
    const base = typeof req.query.base === "string" ? req.query.base : "";
    const compare = typeof req.query.compare === "string" ? req.query.compare : "";
    const file = typeof req.query.file === "string" ? req.query.file : "";
    if (!base || !compare || !file) {
      res.status(400).json({ error: "missing_fields", message: "base, compare, and file are required." });
      return;
    }
    res.json({ file, diff: await compareFileDiff(res.locals.repoRoot as string, base, compare, file) });
  })
);

// ---- Network (needs the Azure PAT for private repos) ----

// POST /api/local/fetch
router.post(
  "/fetch",
  asyncRoute(async (req, res) => {
    const auth = await authFor(req, res);
    if (auth === null) return;
    res.json(await fetchRemote(res.locals.repoRoot as string, auth));
  })
);

// POST /api/local/pull
router.post(
  "/pull",
  asyncRoute(async (req, res) => {
    const auth = await authFor(req, res);
    if (auth === null) return;
    res.json(await pull(res.locals.repoRoot as string, auth));
  })
);

// POST /api/local/push
router.post(
  "/push",
  asyncRoute(async (req, res) => {
    const auth = await authFor(req, res);
    if (auth === null) return;
    res.json(await push(res.locals.repoRoot as string, auth));
  })
);

function requireName(req: Request, res: import("express").Response): string | null {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "missing_name", message: "A branch name is required." });
    return null;
  }
  return name;
}

// Build the auth prefix for a network op. Returns [] for public remotes; for an
// Azure remote with no active connection, refuses with a clear message.
async function authFor(req: Request, res: import("express").Response): Promise<string[] | null> {
  const pat = req.session.connection?.pat;
  if (pat) return azureAuthArgs(pat);
  const remotes = await getRemotes(res.locals.repoRoot as string);
  if (remotes.some((r) => r.isAzure)) {
    res.status(409).json({
      error: "not_connected",
      message: "This repo's remote is Azure DevOps. Connect with your organization, project, and PAT first so the app can authenticate.",
    });
    return null;
  }
  return [];
}

function asFileList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export default router;
