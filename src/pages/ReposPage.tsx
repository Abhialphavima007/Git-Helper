import { useState } from "react";
import { Link } from "react-router-dom";
import { type RepoInfo } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { Card, Mono } from "../components/ui";
import { CloneModal } from "../components/CloneModal";

export function ReposPage() {
  const { repos, project, selectRepo } = useConnection();
  const [cloning, setCloning] = useState<RepoInfo | null>(null);

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Repositories</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-ink">{project}</h1>
        <p className="mt-1 text-sm text-muted">
          {repos.length} repositor{repos.length === 1 ? "y" : "ies"} the token can read. Clone one to work on it
          locally, or browse it remotely.
        </p>
      </header>

      <div className="space-y-2">
        {repos.map((r) => (
          <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-ink">{r.name}</p>
              <p className="mt-0.5 text-xs text-muted">
                default branch <Mono>{r.defaultBranch ?? "—"}</Mono>
                {r.webUrl && (
                  <>
                    {" · "}
                    <a href={r.webUrl} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-hover">
                      open in Azure DevOps ↗
                    </a>
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                to="/"
                onClick={() => selectRepo(r.id)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
              >
                Browse
              </Link>
              <button
                onClick={() => setCloning(r)}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Clone to local
              </button>
            </div>
          </Card>
        ))}
        {repos.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted">No repositories available for this token.</Card>
        )}
      </div>

      {cloning && <CloneModal repo={cloning} onClose={() => setCloning(null)} />}
    </div>
  );
}
