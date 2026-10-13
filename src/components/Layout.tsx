import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { useLocalRepo } from "../context/LocalRepoContext";
import { TopProgressBar } from "./TopProgressBar";
import { RepoSwitcher } from "./RepoSwitcher";
import { ThemePicker, useThemeInit } from "./ThemePicker";
import { AssistantPanel } from "./AssistantPanel";
import { Icons, type IconName } from "./NavIcons";

const SIDEBAR_KEY = "githelper.sidebar";

type Mode = "local" | "azure";

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
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "collapsed");

  const closeDrawer = () => setDrawerOpen(false);

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem(SIDEBAR_KEY, c ? "open" : "collapsed");
      return !c;
    });
  }

  // One mode is shown at a time. With both a local repo and Azure connected,
  // the current route decides which, and the switch at the top flips between
  // them — so the sidebar never stacks two full menus.
  const bothActive = localOpen && connected;
  const onLocalRoute = location.pathname === "/local" || location.pathname.startsWith("/local/");
  const mode: Mode = bothActive ? (onLocalRoute ? "local" : "azure") : localOpen ? "local" : "azure";

  function switchMode(next: Mode) {
    closeDrawer();
    if (next === mode) return;
    navigate(next === "local" ? "/local" : "/");
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
  // Cheap situational awareness for the Recovery badge (the full scan with
  // fetch happens on the page itself).
  const recoveryHints = st ? (st.detached ? 1 : 0) + (st.stashCount > 0 ? 1 : 0) + (st.behind >= 10 ? 1 : 0) : 0;

  // Local nav, grouped the way you actually work.
  const workspaceNav: NavItem[] = [
    { to: "/local", label: "Status", icon: "status", end: true },
    { to: "/local/changes", label: "Changes", icon: "changes", end: false, badge: dirtyCount },
    { to: "/local/commit", label: "Commit", icon: "commit", end: false, badge: st?.staged.length || 0 },
    { to: "/local/undo", label: "Undo & restore", icon: "undo", end: false },
    { to: "/local/recovery", label: "Recovery & sync", icon: "rescue", end: false, badge: recoveryHints, danger: !!st?.detached },
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
    { to: "/history", label: "History", icon: "history", end: false },
    { to: "/pulls", label: "Pull requests", icon: "pulls", end: false },
  ];

  async function onDisconnect() {
    closeDrawer();
    await disconnect();
    navigate(localOpen ? "/local" : "/", { replace: true });
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

  // The Local ⇄ Azure switch. Full-width segmented control normally; two
  // stacked icon buttons when the sidebar is collapsed.
  function modeSwitch() {
    const tabs: Array<{ key: Mode; label: string; icon: IconName }> = [
      { key: "local", label: "Local", icon: "changes" },
      { key: "azure", label: "Azure", icon: "dashboard" },
    ];
    return (
      <div
        role="tablist"
        aria-label="Work with"
        className={`mt-4 grid gap-1 rounded-xl border border-line bg-paper p-1 ${collapsed ? "lg:mx-0 lg:grid-cols-1" : "mx-2 grid-cols-2"}`}
      >
        {tabs.map((t) => {
          const active = mode === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              title={t.key === "local" ? "Work with the local repository" : "Work with Azure DevOps"}
              onClick={() => switchMode(t.key)}
              className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                active ? "bg-card text-accent shadow-card" : "text-muted hover:text-ink"
              }`}
            >
              <span className="[&_svg]:h-4 [&_svg]:w-4">{Icons[t.icon]}</span>
              <span className={textCls}>{t.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const azureUser = me?.name ?? null;

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

      {/* Sidebar: slide-in drawer on mobile; on desktop a sticky column pinned
          to the viewport (its own scrollbar) so long pages scroll under it
          instead of stretching it. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[272px] max-w-[85vw] transform border-r border-line bg-card transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto lg:max-w-none lg:translate-x-0 lg:self-start lg:overflow-hidden ${
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

          {bothActive && modeSwitch()}

          {/* Local-git section */}
          {mode === "local" && localOpen && (
            <div className={bothActive ? "mt-3" : "mt-4"}>
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
          {mode === "azure" && connected && (
            <div className={bothActive ? "mt-3" : "mt-4"}>
              <div className={`px-2 ${textCls}`}>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Azure repository</label>
                <select
                  className="w-full rounded-lg border border-line bg-paper px-2.5 py-2 text-sm font-medium text-ink focus-visible:border-accent"
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
                <p className="mt-1 truncate text-[11px] text-muted" title={`${org} / ${project}`}>
                  <span className="font-medium text-ink">{project}</span> · {org}
                </p>
              </div>
              {sectionHeader("Azure DevOps")}
              <nav className="space-y-0.5">{azureNav.map(navItem)}</nav>
            </div>
          )}

          {/* Footer: who you are in this mode, plus the way into the other one */}
          <div className={`mt-auto space-y-1 border-t border-line pt-3 ${textCls}`}>
            {mode === "azure" && connected && (
              <div className="px-3 pb-1">
                <p className="text-xs text-muted">Connected to</p>
                <p className="truncate text-sm font-medium text-ink" title={`${org} / ${project}`}>
                  {project}
                </p>
                <p className="truncate text-xs text-muted">{azureUser ? `${azureUser} · ${org}` : org}</p>
              </div>
            )}
            {mode === "local" && localOpen && repoName && (
              <div className="px-3 pb-1">
                <p className="text-xs text-muted">Local repository</p>
                <p className="truncate text-sm font-medium text-ink" title={root ?? undefined}>
                  {repoName}
                </p>
              </div>
            )}

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

            {mode === "local" && localOpen && (
              <button
                onClick={onCloseLocal}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-paper hover:text-danger"
              >
                Close local repo
              </button>
            )}
            {mode === "azure" && connected && (
              <NavLink to="/connect?switch=1" onClick={closeDrawer} className="block rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink">
                Switch project / account
              </NavLink>
            )}
            {mode === "azure" && connected && (
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
            {mode === "local" && localOpen && repoName ? (
              <>
                <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">Local</span>
                <span className="ml-2 font-semibold text-ink">{repoName}</span>
                {st?.branch && (
                  <>
                    <span className="mx-1.5 text-line">/</span>
                    <span className="font-mono">{st.branch}</span>
                  </>
                )}
              </>
            ) : connected ? (
              <>
                <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">Azure</span>
                <span className="ml-2 font-semibold text-ink">{org}</span>
                <span className="mx-1.5 text-line">/</span>
                <span>{project}</span>
              </>
            ) : (
              <span className="font-semibold text-ink">Git Helper</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-4">
            {mode === "local" && localOpen && (
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
