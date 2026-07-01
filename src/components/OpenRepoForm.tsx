import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLocalRepo } from "../context/LocalRepoContext";
import { ErrorNote, Mono } from "./ui";
import { FolderPicker } from "./FolderPicker";

// Point the app at a local Git work tree by browsing to it — no typing paths.
export function OpenRepoForm({ compact = false }: { compact?: boolean }) {
  const { openRepo } = useLocalRepo();
  const navigate = useNavigate();
  const [path, setPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onOpen() {
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      await openRepo(path);
      navigate("/local", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "space-y-3" : "mt-5 space-y-4"}>
      <div>
        <label className="mb-1 block text-sm font-medium text-ink">Repository folder</label>
        {path ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
            <Mono>{path}</Mono>
            <button onClick={() => setPicking(true)} className="ml-auto shrink-0 text-xs font-medium text-accent hover:text-accent-hover">
              Change
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPicking(true)}
            className="w-full rounded-lg border border-dashed border-line px-3 py-3 text-sm font-medium text-muted hover:border-accent hover:text-ink"
          >
            📁 Choose a folder…
          </button>
        )}
        <p className="mt-1 text-xs text-muted">Pick a folder on this machine that contains a Git repository.</p>
      </div>

      {error != null && <ErrorNote error={error} />}

      <button
        onClick={onOpen}
        disabled={busy || !path}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {busy ? "Opening…" : "Open repository"}
      </button>

      {picking && (
        <FolderPicker
          title="Choose a Git repository folder"
          initialPath={path ?? undefined}
          pickLabel="Open this folder"
          onPick={(p) => {
            setPath(p);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
