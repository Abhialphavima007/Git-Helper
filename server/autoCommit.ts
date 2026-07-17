// Background auto-commit scheduler. Ticks once a minute (local/desktop only —
// never on serverless hosts) and, for each repo with auto-commit enabled,
// commits outstanding changes on its schedule:
//   - "schedule": at a chosen local time of day — daily, every N days, or on
//     chosen weekdays.
//   - "interval": legacy fixed cadence (everyHours since last run).
//   - "onChange" (dynamic): whenever changes exist, at most every 5 minutes.
// Never touches a repo that is mid-merge, conflicted, or detached, and never
// pushes — sharing stays a deliberate user action.

import { listRepos, updateAutoCommit, type AutoCommitConfig } from "./repoStore";
import { getState, stageAll, commit } from "./localGit";

const TICK_MS = 60_000;
const ON_CHANGE_MIN_GAP_MS = 5 * 60_000;

let started = false;

function fmtNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Is a "schedule" config due right now? Due when: today is one of the chosen
// days (or the every-N-days spacing is satisfied), the chosen local time has
// passed, and we haven't already run in today's slot.
function scheduleDue(cfg: AutoCommitConfig, lastMs: number): boolean {
  const [h, m] = (cfg.atTime ?? "18:00").split(":").map(Number);
  const now = new Date();
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0).getTime();
  if (Date.now() < slot) return false; // today's time not reached yet
  if (lastMs >= slot) return false; // already ran today's slot
  if (cfg.days && cfg.days.length > 0) {
    if (!cfg.days.includes(now.getDay())) return false;
  } else if ((cfg.everyDays ?? 1) > 1 && lastMs > 0) {
    // every-N-days spacing, measured in whole calendar days since the last run
    const lastDay = new Date(lastMs);
    const lastMidnight = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate()).getTime();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (Math.round((todayMidnight - lastMidnight) / 86_400_000) < (cfg.everyDays ?? 1)) return false;
  }
  return true;
}

async function runForRepo(root: string, cfg: AutoCommitConfig): Promise<void> {
  const { mode, everyHours, lastRun } = cfg;
  const now = Date.now();
  const last = lastRun ? Date.parse(lastRun) : 0;
  const due =
    mode === "schedule"
      ? scheduleDue(cfg, last)
      : mode === "interval"
        ? now - last >= (everyHours || 24) * 3_600_000
        : now - last >= ON_CHANGE_MIN_GAP_MS;
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

  // Branch guard: the config can pin auto-commit to one branch. On any other
  // branch we skip — and consume the slot for scheduled modes so this doesn't
  // re-log every minute for the rest of the day.
  if (cfg.branch && state.branch !== cfg.branch) {
    // lastRun is set in every mode so this check doesn't rewrite the store
    // each minute (onChange re-tries after its normal 5-minute gap).
    await updateAutoCommit(root, {
      lastRun: new Date().toISOString(),
      lastResult: `Skipped (on ${state.branch ?? "?"} — auto-commit is set for ${cfg.branch}) — ${fmtNow()}`,
    });
    return;
  }

  const dirty = state.staged.length + state.unstaged.length + state.untracked.length;
  if (dirty === 0) {
    // Scheduled/interval modes: count this as a run so today's slot is done
    // and we don't re-check every minute.
    if (mode === "interval" || mode === "schedule") {
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
      await runForRepo(repo.root, cfg);
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
