import { Router } from "express";
import type { Request } from "express";
import { resolveRepo, azureAuthArgs, openInEditor } from "../git";
import { listRepos, addRepo, setLastOpened, removeRepo, updateAutoCommit } from "../repoStore";
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
  stashList,
  stashSave,
  stashPop,
  stashDrop,
  discardFiles,
  undoLastCommit,
  amendCommit,
  revertCommit,
  resetToCommit,
  getReflog,
  getCommitDetail,
  commitFileDiff,
  getScenarioReport,
  resetToRemote,
  discardAll,
  moveCommitsToNewBranch,
  type ResetMode,
} from "../localGit";
import { logAction, listActions } from "../actionLog";
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

// GET /api/local/repos -> the full known-repository list + last opened + current.
// Each repo gets a quick health peek (branch, stash count, detached) so the
// picker can badge "N stashed change sets waiting" etc. Best-effort per repo.
router.get(
  "/repos",
  asyncRoute(async (req, res) => {
    const { repos, lastOpened } = await listRepos();
    const withInfo = await Promise.all(
      repos.map(async (r) => {
        try {
          const s = await getState(r.root);
          return { ...r, branch: s.branch, detached: s.detached, stashCount: s.stashCount, dirty: !s.clean };
        } catch {
          return { ...r, branch: null, detached: false, stashCount: 0, dirty: false };
        }
      })
    );
    res.json({ repos: withInfo, lastOpened, current: req.session.localRepo?.root ?? null });
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

// POST /api/local/autocommit  { root, config: {enabled, mode, everyHours} | null }
// Configure per-repo automatic commits (interval or on-change).
router.post(
  "/autocommit",
  asyncRoute(async (req, res) => {
    const root = typeof req.body?.root === "string" ? req.body.root : "";
    if (!root) {
      res.status(400).json({ error: "missing_root", message: "A repository is required." });
      return;
    }
    const cfg = req.body?.config;
    let patch: { enabled: boolean; mode: "interval" | "onChange"; everyHours: number } | null = null;
    if (cfg && typeof cfg === "object") {
      const mode = cfg.mode === "onChange" ? "onChange" : "interval";
      const everyHours = Math.min(Math.max(Number(cfg.everyHours) || 24, 1), 24 * 14);
      patch = { enabled: !!cfg.enabled, mode, everyHours };
    }
    const repo = await updateAutoCommit(root, patch);
    if (!repo) {
      res.status(404).json({ error: "unknown_repo", message: "That repository isn't in the list." });
      return;
    }
    res.json(repo);
  })
);

// POST /api/local/close  -> deselect the current repo (keeps it in the list)
router.post("/close", (req, res) => {
  req.session.localRepo = undefined;
  res.status(204).end();
});

// POST /api/local/connect-claude-desktop
// Registers Git Helper's MCP server in Claude Desktop's config (includes the
// current Azure connection's credentials so its Azure tools work too).
router.post(
  "/connect-claude-desktop",
  asyncRoute(async (req, res) => {
    const { connectClaudeDesktop } = await import("../claudeDesktop");
    const result = await connectClaudeDesktop(req.session.connection ?? null);
    res.json(result);
  })
);

// POST /api/local/disconnect-claude-desktop
// Removes Git Helper's MCP entry from Claude Desktop's config.
router.post(
  "/disconnect-claude-desktop",
  asyncRoute(async (_req, res) => {
    const { disconnectClaudeDesktop } = await import("../claudeDesktop");
    res.json(await disconnectClaudeDesktop());
  })
);

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

// GET /api/local/graph?limit=60&all=1&ref=<branch>&fp=1
router.get(
  "/graph",
  asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 300);
    const all = req.query.all === "1" || req.query.all === "true";
    const ref = typeof req.query.ref === "string" && req.query.ref ? req.query.ref : undefined;
    const firstParent = req.query.fp === "1" || req.query.fp === "true";
    res.json(await getGraph(res.locals.repoRoot as string, limit, all, ref, firstParent));
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

// GET /api/local/commit-detail?id=<sha>  -> full commit info + changed files
router.get(
  "/commit-detail",
  asyncRoute(async (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    if (!id || !/^[0-9a-f]{4,40}$/i.test(id)) {
      res.status(400).json({ error: "bad_id", message: "A commit id is required." });
      return;
    }
    res.json(await getCommitDetail(res.locals.repoRoot as string, id));
  })
);

// GET /api/local/commit-diff?id=<sha>&file=...  -> that file's diff in the commit
router.get(
  "/commit-diff",
  asyncRoute(async (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    const file = typeof req.query.file === "string" ? req.query.file : "";
    if (!id || !/^[0-9a-f]{4,40}$/i.test(id) || !file) {
      res.status(400).json({ error: "missing_fields", message: "A commit id and file are required." });
      return;
    }
    res.json({ id, file, diff: await commitFileDiff(res.locals.repoRoot as string, id, file) });
  })
);

// ---- Stash / discard / undo / amend ----

// GET /api/local/stash  -> list of stashes
router.get(
  "/stash",
  asyncRoute(async (_req, res) => {
    res.json(await stashList(res.locals.repoRoot as string));
  })
);

// POST /api/local/stash  { message? }  -> stash all changes (incl. untracked)
router.post(
  "/stash",
  asyncRoute(async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message : undefined;
    res.json(await stashSave(res.locals.repoRoot as string, message));
  })
);

// POST /api/local/stash/pop   { ref? }
router.post(
  "/stash/pop",
  asyncRoute(async (req, res) => {
    const ref = typeof req.body?.ref === "string" && req.body.ref ? req.body.ref : undefined;
    res.json(await stashPop(res.locals.repoRoot as string, ref));
  })
);

// POST /api/local/stash/drop  { ref }
router.post(
  "/stash/drop",
  asyncRoute(async (req, res) => {
    const ref = typeof req.body?.ref === "string" ? req.body.ref : "";
    if (!ref) {
      res.status(400).json({ error: "missing_ref", message: "A stash reference is required." });
      return;
    }
    res.json(await stashDrop(res.locals.repoRoot as string, ref));
  })
);

// POST /api/local/discard  { files }  -> throw away changes (destructive)
router.post(
  "/discard",
  asyncRoute(async (req, res) => {
    const files = asFileList(req.body?.files);
    if (files.length === 0) {
      res.status(400).json({ error: "missing_files", message: "At least one file is required." });
      return;
    }
    res.json(await discardFiles(res.locals.repoRoot as string, files));
  })
);

// POST /api/local/undo-commit  -> soft-reset the last (unpushed) commit
router.post(
  "/undo-commit",
  asyncRoute(async (_req, res) => {
    const root = res.locals.repoRoot as string;
    const prev = (await getState(root)).headCommit;
    const state = await undoLastCommit(root);
    await logAction({
      root,
      action: "Undo last commit",
      detail: `Removed commit ${prev?.id ?? ""} "${prev?.subject ?? ""}" — its changes are staged again.`,
      undo: "Nothing is lost: the changes are staged. Commit again, or Rescue back to the old commit from Undo & restore.",
    });
    res.json(state);
  })
);

// POST /api/local/amend  { message }  -> amend the last (unpushed) commit
router.post(
  "/amend",
  asyncRoute(async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "empty_message", message: "A commit message is required." });
      return;
    }
    const root = res.locals.repoRoot as string;
    const result = await amendCommit(root, message);
    res.json({ committed: result, state: await getState(root) });
  })
);

// POST /api/local/revert-commit  { id }  -> new commit that undoes commit `id`
// (safe for pushed commits; conflicts are reported for the resolver)
router.post(
  "/revert-commit",
  asyncRoute(async (req, res) => {
    const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    if (!id) {
      res.status(400).json({ error: "missing_id", message: "A commit id is required." });
      return;
    }
    const root = res.locals.repoRoot as string;
    const result = await revertCommit(root, id);
    if (result.ok) {
      await logAction({
        root,
        action: "Revert commit",
        detail: `Created a new commit that cancels ${id.slice(0, 8)}.`,
        undo: `Revert the revert: Undo & restore → Revert a commit, pick the new "Revert …" commit. (Or undo it before pushing via Undo last commit.)`,
      });
    }
    res.json(result);
  })
);

// POST /api/local/reset  { id, mode, force? }  -> move the branch back to `id`.
// mode: soft (keep staged) | mixed (keep as edits) | hard (discard). Refused
// when it would rewind pushed commits, unless force (the reflog rescue path).
router.post(
  "/reset",
  asyncRoute(async (req, res) => {
    const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
    const mode = req.body?.mode as ResetMode;
    if (!id) {
      res.status(400).json({ error: "missing_id", message: "A commit id is required." });
      return;
    }
    if (mode !== "soft" && mode !== "mixed" && mode !== "hard") {
      res.status(400).json({ error: "bad_mode", message: "mode must be soft, mixed or hard." });
      return;
    }
    const root = res.locals.repoRoot as string;
    const prevHead = (await getState(root)).headCommit?.id ?? "";
    const state = await resetToCommit(root, id, mode, !!req.body?.force);
    await logAction({
      root,
      action: mode === "hard" ? "Rewind branch (discard)" : "Rewind branch",
      detail: `Moved ${state.branch ?? "the branch"} from ${prevHead} to ${id.slice(0, 8)} (${mode} reset).`,
      undo: `Recovery is possible for ~90 days: Undo & restore → Rescue, jump back to ${prevHead}.`,
    });
    res.json(state);
  })
);

// GET /api/local/reflog?limit=30  -> recent HEAD positions (the safety net)
router.get(
  "/reflog",
  asyncRoute(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    res.json(await getReflog(res.locals.repoRoot as string, limit));
  })
);

// ---- Recovery & sync scenarios ----

// GET /api/local/scenarios?fetch=1
// Inspect the repo for recoverable situations. With fetch=1 the remote is
// contacted first so ahead/behind is accurate; a fetch failure (offline, not
// connected) degrades to a scan of what's known locally, with a note.
router.get(
  "/scenarios",
  asyncRoute(async (req, res) => {
    const root = res.locals.repoRoot as string;
    let fetchError: string | null = null;
    if (req.query.fetch === "1") {
      try {
        const remotes = await getRemotes(root);
        const pat = req.session.connection?.pat;
        if (remotes.some((r) => r.isAzure) && !pat) {
          fetchError = "Not connected to Azure DevOps, so the remote wasn't checked — ahead/behind may be stale.";
        } else if (remotes.length > 0) {
          await fetchRemote(root, pat ? azureAuthArgs(pat) : []);
        }
      } catch (e) {
        fetchError = e instanceof Error ? e.message : "Fetch failed — showing locally-known numbers.";
      }
    }
    res.json({ ...(await getScenarioReport(root)), fetchError });
  })
);

// POST /api/local/recovery/reset-to-remote
// Make the branch identical to its upstream, discarding local-only commits.
router.post(
  "/recovery/reset-to-remote",
  asyncRoute(async (req, res) => {
    const root = res.locals.repoRoot as string;
    const { state, prevHead } = await resetToRemote(root);
    await logAction({
      root,
      action: "Reset to remote",
      detail: `Made ${state.branch ?? "the branch"} identical to ${state.upstream ?? "its upstream"} (was at ${prevHead.slice(0, 8)}).`,
      undo: `Recovery is possible for ~90 days: Undo & restore → Rescue, jump to ${prevHead.slice(0, 8)} (or run: git reset --hard ${prevHead.slice(0, 8)}).`,
    });
    res.json({ state, prevHead });
  })
);

// POST /api/local/recovery/discard-all
// Throw away every uncommitted change (restore . + clean -fd). Unrecoverable.
router.post(
  "/recovery/discard-all",
  asyncRoute(async (_req, res) => {
    const root = res.locals.repoRoot as string;
    const before = await getState(root);
    const dirty = before.staged.length + before.unstaged.length + before.untracked.length;
    const state = await discardAll(root);
    await logAction({
      root,
      action: "Discard all changes",
      detail: `Discarded ${dirty} uncommitted file change${dirty === 1 ? "" : "s"} (git restore . + git clean -fd).`,
      undo: "Uncommitted changes are not recoverable once discarded — that's why this action double-confirms. (A stash would have been reversible.)",
    });
    res.json(state);
  })
);

// POST /api/local/recovery/move-commits  { name }
// Park the local-only commits on a new branch and reset this one to upstream.
router.post(
  "/recovery/move-commits",
  asyncRoute(async (req, res) => {
    const root = res.locals.repoRoot as string;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "missing_name", message: "A name for the new branch is required." });
      return;
    }
    const { state, prevHead } = await moveCommitsToNewBranch(root, name);
    await logAction({
      root,
      action: "Move commits to new branch",
      detail: `Moved local-only commits to new branch "${name}" and reset the original branch to its upstream. Now on ${state.branch}.`,
      undo: `Your commits are safe on "${name}". To undo the move entirely: check out the original branch and run git reset --hard ${prevHead.slice(0, 8)}, then delete "${name}".`,
    });
    res.json({ state, prevHead });
  })
);

// GET /api/local/actions  -> what Git Helper has done in this repo, with undo notes
router.get(
  "/actions",
  asyncRoute(async (_req, res) => {
    res.json(await listActions(res.locals.repoRoot as string));
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
    const root = res.locals.repoRoot as string;
    const result = await pull(root, auth);
    if (result.ok) {
      await logAction({
        root,
        action: "Pull",
        detail: `Merged the latest ${result.state.upstream ?? "upstream"} commits into ${result.state.branch ?? "the branch"}.`,
        undo: "If the pull was a mistake: Recovery → \"Reset to remote\" won't help here; use Undo & restore → Rescue and jump to the position just before the pull.",
      });
    }
    res.json(result);
  })
);

// POST /api/local/push
router.post(
  "/push",
  asyncRoute(async (req, res) => {
    const auth = await authFor(req, res);
    if (auth === null) return;
    const root = res.locals.repoRoot as string;
    const state = await push(root, auth);
    await logAction({
      root,
      action: "Push",
      detail: `Uploaded local commits of ${state.branch ?? "the branch"} to ${state.upstream ?? "the remote"}.`,
      undo: "Pushed commits are shared — undo with a revert (Undo & restore → Revert a commit), then push the revert.",
    });
    res.json(state);
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
