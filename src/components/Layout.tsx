import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useConnection } from "../context/ConnectionContext";
import { useLocalRepo } from "../context/LocalRepoContext";
import { TopProgressBar } from "./TopProgressBar";
import { RepoSwitcher } from "./RepoSwitcher";

const localNav = [
  { to: "/local", label: "Status", end: true },
  { to: "/local/changes", label: "Changes", end: false },
  { to: "/local/commit", label: "Commit", end: false },
  { to: "/local/branches", label: "Branches", end: false },
  { to: "/local/compare", label: "Compare & merge", end: false },
  { to: "/local/graph", label: "History", end: false },
  { to: "/local/conflicts", label: "Resolve conflicts", end: false },
];

const azureNav = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/repos", label: "Repositories", end: false },
  { to: "/branches", label: "Branches", end: false },
  { to: "/pulls", label: "Pull requests", end: false },
];

function navClass({ isActive }: { isActive: boolean }) {
  return `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-accent/10 text-accent" : "text-muted hover:bg-paper hover:text-ink"
  }`;
}

export function Layout({ children }: { children: ReactNode }) {
  const { org, project, me, repos, selectedRepoId, selectRepo, disconnect, connected } = useConnection();
  const { open: localOpen, close: closeLocal } = useLocalRepo();
  const navigate = useNavigate();

  async function onDisconnect() {
    await disconnect();
    navigate("/", { replace: true });
  }

  async function onCloseLocal() {
    await closeLocal();
    navigate(connected ? "/" : "/local/open", { replace: true });
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="border-b border-line bg-card lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col px-4 py-5">
          <div className="px-2">
            <span className="font-display text-base font-bold text-ink">Git Helper</span>
          </div>

          {/* Local-git section */}
          {localOpen && (
            <div className="mt-5">
              <div className="px-2">
                <RepoSwitcher />
              </div>
              <nav className="mt-3 space-y-1">
                {localNav.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          )}

          {/* Azure DevOps section */}
          {connected && (
            <div className="mt-6">
              <div className="px-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Azure DevOps</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted">
                  {org} / {project}
                </p>
              </div>
              <div className="mt-2 px-2">
                <select
                  className="w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-sm text-ink focus-visible:border-accent"
                  value={selectedRepoId ?? ""}
                  onChange={(e) => selectRepo(e.target.value)}
                >
                  {repos.length === 0 && <option value="">No repositories</option>}
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <nav className="mt-2 space-y-1">
                {azureNav.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          )}

          {/* Footer: add the other mode / sign out */}
          <div className="mt-auto space-y-2 border-t border-line pt-4">
            {!localOpen && (
              <NavLink to="/local/open" className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink">
                + Open a local repo
              </NavLink>
            )}
            {!connected && (
              <NavLink to="/connect" className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink">
                + Connect Azure DevOps
              </NavLink>
            )}

            {connected && (
              <div className="px-2 pt-1">
                <p className="text-xs text-muted">Signed in as</p>
                <p className="text-sm font-medium text-ink">{me?.name ?? "Unknown user"}</p>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {localOpen && (
                <button
                  onClick={onCloseLocal}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-paper hover:text-danger"
                >
                  Close local repo
                </button>
              )}
              {connected && (
                <button
                  onClick={onDisconnect}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-paper hover:text-danger"
                >
                  Disconnect Azure
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <TopProgressBar />
        <main className="px-6 py-8 lg:px-10">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
