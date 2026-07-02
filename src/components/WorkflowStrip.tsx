import { Link } from "react-router-dom";
import type { RepoState } from "../api/client";

// The GitHub-Desktop-style "where am I in the cycle?" strip:
//   1 Change  →  2 Commit  →  3 Push
// Each step shows a live count and lights up when it's the next thing to do,
// so a developer always knows where to go after opening a repo.
export function WorkflowStrip({ state }: { state: RepoState }) {
  const dirty = state.unstaged.length + state.untracked.length + state.conflicted.length;
  const staged = state.staged.length;
  const toPush = state.ahead;

  // Determine the active step: first one with work outstanding.
  const active: 1 | 2 | 3 | 0 = state.conflicted.length > 0 ? 1 : dirty > 0 ? 1 : staged > 0 ? 2 : toPush > 0 || !state.upstream ? 3 : 0;

  const steps = [
    {
      n: 1,
      title: "Change",
      to: "/local/changes",
      count: dirty,
      hint: dirty > 0 ? `${dirty} file${dirty === 1 ? "" : "s"} changed` : "edit files in your editor",
    },
    {
      n: 2,
      title: "Commit",
      to: "/local/commit",
      count: staged,
      hint: staged > 0 ? `${staged} staged, ready to commit` : "stage & write a message",
    },
    {
      n: 3,
      title: "Push",
      to: "/local",
      count: toPush,
      hint: toPush > 0 ? `${toPush} commit${toPush === 1 ? "" : "s"} to push` : state.upstream ? "in sync" : "publish this branch",
    },
  ] as const;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-2 sm:flex-row sm:items-stretch">
      {steps.map((s, i) => {
        const isActive = active === s.n;
        const isDone = active !== 0 && s.n < active;
        return (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <Link
              to={s.to}
              className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                isActive ? "bg-accent/10" : "hover:bg-paper"
              }`}
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  isActive
                    ? "bg-accent text-white"
                    : isDone
                    ? "bg-ok text-white"
                    : "bg-line text-muted"
                }`}
                aria-hidden
              >
                {isDone ? "✓" : s.n}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${isActive ? "text-accent" : "text-ink"}`}>
                  {s.title}
                  {s.count > 0 && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isActive ? "bg-accent text-white" : "bg-line text-muted"}`}>
                      {s.count}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted">{s.hint}</span>
              </span>
            </Link>
            {i < steps.length - 1 && <span className="hidden shrink-0 text-line sm:block">→</span>}
          </div>
        );
      })}
    </div>
  );
}
