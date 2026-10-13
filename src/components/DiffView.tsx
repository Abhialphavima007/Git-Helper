import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocalRepo } from "../context/LocalRepoContext";
import { api, type ArchiveEntryStatus, type ArchiveOverview, type FilePreview } from "../api/client";
import { ErrorNote, SearchInput, Spinner } from "./ui";
import { folderOf } from "./FileGroups";
import { openFileDetail, type FileDetailParams } from "../lib/fileDetail";

// "Open in a window" — the full-page viewer with line numbers, red/green
// areas and side-by-side, for when the inline diff is too small to read.
export function OpenInWindowButton({ target, label = "Open in window" }: { target: FileDetailParams; label?: string }) {
  return (
    <button
      onClick={() => openFileDetail(target)}
      title="Open the full-page viewer in its own window"
      className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-paper"
    >
      {label} ↗
    </button>
  );
}

// Which version of the file a preview should show, and what to compare it to.
export interface PreviewSource {
  file: string;
  ref?: string; // a commit id — the file as of that commit
  staged?: boolean; // the index copy (otherwise the working tree)
  against?: string; // the previous version (HEAD, <sha>^, a base branch) for "what changed inside"
}

// Renders a unified diff for one file with line coloring. Fetches lazily so
// the diff is only requested when a row is expanded.
export function DiffView({ file, staged }: { file: string; staged: boolean }) {
  const { root } = useLocalRepo();
  const query = useQuery({
    queryKey: ["local-diff", root, file, staged],
    queryFn: () => api.local.getDiff(file, staged),
  });

  if (query.isLoading) return <div className="p-3"><Spinner /></div>;
  if (query.isError) return <div className="p-3"><ErrorNote error={query.error} /></div>;

  return (
    <div>
      <div className="mb-1 flex justify-end">
        <OpenInWindowButton target={{ file, staged, against: "HEAD" }} />
      </div>
      <DiffLines diff={query.data?.diff ?? ""} preview={{ file, staged, against: "HEAD" }} />
    </div>
  );
}

// Presentational unified-diff renderer with red/green line coloring. With a
// `preview` source, binary files get a "Preview file" option.
export function DiffLines({ diff, preview }: { diff: string; preview?: PreviewSource }) {
  if (!diff.trim()) {
    return <p className="p-3 text-xs text-muted">No textual diff — this may be a binary or empty change.</p>;
  }
  const lines = diff.split("\n");
  // Binary content (zips, dlls, images): git only says that the bytes differ,
  // so say that plainly instead of printing the diff header.
  const binary = lines.find((l) => /^Binary files? .* differ$/.test(l) || l === "GIT binary patch" || /^Binary file \(/.test(l));
  if (binary) {
    const deleted = lines.some((l) => l.startsWith("deleted file mode"));
    const mode = lines.some((l) => l.startsWith("new file mode")) ? "New binary file" : deleted ? "Deleted binary file" : "Binary file changed";
    return <BinaryNote mode={mode} preview={preview && deleted && !preview.ref ? { ...preview, ref: "HEAD" } : preview} />;
  }
  return <DiffPre lines={lines} />;
}

function DiffPre({ lines }: { lines: string[] }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-ink/[0.03] p-3 font-mono text-xs leading-relaxed">
      {lines.map((line, i) => {
        let cls = "text-ink";
        if (line.startsWith("@@")) cls = "text-accent";
        else if (line.startsWith("+") && !line.startsWith("+++")) cls = "bg-ok-bg text-ok";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "bg-danger-bg text-danger";
        else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---"))
          cls = "text-muted";
        return (
          <div key={i} className={`px-1 ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function BinaryNote({ mode, preview }: { mode: string; preview?: PreviewSource }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg bg-ink/[0.03]">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-xs text-muted">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0" aria-hidden>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="font-medium text-ink">{mode}</span> — no text diff.
          {preview ? " You can still look inside it." : " Git tracks it, but there's nothing readable to show."}
        </span>
        {preview && (
          <>
            <button
              onClick={() => setOpen((v) => !v)}
              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-card"
            >
              {open ? "Hide preview" : "Preview file"}
            </button>
            <OpenInWindowButton target={{ file: preview.file, ref: preview.ref, staged: preview.staged, against: preview.against }} />
          </>
        )}
      </div>
      {open && preview && <BinaryPreview source={preview} />}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The preview itself: image, zip (its own explorer), text, or a hex view.
// Fetched only when opened.
export function BinaryPreview({ source }: { source: PreviewSource }) {
  const { root } = useLocalRepo();
  const query = useQuery({
    queryKey: ["local-preview", root, source.file, source.ref ?? "", !!source.staged],
    queryFn: () => api.local.getPreview(source.file, { ref: source.ref, staged: source.staged }),
  });

  if (query.isLoading) return <div className="p-3"><Spinner label="Reading file…" /></div>;
  if (query.isError) return <div className="p-3"><ErrorNote error={query.error} /></div>;
  const p = query.data as FilePreview;

  if (p.kind === "zip") return <ArchivePreview source={source} />;

  return (
    <div className="border-t border-line p-3">
      <p className="text-xs text-muted">
        {formatBytes(p.size)}
        {p.note ? ` · ${p.note}` : ""}
      </p>
      <PreviewBody p={p} />
    </div>
  );
}

// Image / text / hex rendering shared by whole-file and inside-zip previews.
function PreviewBody({ p }: { p: FilePreview }) {
  if (p.kind === "image") {
    return <img src={p.dataUrl} alt={p.file} className="mt-2 max-h-96 max-w-full rounded-lg border border-line bg-card object-contain" />;
  }
  if (p.kind === "text") {
    return (
      <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-line bg-card p-3 font-mono text-xs leading-relaxed text-ink">
        {(p.lines ?? []).join("\n")}
        {p.truncated ? "\n… (more lines not shown)" : ""}
      </pre>
    );
  }
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-line bg-card p-3 font-mono text-[11px] leading-relaxed text-ink">{p.hex}</pre>
  );
}

// ---- zip explorer: folders, per-file status against the previous version,
// and a click-through to each file's content or line diff ----

const STATUS_LABEL: Record<ArchiveEntryStatus, { text: string; cls: string } | null> = {
  added: { text: "Added", cls: "bg-ok-bg text-ok" },
  modified: { text: "Changed", cls: "bg-warn-bg text-warn" },
  removed: { text: "Removed", cls: "bg-danger-bg text-danger" },
  same: null,
};

function StatusPillSmall({ status }: { status: ArchiveEntryStatus }) {
  const s = STATUS_LABEL[status];
  if (!s) return null;
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.cls}`}>{s.text}</span>;
}

function ArchivePreview({ source }: { source: PreviewSource }) {
  const { root } = useLocalRepo();
  const [filter, setFilter] = useState("");
  const [onlyChanges, setOnlyChanges] = useState<boolean | null>(null); // null = decide from the data
  const [openFolders, setOpenFolders] = useState<Set<string> | null>(null); // null = default (changed folders open)
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  // Which archive to compare with: "" = let the server pick (same path, else
  // the previous export of the same solution); "none" = no comparison.
  const [againstFile, setAgainstFile] = useState("");

  const against = againstFile === "none" ? undefined : source.against;
  const entrySource = { ref: source.ref, staged: source.staged, against, againstFile: againstFile && againstFile !== "none" ? againstFile : undefined };
  const query = useQuery({
    queryKey: ["local-archive", root, source.file, source.ref ?? "", !!source.staged, against ?? "", entrySource.againstFile ?? ""],
    queryFn: () => api.local.getArchive(source.file, entrySource),
  });

  const a = query.data;
  const totalChanged = a ? a.changed.added + a.changed.removed + a.changed.modified : 0;
  const showOnlyChanges = onlyChanges ?? (!!a?.previous && totalChanged > 0);

  const groups = useMemo(() => {
    if (!a) return [];
    const term = filter.trim().toLowerCase();
    const list = a.entries.filter((e) => (!showOnlyChanges || e.status !== "same") && (!term || e.path.toLowerCase().includes(term)));
    const map = new Map<string, { folder: string; items: typeof list; changed: number }>();
    for (const e of list) {
      const folder = folderOf(e.path);
      let g = map.get(folder);
      if (!g) {
        g = { folder, items: [], changed: 0 };
        map.set(folder, g);
      }
      g.items.push(e);
      if (e.status !== "same") g.changed++;
    }
    return [...map.values()].sort((x, y) => (x.folder === "" ? -1 : y.folder === "" ? 1 : x.folder.localeCompare(y.folder)));
  }, [a, filter, showOnlyChanges]);

  if (query.isLoading) return <div className="p-3"><Spinner label="Opening archive…" /></div>;
  if (query.isError || !a) return <div className="p-3"><ErrorNote error={query.error} /></div>;

  const searching = filter.trim().length > 0;
  const isOpen = (folder: string) =>
    folder === "" || searching || showOnlyChanges || (openFolders ? openFolders.has(folder) : false);
  const toggleFolder = (folder: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  const sol = a.solution;
  const prevSol = a.previous?.solution;

  return (
    <div className="border-t border-line p-3">
      <p className="text-xs text-muted">
        {formatBytes(a.size)} · {a.entryCount} file{a.entryCount === 1 ? "" : "s"} inside
        {a.previous
          ? totalChanged === 0
            ? " · nothing changed inside since the previous version"
            : ` · since the previous version: ${[
                a.changed.modified && `${a.changed.modified} changed`,
                a.changed.added && `${a.changed.added} added`,
                a.changed.removed && `${a.changed.removed} removed`,
              ]
                .filter(Boolean)
                .join(", ")}`
          : source.against && against
            ? " · no previous version found to compare against"
            : " · not compared with a previous version"}
      </p>
      {source.against && (a.previous || a.candidates.length > 0) && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Compared with</span>
          <select
            value={againstFile || (a.previous ? a.previous.path : "none")}
            onChange={(e) => setAgainstFile(e.target.value === source.file ? "" : e.target.value)}
            className="max-w-full rounded-md border border-line bg-card px-2 py-1 font-mono text-[11px] text-ink focus-visible:border-accent"
            title="Choose which earlier archive to compare this one with"
          >
            {a.previous && a.previous.path === source.file && <option value={source.file}>{source.file} (previous version)</option>}
            {a.candidates.map((c) => (
              <option key={c} value={c}>
                {c}
                {a.previous?.path === c && a.previous.auto ? " (previous export of this solution)" : ""}
              </option>
            ))}
            <option value="none">— don't compare —</option>
          </select>
          {a.previous && a.previous.path !== source.file && a.previous.auto && (
            <span>· picked because it has the same solution name</span>
          )}
        </p>
      )}

      {sol && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-card px-3 py-2 text-xs">
          <dt className="text-muted">Solution</dt>
          <dd className="font-medium text-ink">
            {sol.displayName ?? sol.uniqueName ?? "—"}
            {sol.displayName && sol.uniqueName && <span className="ml-2 font-mono text-muted">{sol.uniqueName}</span>}
          </dd>
          <dt className="text-muted">Version</dt>
          <dd className="font-mono text-ink">
            {sol.version ?? "—"}
            {prevSol?.version && prevSol.version !== sol.version && <span className="ml-2 text-muted">was {prevSol.version}</span>}
          </dd>
          <dt className="text-muted">Publisher</dt>
          <dd className="text-ink">{sol.publisher ?? "—"}</dd>
          <dt className="text-muted">Type</dt>
          <dd className="text-ink">{sol.managed === null ? "—" : sol.managed ? "Managed" : "Unmanaged"}</dd>
        </dl>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <SearchInput value={filter} onChange={setFilter} placeholder="Find a file inside…" className="w-full sm:w-64" />
        {a.previous && totalChanged > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={showOnlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
            Only what changed
          </label>
        )}
        {!showOnlyChanges && !searching && groups.some((g) => g.folder !== "") && (
          <button
            onClick={() => setOpenFolders(groups.every((g) => isOpen(g.folder)) ? new Set() : new Set(groups.map((g) => g.folder)))}
            className="text-xs font-medium text-accent hover:text-accent-hover"
          >
            {groups.every((g) => isOpen(g.folder)) ? "Collapse folders" : "Expand all folders"}
          </button>
        )}
      </div>

      <div className="mt-2 max-h-[28rem] overflow-auto rounded-lg border border-line bg-card">
        {groups.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted">{searching ? "No file inside matches." : "Nothing to show."}</p>
        )}
        {groups.map((g) => (
          <div key={g.folder || "(root)"} className="border-b border-line last:border-b-0">
            {g.folder !== "" && (
              <button
                onClick={() => toggleFolder(g.folder)}
                className="flex w-full items-center gap-2 bg-paper/60 px-3 py-1.5 text-left text-xs hover:bg-paper"
              >
                <span className="text-muted">{isOpen(g.folder) ? "▾" : "▸"}</span>
                <span className="min-w-0 flex-1 truncate font-mono font-semibold text-ink">{g.folder}/</span>
                <span className="shrink-0 text-muted">
                  {g.items.length} file{g.items.length === 1 ? "" : "s"}
                  {g.changed > 0 && !showOnlyChanges ? ` · ${g.changed} changed` : ""}
                </span>
              </button>
            )}
            {isOpen(g.folder) &&
              g.items.map((e) => {
                const open = openEntry === e.path;
                return (
                  <div key={e.path} className={g.folder ? "border-t border-line" : ""}>
                    <button
                      onClick={() => setOpenEntry(open ? null : e.path)}
                      className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-xs hover:bg-paper ${g.folder ? "pl-8" : "pl-3"} ${open ? "bg-accent/5" : ""}`}
                      title={e.path}
                    >
                      <span className={`min-w-0 flex-1 truncate font-mono ${e.status === "removed" ? "text-muted line-through" : "text-ink"}`}>
                        {g.folder ? e.path.slice(g.folder.length + 1) : e.path}
                      </span>
                      <StatusPillSmall status={e.status} />
                      <span className="shrink-0 text-muted">{formatBytes(e.size)}</span>
                      <span className="shrink-0 text-muted">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div className="border-t border-line bg-paper/40 px-3 pb-3">
                        <ArchiveEntryBody source={{ ...source, ...entrySource }} entry={e.path} />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      {a.truncated && <p className="mt-1 text-xs text-muted">Showing the first 2,000 entries.</p>}
    </div>
  );
}

// One file inside the zip: the line diff when it changed (with a switch to
// the full file), otherwise its content.
function ArchiveEntryBody({ source, entry }: { source: PreviewSource & { againstFile?: string }; entry: string }) {
  const { root } = useLocalRepo();
  const [showFull, setShowFull] = useState(false);
  const query = useQuery({
    queryKey: ["local-archive-entry", root, source.file, entry, source.ref ?? "", !!source.staged, source.against ?? "", source.againstFile ?? ""],
    queryFn: () => api.local.getArchiveEntry(source.file, entry, { ref: source.ref, staged: source.staged, against: source.against, againstFile: source.againstFile }),
  });

  if (query.isLoading) return <div className="pt-3"><Spinner label="Reading file inside the archive…" /></div>;
  if (query.isError || !query.data) return <div className="pt-3"><ErrorNote error={query.error} /></div>;
  const v = query.data;

  if (v.status === "removed") {
    return (
      <div className="pt-3">
        <p className="text-xs text-muted">This file was in the previous version of the archive and is gone now. Showing the old content.</p>
        {v.previous ? <PreviewBody p={v.previous} /> : <p className="mt-2 text-xs text-muted">Couldn't read the old content.</p>}
      </div>
    );
  }
  if (!v.current) return <p className="pt-3 text-xs text-muted">Couldn't read this file inside the archive.</p>;

  const hasDiff = v.diff !== undefined;
  return (
    <div className="pt-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>
          {formatBytes(v.current.size)}
          {v.status === "modified" && !hasDiff ? ` · changed — ${v.noDiffReason ?? "no line diff"}` : ""}
          {v.status === "added" ? " · new in this version" : ""}
          {v.status === "same" && source.against ? " · unchanged" : ""}
        </span>
        {hasDiff && (
          <button onClick={() => setShowFull((s) => !s)} className="font-medium text-accent hover:text-accent-hover">
            {showFull ? "Show what changed" : "Show full file"}
          </button>
        )}
        <span className="ml-auto">
          <OpenInWindowButton target={{ file: source.file, ref: source.ref, staged: source.staged, against: source.against, againstFile: source.againstFile, entry }} />
        </span>
      </div>
      {hasDiff && !showFull ? (
        v.diff!.trim() ? (
          <div className="mt-2">
            <DiffPre lines={v.diff!.split("\n")} />
            {v.diffTruncated && <p className="mt-1 text-xs text-muted">Diff cut after 5,000 lines.</p>}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">Only line endings or whitespace differ.</p>
        )
      ) : (
        <PreviewBody p={v.current} />
      )}
    </div>
  );
}
