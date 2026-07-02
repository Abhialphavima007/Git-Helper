import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type GraphCommit } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { timeAgo } from "../lib/git";
import { Card, DiffStat, ErrorNote, Mono, Spinner } from "../components/ui";
import { DiffLines } from "../components/DiffView";

const ROW = 48;
const COLW = 20;
const PAD_X = 16;
const R = 5;
const LANE_COLORS = ["#3B5BDB", "#1F8A53", "#B26A00", "#C2392F", "#7048E8", "#0C8599", "#E8590C", "#D6336C"];

const color = (i: number) => LANE_COLORS[((i % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];

interface Seg {
  from: number; // column at the outer edge
  to: number; // column at the row center (node line)
  color: number;
}
interface Row {
  commit: GraphCommit;
  col: number;
  upper: Seg[]; // segments in the top half (rowTop → center)
  lower: Seg[]; // segments in the bottom half (center → rowBottom)
}

// Assign lanes and per-row rail segments, git-log-graph style. Commits arrive
// newest-first; each commit's first parent continues its lane, extra parents
// open/merge lanes, and lanes that finish free up. This produces continuous
// vertical rails (pass-through), converging lines (into a commit), and merge
// curves (out of a commit) — a real DAG, not just node-to-node lines.
function layoutGraph(commits: GraphCommit[]): { rows: Row[]; cols: number } {
  let lanes: (string | null)[] = []; // per column: the commit id expected next from above
  let maxCols = 1;

  const rows: Row[] = commits.map((commit) => {
    const above = lanes.slice();

    // Column for this commit: a lane already waiting for it, else a fresh lane.
    let col = above.indexOf(commit.full);
    if (col === -1) {
      col = above.indexOf(null);
      if (col === -1) col = above.length;
    }
    while (above.length <= col) above.push(null);

    // Below = state leaving this row. Lanes waiting for this commit converge in.
    const below = above.map((id) => (id === commit.full ? null : id));

    const producedCols = new Set<number>();
    const mergeInto: number[] = [];
    if (commit.parents.length > 0) {
      below[col] = commit.parents[0];
      producedCols.add(col);
      for (let p = 1; p < commit.parents.length; p++) {
        let pc = below.indexOf(commit.parents[p]);
        if (pc === -1) {
          pc = below.indexOf(null);
          if (pc === -1) pc = below.length;
          while (below.length <= pc) below.push(null);
          below[pc] = commit.parents[p];
          producedCols.add(pc);
        } else {
          mergeInto.push(pc); // parent already has a lane — draw a merge curve to it
        }
      }
    } else {
      below[col] = null;
    }

    // Upper half: every incoming lane routes to its center-row position.
    const upper: Seg[] = [];
    for (let c = 0; c < above.length; c++) {
      const id = above[c];
      if (id == null) continue;
      if (id === commit.full) upper.push({ from: c, to: col, color: c }); // converge into node
      else upper.push({ from: c, to: c, color: c }); // pass through
    }

    // Lower half: node continues to its parents; other lanes pass straight down.
    const lower: Seg[] = [];
    for (let c = 0; c < below.length; c++) {
      const id = below[c];
      if (id == null) continue;
      if (producedCols.has(c)) lower.push({ from: col, to: c, color: c }); // node → parent lane
      else lower.push({ from: c, to: c, color: c }); // pass through
    }
    for (const pc of mergeInto) lower.push({ from: col, to: pc, color: pc });

    lanes = below;
    maxCols = Math.max(maxCols, above.length, below.length);
    return { commit, col, upper, lower };
  });

  return { rows, cols: maxCols };
}

const ALL = "__all__";

export function LocalGraphPage() {
  const { name, root } = useLocalRepo();
  const [scope, setScope] = useState<string>(""); // "" = current branch (default), ALL, or a branch ref
  const [view, setView] = useState<"graph" | "list">("graph");
  const [simplify, setSimplify] = useState(false); // --first-parent
  const [limit, setLimit] = useState(80);
  const [selected, setSelected] = useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["local-branches", root],
    queryFn: () => api.local.getBranches(),
    enabled: !!root,
  });
  const branches = branchesQuery.data ?? [];

  const isAll = scope === ALL;
  const ref = scope && scope !== ALL ? scope : undefined; // undefined = HEAD (current branch)

  const query = useQuery({
    queryKey: ["local-graph", root, scope, simplify, limit],
    queryFn: () => api.local.getGraph(limit, isAll, ref, simplify),
    enabled: !!root,
  });

  const { rows, cols } = useMemo(
    () => (query.data ? layoutGraph(query.data) : { rows: [], cols: 1 }),
    [query.data]
  );

  const graphWidth = cols * COLW + PAD_X * 2;
  const height = Math.max(rows.length * ROW, ROW);
  const x = (c: number) => PAD_X + c * COLW;

  const segBtn = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
      active ? "bg-accent/10 text-accent" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">History</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">History — {name}</h1>
          <p className="mt-1 text-sm text-muted">Click a commit to see exactly what it changed.</p>
        </div>
        <Link to="/local" className="text-sm font-medium text-accent hover:text-accent-hover">
          ← Status
        </Link>
      </header>

      {/* View controls */}
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className="inline-flex rounded-lg border border-line bg-card p-0.5">
          <button className={segBtn(view === "graph")} onClick={() => setView("graph")}>
            Graph
          </button>
          <button className={segBtn(view === "list")} onClick={() => setView("list")}>
            List
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-sm text-muted">
          Show
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-lg border border-line bg-card px-2 py-1 font-mono text-sm text-ink focus-visible:border-accent"
          >
            <option value="">Current branch</option>
            <option value={ALL}>All branches</option>
            {branches.map((b) => (
              <option key={b.ref} value={b.ref}>
                {b.name}
                {b.isRemote ? " (remote)" : ""}
              </option>
            ))}
          </select>
        </label>

        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded-lg border border-line bg-card px-2 py-1 text-sm text-ink focus-visible:border-accent"
        >
          {[40, 80, 150, 300].map((n) => (
            <option key={n} value={n}>
              Last {n}
            </option>
          ))}
        </select>

        {!isAll && (
          <label
            className="flex items-center gap-1.5 text-sm text-muted"
            title="Follow only each merge's first parent — the branch's own story without merged-in side branches"
          >
            <input type="checkbox" checked={simplify} onChange={(e) => setSimplify(e.target.checked)} />
            Simplify merges
          </label>
        )}

        {isAll && (
          <span className="text-xs text-muted">
            Tip: long-diverged branches draw long parallel rails — pick one branch for a cleaner view.
          </span>
        )}
      </Card>

      {query.isLoading && <Spinner label="Reading history…" />}
      {query.isError && <ErrorNote error={query.error} />}

      {query.data && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">No commits yet in this repository.</Card>
      )}

      {view === "list" && rows.length > 0 && (
        <Card className="divide-y divide-line p-0">
          {rows.map((r) => {
            const isSel = selected === r.commit.id;
            return (
              <button
                key={r.commit.full}
                onClick={() => setSelected(isSel ? null : r.commit.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                  isSel ? "bg-accent/10" : "hover:bg-paper"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {r.commit.refs.map((refName) => (
                      <RefChip key={refName} label={refName} />
                    ))}
                    <span className="truncate text-sm text-ink">{r.commit.subject || "(no message)"}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {r.commit.author} · {timeAgo(r.commit.date)}
                    {r.commit.parents.length > 1 && (
                      <span className="ml-2 rounded bg-line px-1.5 py-0.5 text-[10px] font-medium uppercase">merge</span>
                    )}
                  </span>
                </span>
                <Mono>{r.commit.id}</Mono>
              </button>
            );
          })}
        </Card>
      )}

      {view === "graph" && rows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="flex min-w-[320px]">
            <svg width={graphWidth} height={height} className="shrink-0" role="img" aria-label="Commit graph">
              {rows.map((r, i) => {
                const top = i * ROW;
                const center = top + ROW / 2;
                const bottom = top + ROW;
                const seg = (s: Seg, y1: number, y2: number, key: string) => {
                  const x1 = x(s.from);
                  const x2 = x(s.to);
                  const d =
                    x1 === x2
                      ? `M ${x1} ${y1} L ${x2} ${y2}`
                      : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
                  return <path key={key} d={d} fill="none" stroke={color(s.color)} strokeWidth={2} opacity={0.85} />;
                };
                return (
                  <g key={r.commit.full}>
                    {r.upper.map((s, j) => seg(s, top, center, `u${i}-${j}`))}
                    {r.lower.map((s, j) => seg(s, center, bottom, `l${i}-${j}`))}
                  </g>
                );
              })}
              {rows.map((r, i) => {
                const cy = i * ROW + ROW / 2;
                const isHead = r.commit.refs.includes("HEAD");
                const isSel = selected === r.commit.id;
                return (
                  <circle
                    key={r.commit.full}
                    cx={x(r.col)}
                    cy={cy}
                    r={isSel ? R + 2 : isHead ? R + 1.5 : R}
                    fill={color(r.col)}
                    style={{ stroke: isSel || isHead ? "rgb(var(--ink))" : "rgb(var(--card))" }}
                    strokeWidth={isSel ? 2.5 : isHead ? 2 : 1.5}
                    className="cursor-pointer"
                    onClick={() => setSelected(isSel ? null : r.commit.id)}
                  />
                );
              })}
            </svg>

            <ul className="min-w-0 flex-1 border-l border-line">
              {rows.map((r) => {
                const isSel = selected === r.commit.id;
                return (
                  <li key={r.commit.full} style={{ height: ROW }}>
                    <button
                      onClick={() => setSelected(isSel ? null : r.commit.id)}
                      className={`flex h-full w-full flex-col justify-center border-b border-line px-4 text-left transition-colors ${
                        isSel ? "bg-accent/10" : "hover:bg-paper"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {r.commit.refs.map((ref) => (
                          <RefChip key={ref} label={ref} />
                        ))}
                        <span className="truncate text-sm text-ink">{r.commit.subject || "(no message)"}</span>
                      </span>
                      <span className="truncate text-xs text-muted">
                        <Mono>{r.commit.id}</Mono> · {r.commit.author} · {timeAgo(r.commit.date)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      )}

      {selected && <CommitDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// Everything one commit changed: message, meta, and per-file diffs.
function CommitDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { root } = useLocalRepo();
  const [openFile, setOpenFile] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["local-commit-detail", root, id],
    queryFn: () => api.local.getCommitDetail(id),
  });

  const d = query.data;

  return (
    <Card className="p-0">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">
            commit <Mono>{d?.full ?? id}</Mono>
          </p>
          {d && (
            <>
              <h2 className="mt-1 font-display text-lg font-semibold text-ink">{d.subject}</h2>
              <p className="mt-1 text-sm text-muted">
                {d.author} {d.email && <span className="text-muted/70">&lt;{d.email}&gt;</span>} · {timeAgo(d.date)}
                {d.parents.length > 1 && <span className="ml-2 rounded bg-line px-1.5 py-0.5 text-[10px] font-medium uppercase">merge</span>}
              </p>
              {d.refs.length > 0 && (
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {d.refs.map((ref) => (
                    <RefChip key={ref} label={ref} />
                  ))}
                </p>
              )}
            </>
          )}
        </div>
        <button onClick={onClose} className="shrink-0 rounded-md p-1 text-muted hover:text-ink" aria-label="Close details">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {query.isLoading && (
        <div className="p-5">
          <Spinner label="Loading commit…" />
        </div>
      )}
      {query.isError && (
        <div className="p-5">
          <ErrorNote error={query.error} />
        </div>
      )}

      {d && (
        <>
          {d.body && (
            <p className="whitespace-pre-wrap border-b border-line px-5 py-3 text-sm text-ink">{d.body}</p>
          )}
          <div className="px-5 py-3 text-sm font-semibold text-ink">
            {d.files.length} file{d.files.length === 1 ? "" : "s"} changed{" "}
            <span className="font-mono text-xs font-normal">
              <span className="text-ok">+{d.totalAdded}</span> <span className="text-danger">−{d.totalRemoved}</span>
            </span>
          </div>
          <div className="divide-y divide-line border-t border-line">
            {d.files.map((f) => {
              const isOpen = openFile === f.path;
              return (
                <div key={f.path}>
                  <button
                    onClick={() => setOpenFile(isOpen ? null : f.path)}
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-paper"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.path}</span>
                    <DiffStat added={f.added} removed={f.removed} />
                    <span className="shrink-0 text-muted">{isOpen ? "▾" : "▸"}</span>
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-3">
                      <CommitFileDiff id={d.id} file={f.path} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function CommitFileDiff({ id, file }: { id: string; file: string }) {
  const { root } = useLocalRepo();
  const query = useQuery({
    queryKey: ["local-commit-diff", root, id, file],
    queryFn: () => api.local.getCommitDiff(id, file),
  });
  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorNote error={query.error} />;
  return <DiffLines diff={query.data?.diff ?? ""} />;
}

function RefChip({ label }: { label: string }) {
  const isHead = label === "HEAD";
  const isTag = label.startsWith("tag:");
  const isRemote = label.startsWith("origin/");
  const text = isTag ? label.replace(/^tag:\s*/, "") : label;
  const cls = isHead
    ? "bg-ink text-paper"
    : isTag
    ? "bg-warn-bg text-warn"
    : isRemote
    ? "bg-line text-muted"
    : "bg-accent/10 text-accent";
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${cls}`}>
      {isTag ? `⚲ ${text}` : text}
    </span>
  );
}
