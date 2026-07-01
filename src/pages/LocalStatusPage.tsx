import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type RepoFile, type RepoState } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { changeLabel, localStateVerdict } from "../lib/git";
import { Card, ChangePill, DiffStat, ErrorNote, GuidanceBanner, Mono, Spinner, StatusPill } from "../components/ui";
import { NetworkToolbar } from "../components/NetworkToolbar";
import type { Light } from "../lib/git";

export function LocalStatusPage() {
  const { name, root } = useLocalRepo();

  const query = useQuery({
    queryKey: ["local-state", root],
    queryFn: () => api.local.getState(),
    enabled: !!root,
    refetchOnWindowFocus: true,
  });

  const s = query.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Working tree</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">{name}</h1>
          {s && (
            <p className="mt-1 text-sm text-muted">
              On branch <Mono>{s.detached ? "(detached HEAD)" : s.branch ?? "?"}</Mono>
              {s.upstream && (
                <>
                  {" "}· tracking <Mono>{s.upstream}</Mono>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                await api.local.openInEditor();
              } catch (e) {
                alert(e instanceof Error ? e.message : "Couldn't open VS Code.");
              }
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            Open in VS Code
          </button>
          <button
            onClick={() => query.refetch()}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {query.isLoading && <Spinner label="Reading the working tree…" />}
      {query.isError && <ErrorNote error={query.error} />}

      {s && (
        <>
          <GuidanceBanner verdict={localStateVerdict(s)} />

          <Card className="p-4">
            <NetworkToolbar state={s} />
          </Card>

          <section>
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">Where's the issue?</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <AttentionItems state={s} />
            </div>
          </section>

          <FileGroups state={s} />
        </>
      )}
    </div>
  );
}

// Turns the raw state into a short list of actionable "go here next" cards.
function AttentionItems({ state: s }: { state: RepoState }) {
  const items: Array<{ light: Light; title: string; body: string; to?: string; cta?: string }> = [];

  if (s.conflicted.length > 0) {
    items.push({
      light: "danger",
      title: `${s.conflicted.length} conflict${s.conflicted.length === 1 ? "" : "s"}`,
      body: "These files changed on both sides and must be resolved before the merge can finish.",
      to: "/local/conflicts",
      cta: "Resolve conflicts",
    });
  }
  if (s.behind > 0) {
    items.push({
      light: "warn",
      title: `${s.behind} to pull`,
      body: `The upstream has ${s.behind} commit${s.behind === 1 ? "" : "s"} you don't have yet. Pull to catch up.`,
    });
  }
  if (s.ahead > 0) {
    items.push({
      light: "ok",
      title: `${s.ahead} to push`,
      body: `You have ${s.ahead} commit${s.ahead === 1 ? "" : "s"} not on the upstream yet.`,
    });
  }
  const dirty = s.staged.length + s.unstaged.length + s.untracked.length;
  if (dirty > 0) {
    items.push({
      light: "neutral",
      title: `${dirty} uncommitted change${dirty === 1 ? "" : "s"}`,
      body: "Review what changed, stage what belongs together, and commit it.",
      to: "/local/commit",
      cta: "Review & commit",
    });
  }
  if (items.length === 0) {
    items.push({
      light: "ok",
      title: "Nothing needs attention",
      body: "Clean working tree and in sync with the upstream. A good place to start new work.",
    });
  }

  return (
    <>
      {items.map((it, i) => (
        <Card key={i} className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">{it.title}</h3>
            <StatusPill light={it.light}>{it.light === "danger" ? "blocked" : it.light === "warn" ? "attention" : it.light === "ok" ? "ok" : "info"}</StatusPill>
          </div>
          <p className="text-sm text-muted">{it.body}</p>
          {it.to && it.cta && (
            <Link
              to={it.to}
              className="self-start rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              {it.cta} →
            </Link>
          )}
        </Card>
      ))}
    </>
  );
}

function FileGroups({ state: s }: { state: RepoState }) {
  const groups: Array<{ title: string; files: RepoFile[] }> = [
    { title: "Conflicted", files: s.conflicted },
    { title: "Staged", files: s.staged },
    { title: "Changed (not staged)", files: s.unstaged },
    { title: "New (untracked)", files: s.untracked },
  ].filter((g) => g.files.length > 0);

  if (groups.length === 0) return null;

  return (
    <section className="space-y-4">
      {groups.map((g) => (
        <Card key={g.title} className="p-4">
          <h3 className="mb-2 font-display text-sm font-semibold text-ink">
            {g.title} <span className="text-muted">({g.files.length})</span>
          </h3>
          <ul className="space-y-1.5">
            {g.files.map((f) => {
              const cl = changeLabel(f.change);
              return (
                <li key={f.path} className="flex items-center gap-2">
                  <ChangePill light={cl.light}>{cl.text}</ChangePill>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.path}</span>
                  <DiffStat added={f.added} removed={f.removed} />
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </section>
  );
}
