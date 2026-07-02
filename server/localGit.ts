// Higher-level local-git operations. Each function runs git inside a repo
// root and shapes the output into the small JSON the frontend consumes —
// the same "only the fields we use" discipline as the Azure DevOps mapper.

import { promises as fs } from "node:fs";
import path from "node:path";
import { runGit } from "./git";

// Network ops (fetch/pull/push) can take longer than local plumbing.
const NETWORK_TIMEOUT = 120_000;

const UNIT = "\x1f"; // field separator inside a record
const REC = "\x1e"; // record separator between commits

export type FileChange = "modified" | "added" | "deleted" | "renamed" | "untracked" | "typechange";

export interface RepoFile {
  path: string;
  staged: boolean; // has a staged (index) change
  unstaged: boolean; // has a working-tree change
  conflicted: boolean;
  change: FileChange;
  origPath?: string; // for renames
  added?: number; // lines added (from numstat)
  removed?: number; // lines removed
}

export interface RepoState {
  branch: string | null; // null when detached
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: RepoFile[];
  unstaged: RepoFile[];
  untracked: RepoFile[];
  conflicted: RepoFile[];
  clean: boolean;
  merging: boolean; // a merge is in progress (MERGE_HEAD present)
  headCommit: { id: string; subject: string } | null; // last commit (null in an empty repo)
  stashCount: number;
}

const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function changeFromCode(x: string, y: string): FileChange {
  const c = x !== " " && x !== "?" ? x : y;
  switch (c) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "added";
    case "T":
      return "typechange";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}

// Parse `git status --porcelain=v1 -z --branch` into a structured state.
function parseStatus(raw: string): Omit<RepoState, "merging" | "headCommit" | "stashCount"> {
  const tokens = raw.split("\0");
  let branch: string | null = null;
  let detached = false;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  const staged: RepoFile[] = [];
  const unstaged: RepoFile[] = [];
  const untracked: RepoFile[] = [];
  const conflicted: RepoFile[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "") continue;

    // Branch header line: "## name...upstream [ahead 1, behind 2]"
    if (t.startsWith("## ")) {
      const header = t.slice(3);
      if (header.startsWith("HEAD (no branch)")) {
        detached = true;
      } else {
        const [local, rest] = header.split("...");
        branch = local;
        if (rest) {
          upstream = rest.split(" ")[0];
          const a = /ahead (\d+)/.exec(rest);
          const b = /behind (\d+)/.exec(rest);
          if (a) ahead = Number(a[1]);
          if (b) behind = Number(b[1]);
        }
      }
      continue;
    }

    const x = t[0];
    const y = t[1];
    const xy = x + y;
    const filePath = t.slice(3);

    // Renames/copies carry a second NUL-separated original path.
    let origPath: string | undefined;
    if (x === "R" || x === "C") {
      origPath = tokens[i + 1];
      i++;
    }

    const file: RepoFile = {
      path: filePath,
      staged: false,
      unstaged: false,
      conflicted: false,
      change: changeFromCode(x, y),
      origPath,
    };

    if (UNMERGED.has(xy)) {
      file.conflicted = true;
      conflicted.push(file);
      continue;
    }
    if (xy === "??") {
      file.unstaged = true;
      untracked.push({ ...file, change: "untracked" });
      continue;
    }
    if (x !== " " && x !== "?") {
      staged.push({ ...file, staged: true, change: changeFromCode(x, " ") });
    }
    if (y !== " " && y !== "?") {
      unstaged.push({ ...file, unstaged: true, change: changeFromCode(" ", y) });
    }
  }

  const clean =
    staged.length === 0 && unstaged.length === 0 && untracked.length === 0 && conflicted.length === 0;

  return { branch, detached, upstream, ahead, behind, staged, unstaged, untracked, conflicted, clean };
}

// Parse `git diff --numstat` into a path -> {added, removed} map.
async function numstat(root: string, staged: boolean): Promise<Map<string, { added: number; removed: number }>> {
  const args = ["diff", "--numstat"];
  if (staged) args.push("--staged");
  const raw = await runGit(root, args);
  const map = new Map<string, { added: number; removed: number }>();
  for (const line of raw.split("\n").filter(Boolean)) {
    const [a, r, ...rest] = line.split("\t");
    const p = rest.join("\t");
    map.set(p, { added: a === "-" ? 0 : Number(a) || 0, removed: r === "-" ? 0 : Number(r) || 0 });
  }
  return map;
}

export async function getState(root: string): Promise<RepoState> {
  const raw = await runGit(root, ["status", "--porcelain=v1", "-z", "--branch"]);
  const parsed = parseStatus(raw);

  // Attach +/- line counts so the UI can show a GitHub-style summary.
  const [stagedStat, unstagedStat] = await Promise.all([numstat(root, true), numstat(root, false)]);
  for (const f of parsed.staged) {
    const s = stagedStat.get(f.path);
    if (s) {
      f.added = s.added;
      f.removed = s.removed;
    }
  }
  for (const f of parsed.unstaged) {
    const s = unstagedStat.get(f.path);
    if (s) {
      f.added = s.added;
      f.removed = s.removed;
    }
  }

  // A merge is in progress when MERGE_HEAD exists in the git dir.
  let merging = false;
  try {
    const gitDir = (await runGit(root, ["rev-parse", "--git-dir"])).trim();
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
    await fs.access(path.join(abs, "MERGE_HEAD"));
    merging = true;
  } catch {
    /* no merge in progress */
  }

  // Last commit (for the undo/amend UI) — absent in a brand-new repo.
  let headCommit: RepoState["headCommit"] = null;
  try {
    const raw = (await runGit(root, ["log", "-1", `--pretty=%h${UNIT}%s`])).trim();
    if (raw) {
      const [id, subject] = raw.split(UNIT);
      headCommit = { id, subject: subject || "" };
    }
  } catch {
    /* no commits yet */
  }

  let stashCount = 0;
  try {
    const raw = await runGit(root, ["stash", "list", "--format=%gd"]);
    stashCount = raw.split("\n").filter(Boolean).length;
  } catch {
    /* stash unavailable */
  }

  return { ...parsed, merging, headCommit, stashCount };
}

export interface BranchSummary {
  name: string; // display name, e.g. "feature/login"
  ref: string; // git ref to use, e.g. "feature/login" (local) or "origin/feature/login" (remote-only)
  current: boolean;
  isRemote: boolean; // a remote-only branch (fetched, but not yet a local branch)
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommit: { id: string; message: string; date: string | null } | null;
}

// All branches: local branches plus remote-tracking branches that don't have a
// local copy yet. After a clone only the default branch is local, so the rest
// show up here as `isRemote` — checking one out creates a local tracking branch.
export async function getBranches(root: string): Promise<BranchSummary[]> {
  const fmt = [
    "%(refname)", // full ref
    "%(refname:short)",
    "%(HEAD)",
    "%(upstream:short)",
    "%(upstream:track)",
    "%(objectname:short)",
    "%(contents:subject)",
    "%(committerdate:iso-strict)",
  ].join(UNIT);

  const raw = await runGit(root, ["for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes"]);
  const lines = raw.split("\n").filter(Boolean);

  const localNames = new Set<string>();
  for (const line of lines) {
    const full = line.split(UNIT)[0];
    if (full.startsWith("refs/heads/")) localNames.add(full.slice("refs/heads/".length));
  }

  const locals: BranchSummary[] = [];
  const remotes: BranchSummary[] = [];

  for (const line of lines) {
    const [full, short, head, upstream, track, sha, subject, date] = line.split(UNIT);
    const lastCommit = sha ? { id: sha, message: subject || "", date: date || null } : null;

    if (full.startsWith("refs/remotes/")) {
      if (full.endsWith("/HEAD")) continue; // skip the origin/HEAD symbolic pointer
      const shortName = short.replace(/^[^/]+\//, ""); // strip "origin/"
      if (localNames.has(shortName)) continue; // already have a local branch
      remotes.push({
        name: shortName,
        ref: short,
        current: false,
        isRemote: true,
        upstream: null,
        ahead: 0,
        behind: 0,
        lastCommit,
      });
      continue;
    }

    if (full.startsWith("refs/heads/")) {
      const a = /ahead (\d+)/.exec(track || "");
      const b = /behind (\d+)/.exec(track || "");
      const name = full.slice("refs/heads/".length);
      locals.push({
        name,
        ref: name,
        current: head === "*",
        isRemote: false,
        upstream: upstream || null,
        ahead: a ? Number(a[1]) : 0,
        behind: b ? Number(b[1]) : 0,
        lastCommit,
      });
    }
  }

  locals.sort((x, y) => (x.current ? -1 : y.current ? 1 : x.name.localeCompare(y.name)));
  remotes.sort((x, y) => x.name.localeCompare(y.name));
  return [...locals, ...remotes];
}

export interface GraphCommit {
  id: string; // short
  full: string;
  parents: string[]; // short parent ids
  author: string;
  date: string | null;
  subject: string;
  refs: string[]; // decorations: branch/tag names, "HEAD"
}

export async function getGraph(root: string, limit = 60, all = true): Promise<GraphCommit[]> {
  const fmt = ["%H", "%h", "%p", "%an", "%aI", "%s", "%D"].join(UNIT) + REC;
  const args = ["log", `--pretty=format:${fmt}`, `-n`, String(limit)];
  if (all) args.push("--all");
  args.push("--topo-order");

  const raw = await runGit(root, args);
  return raw
    .split(REC)
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.trim() !== "")
    .map((record) => {
      const [full, short, parents, author, date, subject, decoration] = record.split(UNIT);
      const refs = (decoration || "")
        .split(",")
        .map((d) => d.trim().replace(/^HEAD -> /, "HEAD, ").trim())
        .flatMap((d) => d.split(",").map((s) => s.trim()))
        .filter(Boolean);
      return {
        id: short,
        full,
        parents: parents ? parents.trim().split(" ").filter(Boolean) : [],
        author,
        date: date || null,
        subject,
        refs,
      };
    });
}

// ---- Conflicts ----

export interface ConflictFile {
  path: string;
  // Which stages exist: 1 base, 2 ours, 3 theirs. A missing stage means the
  // file was added/deleted on one side.
  hasBase: boolean;
  hasOurs: boolean;
  hasTheirs: boolean;
}

export async function listConflicts(root: string): Promise<ConflictFile[]> {
  // ls-files -u lists unmerged entries, one line per stage.
  const raw = await runGit(root, ["ls-files", "-u", "-z"]);
  const byPath = new Map<string, ConflictFile>();
  for (const entry of raw.split("\0")) {
    if (!entry) continue;
    // Format: "<mode> <sha> <stage>\t<path>"
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const meta = entry.slice(0, tab).split(" ");
    const stage = meta[2];
    const p = entry.slice(tab + 1);
    const cur =
      byPath.get(p) || { path: p, hasBase: false, hasOurs: false, hasTheirs: false };
    if (stage === "1") cur.hasBase = true;
    if (stage === "2") cur.hasOurs = true;
    if (stage === "3") cur.hasTheirs = true;
    byPath.set(p, cur);
  }
  return [...byPath.values()];
}

export interface ConflictContent {
  path: string;
  base: string | null; // stage 1
  ours: string | null; // stage 2
  theirs: string | null; // stage 3
  merged: string; // current working-tree content (with markers)
}

async function showStage(root: string, stage: 1 | 2 | 3, file: string): Promise<string | null> {
  try {
    return await runGit(root, ["show", `:${stage}:${file}`]);
  } catch {
    return null; // stage absent (added/deleted on one side)
  }
}

export async function getConflict(root: string, file: string): Promise<ConflictContent> {
  const [base, ours, theirs] = await Promise.all([
    showStage(root, 1, file),
    showStage(root, 2, file),
    showStage(root, 3, file),
  ]);
  let merged = "";
  try {
    merged = await fs.readFile(path.join(root, file), "utf8");
  } catch {
    merged = "";
  }
  return { path: file, base, ours, theirs, merged };
}

// Write resolved content for a file and stage it.
export async function resolveConflict(root: string, file: string, content: string): Promise<void> {
  const target = path.join(root, file);
  await fs.writeFile(target, content, "utf8");
  await runGit(root, ["add", "--", file]);
}

// ---- Mutations ----

export async function stage(root: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await runGit(root, ["add", "--", ...files]);
}

export async function stageAll(root: string): Promise<void> {
  await runGit(root, ["add", "-A"]);
}

export async function unstage(root: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await runGit(root, ["restore", "--staged", "--", ...files]);
}

export interface CommitResult {
  id: string;
  subject: string;
}

export async function commit(root: string, message: string): Promise<CommitResult> {
  await runGit(root, ["commit", "-m", message]);
  const id = (await runGit(root, ["rev-parse", "--short", "HEAD"])).trim();
  const subject = (await runGit(root, ["log", "-1", "--pretty=%s"])).trim();
  return { id, subject };
}

// Unified diff for one file. `staged` shows the index vs HEAD; otherwise the
// working tree vs the index. Returns "" when there's nothing to show.
// For untracked files, fall back to a no-index diff against /dev/null.
export async function diffFile(root: string, file: string, staged: boolean): Promise<string> {
  const args = ["diff", "--no-color"];
  if (staged) args.push("--staged");
  args.push("--", file);
  const out = await runGit(root, args);
  if (out.trim() === "" && !staged) {
    // Untracked file — show its full content as additions.
    try {
      return await runGit(root, ["diff", "--no-color", "--no-index", "--", "/dev/null", file]);
    } catch (e) {
      // --no-index returns exit code 1 when files differ; the diff is still on stdout.
      const msg = e instanceof Error ? (e as { message?: string }).message ?? "" : "";
      if (msg.includes("@@") || msg.includes("+++")) return msg;
      return out;
    }
  }
  return out;
}

// ---- Stash ----

export interface StashEntry {
  ref: string; // "stash@{0}"
  message: string;
}

export async function stashList(root: string): Promise<StashEntry[]> {
  const raw = await runGit(root, ["stash", "list", `--format=%gd${UNIT}%gs`]);
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, message] = line.split(UNIT);
      return { ref, message: message || "" };
    });
}

// Stash everything (including untracked files, like GitHub Desktop does).
export async function stashSave(root: string, message?: string): Promise<RepoState> {
  const args = ["stash", "push", "--include-untracked"];
  if (message && message.trim()) args.push("-m", message.trim());
  await runGit(root, args);
  return getState(root);
}

// Restore a stash. Conflicts are reported, not thrown, so the UI can route to
// the resolver just like a merge.
export async function stashPop(root: string, ref?: string): Promise<BranchActionResult> {
  try {
    await runGit(root, ref ? ["stash", "pop", ref] : ["stash", "pop"]);
  } catch (e) {
    const state = await getState(root);
    if (state.conflicted.length > 0) return { ok: false, conflicts: true, state };
    throw e;
  }
  return { ok: true, conflicts: false, state: await getState(root) };
}

export async function stashDrop(root: string, ref: string): Promise<RepoState> {
  await runGit(root, ["stash", "drop", ref]);
  return getState(root);
}

// ---- Discard / undo / amend ----

// Throw away changes to specific files. Tracked files are restored from HEAD
// (both index and working tree); untracked ones are deleted. Destructive —
// the UI must confirm first.
export async function discardFiles(root: string, files: string[]): Promise<RepoState> {
  if (files.length === 0) return getState(root);
  const state = await getState(root);
  const untracked = new Set(state.untracked.map((f) => f.path));
  const tracked = files.filter((f) => !untracked.has(f));
  const toDelete = files.filter((f) => untracked.has(f));
  if (tracked.length) await runGit(root, ["restore", "--staged", "--worktree", "--", ...tracked]);
  if (toDelete.length) await runGit(root, ["clean", "-f", "--", ...toDelete]);
  return getState(root);
}

// Undo the last commit but keep its changes staged (soft reset). Refused when
// the commit is already on the upstream — rewriting published history bites.
export async function undoLastCommit(root: string): Promise<RepoState> {
  const state = await getState(root);
  if (!state.headCommit) {
    throw Object.assign(new Error("There is no commit to undo."), { name: "UndoError" });
  }
  if (state.upstream && state.ahead === 0) {
    throw Object.assign(
      new Error("The last commit is already pushed to the upstream. Undoing it would rewrite shared history — create a new commit instead."),
      { name: "UndoError" }
    );
  }
  await runGit(root, ["reset", "--soft", "HEAD~1"]);
  return getState(root);
}

// Replace the last commit with the staged changes + a new message.
// Same guard as undo: never rewrite a pushed commit.
export async function amendCommit(root: string, message: string): Promise<CommitResult> {
  const state = await getState(root);
  if (!state.headCommit) {
    throw Object.assign(new Error("There is no commit to amend."), { name: "AmendError" });
  }
  if (state.upstream && state.ahead === 0) {
    throw Object.assign(
      new Error("The last commit is already pushed to the upstream. Amending it would rewrite shared history."),
      { name: "AmendError" }
    );
  }
  await runGit(root, ["commit", "--amend", "-m", message]);
  const id = (await runGit(root, ["rev-parse", "--short", "HEAD"])).trim();
  const subject = (await runGit(root, ["log", "-1", "--pretty=%s"])).trim();
  return { id, subject };
}

// ---- Remotes ----

export interface Remote {
  name: string;
  url: string;
  isAzure: boolean;
}

export async function getRemotes(root: string): Promise<Remote[]> {
  const raw = await runGit(root, ["remote", "-v"]);
  const seen = new Map<string, Remote>();
  for (const line of raw.split("\n").filter(Boolean)) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
    if (!m) continue;
    if (!seen.has(m[1])) {
      seen.set(m[1], { name: m[1], url: m[2], isAzure: /dev\.azure\.com|visualstudio\.com/i.test(m[2]) });
    }
  }
  return [...seen.values()];
}

// ---- Branch operations ----

export interface BranchActionResult {
  ok: boolean;
  conflicts: boolean;
  state: RepoState;
}

export async function checkoutBranch(root: string, name: string): Promise<RepoState> {
  await runGit(root, ["checkout", name]);
  return getState(root);
}

export async function createBranch(root: string, name: string, from?: string): Promise<RepoState> {
  const args = ["checkout", "-b", name];
  if (from) args.push(from);
  await runGit(root, args);
  return getState(root);
}

// Merge `name` into the current branch. Conflicts are reported, not thrown.
export async function mergeBranch(root: string, name: string): Promise<BranchActionResult> {
  try {
    await runGit(root, ["merge", "--no-edit", name]);
  } catch (e) {
    const state = await getState(root);
    if (state.conflicted.length > 0 || state.merging) return { ok: false, conflicts: true, state };
    throw e;
  }
  const state = await getState(root);
  return { ok: true, conflicts: false, state };
}

export async function deleteBranch(root: string, name: string, force: boolean): Promise<void> {
  await runGit(root, ["branch", force ? "-D" : "-d", name]);
}

// ---- Network operations (auth prefix supplied by the caller) ----

export async function fetchRemote(root: string, auth: string[]): Promise<RepoState> {
  await runGit(root, [...auth, "fetch", "--all", "--prune"], { timeout: NETWORK_TIMEOUT });
  return getState(root);
}

export async function pull(root: string, auth: string[]): Promise<BranchActionResult> {
  try {
    await runGit(root, [...auth, "pull", "--no-edit"], { timeout: NETWORK_TIMEOUT });
  } catch (e) {
    const state = await getState(root);
    if (state.conflicted.length > 0 || state.merging) return { ok: false, conflicts: true, state };
    throw e;
  }
  const state = await getState(root);
  return { ok: true, conflicts: false, state };
}

export async function push(root: string, auth: string[]): Promise<RepoState> {
  const state = await getState(root);
  if (state.detached || !state.branch) {
    throw Object.assign(new Error("You're not on a branch, so there's nothing to push."), { name: "PushError" });
  }
  if (state.upstream) {
    await runGit(root, [...auth, "push"], { timeout: NETWORK_TIMEOUT });
  } else {
    // First push of a new branch — set the upstream to origin.
    await runGit(root, [...auth, "push", "-u", "origin", state.branch], { timeout: NETWORK_TIMEOUT });
  }
  return getState(root);
}

// ---- Per-branch commits ----

async function defaultBaseRef(root: string): Promise<string | null> {
  try {
    return (await runGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
  } catch {
    /* no origin/HEAD */
  }
  for (const b of ["origin/main", "origin/master", "main", "master"]) {
    try {
      await runGit(root, ["rev-parse", "--verify", b]);
      return b;
    } catch {
      /* keep trying */
    }
  }
  return null;
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

// ---- Compare branches ----

export interface CompareFile {
  path: string;
  added: number;
  removed: number;
  change: FileChange;
}

export interface CompareResult {
  base: string;
  compare: string;
  ahead: number; // commits on `compare` not on `base`
  behind: number; // commits on `base` not on `compare`
  mergeBase: string | null;
  commits: CommitSummary[]; // the commits `compare` adds (base..compare)
  files: CompareFile[]; // net file changes introduced by `compare` (base...compare)
}

function changeFromStatus(code: string): FileChange {
  switch (code[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "added";
    case "T":
      return "typechange";
    default:
      return "modified";
  }
}

// Net file changes for a diff range (e.g. "base...compare"), merging
// --name-status (change kind) with --numstat (line counts).
async function diffFilesForRange(root: string, range: string): Promise<CompareFile[]> {
  const [statusRaw, numstatRaw] = await Promise.all([
    runGit(root, ["diff", "--name-status", range]),
    runGit(root, ["diff", "--numstat", range]),
  ]);

  const counts = new Map<string, { added: number; removed: number }>();
  for (const line of numstatRaw.split("\n").filter(Boolean)) {
    const [a, r, ...rest] = line.split("\t");
    const p = rest[rest.length - 1]; // for renames numstat lists "old => new" forms; last col is the path
    counts.set(p, { added: a === "-" ? 0 : Number(a) || 0, removed: r === "-" ? 0 : Number(r) || 0 });
  }

  const files: CompareFile[] = [];
  for (const line of statusRaw.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const code = parts[0];
    const p = parts[parts.length - 1];
    const c = counts.get(p) || { added: 0, removed: 0 };
    files.push({ path: p, added: c.added, removed: c.removed, change: changeFromStatus(code) });
  }
  return files;
}

export async function compareBranches(root: string, base: string, compare: string): Promise<CompareResult> {
  // Validate both refs up front for a friendly error.
  for (const ref of [base, compare]) {
    try {
      await runGit(root, ["rev-parse", "--verify", "--quiet", ref + "^{commit}"]);
    } catch {
      const { GitError } = await import("./git");
      throw new GitError(`Unknown branch or ref: ${ref}`, null, "");
    }
  }

  const countsRaw = await runGit(root, ["rev-list", "--left-right", "--count", `${base}...${compare}`]);
  const [behindStr, aheadStr] = countsRaw.trim().split(/\s+/);
  const behind = Number(behindStr) || 0;
  const ahead = Number(aheadStr) || 0;

  let mergeBase: string | null = null;
  try {
    mergeBase = (await runGit(root, ["merge-base", base, compare])).trim().slice(0, 8) || null;
  } catch {
    /* unrelated histories */
  }

  const fmt = ["%h", "%s", "%an", "%aI"].join(UNIT);
  const rawCommits = await runGit(root, ["log", `--pretty=format:${fmt}`, "-n", "200", `${base}..${compare}`]);
  const commits: CommitSummary[] = rawCommits
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, subject, author, date] = line.split(UNIT);
      return { id, subject: subject || "", author: author || "", date: date || null };
    });

  const files = await diffFilesForRange(root, `${base}...${compare}`);

  return { base, compare, ahead, behind, mergeBase, commits, files };
}

// Unified diff for one file between two branches (three-dot, like a PR view).
export async function compareFileDiff(root: string, base: string, compare: string, file: string): Promise<string> {
  return runGit(root, ["diff", "--no-color", `${base}...${compare}`, "--", file]);
}

// Commits that are on `branch` but not on the repo's base branch — i.e. the
// work this branch introduces. Falls back to the branch's own recent history
// when it *is* the base.
export async function branchCommits(root: string, branch: string): Promise<BranchCommits> {
  const base = await defaultBaseRef(root);
  const sameAsBase = base !== null && (base === branch || base.endsWith("/" + branch));
  const range = base && !sameAsBase ? `${base}..${branch}` : branch;

  const fmt = ["%h", "%s", "%an", "%aI"].join(UNIT);
  const raw = await runGit(root, ["log", `--pretty=format:${fmt}`, "-n", "100", range]);
  const commits = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, subject, author, date] = line.split(UNIT);
      return { id, subject: subject || "", author: author || "", date: date || null };
    });
  return { branch, base: sameAsBase ? null : base, commits };
}
