// The full-page file viewer (/local/file) and how to open it in its own window.

export interface FileDetailParams {
  file: string;
  // Azure DevOps commit (instead of the local repo): repo id + commit id, and
  // the old path for a rename.
  azureRepo?: string;
  commit?: string;
  from?: string;
  ref?: string; // commit id or branch — the version to show
  staged?: boolean; // the index copy (working tree otherwise)
  against?: string; // the version to compare with (HEAD, <sha>^, base branch)
  base?: string; // compare page: diff is base…ref instead of the commit's own diff
  entry?: string; // a file inside a zip
  againstFile?: string; // a different zip (previous export) to compare the entry with
}

export function fileDetailUrl(p: FileDetailParams): string {
  const q = new URLSearchParams({ file: p.file });
  if (p.azureRepo && p.commit) {
    q.set("repo", p.azureRepo);
    q.set("commit", p.commit);
    if (p.from) q.set("from", p.from);
    return `/azure/file?${q.toString()}`;
  }
  if (p.ref) q.set("ref", p.ref);
  if (p.staged) q.set("staged", "1");
  if (p.against) q.set("against", p.against);
  if (p.base) q.set("base", p.base);
  if (p.entry) q.set("entry", p.entry);
  if (p.againstFile) q.set("againstFile", p.againstFile);
  return `/local/file?${q.toString()}`;
}

// A separate window in the desktop app (Electron allows same-origin popups),
// a new tab in a browser.
export function openFileDetail(p: FileDetailParams): void {
  window.open(fileDetailUrl(p), "_blank", "width=1280,height=860,noopener");
}
