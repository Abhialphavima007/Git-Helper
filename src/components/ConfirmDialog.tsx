import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

// "Are you sure?" modal that explains, in plain language, what an action will
// do and what it affects BEFORE anything happens. Nothing runs until Yes.
// Portaled to <body> so it can't be trapped by transformed ancestors.
export function ConfirmDialog({
  title,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-2xl"
      >
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted">Are you sure?</p>
        <h2 className="mt-1 font-display text-lg font-semibold text-ink">{title}</h2>
        <div className="mt-3 space-y-2.5 text-sm">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              danger ? "bg-danger hover:opacity-90" : "bg-accent hover:bg-accent-hover"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// One labelled row inside the dialog body: "What will happen:", "What it affects:", …
export function ConfirmRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 font-medium text-muted">{label}</span>
      <span className="text-ink">{children}</span>
    </div>
  );
}
