import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { useLocalRepo } from "../context/LocalRepoContext";
import { TopProgressBar } from "./TopProgressBar";
import { RepoSwitcher } from "./RepoSwitcher";

const azureNav = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/repos", label: "Repositories", end: false },
  { to: "/branches", label: "Branches", end: false },
  { to: "/compare", label: "Compare branches", end: false },
  { to: "/pulls", label: "Pull requests", end: false },
];

function navClass({ isActive }: { isActive: boolean }) {
  return `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-accent/10 text-accent" : "text-muted hover:bg-paper hover:text-ink"
  }`;
}

export function Layout({ children }: { children: ReactNode }) {
  const { org, project, me, repos, selectedRepoId, selectRepo, disconnect, connected } = useConnection();
  const { open: localOpen, localEnabled, close: closeLocal, root } = useLocalRepo();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Shares the Status page's cache — cheap, and lets the nav show live badges
  // (changed-file count) and only surface "Resolve conflicts" when relevant.
  const stateQuery = useQuery({
    queryKey: ["local-state", root],
    queryFn: () => api.local.getState(),
    enabled: localOpen && !!root,
    staleTime: 15_000,
  });
  const st = stateQuery.data;
  const dirtyCount = st ? st.unstaged.length + st.untracked.length + st.staged.length : 0;
  const hasConflicts = !!st && st.conflicted.length > 0;

  const localNav: Array<{ to: string; label: string; end: boolean; badge?: number; danger?: boolean }> = [
    { to: "/local", label: "Status", end: true },
    { to: "/local/changes", label: "Changes", end: false, badge: dirtyCount },
    { to: "/local/commit", label: "Commit", end: false },
    { to: "/local/branches", label: "Branches", end: false },
    { to: "/local/compare", label: "Compare & merge", end: false },
    { to: "/local/graph", label: "History", end: false },
    ...(hasConflicts
      ? [{ to: "/local/conflicts", label: "Resolve conflicts", end: false, badge: st!.conflicted.length, danger: true }]
      : []),
  ];

  const closeDrawer = () => setDrawerOpen(false);

  async function onDisconnect() {
    closeDrawer();
    await disconnect();
    navigate("/", { replace: true });
  }

  async function onCloseLocal() {
    closeDrawer();
    await closeLocal();
    navigate(connected ? "/" : "/local/open", { replace: true });
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-line bg-card px-4 py-3 lg:hidden">
        <span className="font-display text-base font-bold text-ink">Git Helper</span>
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="rounded-lg border border-line p-2 text-ink hover:bg-paper"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Backdrop for the mobile drawer */}
      {drawerOpen && <div className="fixed inset-0 z-30 bg-ink/40 lg:hidden" onClick={closeDrawer} aria-hidden />}

      {/* Sidebar: slide-in drawer on mobile, static column on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[272px] max-w-[85vw] transform border-r border-line bg-card transition-transform duration-200 lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:border-b-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex h-full flex-col overflow-y-auto px-4 py-5">
          <div className="flex items-center justify-between px-2">
            <span className="font-display text-base font-bold text-ink">Git Helper</span>
            <button
              onClick={closeDrawer}
              aria-label="Close menu"
              className="rounded-md p-1 text-muted hover:text-ink lg:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Local-git section */}
          {localOpen && (
            <div className="mt-5">
              <div className="px-2">
                <RepoSwitcher />
              </div>
              <nav className="mt-3 space-y-1">
                {localNav.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navClass} onClick={closeDrawer}>
                    <span className="flex items-center justify-between">
                      {item.label}
                      {item.badge !== undefined && item.badge > 0 && (
                        <span
                          className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                            item.danger ? "bg-danger text-white" : "bg-accent/15 text-accent"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </span>
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
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
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
                  <NavLink key={item.to} to={item.to} end={item.end} className={navClass} onClick={closeDrawer}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          )}

          {/* Footer: add the other mode / sign out */}
          <div className="mt-auto space-y-2 border-t border-line pt-4">
            {!localOpen && localEnabled && (
              <NavLink to="/local/open" onClick={closeDrawer} className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink">
                + Open a local repo
              </NavLink>
            )}
            {!connected && (
              <NavLink to="/connect" onClick={closeDrawer} className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink">
                + Connect Azure DevOps
              </NavLink>
            )}

            {connected && (
              <div className="px-2 pt-1">
                <p className="text-xs text-muted">Signed in as</p>
                <p className="truncate text-sm font-medium text-ink">{me?.name ?? "Unknown user"}</p>
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

      {/* Main */}
      <div className="flex min-h-screen flex-col">
        <TopProgressBar />
        <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
