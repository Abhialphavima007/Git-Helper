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

function lane(x: number, count: number, baseY: number, color: string, faded = false) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const y = baseY - (i + 1) * STEP;
    nodes.push(
      <circle key={i} cx={x} cy={y} r={R} fill={color} opacity={faded ? 0.55 : 1} />
    );
    const fromY = i === 0 ? baseY : baseY - i * STEP;
    nodes.push(
      <line
        key={`l${i}`}
        x1={x}
        y1={fromY - (i === 0 ? 0 : R)}
        x2={x}
        y2={y + R}
        stroke={color}
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
        <circle cx={(leftX + rightX) / 2} cy={baseY} r={R} fill="#5B6573" />
        {/* split lines from base to each lane */}
        <path
          d={`M ${(leftX + rightX) / 2} ${baseY - R} C ${(leftX + rightX) / 2} ${baseY - STEP}, ${leftX} ${baseY - STEP}, ${leftX} ${baseY - STEP}`}
          fill="none"
          stroke="#5B6573"
          strokeWidth={2}
          opacity={0.6}
        />
        <path
          d={`M ${(leftX + rightX) / 2} ${baseY - R} C ${(leftX + rightX) / 2} ${baseY - STEP}, ${rightX} ${baseY - STEP}, ${rightX} ${baseY - STEP}`}
          fill="none"
          stroke="#3B5BDB"
          strokeWidth={2}
          opacity={0.6}
        />

        {!inSync && lane(leftX, shownBehind, baseY - STEP + R, "#5B6573", true)}
        {!inSync && lane(rightX, shownAhead, baseY - STEP + R, "#3B5BDB", false)}

        {inSync && <circle cx={(leftX + rightX) / 2} cy={baseY - STEP} r={R} fill="#1F8A53" />}

        {/* labels */}
        <text x={leftX} y={16} textAnchor="middle" fontSize="11" fill="#5B6573" fontFamily="Inter">
          {defaultBranch}
        </text>
        <text x={leftX} y={30} textAnchor="middle" fontSize="11" fill="#5B6573" fontFamily="Inter">
          {behind > CAP ? `+${behind}` : behind === 0 ? "—" : `+${behind}`}
        </text>
        <text x={rightX} y={16} textAnchor="middle" fontSize="11" fill="#3B5BDB" fontFamily="Inter" fontWeight="600">
          your branch
        </text>
        <text x={rightX} y={30} textAnchor="middle" fontSize="11" fill="#3B5BDB" fontFamily="Inter">
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
