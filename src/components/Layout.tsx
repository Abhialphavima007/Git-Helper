import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { useLocalRepo } from "../context/LocalRepoContext";
import { TopProgressBar } from "./TopProgressBar";
import { RepoSwitcher } from "./RepoSwitcher";
import { ThemePicker, useThemeInit } from "./ThemePicker";
import { AssistantPanel } from "./AssistantPanel";
import { Icons, type IconName } from "./NavIcons";

const SIDEBAR_KEY = "githelper.sidebar";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end: boolean;
  badge?: number;
  danger?: boolean;
}

export function Layout({ children }: { children: ReactNode }) {
  useThemeInit();
  const { org, project, me, repos, selectedRepoId, selectRepo, disconnect, connected } = useConnection();
  const { open: localOpen, localEnabled, close: closeLocal, root, name: repoName } = useLocalRepo();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "collapsed");

  const closeDrawer = () => setDrawerOpen(false);

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem(SIDEBAR_KEY, c ? "open" : "collapsed");
      return !c;
    });
  }

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

  // Local nav, grouped the way you actually work.
  const workspaceNav: NavItem[] = [
    { to: "/local", label: "Status", icon: "status", end: true },
    { to: "/local/changes", label: "Changes", icon: "changes", end: false, badge: dirtyCount },
    { to: "/local/commit", label: "Commit", icon: "commit", end: false, badge: st?.staged.length || 0 },
    ...(hasConflicts
      ? [{ to: "/local/conflicts", label: "Resolve conflicts", icon: "conflicts" as IconName, end: false, badge: st!.conflicted.length, danger: true }]
      : []),
  ];
  const branchesNav: NavItem[] = [
    { to: "/local/branches", label: "Branches", icon: "branches", end: false },
    { to: "/local/compare", label: "Compare & merge", icon: "compare", end: false },
    { to: "/local/graph", label: "History", icon: "history", end: false },
  ];
  const azureNav: NavItem[] = [
    { to: "/", label: "Dashboard", icon: "dashboard", end: true },
    { to: "/repos", label: "Repositories", icon: "repos", end: false },
    { to: "/branches", label: "Branches", icon: "branches", end: false },
    { to: "/compare", label: "Compare branches", icon: "compare", end: false },
    { to: "/pulls", label: "Pull requests", icon: "pulls", end: false },
  ];

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

  // Hide text (labels, headers, pickers) at lg+ when collapsed; the mobile
  // drawer always shows everything.
  const textCls = collapsed ? "lg:hidden" : "";

  function navItem(item: NavItem) {
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={closeDrawer}
        title={item.badge ? `${item.label} (${item.badge})` : item.label}
        className={({ isActive }) =>
          `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            collapsed ? "lg:justify-center lg:px-2 lg:py-2.5 lg:[&_svg]:h-[22px] lg:[&_svg]:w-[22px]" : ""
          } ${isActive ? "bg-accent/10 text-accent" : "text-muted hover:bg-paper hover:text-ink"}`
        }
      >
        {Icons[item.icon]}
        <span className={`flex min-w-0 flex-1 items-center justify-between ${textCls}`}>
          <span className="truncate">{item.label}</span>
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
    );
  }

  function sectionHeader(text: string) {
    return (
      <p className={`px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-muted/80 ${textCls}`}>
        {text}
      </p>
    );
  }

  return (
    <div className={`min-h-screen lg:grid ${collapsed ? "lg:grid-cols-[64px_1fr]" : "lg:grid-cols-[248px_1fr]"}`}>
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

      {/* Sidebar: slide-in drawer on mobile, static (collapsible) column on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[272px] max-w-[85vw] transform border-r border-line bg-card transition-transform duration-200 lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className={`flex h-full flex-col overflow-y-auto py-5 ${collapsed ? "px-2 lg:items-stretch" : "px-4"}`}>
          <div className={`flex items-center justify-between px-2 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
            <span className={`font-display text-base font-bold text-ink ${textCls}`}>Git Helper</span>
            <span className={`hidden font-display text-xl font-bold text-accent ${collapsed ? "lg:block" : ""}`}>G</span>
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
            <div className="mt-4">
              <div className={`px-2 ${textCls}`}>
                <RepoSwitcher />
              </div>
              {sectionHeader("Workspace")}
              <nav className="space-y-0.5">{workspaceNav.map(navItem)}</nav>
              {sectionHeader("Branches & history")}
              <nav className="space-y-0.5">{branchesNav.map(navItem)}</nav>
            </div>
          )}

          {/* Azure DevOps section */}
          {connected && (
            <div className="mt-2">
              {sectionHeader(`Azure · ${project ?? ""}`)}
              <div className={`px-2 pb-1 ${textCls}`}>
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
              <nav className="space-y-0.5">{azureNav.map(navItem)}</nav>
            </div>
          )}

          {/* Footer: add the other mode / sign out */}
          <div className={`mt-auto space-y-1 border-t border-line pt-3 ${textCls}`}>
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
              <div className="px-3 pt-1">
                <p className="text-xs text-muted">Signed in as</p>
                <p className="truncate text-sm font-medium text-ink">{me?.name ?? "Unknown user"}</p>
              </div>
            )}

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

            {/* Theme picker inside the drawer on mobile */}
            <div className="px-3 pt-2 lg:hidden">
              <p className="mb-1.5 text-xs text-muted">Accent color</p>
              <ThemePicker />
            </div>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-col">
        {/* Desktop navbar: sidebar toggle · context · theme */}
        <header className="hidden items-center gap-3 border-b border-line bg-card px-4 py-2.5 lg:flex">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg border border-line p-1.5 text-muted hover:bg-paper hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>

          <div className="min-w-0 text-sm text-muted">
            {localOpen && repoName ? (
              <>
                <span className="font-semibold text-ink">{repoName}</span>
                {st?.branch && (
                  <>
                    <span className="mx-1.5 text-line">/</span>
                    <span className="font-mono">{st.branch}</span>
                  </>
                )}
              </>
            ) : connected ? (
              <>
                <span className="font-semibold text-ink">{org}</span>
                <span className="mx-1.5 text-line">/</span>
                <span>{project}</span>
              </>
            ) : (
              <span className="font-semibold text-ink">Git Helper</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-4">
            {localOpen && (
              <button
                onClick={async () => {
                  try {
                    await api.local.openInEditor();
                  } catch {
                    /* surfaced on the Status page */
                  }
                }}
                className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper"
              >
                Open in VS Code
              </button>
            )}
            <ThemePicker />
          </div>
        </header>

        <TopProgressBar />
        <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>

      {/* AI assistant — floating, available on every page */}
      <AssistantPanel />
    </div>
  );
}
