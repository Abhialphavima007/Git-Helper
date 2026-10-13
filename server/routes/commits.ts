import { Router } from "express";
import type { Connection, GitCommitRef } from "../azdo";
import { gitGet, AzdoError } from "../azdo";
import { asyncRoute, requireConnection } from "../session";
import { unifiedDiff } from "../textDiff";

// Azure DevOps commit details: what a commit changed, and a line diff per
// file. Azure's REST API lists the changed items but has no text diff, so we
// fetch the file at the commit and at its parent and diff them here.

const router = Router({ mergeParams: true });
router.use(requireConnection);

interface AzdoCommit extends GitCommitRef {
  parents?: string[];
  changeCounts?: { Add?: number; Edit?: number; Delete?: number };
}

interface AzdoChanges {
  changes?: Array<{
    item?: { path?: string; isFolder?: boolean; gitObjectType?: string };
    changeType?: string;
    sourceServerItem?: string;
  }>;
}

interface AzdoItem {
  path?: string;
  content?: string;
  isFolder?: boolean;
}

export type AzureChangeKind = "added" | "modified" | "deleted" | "renamed";

function kindOf(changeType: string | undefined): AzureChangeKind {
  const t = (changeType || "").toLowerCase();
  if (t.includes("delete")) return "deleted";
  if (t.includes("add")) return "added";
  if (t.includes("rename")) return "renamed";
  return "modified";
}

const MAX_CONTENT = 5 * 1024 * 1024;

// The file's text at a commit; null when it doesn't exist there, or isn't text.
async function fileAt(c: Connection, repoId: string, commitId: string, path: string): Promise<{ text: string | null; missing: boolean }> {
  try {
    const item = await gitGet<AzdoItem>(c, `/repositories/${encodeURIComponent(repoId)}/items`, {
      path,
      "versionDescriptor.version": commitId,
      "versionDescriptor.versionType": "commit",
      includeContent: true,
      "$format": "json",
    });
    if (typeof item.content !== "string") return { text: null, missing: false };
    if (item.content.length > MAX_CONTENT || item.content.includes("\u0000")) return { text: null, missing: false };
    return { text: item.content, missing: false };
  } catch (e) {
    if (e instanceof AzdoError && e.status === 404) return { text: null, missing: true };
    throw e;
  }
}

// GET /api/repos/:repoId/commit/:commitId  -> message, people, parents, files
router.get(
  "/:commitId",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId, commitId } = req.params;
    if (!/^[0-9a-f]{4,40}$/i.test(commitId)) {
      res.status(400).json({ error: "bad_id", message: "A commit id is required." });
      return;
    }
    const [commit, changes] = await Promise.all([
      gitGet<AzdoCommit>(c, `/repositories/${encodeURIComponent(repoId)}/commits/${commitId}`),
      gitGet<AzdoChanges>(c, `/repositories/${encodeURIComponent(repoId)}/commits/${commitId}/changes`, { top: 2000 }),
    ]);
    const message = commit.comment || "";
    const files = (changes.changes || [])
      .filter((ch) => ch.item?.path && !ch.item.isFolder && ch.item.gitObjectType !== "tree")
      .map((ch) => ({
        path: (ch.item!.path as string).replace(/^\//, ""),
        kind: kindOf(ch.changeType),
        from: ch.sourceServerItem ? ch.sourceServerItem.replace(/^\//, "") : null,
      }));
    res.json({
      id: commit.commitId.slice(0, 8),
      fullId: commit.commitId,
      subject: message.split("\n")[0],
      body: message.split("\n").slice(1).join("\n").trim(),
      author: commit.author?.name || "Unknown",
      authorEmail: commit.author?.email || null,
      date: commit.author?.date || commit.committer?.date || null,
      committer: commit.committer?.name || null,
      parents: (commit.parents || []).map((p) => p.slice(0, 8)),
      parentIds: commit.parents || [],
      counts: { added: commit.changeCounts?.Add ?? 0, modified: commit.changeCounts?.Edit ?? 0, deleted: commit.changeCounts?.Delete ?? 0 },
      files,
    });
  })
);

// GET /api/repos/:repoId/commit/:commitId/diff?path=...  -> unified diff vs first parent
router.get(
  "/:commitId/diff",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId, commitId } = req.params;
    const path = typeof req.query.path === "string" ? req.query.path : "";
    const from = typeof req.query.from === "string" && req.query.from ? req.query.from : path;
    if (!/^[0-9a-f]{4,40}$/i.test(commitId) || !path) {
      res.status(400).json({ error: "bad_request", message: "A commit id and a file path are required." });
      return;
    }
    const commit = await gitGet<AzdoCommit>(c, `/repositories/${encodeURIComponent(repoId)}/commits/${commitId}`);
    const parent = commit.parents?.[0] ?? null;
    const [cur, prev] = await Promise.all([
      fileAt(c, repoId, commitId, "/" + path),
      parent ? fileAt(c, repoId, parent, "/" + from) : Promise.resolve({ text: null, missing: true }),
    ]);
    const binary = (!cur.missing && cur.text === null) || (!prev.missing && prev.text === null);
    if (binary) {
      res.json({ path, diff: "", binary: true, status: cur.missing ? "deleted" : prev.missing ? "added" : "modified" });
      return;
    }
    const diff = unifiedDiff(prev.text ?? "", cur.text ?? "");
    res.json({
      path,
      diff: diff ?? "",
      binary: false,
      tooLarge: diff === null,
      status: cur.missing ? "deleted" : prev.missing ? "added" : "modified",
    });
  })
);

// GET /api/repos/:repoId/commit/:commitId/file?path=...  -> the whole file at that commit
router.get(
  "/:commitId/file",
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const { repoId, commitId } = req.params;
    const path = typeof req.query.path === "string" ? req.query.path : "";
    if (!/^[0-9a-f]{4,40}$/i.test(commitId) || !path) {
      res.status(400).json({ error: "bad_request", message: "A commit id and a file path are required." });
      return;
    }
    const cur = await fileAt(c, repoId, commitId, "/" + path);
    if (cur.missing) {
      res.status(404).json({ error: "not_found", message: "That file doesn't exist at this commit." });
      return;
    }
    res.json({ path, binary: cur.text === null, lines: cur.text === null ? [] : cur.text.split(/\r\n|\r|\n/) });
  })
);

export default router;
