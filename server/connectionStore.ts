// Remembers the Azure DevOps connections used on this machine so the Connect
// screen can offer them back as one-click sign-ins. Local/desktop only.
//
// Organization, project and the signed-in user's name are stored as-is. The
// PAT is stored only when the user ticks "Remember token on this computer",
// and then encrypted (AES-256-GCM) with the same per-machine secret that
// protects the session cookie, in a file readable only by the current user.

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { localSessionKey } from "./cookieSession";

const DIR = path.join(os.homedir(), ".azdo-git-helper");
const FILE = path.join(DIR, "connections.json");
const MAX_ENTRIES = 12;

interface StoredConnection {
  org: string;
  project: string;
  user: string | null;
  lastUsed: string; // ISO timestamp
  token?: string; // encrypted PAT, present only when remembered
}

export interface SavedConnection {
  org: string;
  project: string;
  user: string | null;
  lastUsed: string;
  hasToken: boolean;
}

async function read(): Promise<StoredConnection[]> {
  try {
    const d = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(d.connections) ? d.connections : [];
  } catch {
    return [];
  }
}

async function write(connections: StoredConnection[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(FILE, JSON.stringify({ connections }, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.chmod(FILE, 0o600).catch(() => undefined);
}

function sameEntry(a: { org: string; project: string }, b: { org: string; project: string }): boolean {
  return a.org.toLowerCase() === b.org.toLowerCase() && a.project.toLowerCase() === b.project.toLowerCase();
}

function encryptToken(pat: string): string {
  const key = localSessionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(pat, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

function decryptToken(token: string): string | null {
  try {
    const key = localSessionKey();
    const buf = Buffer.from(token, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null; // secret rotated or file damaged — the user just signs in again
  }
}

export async function listConnections(): Promise<SavedConnection[]> {
  const all = await read();
  return all.map((c) => ({ org: c.org, project: c.project, user: c.user, lastUsed: c.lastUsed, hasToken: !!c.token }));
}

// Record a successful sign-in. `pat` is kept only when `rememberToken` is set;
// otherwise any token saved earlier for this org/project is dropped.
export async function rememberConnection(
  entry: { org: string; project: string; user: string | null },
  pat: string,
  rememberToken: boolean
): Promise<void> {
  const all = (await read()).filter((c) => !sameEntry(c, entry));
  const next: StoredConnection = { org: entry.org, project: entry.project, user: entry.user, lastUsed: new Date().toISOString() };
  if (rememberToken) next.token = encryptToken(pat);
  all.unshift(next);
  await write(all.slice(0, MAX_ENTRIES));
}

export async function savedToken(org: string, project: string): Promise<string | null> {
  const hit = (await read()).find((c) => sameEntry(c, { org, project }));
  return hit?.token ? decryptToken(hit.token) : null;
}

export async function forgetConnection(org: string, project: string): Promise<void> {
  const all = await read();
  const kept = all.filter((c) => !sameEntry(c, { org, project }));
  if (kept.length !== all.length) await write(kept);
}
