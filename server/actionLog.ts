// Per-repo history of actions Git Helper performed, each with a plain
// "how to undo" note. Stored next to the repo registry so it survives
// restarts; capped so it can't grow unbounded.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ActionEntry {
  ts: string; // ISO timestamp
  root: string; // repo the action ran in
  action: string; // short label, e.g. "Reset to remote"
  detail: string; // what exactly happened
  undo: string; // plain-language recovery route
}

const FILE = path.join(os.homedir(), ".azdo-git-helper", "actions.json");
const CAP = 300;

async function readAll(): Promise<ActionEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(parsed?.entries) ? (parsed.entries as ActionEntry[]) : [];
  } catch {
    return [];
  }
}

export async function logAction(entry: Omit<ActionEntry, "ts">): Promise<void> {
  try {
    const entries = await readAll();
    entries.unshift({ ts: new Date().toISOString(), ...entry });
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify({ entries: entries.slice(0, CAP) }, null, 2), "utf8");
  } catch {
    /* logging must never break the action itself */
  }
}

export async function listActions(root: string, limit = 50): Promise<ActionEntry[]> {
  const entries = await readAll();
  return entries.filter((e) => e.root === root).slice(0, limit);
}
