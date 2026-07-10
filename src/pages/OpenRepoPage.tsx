import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { timeAgo } from "../lib/git";
import { Card, Mono } from "../components/ui";
import { OpenRepoForm } from "../components/OpenRepoForm";

// GitHub Desktop-style welcome: your known repositories on the left, open a new
// folder on the right. Cloned repos live here permanently (no re-cloning).
export function OpenRepoPage() {
  const { repos, selectRepo, removeRepo } = useLocalRepo();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function onSelect(root: string) {
    setBusy(true);
    try {
      await selectRepo(root);
      navigate("/local", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Local repositories</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">Your repositories</h1>
        <p className="mt-2 text-sm text-muted">
          Pick one you've already cloned or opened, or open a new folder. Clone a repo from Azure via the{" "}
          <b>Repositories</b> page.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-2">
          {repos.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted">
              No repositories yet. Open a folder, or clone one from Azure DevOps.
            </Card>
          )}
          {repos.map((r) => (
            <Card key={r.root} className="flex items-center justify-between gap-3 p-4">
              <button onClick={() => onSelect(r.root)} disabled={busy} className="min-w-0 text-left">
                <p className="flex flex-wrap items-center gap-1.5 font-display text-sm font-semibold text-ink hover:text-accent">
                  <span className="truncate">{r.name}</span>
                  {r.branch && (
                    <span className="rounded bg-line px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted">{r.branch}</span>
                  )}
                  {r.detached && (
                    <span
                      className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-danger"
                      title="Not on any branch — open this repo and visit Recovery & sync"
                    >
                      detached
                    </span>
                  )}
                  {!!r.stashCount && (
                    <span
                      className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-ink"
                      title="Stashed changes waiting — restore them from Status or Recovery & sync"
                    >
                      {r.stashCount} stashed change set{r.stashCount === 1 ? "" : "s"} waiting
                    </span>
                  )}
                  {r.dirty && (
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">uncommitted changes</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted" title={r.root}>
                  <Mono>{r.root}</Mono> · added {timeAgo(r.addedAt)}
                </p>
              </button>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onSelect(r.root)}
                  disabled={busy}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  Open
                </button>
                <button
                  onClick={async () => {
                    try {
                      await api.local.openInEditor(r.root);
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "Couldn't open VS Code.");
                    }
                  }}
                  disabled={busy}
                  title="Open this repo in VS Code"
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
                >
                  VS Code
                </button>
                <button
                  onClick={() => removeRepo(r.root)}
                  disabled={busy}
                  title="Remove from list (keeps files)"
                  className="rounded-lg border border-line px-2 py-1.5 text-sm font-medium text-muted hover:bg-paper hover:text-danger"
                >
                  ✕
                </button>
              </div>
            </Card>
          ))}
        </div>

        <Card className="h-fit p-5">
          <h2 className="font-display text-sm font-semibold text-ink">Open a folder</h2>
          <p className="mt-1 text-xs text-muted">Browse to any Git repository on this machine.</p>
          <OpenRepoForm compact />
        </Card>
      </div>
    </div>
  );
}
