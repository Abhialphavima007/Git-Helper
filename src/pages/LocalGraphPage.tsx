import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type GraphCommit } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { timeAgo } from "../lib/git";
import { Card, ErrorNote, Mono, Spinner } from "../components/ui";

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

export function LocalGraphPage() {
  const { name, root } = useLocalRepo();
  const [all, setAll] = useState(true);
  const [limit, setLimit] = useState(80);

  const query = useQuery({
    queryKey: ["local-graph", root, all, limit],
    queryFn: () => api.local.getGraph(limit, all),
    enabled: !!root,
  });

  const { rows, cols } = useMemo(
    () => (query.data ? layoutGraph(query.data) : { rows: [], cols: 1 }),
    [query.data]
  );

  const graphWidth = cols * COLW + PAD_X * 2;
  const height = Math.max(rows.length * ROW, ROW);
  const x = (c: number) => PAD_X + c * COLW;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">History</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">Commit graph — {name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            All branches
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
          <Link to="/local" className="text-sm font-medium text-accent hover:text-accent-hover">
            ← Status
          </Link>
        </div>
      </header>

      {query.isLoading && <Spinner label="Building the graph…" />}
      {query.isError && <ErrorNote error={query.error} />}

      {query.data && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted">No commits yet in this repository.</Card>
      )}

      {rows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="flex">
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
                return (
                  <circle
                    key={r.commit.full}
                    cx={x(r.col)}
                    cy={cy}
                    r={isHead ? R + 1.5 : R}
                    fill={color(r.col)}
                    stroke={isHead ? "#14181F" : "#FFFFFF"}
                    strokeWidth={isHead ? 2 : 1.5}
                  />
                );
              })}
            </svg>

            <ul className="min-w-0 flex-1 border-l border-line">
              {rows.map((r) => (
                <li
                  key={r.commit.full}
                  className="flex flex-col justify-center border-b border-line px-4"
                  style={{ height: ROW }}
                >
                  <div className="flex items-center gap-2">
                    {r.commit.refs.map((ref) => (
                      <RefChip key={ref} label={ref} />
                    ))}
                    <span className="truncate text-sm text-ink">{r.commit.subject || "(no message)"}</span>
                  </div>
                  <p className="truncate text-xs text-muted">
                    <Mono>{r.commit.id}</Mono> · {r.commit.author} · {timeAgo(r.commit.date)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

function RefChip({ label }: { label: string }) {
  const isHead = label === "HEAD";
  const isTag = label.startsWith("tag:");
  const isRemote = label.startsWith("origin/");
  const text = isTag ? label.replace(/^tag:\s*/, "") : label;
  const cls = isHead
    ? "bg-ink text-white"
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
