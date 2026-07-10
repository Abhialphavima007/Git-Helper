// Small disk-backed settings store (~/.azdo-git-helper/settings.json).
// Currently holds the Anthropic API key for the assistant when it isn't
// provided via the ANTHROPIC_API_KEY environment variable. Local/desktop only —
// hosted deployments configure the key through environment variables.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".azdo-git-helper");
const FILE = path.join(DIR, "settings.json");

interface Settings {
  anthropicApiKey?: string;
}

async function read(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export async function getAssistantApiKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const s = await read();
  return s.anthropicApiKey || null;
}

export async function setAssistantApiKey(key: string): Promise<void> {
  const s = await read();
  s.anthropicApiKey = key;
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(s, null, 2), "utf8");
}

export async function clearAssistantApiKey(): Promise<void> {
  const s = await read();
  delete s.anthropicApiKey;
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(s, null, 2), "utf8");
}
