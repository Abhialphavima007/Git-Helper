// Background auto-commit scheduler. Ticks once a minute (local/desktop only —
// never on serverless hosts) and, for each repo with auto-commit enabled,
// commits outstanding changes on its schedule:
//   - "interval": when everyHours have passed since the last run (24 = daily,
//     48 = alternate days) and there is something to commit.
//   - "onChange" (dynamic): whenever changes exist, at most every 5 minutes.
// Never touches a repo that is mid-merge, conflicted, or detached, and never
// pushes — sharing stays a deliberate user action.

import { listRepos, updateAutoCommit } from "./repoStore";
import { getState, stageAll, commit } from "./localGit";

const TICK_MS = 60_000;
const ON_CHANGE_MIN_GAP_MS = 5 * 60_000;

let started = false;

function fmtNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function runForRepo(root: string, mode: "interval" | "onChange", everyHours: number, lastRun?: string): Promise<void> {
  const now = Date.now();
  const last = lastRun ? Date.parse(lastRun) : 0;
  const due =
    mode === "interval" ? now - last >= everyHours * 3_600_000 : now - last >= ON_CHANGE_MIN_GAP_MS;
  if (!due) return;

  let state;
  try {
    state = await getState(root);
  } catch {
    return; // folder missing / not a repo right now — skip quietly
  }

  // Safety: never auto-commit into a merge, conflict, or detached HEAD.
  if (state.merging || state.conflicted.length > 0 || state.detached) {
    await updateAutoCommit(root, { lastResult: `Skipped (${state.merging ? "merge in progress" : state.conflicted.length ? "conflicts" : "detached HEAD"}) — ${fmtNow()}` });
    return;
  }

  const dirty = state.staged.length + state.unstaged.length + state.untracked.length;
  if (dirty === 0) {
    // Interval mode: count this as a run so we don't re-check every minute.
    if (mode === "interval") {
      await updateAutoCommit(root, { lastRun: new Date().toISOString(), lastResult: `Nothing to commit — ${fmtNow()}` });
    }
    return;
  }

  try {
    await stageAll(root);
    const result = await commit(root, `Auto-commit (Git Helper): ${dirty} file${dirty === 1 ? "" : "s"} — ${fmtNow()}`);
    await updateAutoCommit(root, {
      lastRun: new Date().toISOString(),
      lastResult: `Committed ${result.id} (${dirty} file${dirty === 1 ? "" : "s"}) — ${fmtNow()}`,
    });
  } catch (e) {
    await updateAutoCommit(root, {
      lastRun: new Date().toISOString(),
      lastResult: `Failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown error"} — ${fmtNow()}`,
    });
  }
}

// Exported for tests and a potential "run now" action.
export async function tick(): Promise<void> {
  try {
    const { repos } = await listRepos();
    for (const repo of repos) {
      const cfg = repo.autoCommit;
      if (!cfg?.enabled) continue;
      await runForRepo(repo.root, cfg.mode, cfg.everyHours || 24, cfg.lastRun);
    }
  } catch {
    /* never let the scheduler crash the server */
  }
}

export function startAutoCommitScheduler(): void {
  if (started) return; // guard against double-mounting (dev middleware + prod)
  started = true;
  const timer = setInterval(tick, TICK_MS);
  // Don't keep the process alive just for the scheduler.
  timer.unref?.();
  // First pass shortly after startup.
  setTimeout(tick, 5_000).unref?.();
}
