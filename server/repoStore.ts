// A small, disk-backed registry of the local repositories the user has cloned
// or opened — the equivalent of GitHub Desktop's repository list. It survives
// server restarts, so a cloned repo is always there to re-select (no re-clone).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".azdo-git-helper");
const FILE = path.join(DIR, "repos.json");

export interface AutoCommitConfig {
  enabled: boolean;
  // "schedule": commit at a chosen time of day, daily / every N days / on
  //   chosen weekdays.
  // "onChange" (dynamic): commit shortly after changes appear (checked ~5 min).
  // "interval": legacy fixed cadence (configs saved before times existed).
  mode: "interval" | "onChange" | "schedule";
  everyHours: number; // interval mode: 24 = daily, 48 = alternate days
  atTime?: string; // schedule mode: "HH:mm" local time to commit at
  everyDays?: number; // schedule mode: 1 = daily, 2 = every 2 days (used when no days list)
  days?: number[]; // schedule mode: custom weekdays, 0=Sun … 6=Sat (overrides everyDays)
  lastRun?: string; // ISO timestamp of the last successful auto-commit
  lastResult?: string; // human-readable outcome of the last attempt
}

export interface StoredRepo {
  root: string;
  name: string;
  addedAt: string;
  autoCommit?: AutoCommitConfig;
}

export interface StoreData {
  repos: StoredRepo[];
  lastOpened: string | null; // root of the most recently selected repo
}

async function read(): Promise<StoreData> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const d = JSON.parse(raw);
    return {
      repos: Array.isArray(d.repos) ? d.repos : [],
      lastOpened: typeof d.lastOpened === "string" ? d.lastOpened : null,
    };
  } catch {
    return { repos: [], lastOpened: null };
  }
}

async function write(d: StoreData): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(d, null, 2), "utf8");
}

// List known repos, pruning any whose folder has since disappeared.
export async function listRepos(): Promise<StoreData> {
  const d = await read();
  const alive: StoredRepo[] = [];
  for (const r of d.repos) {
    try {
      await fs.access(r.root);
      alive.push(r);
    } catch {
      /* folder gone — drop it */
    }
  }
  if (alive.length !== d.repos.length) {
    d.repos = alive;
    if (d.lastOpened && !alive.some((r) => r.root === d.lastOpened)) {
      d.lastOpened = alive[0]?.root ?? null;
    }
    await write(d);
  }
  return d;
}

export async function addRepo(root: string, name: string): Promise<StoreData> {
  const d = await read();
  if (!d.repos.some((r) => r.root === root)) {
    d.repos.unshift({ root, name, addedAt: new Date().toISOString() });
  }
  d.lastOpened = root;
  await write(d);
  return d;
}

export async function setLastOpened(root: string): Promise<StoredRepo | null> {
  const d = await read();
  const hit = d.repos.find((r) => r.root === root);
  if (hit) {
    d.lastOpened = root;
    await write(d);
  }
  return hit ?? null;
}

// Update a repo's auto-commit settings (or record a run result).
export async function updateAutoCommit(
  root: string,
  patch: Partial<AutoCommitConfig> | null
): Promise<StoredRepo | null> {
  const d = await read();
  const repo = d.repos.find((r) => r.root === root);
  if (!repo) return null;
  if (patch === null) {
    delete repo.autoCommit;
  } else {
    repo.autoCommit = {
      enabled: false,
      mode: "interval",
      everyHours: 24,
      ...repo.autoCommit,
      ...patch,
    };
  }
  await write(d);
  return repo;
}

export async function removeRepo(root: string): Promise<StoreData> {
  const d = await read();
  d.repos = d.repos.filter((r) => r.root !== root);
  if (d.lastOpened === root) d.lastOpened = d.repos[0]?.root ?? null;
  await write(d);
  return d;
}
