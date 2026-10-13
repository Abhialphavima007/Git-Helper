import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, type FilePreview } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { useConnection } from "../context/ConnectionContext";
import { ErrorNote, Spinner } from "../components/ui";
import { ThemePicker, useThemeInit } from "../components/ThemePicker";
import { BinaryPreview } from "../components/DiffView";
import { diffStats, parseUnifiedDiff, rowsFromLines, SplitDiffTable, UnifiedDiffTable, type DiffRow } from "../components/DiffTable";

const LAYOUT_KEY = "githelper.diff.layout";
const WRAP_KEY = "githelper.diff.wrap";

// Full-page view of one file's change: where it is (line numbers), what it is
// (red/green), unified or side by side — opened in its own window from the
// Changes, Commit, History and Compare screens, and from inside zip previews.
export function FileDetailPage() {
  useThemeInit();
  const { root, name: localName } = useLocalRepo();
  const { repos } = useConnection();
  const [params] = useSearchParams();
  const file = params.get("file") ?? "";
  // Azure DevOps commit (opened from the Azure History page) instead of the local repo.
  const azureRepo = params.get("repo") ?? undefined;
  const commit = params.get("commit") ?? undefined;
  const from = params.get("from") ?? undefined;
  const isAzure = !!azureRepo && !!commit;
  const repoName = isAzure ? repos.find((r) => r.id === azureRepo)?.name ?? "Azure DevOps" : localName;
  const ref = params.get("ref") ?? undefined;
  const staged = params.get("staged") === "1";
  const against = params.get("against") ?? undefined;
  const base = params.get("base") ?? undefined;
  const entry = params.get("entry") ?? undefined;
  const againstFile = params.get("againstFile") ?? undefined;

  const [tab, setTab] = useState<"changes" | "full">("changes");
  const [layout, setLayout] = useState<"unified" | "split">(() => (localStorage.getItem(LAYOUT_KEY) === "split" ? "split" : "unified"));
  const [wrap, setWrap] = useState(() => localStorage.getItem(WRAP_KEY) === "1");

  function pickLayout(next: "unified" | "split") {
    localStorage.setItem(LAYOUT_KEY, next);
    setLayout(next);
  }
  function pickWrap(next: boolean) {
    localStorage.setItem(WRAP_KEY, next ? "1" : "0");
    setWrap(next);
  }

  // --- the change (diff) ---
  const diffQuery = useQuery({
    queryKey: ["file-detail-diff", root, file, ref ?? "", staged, base ?? "", against ?? "", entry ?? "", againstFile ?? "", azureRepo ?? "", commit ?? "", from ?? ""],
    queryFn: async () => {
      const none = {
        diff: "",
        truncated: false,
        whole: null as null | { kind: "add" | "del"; p: FilePreview },
        plain: null as null | { p: FilePreview; note: string },
      };
      if (isAzure) {
        const v = await api.getAzureCommitDiff(azureRepo!, commit!, file, from);
        if (v.binary) return { ...none, plain: { p: { file, size: 0, kind: "binary" as const, hex: "" }, note: "Binary file — Azure DevOps has no line diff for it. Open it in Azure DevOps to download it." } };
        if (v.tooLarge) return { ...none, plain: { p: { file, size: 0, kind: "binary" as const, hex: "" }, note: "This file is too large or too different to diff here — open it in Azure DevOps." } };
        return { ...none, diff: v.diff };
      }
      if (entry) {
        const v = await api.local.getArchiveEntry(file, entry, { ref, staged, against, againstFile }, true);
        if (v.diff !== undefined) return { ...none, diff: v.diff, truncated: !!v.diffTruncated };
        if (v.status === "removed" && v.previous) return { ...none, whole: { kind: "del" as const, p: v.previous } };
        if (!v.current) return none;
        // Changed, but no line diff possible (binary / can't unpack): show the
        // content plainly rather than painting it all as additions.
        if (v.status === "modified") {
          const why = (v.noDiffReason ?? "No line diff is available.").replace(/^./, (c) => c.toLowerCase());
          return { ...none, plain: { p: v.current, note: `This file changed inside the archive, but ${why}` } };
        }
        if (v.status === "same" && against) {
          return { ...none, plain: { p: v.current, note: "This file is identical to the previous version — showing it in full." } };
        }
        return { ...none, whole: { kind: "add" as const, p: v.current } };
      }
      if (ref && base) return { ...none, diff: (await api.local.compareDiff(base, ref, file)).diff };
      if (ref) return { ...none, diff: (await api.local.getCommitDiff(ref, file)).diff };
      return { ...none, diff: (await api.local.getDiff(file, staged)).diff };
    },
    enabled: (!!root || isAzure) && !!file,
  });

  // --- the whole file ---
  const fullQuery = useQuery({
    queryKey: ["file-detail-full", root, file, ref ?? "", staged, entry ?? "", azureRepo ?? "", commit ?? ""],
    queryFn: async (): Promise<FilePreview | null> => {
      if (isAzure) {
        const v = await api.getAzureFile(azureRepo!, commit!, file);
        return v.binary ? { file, size: 0, kind: "binary", hex: "", note: "Binary file — open it in Azure DevOps to download it." } : { file, size: 0, kind: "text", lines: v.lines };
      }
      if (entry) {
        const v = await api.local.getArchiveEntry(file, entry, { ref, staged, against, againstFile }, true);
        return v.current ?? v.previous;
      }
      return api.local.getPreview(file, { ref, staged }, true);
    },
    enabled: (!!root || isAzure) && !!file && tab === "full",
  });

  const d = diffQuery.data;
  const isBinaryDiff = !!d && !d.whole && /^Binary files? .* differ$/m.test(d.diff);
  const rows: DiffRow[] = useMemo(() => {
    if (!d) return [];
    if (d.whole) {
      if (d.whole.p.kind !== "text") return [];
      return rowsFromLines(d.whole.p.lines ?? [], d.whole.kind);
    }
    return isBinaryDiff ? [] : parseUnifiedDiff(d.diff);
  }, [d, isBinaryDiff]);
  const stats = diffStats(rows);

  const where = isAzure ? `Azure DevOps · commit ${commit!.slice(0, 8)}${from && from !== file ? ` · renamed from ${from}` : ""}` : base && ref ? `${base} → ${ref}` : ref ? `commit ${ref.slice(0, 8)}` : staged ? "staged (index)" : "working tree";

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line bg-card px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-semibold text-ink" title={entry ? `${file} › ${entry}` : file}>
              {entry ? (
                <>
                  <span className="text-muted">{file} ›</span> {entry}
                </>
              ) : (
                file
              )}
            </p>
            <p className="truncate text-xs text-muted">
              {repoName} · {where}
              {against && entry ? ` · compared with ${against.length > 12 ? against.slice(0, 8) + "…" : against}` : ""}
              {rows.length > 0 && (
                <>
                  {" · "}
                  <span className="font-mono text-ok">+{stats.added}</span> <span className="font-mono text-danger">−{stats.removed}</span>
                </>
              )}
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-line bg-paper p-0.5 text-xs font-medium">
            {(["changes", "full"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 ${tab === t ? "bg-card text-accent shadow-card" : "text-muted hover:text-ink"}`}>
                {t === "changes" ? "Changes" : "Full file"}
              </button>
            ))}
          </div>
          {tab === "changes" && rows.length > 0 && (
            <div className="inline-flex rounded-lg border border-line bg-paper p-0.5 text-xs font-medium">
              {(["unified", "split"] as const).map((l) => (
                <button key={l} onClick={() => pickLayout(l)} className={`rounded-md px-3 py-1 ${layout === l ? "bg-card text-accent shadow-card" : "text-muted hover:text-ink"}`}>
                  {l === "unified" ? "Unified" : "Side by side"}
                </button>
              ))}
            </div>
          )}
          {!(tab === "changes" && layout === "split" && rows.length > 0) && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={wrap} onChange={(e) => pickWrap(e.target.checked)} />
              Wrap long lines
            </label>
          )}
          <ThemePicker />
        </div>
      </header>

      <main className="p-4">
        {!root && !isAzure && <ErrorNote error={new Error("No local repository is open in this session.")} />}
        {tab === "changes" && (
          <>
            {diffQuery.isLoading && <Spinner label="Reading the change…" />}
            {diffQuery.isError && <ErrorNote error={diffQuery.error} />}
            {d && isBinaryDiff && (
              <div className="rounded-xl border border-line bg-card">
                <p className="px-4 py-3 text-sm text-muted">
                  Git can't show a line diff for this binary file — here's what's inside it instead.
                </p>
                <BinaryPreview source={{ file, ref, staged, against: against ?? (ref ? `${ref}^` : "HEAD") }} />
              </div>
            )}
            {d && !isBinaryDiff && d.whole && d.whole.p.kind !== "text" && (
              <div className="rounded-xl border border-line bg-card p-4 text-sm text-muted">
                {d.whole.p.kind === "image" ? <img src={d.whole.p.dataUrl} alt={entry} className="max-h-[80vh] max-w-full rounded-lg border border-line" /> : <pre className="overflow-auto font-mono text-[11px] text-ink">{d.whole.p.hex}</pre>}
              </div>
            )}
            {d && d.plain && (
              <div className="overflow-hidden rounded-xl border border-line bg-card">
                <p className="border-b border-line px-4 py-2 text-xs text-muted">{d.plain.note}</p>
                {d.plain.p.kind !== "binary" || d.plain.p.hex ? (
                  <div className="p-3">
                    <FullFile p={d.plain.p} wrap={wrap} source={{ file, ref, staged, against }} />
                  </div>
                ) : null}
              </div>
            )}
            {d && !isBinaryDiff && rows.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-line bg-card">
                {d.whole && (
                  <p className="border-b border-line px-4 py-2 text-xs text-muted">
                    {d.whole.kind === "add"
                      ? entry
                        ? "This file is new inside the archive — every line is an addition."
                        : "Whole file is new in this version — every line is an addition."
                      : "Whole file was removed — every line is a removal."}
                  </p>
                )}
                <div className="overflow-x-auto">
                  {layout === "split" ? <SplitDiffTable rows={rows} /> : <UnifiedDiffTable rows={rows} wrap={wrap} />}
                </div>
                {d.truncated && <p className="border-t border-line px-4 py-2 text-xs text-muted">Diff cut after 100,000 lines.</p>}
              </div>
            )}
            {d && !isBinaryDiff && !d.whole && !d.plain && rows.length === 0 && (
              <div className="rounded-xl border border-line bg-card p-6 text-center text-sm text-muted">
                No line changes to show{d.diff.trim() ? "" : " — the content is identical, or only line endings differ"}.
              </div>
            )}
          </>
        )}

        {tab === "full" && (
          <>
            {fullQuery.isLoading && <Spinner label="Reading the file…" />}
            {fullQuery.isError && <ErrorNote error={fullQuery.error} />}
            {fullQuery.data && <FullFile p={fullQuery.data} wrap={wrap} source={{ file, ref, staged, against }} />}
          </>
        )}
      </main>
    </div>
  );
}

function FullFile({ p, wrap, source }: { p: FilePreview; wrap: boolean; source: { file: string; ref?: string; staged?: boolean; against?: string } }) {
  if (p.kind === "zip") {
    return (
      <div className="rounded-xl border border-line bg-card">
        <BinaryPreview source={source} />
      </div>
    );
  }
  if (p.kind === "image") {
    return (
      <div className="rounded-xl border border-line bg-card p-4">
        <img src={p.dataUrl} alt={p.file} className="max-h-[85vh] max-w-full rounded-lg border border-line" />
      </div>
    );
  }
  if (p.kind === "binary") {
    return (
      <div className="rounded-xl border border-line bg-card p-4">
        <p className="mb-2 text-xs text-muted">{p.note ?? "Binary file — first bytes shown."}</p>
        <pre className="overflow-auto font-mono text-[11px] leading-relaxed text-ink">{p.hex}</pre>
      </div>
    );
  }
  const lines = p.lines ?? [];
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <p className="border-b border-line px-4 py-2 text-xs text-muted">
        {lines.length.toLocaleString()} line{lines.length === 1 ? "" : "s"}
        {p.truncated ? " shown (file is longer)" : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs leading-relaxed">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td className="w-14 select-none border-r border-line px-2 text-right align-top text-muted">{i + 1}</td>
                <td className={`px-3 text-ink ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}>{line || " "}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

