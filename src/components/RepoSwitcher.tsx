import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { StoredRepo } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { FolderPicker } from "./FolderPicker";

// Group the known repos by the Azure DevOps project they were cloned from, so a
// long list reads "Prexa365 → Big-D, VPS, …" instead of one flat column.
function groupByProject(repos: StoredRepo[]): Array<{ label: string; repos: StoredRepo[] }> {
  // Azure org and project names are case-insensitive, and the clone URL
  // carries whatever casing was typed at sign-in — so compare lower-cased and
  // show the first spelling seen.
  const groups = new Map<string, { label: string; repos: StoredRepo[] }>();
  const other: StoredRepo[] = [];
  for (const r of repos) {
    if (!r.origin) {
      other.push(r);
      continue;
    }
    const key = `${r.origin.org} / ${r.origin.project}`.toLowerCase();
    const group = groups.get(key);
    if (group) group.repos.push(r);
    else groups.set(key, { label: `${r.origin.org} / ${r.origin.project}`, repos: [r] });
  }
  const byName = (a: StoredRepo, b: StoredRepo) => a.name.localeCompare(b.name);
  const out = [...groups.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((g) => ({ label: g.label, repos: g.repos.sort(byName) }));
  if (other.length) out.push({ label: groups.size ? "Other local repositories" : "Local repositories", repos: other.sort(byName) });
  return out;
}

// GitHub Desktop-style current-repository picker: switch between known repos or
// open another folder. The list is persisted, so cloned repos are always here.
export function RepoSwitcher() {
  const { repos, root, selectRepo, openRepo } = useLocalRepo();
  const groups = groupByProject(repos);
  const current = repos.find((r) => r.root === root);
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
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.repos.map((r) => (
              <option key={r.root} value={r.root}>
                {r.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {current?.origin && (
        <p className="mt-1 truncate text-[11px] text-muted" title={`${current.origin.org} / ${current.origin.project}`}>
          Cloned from <span className="font-medium text-ink">{current.origin.project}</span>
        </p>
      )}
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
