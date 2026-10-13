// On-demand previews for files git can't diff as text: images render as-is,
// zip archives (including Dynamics managed-solution zips) list what's inside,
// and anything else gets a hex view of its first bytes.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { runGit, runGitRaw, GitError } from "./git";
import { pathInRepo } from "./localGit";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024; // one entry may inflate to this much, no more (zip bombs)
const MAX_TEXT_LINES = 200; // inline preview
const MAX_TEXT_LINES_FULL = 50_000; // the full-page viewer
const HEX_BYTES = 512;

export interface ZipEntry {
  path: string;
  size: number;
  compressed: number;
}

export type EntryStatus = "added" | "removed" | "modified" | "same";

export interface ArchiveEntry extends ZipEntry {
  status: EntryStatus; // relative to the previous version of the archive
}

export interface ArchiveOverview {
  file: string;
  size: number;
  entries: ArchiveEntry[];
  entryCount: number;
  truncated: boolean;
  solution: SolutionInfo | null;
  // The version compared against (null when there is none, e.g. a new file or
  // the first commit) and what it looked like. `path` differs from `file` when
  // the previous export had another name (version in the file name) and was
  // matched by solution; `auto` says it was picked, not chosen by the user.
  previous: { path: string; auto: boolean; size: number; solution: SolutionInfo | null } | null;
  // Other zips in the same folder at the compared ref — offered as alternatives.
  candidates: string[];
  changed: { added: number; removed: number; modified: number };
}

export interface ArchiveEntryView {
  entry: string;
  status: EntryStatus;
  current: FilePreview | null; // null when the entry was removed
  previous: FilePreview | null; // the old version, for removed entries
  diff?: string; // unified diff for a modified text entry
  diffTruncated?: boolean;
  // Why a changed entry has no line diff ("binary", "unsupported compression").
  noDiffReason?: string;
}

export interface SolutionInfo {
  uniqueName: string | null;
  displayName: string | null;
  version: string | null;
  publisher: string | null;
  managed: boolean | null;
}

export interface FilePreview {
  file: string;
  size: number;
  kind: "image" | "zip" | "text" | "binary";
  mime?: string;
  dataUrl?: string; // image
  entries?: ZipEntry[]; // zip
  entryCount?: number;
  solution?: SolutionInfo | null; // zip that is a Dynamics solution
  lines?: string[]; // text
  truncated?: boolean;
  hex?: string; // binary
  note?: string;
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

// Where the bytes come from: a commit (ref:path), the index, or the work tree
// (falling back to HEAD for a file that was deleted locally).
export async function readFileBytes(
  root: string,
  file: string,
  source: { ref?: string; staged?: boolean }
): Promise<Buffer> {
  if (file.startsWith("-")) throw new GitError(`That isn't a valid path: ${file}`, null, "");
  if (source.ref) {
    if (source.ref.startsWith("-")) throw new GitError(`That isn't a valid ref: ${source.ref}`, null, "");
    return runGitRaw(root, ["show", `${source.ref}:${file}`]);
  }
  if (source.staged) {
    return runGitRaw(root, ["show", `:${file}`]);
  }
  try {
    return await fs.readFile(pathInRepo(root, file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return runGitRaw(root, ["show", `HEAD:${file}`]);
  }
}

export async function previewFile(
  root: string,
  file: string,
  source: { ref?: string; staged?: boolean },
  full = false
): Promise<FilePreview> {
  const buf = await readFileBytes(root, file, source);
  return describeBytes(buf, file, full);
}

// What a blob is and how to show it: image, zip listing, text, or hex.
// `full` lifts the inline line cap for the full-page viewer.
export function describeBytes(buf: Buffer, file: string, full = false): FilePreview {
  const maxLines = full ? MAX_TEXT_LINES_FULL : MAX_TEXT_LINES;
  const size = buf.length;
  const ext = path.extname(file).toLowerCase();

  if (IMAGE_MIME[ext]) {
    if (size > MAX_IMAGE_BYTES) {
      return { file, size, kind: "binary", hex: hexDump(buf), note: "Image is too large to preview here (over 10 MB)." };
    }
    return { file, size, kind: "image", mime: IMAGE_MIME[ext], dataUrl: `data:${IMAGE_MIME[ext]};base64,${buf.toString("base64")}` };
  }

  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    if (size > MAX_ARCHIVE_BYTES) {
      return { file, size, kind: "binary", hex: hexDump(buf), note: "Archive is too large to list here (over 200 MB)." };
    }
    const entries = listZip(buf);
    const solution = entries ? readSolutionInfo(buf, entries) : null;
    if (entries) {
      return { file, size, kind: "zip", entries: entries.slice(0, 2000), entryCount: entries.length, solution, truncated: entries.length > 2000 };
    }
  }

  if (!buf.subarray(0, 8000).includes(0)) {
    const all = buf.toString("utf8").split(/\r\n|\r|\n/);
    return { file, size, kind: "text", lines: all.slice(0, maxLines), truncated: all.length > maxLines };
  }

  return { file, size, kind: "binary", hex: hexDump(buf) };
}

function hexDump(buf: Buffer): string {
  const rows: string[] = [];
  const end = Math.min(buf.length, HEX_BYTES);
  for (let off = 0; off < end; off += 16) {
    const chunk = buf.subarray(off, Math.min(off + 16, end));
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...chunk].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    rows.push(`${off.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (buf.length > HEX_BYTES) rows.push(`… ${(buf.length - HEX_BYTES).toLocaleString()} more bytes`);
  return rows.join("\n");
}

// ---- zip central directory (enough to list entries and inflate one) ----

interface ZipRecord extends ZipEntry {
  method: number;
  crc: number;
  localHeaderOffset: number;
}

function listZip(buf: Buffer): ZipRecord[] | null {
  // End-of-central-directory record sits in the last 64 KB (comment can follow it).
  const start = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipRecord[] = [];
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (!name.endsWith("/")) out.push({ path: name, size, compressed, method, crc, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function inflateEntry(buf: Buffer, rec: ZipRecord): Buffer | null {
  const h = rec.localHeaderOffset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(h + 26);
  const extraLen = buf.readUInt16LE(h + 28);
  const dataStart = h + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + rec.compressed);
  if (rec.size > MAX_ENTRY_BYTES) return null;
  try {
    if (rec.method === 0) return Buffer.from(data);
    if (rec.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
  } catch {
    /* damaged entry, or it inflates past the cap */
  }
  return null;
}

// Dynamics 365 solution zips carry solution.xml at the root — surface the
// bits people actually look for before importing one.
function readSolutionInfo(buf: Buffer, entries: ZipRecord[]): SolutionInfo | null {
  const rec = entries.find((e) => e.path.toLowerCase() === "solution.xml");
  if (!rec || rec.size > 5 * 1024 * 1024) return null;
  const xml = inflateEntry(buf, rec)?.toString("utf8");
  if (!xml) return null;
  const tag = (name: string) => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(xml);
    return m ? m[1].trim() : null;
  };
  const localized = /<LocalizedName[^>]*description="([^"]*)"/i.exec(xml);
  const publisher = /<Publisher>[\s\S]*?<UniqueName>([^<]*)<\/UniqueName>/i.exec(xml);
  const managed = tag("Managed");
  return {
    uniqueName: tag("UniqueName"),
    displayName: localized ? localized[1] : null,
    version: tag("Version"),
    publisher: publisher ? publisher[1].trim() : null,
    managed: managed === null ? null : managed === "1",
  };
}


// ---- archive overview and single-entry views ----

const MAX_DIFF_LINES = 5000;
const MAX_DIFF_LINES_FULL = 100_000;

async function readArchive(root: string, file: string, source: { ref?: string; staged?: boolean }): Promise<{ buf: Buffer; entries: ZipRecord[] } | null> {
  let buf: Buffer;
  try {
    buf = await readFileBytes(root, file, source);
  } catch (e) {
    if (e instanceof GitError) return null; // no such version (new file / first commit)
    throw e;
  }
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50 || buf.length > MAX_ARCHIVE_BYTES) return null;
  const entries = listZip(buf);
  return entries ? { buf, entries } : null;
}

type Loaded = { buf: Buffer; entries: ZipRecord[] };

// Zips sitting next to `file` in the tree at `ref` (what a release folder
// holds: this export and the ones before it).
async function siblingZips(root: string, ref: string, file: string): Promise<string[]> {
  const folder = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  let raw = "";
  try {
    raw = await runGit(root, ["ls-tree", "-r", "--name-only", "-z", ref, "--", folder ? folder + "/" : "."]);
  } catch {
    return [];
  }
  return raw
    .split("\0")
    .filter((p) => p && p !== file && /\.zip$/i.test(p) && (folder ? p.startsWith(folder + "/") && !p.slice(folder.length + 1).includes("/") : !p.includes("/")));
}

// "1.DealCore_2_0_0_18_managed.zip" → "dealcore": the name without the
// ordering prefix, version digits, managed/unmanaged and separators.
function solutionNameKey(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.zip$/i, "");
  return base
    .replace(/^\d+[.\-_ ]+/, "")
    .replace(/_?(managed|unmanaged)$/i, "")
    .replace(/[\d._\- ]+/g, "")
    .toLowerCase();
}

function versionParts(v: string | null | undefined): number[] {
  return (v ?? "0").split(".").map((n) => Number(n) || 0);
}

function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// The archive to compare with: the user's explicit pick, else the same path
// at `against`, else — for exports whose name carries the version — the
// newest zip in the same folder that is the same solution (unique name), or
// failing that the same name once version digits are ignored.
async function findPreviousArchive(
  root: string,
  file: string,
  cur: Loaded,
  against: string,
  explicitPath: string | null
): Promise<{ loaded: Loaded; path: string; auto: boolean } | null> {
  if (explicitPath) {
    const loaded = await readArchive(root, explicitPath, { ref: against });
    return loaded ? { loaded, path: explicitPath, auto: false } : null;
  }
  const same = await readArchive(root, file, { ref: against });
  if (same) return { loaded: same, path: file, auto: false };

  const curSol = readSolutionInfo(cur.buf, cur.entries);
  const nameKey = solutionNameKey(file);
  const byName: Array<{ loaded: Loaded; path: string }> = [];
  const bySolution: Array<{ loaded: Loaded; path: string; version: string | null }> = [];
  for (const candidate of (await siblingZips(root, against, file)).slice(0, 15)) {
    const loaded = await readArchive(root, candidate, { ref: against });
    if (!loaded) continue;
    const sol = readSolutionInfo(loaded.buf, loaded.entries);
    if (curSol?.uniqueName && sol?.uniqueName && sol.uniqueName.toLowerCase() === curSol.uniqueName.toLowerCase()) {
      bySolution.push({ loaded, path: candidate, version: sol.version });
    } else if (nameKey && solutionNameKey(candidate) === nameKey) {
      byName.push({ loaded, path: candidate });
    }
  }
  if (bySolution.length) {
    // Several older exports kept around: compare with the newest one that is
    // still older than (or equal to) this version.
    const older = bySolution.filter((c) => compareVersions(c.version, curSol?.version) <= 0);
    const pool = older.length ? older : bySolution;
    pool.sort((a, b) => compareVersions(b.version, a.version));
    return { loaded: pool[0].loaded, path: pool[0].path, auto: true };
  }
  if (byName.length) return { loaded: byName[0].loaded, path: byName[0].path, auto: true };
  return null;
}

// Entries of the archive, each marked against the previous version
// (`against` is a ref such as HEAD, <sha>^ or a branch name; `againstFile`
// a different archive to compare with, chosen by the user).
export async function archiveOverview(
  root: string,
  file: string,
  source: { ref?: string; staged?: boolean },
  against: string | null,
  againstFile: string | null = null
): Promise<ArchiveOverview> {
  const cur = await readArchive(root, file, source);
  if (!cur) throw new GitError(`That file isn't a zip archive: ${file}`, null, "");
  const previous = against ? await findPreviousArchive(root, file, cur, against, againstFile) : null;
  const prev = previous?.loaded ?? null;
  const prevByPath = new Map((prev?.entries ?? []).map((e) => [e.path, e] as const));

  const entries: ArchiveEntry[] = [];
  const changed = { added: 0, removed: 0, modified: 0 };
  for (const e of cur.entries) {
    const old = prevByPath.get(e.path);
    let status: EntryStatus = "same";
    if (!prev) status = "same";
    else if (!old) status = "added";
    else if (old.crc !== e.crc || old.size !== e.size) status = "modified";
    if (status === "added") changed.added++;
    if (status === "modified") changed.modified++;
    entries.push({ path: e.path, size: e.size, compressed: e.compressed, status });
    prevByPath.delete(e.path);
  }
  for (const old of prevByPath.values()) {
    changed.removed++;
    entries.push({ path: old.path, size: old.size, compressed: old.compressed, status: "removed" });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    file,
    size: cur.buf.length,
    entries: entries.slice(0, 2000),
    entryCount: entries.length,
    truncated: entries.length > 2000,
    solution: readSolutionInfo(cur.buf, cur.entries),
    previous: previous ? { path: previous.path, auto: previous.auto, size: previous.loaded.buf.length, solution: readSolutionInfo(previous.loaded.buf, previous.loaded.entries) } : null,
    candidates: against ? await siblingZips(root, against, file) : [],
    changed,
  };
}

// One file inside the archive: its content, and for a changed text entry the
// line diff against the previous version (git computes it on two temp files).
export async function archiveEntry(
  root: string,
  file: string,
  entry: string,
  source: { ref?: string; staged?: boolean },
  against: string | null,
  full = false,
  againstFile: string | null = null
): Promise<ArchiveEntryView> {
  const cur = await readArchive(root, file, source);
  if (!cur) throw new GitError(`That file isn't a zip archive: ${file}`, null, "");
  const prev = against ? (await findPreviousArchive(root, file, cur, against, againstFile))?.loaded ?? null : null;
  const curRec = cur.entries.find((e) => e.path === entry);
  const prevRec = prev?.entries.find((e) => e.path === entry);
  if (!curRec && !prevRec) throw new GitError(`No such file inside the archive: ${entry}`, null, "");

  const curBytes = curRec ? inflateEntry(cur.buf, curRec) : null;
  const prevBytes = prevRec && prev ? inflateEntry(prev.buf, prevRec) : null;
  const status: EntryStatus = !curRec ? "removed" : !prev ? "same" : !prevRec ? "added" : prevRec.crc !== curRec.crc || prevRec.size !== curRec.size ? "modified" : "same";

  const view: ArchiveEntryView = {
    entry,
    status,
    current: curBytes ? describeBytes(curBytes, entry, full) : null,
    previous: status === "removed" && prevBytes ? describeBytes(prevBytes, entry, full) : null,
  };

  if (status === "modified" && view.current?.kind !== "text") {
    view.noDiffReason = !curBytes || !prevBytes ? "This entry uses a compression method that can't be unpacked here, so there is no line diff." : "Binary content — no line diff.";
  }
  if (status === "modified" && curBytes && prevBytes && view.current?.kind === "text") {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "githelper-zipdiff-"));
    const a = path.join(dir, "a");
    const b = path.join(dir, "b");
    try {
      await fs.writeFile(a, prevBytes);
      await fs.writeFile(b, curBytes);
      const raw = await runGit(dir, ["diff", "--no-index", "--no-color", "--", "a", "b"], { okExitCodes: [1], timeout: 60_000 });
      const lines = raw.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l));
      const cap = full ? MAX_DIFF_LINES_FULL : MAX_DIFF_LINES;
      view.diff = lines.slice(0, cap).join("\n");
      view.diffTruncated = lines.length > cap;
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return view;
}

