import { useOperation } from "../context/OperationContext";

// A slim status bar pinned to the top of the app. Shows clone (and future
// long-running) progress with a phase label and percentage.
export function TopProgressBar() {
  const { op, dismiss } = useOperation();
  if (!op) return null;

  const isError = op.status === "error";
  const isDone = op.status === "done";
  const pct = op.percent < 0 ? null : Math.min(100, Math.max(0, op.percent));

  const barColor = isError ? "bg-danger" : isDone ? "bg-ok" : "bg-accent";

  return (
    <div className="sticky top-0 z-20 border-b border-line bg-card/95 backdrop-blur">
      <div className="h-1 w-full bg-line">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: pct === null ? "100%" : `${pct}%`, opacity: pct === null && !isError ? 0.5 : 1 }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`font-medium ${isError ? "text-danger" : isDone ? "text-ok" : "text-ink"}`}>
            {op.title}
          </span>
          <span className="truncate text-muted">
            {isError ? op.error : `${op.phase}${pct !== null ? ` · ${pct}%` : ""}${op.message ? ` — ${op.message}` : ""}`}
          </span>
        </div>
        {(isError || isDone) && (
          <button onClick={dismiss} className="shrink-0 font-medium text-muted hover:text-ink">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
