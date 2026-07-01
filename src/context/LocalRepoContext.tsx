import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type StoredRepo } from "../api/client";

interface LocalRepoContextValue {
  ready: boolean; // finished the initial probe
  localEnabled: boolean; // false on hosted deployments (desktop-only feature)
  open: boolean; // a repo is currently selected
  root: string | null;
  name: string | null;
  repos: StoredRepo[]; // all known (cloned/opened) repos
  refreshRepos: () => Promise<void>;
  openRepo: (path: string) => Promise<void>; // open a folder → registers + selects it
  selectRepo: (root: string) => Promise<void>; // switch to an already-known repo
  removeRepo: (root: string) => Promise<void>; // forget a repo (keeps files)
  close: () => Promise<void>; // deselect (repo stays in the list)
}

const Ctx = createContext<LocalRepoContextValue | null>(null);

export function LocalRepoProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(true);
  const [repos, setRepos] = useState<StoredRepo[]>([]);
  const [current, setCurrent] = useState<{ root: string; name: string } | null>(null);

  // On load, check whether local mode is available in this deployment; if so,
  // restore the known-repo list and re-select the last opened one (so a cloned
  // repo is always there without cloning again).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api.getConfig();
        if (cancelled) return;
        setLocalEnabled(cfg.localEnabled);
        if (!cfg.localEnabled) return; // hosted: no local repos

        const list = await api.local.listRepos();
        if (cancelled) return;
        setRepos(list.repos);

        const activeRoot = list.current ?? list.lastOpened;
        if (activeRoot) {
          const hit = list.repos.find((r) => r.root === activeRoot);
          if (hit) {
            // Ensure the server session points at it (survives restarts).
            if (!list.current) await api.local.select(hit.root);
            if (!cancelled) setCurrent({ root: hit.root, name: hit.name });
          }
        }
      } catch {
        /* nothing stored / config unavailable */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshRepos() {
    const list = await api.local.listRepos();
    setRepos(list.repos);
  }

  async function openRepo(path: string) {
    const res = await api.local.open(path);
    setCurrent({ root: res.root, name: res.name });
    await refreshRepos();
  }

  async function selectRepo(root: string) {
    const res = await api.local.select(root);
    setCurrent({ root: res.root, name: res.name });
    await refreshRepos();
  }

  async function removeRepo(root: string) {
    const list = await api.local.remove(root);
    setRepos(list.repos);
    if (current?.root === root) setCurrent(null);
  }

  async function close() {
    await api.local.close();
    setCurrent(null);
  }

  const value = useMemo<LocalRepoContextValue>(
    () => ({
      ready,
      localEnabled,
      open: !!current,
      root: current?.root ?? null,
      name: current?.name ?? null,
      repos,
      refreshRepos,
      openRepo,
      selectRepo,
      removeRepo,
      close,
    }),
    [ready, localEnabled, current, repos]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocalRepo(): LocalRepoContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLocalRepo must be used within LocalRepoProvider");
  return ctx;
}
