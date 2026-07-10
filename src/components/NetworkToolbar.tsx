import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type RepoState } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { ApiError } from "../api/client";
import { ConfirmDialog, ConfirmRow } from "./ConfirmDialog";

type NetAction = "fetch" | "pull" | "push";

// Fetch / Pull / Push controls plus a live ahead-behind summary. Shared by the
// status and changes screens. Every action shows an "Are you sure?" dialog
// first that spells out what will happen and what it affects — nothing runs
// until Yes. Pull that hits conflicts routes to the resolver.
export function NetworkToolbar({ state }: { state: RepoState }) {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState<NetAction | null>(null);

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

  // Safe-push check: when the push dialog opens, quietly look at who owns
  // this branch's pushed history so we can warn before touching a teammate's
  // branch (no fetch — this must be instant).
  const ownerQuery = useQuery({
    queryKey: ["local-scenarios-lite", root],
    queryFn: () => api.local.scenarios(false),
    enabled: pending === "push",
    staleTime: 60_000,
  });
  const othersBranch = ownerQuery.data?.looksLikeOthersBranch ? ownerQuery.data.dominantAuthor : null;

  const branchLabel = state.branch ?? "(detached)";
  const upstreamLabel = state.upstream ?? `origin/${state.branch ?? ""}`;

  function confirmed() {
    const a = pending;
    setPending(null);
    if (a === "fetch") fetchM.mutate();
    if (a === "pull") pullM.mutate();
    if (a === "push") pushM.mutate();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={busy} onClick={() => setPending("fetch")}>
          {fetchM.isPending ? "Fetching…" : "Fetch"}
        </button>
        <button className={btn} disabled={busy} onClick={() => setPending("pull")}>
          {pullM.isPending ? "Pulling…" : `Pull${state.behind ? ` (${state.behind})` : ""}`}
        </button>
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          disabled={busy || state.detached}
          onClick={() => setPending("push")}
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

      {pending === "fetch" && (
        <ConfirmDialog title="Fetch from Azure DevOps" confirmLabel="Yes, fetch" onConfirm={confirmed} onCancel={() => setPending(null)}>
          <ConfirmRow label="What will happen:">
            Git Helper contacts the remote and downloads the latest list of branches and commits, so the
            ahead/behind numbers are up to date.
          </ConfirmRow>
          <ConfirmRow label="What it affects:">
            Nothing in your files or your branch changes — this only refreshes information. Always safe.
          </ConfirmRow>
        </ConfirmDialog>
      )}

      {pending === "pull" && (
        <ConfirmDialog title={`Pull into ${branchLabel}`} confirmLabel="Yes, pull" onConfirm={confirmed} onCancel={() => setPending(null)}>
          <ConfirmRow label="What will happen:">
            {state.behind > 0 ? (
              <>
                The <b>{state.behind}</b> new commit{state.behind === 1 ? "" : "s"} on{" "}
                <span className="font-mono text-xs">{upstreamLabel}</span> will be merged into your branch, and
                your files update to include them.
              </>
            ) : (
              <>
                You don't appear to be behind, so most likely nothing changes. (If these numbers look stale,
                Fetch first.)
              </>
            )}
          </ConfirmRow>
          <ConfirmRow label="What it affects:">
            Your branch <span className="font-mono text-xs">{branchLabel}</span> and your working files. If a
            downloaded change clashes with your edits, you'll be taken to the conflict resolver — nothing is
            lost.
          </ConfirmRow>
        </ConfirmDialog>
      )}

      {pending === "push" && (
        <ConfirmDialog title={`Push ${branchLabel} to Azure DevOps`} confirmLabel="Yes, push" onConfirm={confirmed} onCancel={() => setPending(null)}>
          <ConfirmRow label="What will happen:">
            {state.upstream ? (
              state.ahead > 0 ? (
                <>
                  Your <b>{state.ahead}</b> local commit{state.ahead === 1 ? "" : "s"} will be uploaded to{" "}
                  <span className="font-mono text-xs">{state.upstream}</span>.
                </>
              ) : (
                <>You have no unpushed commits, so most likely nothing changes.</>
              )
            ) : (
              <>
                This branch will be published to the remote as{" "}
                <span className="font-mono text-xs">{upstreamLabel}</span> for the first time, with all its
                commits.
              </>
            )}
          </ConfirmRow>
          <ConfirmRow label="What it affects:">
            The branch on Azure DevOps — teammates will see these commits. Your local files don't change.
          </ConfirmRow>
          {othersBranch && (
            <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-ink">
              ⚠ This looks like <b>{othersBranch.name}</b>'s branch ({othersBranch.share}% of its recent pushed
              commits are theirs). Consider your own branch + a Pull Request instead — or push anyway if you two
              agreed to share it. The <span className="font-mono">Recovery &amp; sync</span> page can move your
              commits to a new branch.
            </p>
          )}
          {state.behind > 0 && (
            <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-ink">
              ⚠ You're also <b>{state.behind} behind</b> — Azure may reject this push until you Pull first.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
