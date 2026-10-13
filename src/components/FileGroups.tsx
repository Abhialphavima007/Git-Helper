import type { ReactNode } from "react";
import { DiffStat } from "./ui";

// Folder grouping for file lists. A change set that touches dozens of files
// under one folder reads as "PREXAPlugins/ · 38 files" with the files one
// click away, instead of a wall of paths.

export interface FolderGroup<T> {
  folder: string; // "" = repository root
  items: T[];
  added: number;
  removed: number;
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function groupByFolder<T>(
  items: T[],
  pathOf: (item: T) => string,
  statOf?: (item: T) => { added?: number; removed?: number }
): FolderGroup<T>[] {
  const groups = new Map<string, FolderGroup<T>>();
  for (const item of items) {
    const folder = folderOf(pathOf(item));
    let g = groups.get(folder);
    if (!g) {
      g = { folder, items: [], added: 0, removed: 0 };
      groups.set(folder, g);
    }
    g.items.push(item);
    const stat = statOf ? statOf(item) : {};
    g.added += stat.added ?? 0;
    g.removed += stat.removed ?? 0;
  }
  // Root files first, then folders A→Z.
  return [...groups.values()].sort((a, b) => (a.folder === "" ? -1 : b.folder === "" ? 1 : a.folder.localeCompare(b.folder)));
}

// Case-insensitive match on the path (and anything else the caller passes).
export function matchesFilter(filter: string, ...fields: Array<string | null | undefined>): boolean {
  const term = filter.trim().toLowerCase();
  if (!term) return true;
  return fields.some((f) => !!f && f.toLowerCase().includes(term));
}

export function FolderRow({
  folder,
  count,
  added,
  removed,
  open,
  onToggle,
  children,
}: {
  folder: string;
  count: number;
  added?: number; // omit both when there are no line counts (Azure commits)
  removed?: number;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-2 bg-paper/60 px-4 py-2 text-left hover:bg-paper"
      title={open ? "Hide files in this folder" : "Show files in this folder"}
    >
      <span className="text-muted">{open ? "▾" : "▸"}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted" aria-hidden>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
      <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink">{folder}/</span>
      <span className="shrink-0 text-xs text-muted">
        {count} file{count === 1 ? "" : "s"}
      </span>
      {added !== undefined && removed !== undefined && <DiffStat added={added} removed={removed} />}
      {children}
    </button>
  );
}
