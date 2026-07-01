import type { GitBranchStat, PullRequest, CommentThread } from "./azdo";

// "refs/heads/feature/login" -> "feature/login"
export function shortRef(ref?: string): string {
  if (!ref) return "";
  return ref.replace(/^refs\/heads\//, "");
}

export function mapBranch(b: GitBranchStat) {
  return {
    name: b.name,
    aheadCount: b.aheadCount,
    behindCount: b.behindCount,
    isDefault: b.isBaseVersion,
    lastCommit: b.commit
      ? {
          id: b.commit.commitId.slice(0, 8),
          message: (b.commit.comment || "").split("\n")[0],
          author: b.commit.author?.name || b.commit.committer?.name || "Unknown",
          date: b.commit.author?.date || b.commit.committer?.date || null,
        }
      : null,
  };
}

export function mapPullRequest(pr: PullRequest) {
  return {
    id: pr.pullRequestId,
    title: pr.title,
    description: pr.description || "",
    status: pr.status,
    isDraft: !!pr.isDraft,
    mergeStatus: pr.mergeStatus || "notSet",
    sourceBranch: shortRef(pr.sourceRefName),
    targetBranch: shortRef(pr.targetRefName),
    createdBy: pr.createdBy
      ? { id: pr.createdBy.id, name: pr.createdBy.displayName || pr.createdBy.uniqueName || "Unknown" }
      : null,
    creationDate: pr.creationDate || null,
    reviewers: (pr.reviewers || []).map((r) => ({
      id: r.id,
      name: r.displayName || r.uniqueName || "Unknown",
      vote: r.vote,
      isRequired: !!r.isRequired,
    })),
  };
}

export function mapThreads(threads: CommentThread[]) {
  return threads
    .filter((t) => !t.isDeleted)
    .map((t) => ({
      id: t.id,
      status: t.status || null,
      filePath: t.threadContext?.filePath || null,
      comments: (t.comments || [])
        .filter((c) => !c.isDeleted && (c.commentType || "text") !== "system")
        .map((c) => ({
          id: c.id,
          author: c.author?.displayName || c.author?.uniqueName || "Unknown",
          content: c.content || "",
          publishedDate: c.publishedDate || null,
        })),
    }))
    // Drop threads that have no human-visible comments left (pure system threads).
    .filter((t) => t.comments.length > 0);
}
