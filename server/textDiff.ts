// Line diff between two texts as a unified diff — for places where git isn't
// around to do it (Azure DevOps commits on a hosted deployment). Myers' O(ND)
// algorithm; bounded so a pathological pair can't pin the server.

const MAX_LINES = 40_000;
const MAX_EDITS = 4_000; // edit-script length before we give up (keeps memory ~ tens of MB)

type Op = { kind: "eq" | "del" | "ins"; a: number; b: number };

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    // Only k in [-d-1, d+1] is read back for this round.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;

  // Walk the trace back from the end to recover the edit script.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const at = (kk: number) => vd[kk + d + 1]; // window index for k
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && at(k - 1) < at(k + 1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ kind: "eq", a: x, b: y });
    }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: "ins", a: x, b: prevY });
      else ops.push({ kind: "del", a: prevX, b: y });
      x = prevX;
      y = prevY;
    }
  }
  return ops.reverse();
}

// null when the texts are too large or too different to diff within bounds.
export function unifiedDiff(oldText: string, newText: string, context = 3): string | null {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;
  const ops = myers(a, b);
  if (!ops) return null;
  if (!ops.some((o) => o.kind !== "eq")) return "";

  // Group edits into hunks with `context` lines of unchanged text around them.
  const out: string[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "eq") {
      i++;
      continue;
    }
    const start = Math.max(0, i - context);
    let end = i;
    let lastChange = i;
    while (end < ops.length && end - lastChange <= context * 2) {
      if (ops[end].kind !== "eq") lastChange = end;
      end++;
    }
    end = Math.min(ops.length, lastChange + context + 1);
    const slice = ops.slice(start, end);
    const oldStart = (slice.find((o) => o.kind !== "ins")?.a ?? ops[start].a) + 1;
    const newStart = (slice.find((o) => o.kind !== "del")?.b ?? ops[start].b) + 1;
    const oldLen = slice.filter((o) => o.kind !== "ins").length;
    const newLen = slice.filter((o) => o.kind !== "del").length;
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const o of slice) {
      if (o.kind === "eq") out.push(" " + a[o.a]);
      else if (o.kind === "del") out.push("-" + a[o.a]);
      else out.push("+" + b[o.b]);
    }
    i = end;
  }
  return out.join("\n") + "\n";
}
