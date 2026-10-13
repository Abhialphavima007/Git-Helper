import { useMemo } from "react";

// A unified diff parsed into rows with old/new line numbers, rendered either
// as one column (unified) or as old | new (side by side). Red/green areas,
// gutters with line numbers, hunk headers with the file positions.

export type RowKind = "ctx" | "add" | "del" | "hunk" | "meta";

export interface DiffRow {
  kind: RowKind;
  oldNo?: number;
  newNo?: number;
  text: string;
}

export function parseUnifiedDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    // The git header (diff --git, index, ---/+++, modes) says nothing the page
    // header doesn't; only "\ No newline at end of file" is worth keeping.
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || /^(new|deleted) file mode/.test(line) || /^(old|new) mode/.test(line) || /^(similarity|rename|copy|dissimilarity) /.test(line)) {
      continue;
    }
    if (line.startsWith("\\ ")) {
      rows.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", newNo: newNo++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", oldNo: oldNo++, text: line.slice(1) });
    } else if (line.startsWith(" ") || line === "") {
      if (line === "" && rows.length === 0) continue;
      rows.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    } else {
      rows.push({ kind: "meta", text: line });
    }
  }
  return rows;
}

// Whole-file content shown as one big addition or removal — for a file that is
// new (or gone) so the viewer still reads as "everything here is the change".
export function rowsFromLines(lines: string[], kind: "add" | "del"): DiffRow[] {
  return lines.map((text, i) => (kind === "add" ? { kind, newNo: i + 1, text } : { kind, oldNo: i + 1, text }));
}

export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === "add") added++;
    if (r.kind === "del") removed++;
  }
  return { added, removed };
}

const ROW_CLS: Record<RowKind, string> = {
  ctx: "",
  add: "bg-ok-bg",
  del: "bg-danger-bg",
  hunk: "bg-accent/10 text-accent",
  meta: "text-muted",
};

const SIGN: Record<RowKind, string> = { ctx: " ", add: "+", del: "−", hunk: "", meta: "" };

function Num({ n }: { n?: number }) {
  return <td className="w-12 select-none border-r border-line px-2 text-right align-top text-muted">{n ?? ""}</td>;
}

function Code({ row, wrap }: { row: DiffRow; wrap: boolean }) {
  const color = row.kind === "add" ? "text-ok" : row.kind === "del" ? "text-danger" : row.kind === "hunk" ? "text-accent" : "text-ink";
  return (
    <td className={`px-2 align-top ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"} ${row.kind === "meta" ? "text-muted" : color}`}>
      {row.kind === "ctx" || row.kind === "add" || row.kind === "del" ? (
        <>
          <span className="mr-2 inline-block w-2 select-none text-muted">{SIGN[row.kind]}</span>
          {row.text || " "}
        </>
      ) : (
        row.text
      )}
    </td>
  );
}

export function UnifiedDiffTable({ rows, wrap }: { rows: DiffRow[]; wrap: boolean }) {
  return (
    <table className="w-full border-collapse font-mono text-xs leading-relaxed">
      <tbody>
        {rows.map((row, i) =>
          row.kind === "hunk" || row.kind === "meta" ? (
            <tr key={i} className={ROW_CLS[row.kind]}>
              <td colSpan={3} className="px-3 py-0.5 whitespace-pre">
                {row.text}
              </td>
            </tr>
          ) : (
            <tr key={i} className={ROW_CLS[row.kind]}>
              <Num n={row.oldNo} />
              <Num n={row.newNo} />
              <Code row={row} wrap={wrap} />
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

interface SplitRow {
  left?: DiffRow;
  right?: DiffRow;
  full?: DiffRow; // hunk / meta spanning both sides
}

// Pair removed lines with the added lines that replaced them.
function toSplit(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind === "hunk" || r.kind === "meta") {
      out.push({ full: r });
      i++;
      continue;
    }
    if (r.kind === "ctx") {
      out.push({ left: r, right: r });
      i++;
      continue;
    }
    const dels: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (i < rows.length && rows[i].kind === "del") dels.push(rows[i++]);
    while (i < rows.length && rows[i].kind === "add") adds.push(rows[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) out.push({ left: dels[k], right: adds[k] });
  }
  return out;
}

// Side by side always wraps: two columns have no room for a horizontal scroll
// that keeps the old and new lines aligned.
export function SplitDiffTable({ rows }: { rows: DiffRow[] }) {
  const wrap = true;
  const split = useMemo(() => toSplit(rows), [rows]);
  const side = (row: DiffRow | undefined, empty: string) =>
    row ? (
      <>
        <Num n={row.kind === "add" ? row.newNo : row.oldNo} />
        <Code row={row} wrap={wrap} />
      </>
    ) : (
      <>
        <td className={`w-12 border-r border-line ${empty}`} />
        <td className={empty} />
      </>
    );
  return (
    <table className="w-full table-fixed border-collapse font-mono text-xs leading-relaxed">
      <colgroup>
        <col className="w-12" />
        <col />
        <col className="w-12" />
        <col />
      </colgroup>
      <tbody>
        {split.map((s, i) =>
          s.full ? (
            <tr key={i} className={ROW_CLS[s.full.kind]}>
              <td colSpan={4} className="px-3 py-0.5 whitespace-pre">
                {s.full.text}
              </td>
            </tr>
          ) : (
            <tr key={i}>
              <td className={`p-0 ${s.left ? ROW_CLS[s.left.kind] : ""}`} colSpan={2}>
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col className="w-12" />
                    <col />
                  </colgroup>
                  <tbody>
                    <tr>{side(s.left, "bg-paper/60")}</tr>
                  </tbody>
                </table>
              </td>
              <td className={`border-l border-line p-0 ${s.right ? ROW_CLS[s.right.kind] : ""}`} colSpan={2}>
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col className="w-12" />
                    <col />
                  </colgroup>
                  <tbody>
                    <tr>{side(s.right, "bg-paper/60")}</tr>
                  </tbody>
                </table>
              </td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}
