import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type RepoState } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { ApiError } from "../api/client";

// Fetch / Pull / Push controls plus a live ahead-behind summary. Shared by the
// status and changes screens. Pull that hits conflicts routes to the resolver.
export function NetworkToolbar({ state }: { state: RepoState }) {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function refreshDerived(next?: RepoState) {
    if (next) qc.setQueryData(["local-state", root], next);
    qc.invalidateQueries({ queryKey: ["local-state", root] });
    qc.invalidateQueries({ queryKey: ["local-graph"] });
    qc.invalidateQueries({ queryKey: ["local-branches"] });
  }

  function errText(err: unknown): string {
    if (err instanceof ApiError) return err.detail ? `${err.message} — ${err.detail}` : err.message;
    return err instanceof Error ? err.message : "Something went wrong.";
  }

  const fetchM = useMutation({
    mutationFn: () => api.local.fetch(),
    onSuccess: (next) => {
      refreshDerived(next);
      setNote({ kind: "ok", text: "Fetched latest refs from the remote." });
    },
    onError: (e) => setNote({ kind: "err", text: errText(e) }),
  });

  const pullM = useMutation({
    mutationFn: () => api.local.pull(),
    onSuccess: (res) => {
      refreshDerived(res.state);
      if (res.conflicts) {
        setNote({ kind: "err", text: "Pull produced conflicts — opening the resolver." });
        navigate("/local/conflicts");
      } else {
        setNote({ kind: "ok", text: "Pulled and merged the latest changes." });
      }
    },
    onError: (e) => setNote({ kind: "err", text: errText(e) }),
  });

  const pushM = useMutation({
    mutationFn: () => api.local.push(),
    onSuccess: (next) => {
      refreshDerived(next);
      setNote({ kind: "ok", text: "Pushed your commits to the remote." });
    },
    onError: (e) => setNote({ kind: "err", text: errText(e) }),
  });

  const busy = fetchM.isPending || pullM.isPending || pushM.isPending;
  const btn = "rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={busy} onClick={() => fetchM.mutate()}>
          {fetchM.isPending ? "Fetching…" : "Fetch"}
        </button>
        <button className={btn} disabled={busy} onClick={() => pullM.mutate()}>
          {pullM.isPending ? "Pulling…" : `Pull${state.behind ? ` (${state.behind})` : ""}`}
        </button>
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          disabled={busy || state.detached}
          onClick={() => pushM.mutate()}
        >
          {pushM.isPending ? "Pushing…" : `Push${state.ahead ? ` (${state.ahead})` : ""}`}
        </button>
        <span className="text-xs text-muted">
          {state.upstream ? (
            <>
              ↑{state.ahead} ↓{state.behind} vs <span className="font-mono">{state.upstream}</span>
            </>
          ) : (
            "No upstream set — Push will publish this branch."
          )}
        </span>
      </div>
      {note && (
        <p className={`text-xs ${note.kind === "ok" ? "text-ok" : "text-danger"}`}>{note.text}</p>
      )}
    </div>
  );
}
