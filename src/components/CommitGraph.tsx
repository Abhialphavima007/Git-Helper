// A simple, schematic commit graph showing where a branch diverged from the
// default branch. It is intentionally not a full DAG — it answers
// "how far apart are these two branches?" at a glance.

interface Props {
  branch: string;
  defaultBranch: string;
  ahead: number;
  behind: number;
}

const CAP = 5;
const STEP = 26;
const R = 5.5;

// `color` is a CSS color (may use var(...)), so paint via style, not attributes.
function lane(x: number, count: number, baseY: number, color: string, faded = false) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const y = baseY - (i + 1) * STEP;
    nodes.push(
      <circle key={i} cx={x} cy={y} r={R} style={{ fill: color }} opacity={faded ? 0.55 : 1} />
    );
    const fromY = i === 0 ? baseY : baseY - i * STEP;
    nodes.push(
      <line
        key={`l${i}`}
        x1={x}
        y1={fromY - (i === 0 ? 0 : R)}
        x2={x}
        y2={y + R}
        style={{ stroke: color }}
        strokeWidth={2}
        opacity={faded ? 0.45 : 0.8}
      />
    );
  }
  return nodes;
}

export function CommitGraph({ branch, defaultBranch, ahead, behind }: Props) {
  const shownBehind = Math.min(behind, CAP);
  const shownAhead = Math.min(ahead, CAP);
  const rows = Math.max(shownBehind, shownAhead, 1);
  const height = rows * STEP + 64;
  const baseY = height - 28;
  const leftX = 64;
  const rightX = 176;

  const inSync = ahead === 0 && behind === 0;

  return (
    <div className="overflow-x-auto">
      <svg width={240} height={height} role="img" aria-label="Branch divergence diagram">
        {/* base / common ancestor */}
        <circle cx={(leftX + rightX) / 2} cy={baseY} r={R} style={{ fill: "rgb(var(--muted))" }} />
        {/* split lines from base to each lane */}
        <path
          d={`M ${(leftX + rightX) / 2} ${baseY - R} C ${(leftX + rightX) / 2} ${baseY - STEP}, ${leftX} ${baseY - STEP}, ${leftX} ${baseY - STEP}`}
          fill="none"
          style={{ stroke: "rgb(var(--muted))" }}
          strokeWidth={2}
          opacity={0.6}
        />
        <path
          d={`M ${(leftX + rightX) / 2} ${baseY - R} C ${(leftX + rightX) / 2} ${baseY - STEP}, ${rightX} ${baseY - STEP}, ${rightX} ${baseY - STEP}`}
          fill="none"
          style={{ stroke: "rgb(var(--accent))" }}
          strokeWidth={2}
          opacity={0.6}
        />

        {!inSync && lane(leftX, shownBehind, baseY - STEP + R, "rgb(var(--muted))", true)}
        {!inSync && lane(rightX, shownAhead, baseY - STEP + R, "rgb(var(--accent))", false)}

        {inSync && <circle cx={(leftX + rightX) / 2} cy={baseY - STEP} r={R} style={{ fill: "rgb(var(--ok))" }} />}

        {/* labels */}
        <text x={leftX} y={16} textAnchor="middle" fontSize="11" style={{ fill: "rgb(var(--muted))" }} fontFamily="Inter">
          {defaultBranch}
        </text>
        <text x={leftX} y={30} textAnchor="middle" fontSize="11" style={{ fill: "rgb(var(--muted))" }} fontFamily="Inter">
          {behind > CAP ? `+${behind}` : behind === 0 ? "—" : `+${behind}`}
        </text>
        <text x={rightX} y={16} textAnchor="middle" fontSize="11" style={{ fill: "rgb(var(--accent))" }} fontFamily="Inter" fontWeight="600">
          your branch
        </text>
        <text x={rightX} y={30} textAnchor="middle" fontSize="11" style={{ fill: "rgb(var(--accent))" }} fontFamily="Inter">
          {ahead === 0 ? "—" : `+${ahead}`}
        </text>
      </svg>
      <p className="mt-1 text-xs text-muted">
        {inSync
          ? `In sync with ${defaultBranch}.`
          : `Since the split: ${defaultBranch} added ${behind}, your branch added ${ahead}.`}
      </p>
    </div>
  );
}
