import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type MeInfo, type RepoInfo } from "../api/client";

interface ConnectionContextValue {
  ready: boolean; // finished the initial /connection probe
  connected: boolean;
  org: string | null;
  project: string | null;
  me: MeInfo | null;
  repos: RepoInfo[];
  selectedRepoId: string | null;
  selectedRepo: RepoInfo | null;
  selectRepo: (id: string) => void;
  applyConnect: (org: string, project: string, me: MeInfo | null, repos: RepoInfo[]) => void;
  refreshRepos: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [org, setOrg] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);

  // On load, restore the session if the cookie is still valid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await api.getConnection();
        if (cancelled) return;
        if (state.connected) {
          setConnected(true);
          setOrg(state.org);
          setProject(state.project);
          setMe(state.me);
          const list = await api.getRepos();
          if (cancelled) return;
          setRepos(list);
          if (list.length) setSelectedRepoId((prev) => prev ?? list[0].id);
        }
      } catch {
        /* not connected — show the connect screen */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyConnect(o: string, p: string, who: MeInfo | null, list: RepoInfo[]) {
    setConnected(true);
    setOrg(o);
    setProject(p);
    setMe(who);
    setRepos(list);
    setSelectedRepoId(list.length ? list[0].id : null);
  }

  async function refreshRepos() {
    const list = await api.getRepos();
    setRepos(list);
    if (list.length && !list.some((r) => r.id === selectedRepoId)) {
      setSelectedRepoId(list[0].id);
    }
  }

  async function disconnect() {
    await api.disconnect();
    setConnected(false);
    setOrg(null);
    setProject(null);
    setMe(null);
    setRepos([]);
    setSelectedRepoId(null);
  }

  const value = useMemo<ConnectionContextValue>(
    () => ({
      ready,
      connected,
      org,
      project,
      me,
      repos,
      selectedRepoId,
      selectedRepo: repos.find((r) => r.id === selectedRepoId) ?? null,
      selectRepo: setSelectedRepoId,
      applyConnect,
      refreshRepos,
      disconnect,
    }),
    [ready, connected, org, project, me, repos, selectedRepoId]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConnection must be used within ConnectionProvider");
  return ctx;
}
