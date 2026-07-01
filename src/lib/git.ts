// Turns raw Git / Azure DevOps state into plain-language, traffic-light guidance.
// This is the core of the product: every screen answers
// "Where am I? / What's the state? / What can I safely do next?"

import type { BranchInfo, FileChange, PullRequestInfo, RepoState, ReviewerInfo } from "../api/client";

export type Light = "ok" | "warn" | "danger" | "neutral";

export interface Verdict {
  light: Light;
  headline: string;
  detail: string;
}

function commits(n: number): string {
  return `${n} commit${n === 1 ? "" : "s"}`;
}

// How a branch stands relative to the default branch.
export function branchVerdict(b: BranchInfo, defaultBranch: string): Verdict {
  if (b.isDefault) {
    return {
      light: "neutral",
      headline: "This is the default branch",
      detail: `Other branches are compared against ${defaultBranch}.`,
    };
  }
  const { aheadCount: ahead, behindCount: behind } = b;

  if (ahead === 0 && behind === 0) {
    return {
      light: "ok",
      headline: `Up to date with ${defaultBranch}`,
      detail: "Nothing to pull and nothing new to share.",
    };
  }
  if (ahead > 0 && behind === 0) {
    return {
      light: "ok",
      headline: `${commits(ahead)} ahead of ${defaultBranch}`,
      detail: `You have work that isn't in ${defaultBranch} yet, and nothing to pull. Ready to open a pull request.`,
    };
  }
  if (ahead === 0 && behind > 0) {
    return {
      light: "warn",
      headline: `${commits(behind)} behind ${defaultBranch}`,
      detail: `${defaultBranch} has moved on. Update this branch to catch up — this won't lose any work.`,
    };
  }
  return {
    light: "warn",
    headline: `${commits(ahead)} ahead, ${commits(behind)} behind ${defaultBranch}`,
    detail: `Both branches changed since they split. Update this branch with ${defaultBranch} before merging to avoid surprises.`,
  };
}

// Whether a pull request can merge right now, based on its merge status.
export function mergeVerdict(mergeStatus: string): Verdict {
  switch (mergeStatus) {
    case "succeeded":
      return {
        light: "ok",
        headline: "Can merge automatically",
        detail: "No conflicts. If policies and approvals are met, this is ready to complete.",
      };
    case "conflicts":
      return {
        light: "danger",
        headline: "Has conflicts",
        detail: "The same lines changed on both sides. Conflicts must be resolved before this can merge.",
      };
    case "rejectedByPolicy":
      return {
        light: "danger",
        headline: "Blocked by a branch policy",
        detail: "A required check, reviewer, or rule isn't satisfied yet.",
      };
    case "failure":
      return {
        light: "danger",
        headline: "Merge check failed",
        detail: "Azure DevOps couldn't compute the merge. Try refreshing, or re-run the build.",
      };
    case "queued":
    case "notSet":
    default:
      return {
        light: "warn",
        headline: "Still checking if this can merge",
        detail: "Azure DevOps is comparing the branches. Give it a moment and refresh.",
      };
  }
}

// Overall lifecycle state of a pull request.
export function prStatusVerdict(pr: PullRequestInfo): Verdict {
  if (pr.status === "completed") {
    return { light: "ok", headline: "Completed", detail: "This pull request was merged." };
  }
  if (pr.status === "abandoned") {
    return { light: "neutral", headline: "Abandoned", detail: "This pull request was closed without merging." };
  }
  if (pr.isDraft) {
    return { light: "neutral", headline: "Draft", detail: "Marked as a work in progress. Reviewers aren't notified yet." };
  }
  return mergeVerdict(pr.mergeStatus);
}

// A single reviewer's vote in plain words.
export function voteVerdict(vote: number): { light: Light; text: string } {
  switch (vote) {
    case 10:
      return { light: "ok", text: "Approved" };
    case 5:
      return { light: "ok", text: "Approved with suggestions" };
    case -5:
      return { light: "warn", text: "Waiting for the author" };
    case -10:
      return { light: "danger", text: "Rejected" };
    case 0:
    default:
      return { light: "neutral", text: "No vote yet" };
  }
}

// Short summary of reviewer progress for a PR list row.
export function reviewSummary(reviewers: ReviewerInfo[]): string {
  if (reviewers.length === 0) return "No reviewers";
  const approved = reviewers.filter((r) => r.vote >= 5).length;
  const rejected = reviewers.filter((r) => r.vote === -10).length;
  const waiting = reviewers.filter((r) => r.vote === -5).length;
  const parts: string[] = [`${approved}/${reviewers.length} approved`];
  if (rejected) parts.push(`${rejected} rejected`);
  if (waiting) parts.push(`${waiting} waiting on author`);
  return parts.join(" · ");
}

// ---- Local-git, plain language ----

// The one banner that tells a developer where their working tree stands and
// what is safe to do next. Ordered by urgency: conflicts first, then merges,
// divergence, uncommitted work, and finally the all-clear.
export function localStateVerdict(s: RepoState): Verdict {
  const dirty = s.staged.length + s.unstaged.length + s.untracked.length;

  if (s.conflicted.length > 0) {
    return {
      light: "danger",
      headline: `${s.conflicted.length} file${s.conflicted.length === 1 ? "" : "s"} in conflict`,
      detail:
        "The same lines changed on both sides. Resolve each file — keep one side, the other, or combine them — then commit to finish the merge.",
    };
  }
  if (s.merging) {
    return {
      light: "warn",
      headline: "A merge is in progress",
      detail: "Conflicts are resolved, but the merge isn't committed yet. Commit to finish it.",
    };
  }
  if (s.detached) {
    return {
      light: "warn",
      headline: "Detached HEAD — not on a branch",
      detail: "You're sitting on a specific commit, not a branch. New commits here are easy to lose. Create or switch to a branch before working.",
    };
  }

  const onBranch = s.branch ? `on ${s.branch}` : "here";
  const ahead = s.ahead;
  const behind = s.behind;

  if (dirty > 0) {
    const parts: string[] = [];
    if (s.staged.length) parts.push(`${s.staged.length} staged`);
    if (s.unstaged.length) parts.push(`${s.unstaged.length} changed`);
    if (s.untracked.length) parts.push(`${s.untracked.length} new`);
    return {
      light: "neutral",
      headline: `You have uncommitted changes ${onBranch}`,
      detail: `${parts.join(", ")}. Stage what belongs together and commit it with a clear message.`,
    };
  }

  if (ahead > 0 && behind > 0) {
    return {
      light: "warn",
      headline: `${commits(ahead)} to push, ${commits(behind)} to pull`,
      detail: "Your branch and its upstream both moved. Pull to catch up — that may need a merge — before pushing.",
    };
  }
  if (behind > 0) {
    return {
      light: "warn",
      headline: `${commits(behind)} behind the upstream`,
      detail: "The remote has moved on. Pull to catch up. Your tree is clean, so this is safe.",
    };
  }
  if (ahead > 0) {
    return {
      light: "ok",
      headline: `${commits(ahead)} ready to push`,
      detail: "Your work is committed and the tree is clean. Push to share it.",
    };
  }
  return {
    light: "ok",
    headline: s.upstream ? "Clean and up to date" : "Clean working tree",
    detail: s.upstream
      ? "Nothing to commit, nothing to pull or push. A good place to start new work."
      : "Nothing to commit. This branch has no upstream set yet.",
  };
}

// Short human label + traffic light for a file's change type.
export function changeLabel(change: FileChange): { text: string; light: Light } {
  switch (change) {
    case "added":
      return { text: "added", light: "ok" };
    case "deleted":
      return { text: "deleted", light: "danger" };
    case "renamed":
      return { text: "renamed", light: "neutral" };
    case "untracked":
      return { text: "new", light: "neutral" };
    case "typechange":
      return { text: "type changed", light: "warn" };
    case "modified":
    default:
      return { text: "modified", light: "warn" };
  }
}

// Friendly relative time, e.g. "3 days ago".
export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  const units: Array<[number, string]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = seconds;
  let unit = "second";
  for (const [size, name] of units) {
    if (Math.abs(value) < size) {
      unit = name;
      break;
    }
    value = value / size;
    unit = name;
  }
  const rounded = Math.floor(Math.abs(value));
  if (unit === "second" && rounded < 30) return "just now";
  return `${rounded} ${unit}${rounded === 1 ? "" : "s"} ago`;
}
