import { useEffect, useState } from "react";
import { api, type RepoInfo } from "../api/client";
import { useOperation } from "../context/OperationContext";
import { ErrorNote, Mono } from "./ui";
import { FolderPicker } from "./FolderPicker";

// Asks where to put the clone, then hands off to the global operation tracker
// (which shows the top progress bar and opens the repo when it finishes).
export function CloneModal({ repo, onClose }: { repo: RepoInfo; onClose: () => void }) {
  const { cloneRepo } = useOperation();
  const [parentDir, setParentDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.clone
      .defaults()
      .then((d) => {
        if (!cancelled) setParentDir(d.baseDir);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sep = parentDir.includes("\\") ? "\\" : "/";
  const dest = parentDir ? `${parentDir.replace(/[\\/]$/, "")}${sep}${repo.name}` : "";

  async function onClone() {
    await cloneRepo(repo.name, parentDir.trim());
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-semibold text-ink">Clone “{repo.name}”</h2>
        <p className="mt-1 text-sm text-muted">
          Choose a folder on this machine. The repo is cloned into a subfolder named after it, then opened here
          automatically.
        </p>

        {error != null && (
          <div className="mt-4">
            <ErrorNote error={error} />
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-ink">Destination folder</label>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
            <Mono>{parentDir || (loading ? "Loading…" : "No folder chosen")}</Mono>
            <button
              onClick={() => setPicking(true)}
              className="ml-auto shrink-0 text-xs font-medium text-accent hover:text-accent-hover"
            >
              {parentDir ? "Change" : "Choose…"}
            </button>
          </div>
          {dest && (
            <p className="mt-1.5 text-xs text-muted">
              Will clone into <Mono>{dest}</Mono>
            </p>
          )}
        </div>

        {picking && (
          <FolderPicker
            title="Choose where to clone"
            initialPath={parentDir || undefined}
            pickLabel="Clone here"
            onPick={(p) => {
              setParentDir(p);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
          >
            Cancel
          </button>
          <button
            onClick={onClone}
            disabled={!parentDir.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Clone
          </button>
        </div>
      </div>
    </div>
  );
}
