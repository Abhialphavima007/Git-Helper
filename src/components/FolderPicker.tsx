import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, type FsListing } from "../api/client";
import { Spinner } from "./ui";

// A server-driven "choose folder" browser — the local-tool stand-in for a
// native folder dialog. Navigate into folders, jump to drives, go up, then
// select the folder you're in.
export function FolderPicker({
  title,
  initialPath,
  pickLabel = "Select this folder",
  onPick,
  onClose,
}: {
  title: string;
  initialPath?: string;
  pickLabel?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(path?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fs.browse(path);
      setListing(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that folder.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Portal to <body>: ancestors with CSS transforms (the animated sidebar)
  // would otherwise trap this fixed-position overlay inside themselves.
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-card shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
          <p className="mt-1 truncate font-mono text-xs text-muted" title={listing?.path}>
            {listing?.path ?? "…"}
          </p>
        </div>

        {/* Drives (Windows) + Up */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-2">
          <button
            disabled={!listing?.parent}
            onClick={() => listing?.parent && load(listing.parent)}
            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-40"
          >
            ↑ Up
          </button>
          {listing?.home && (
            <button
              onClick={() => load(listing.home)}
              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-paper"
            >
              Home
            </button>
          )}
          {listing?.drives?.map((d) => (
            <button
              key={d}
              onClick={() => load(d)}
              className="rounded-md border border-line px-2 py-1 font-mono text-xs font-medium text-ink hover:bg-paper"
            >
              {d}
            </button>
          ))}
        </div>

        {/* Folder list */}
        <div className="min-h-[12rem] flex-1 overflow-auto px-2 py-2">
          {loading && <div className="p-3"><Spinner label="Reading folder…" /></div>}
          {error && <p className="p-3 text-sm text-danger">{error}</p>}
          {!loading && listing && listing.entries.length === 0 && !error && (
            <p className="p-3 text-sm text-muted">No sub-folders here. You can still select this folder.</p>
          )}
          {!loading &&
            listing?.entries.map((e) => (
              <button
                key={e.path}
                onClick={() => load(e.path)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-ink hover:bg-paper"
              >
                <span aria-hidden>📁</span>
                <span className="truncate">{e.name}</span>
              </button>
            ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
          >
            Cancel
          </button>
          <button
            disabled={!listing}
            onClick={() => listing && onPick(listing.path)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {pickLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
