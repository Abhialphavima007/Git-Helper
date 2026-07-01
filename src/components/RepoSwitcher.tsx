import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLocalRepo } from "../context/LocalRepoContext";
import { FolderPicker } from "./FolderPicker";

// GitHub Desktop-style current-repository picker: switch between known repos or
// open another folder. The list is persisted, so cloned repos are always here.
export function RepoSwitcher() {
  const { repos, root, selectRepo, openRepo } = useLocalRepo();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSelect(nextRoot: string) {
    if (!nextRoot || nextRoot === root) return;
    setBusy(true);
    try {
      await selectRepo(nextRoot);
      navigate("/local");
    } finally {
      setBusy(false);
    }
  }

  async function onOpenFolder(path: string) {
    setPicking(false);
    setBusy(true);
    try {
      await openRepo(path);
      navigate("/local");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
        Current repository
      </label>
      <select
        value={root ?? ""}
        disabled={busy}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-sm font-medium text-ink focus-visible:border-accent"
      >
        {repos.length === 0 && <option value="">No repositories</option>}
        {repos.map((r) => (
          <option key={r.root} value={r.root}>
            {r.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => setPicking(true)}
        className="mt-1.5 text-xs font-medium text-accent hover:text-accent-hover"
      >
        + Open another folder…
      </button>

      {picking && (
        <FolderPicker
          title="Open a Git repository folder"
          pickLabel="Open this folder"
          onPick={onOpenFolder}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
