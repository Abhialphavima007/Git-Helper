// Small disk-backed settings store (~/.azdo-git-helper/settings.json).
// Holds the assistant's LLM provider + API key when not provided via env vars
// (ANTHROPIC_API_KEY / GEMINI_API_KEY). Local/desktop only — hosted deployments
// configure keys through environment variables.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".azdo-git-helper");
const FILE = path.join(DIR, "settings.json");

export type AssistantProvider = "anthropic" | "gemini";

interface Settings {
  assistantProvider?: AssistantProvider;
  anthropicApiKey?: string;
  geminiApiKey?: string;
}

async function read(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Settings;
  } catch {
    return {};
  }
}

async function write(s: Settings): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(s, null, 2), "utf8");
}

export interface AssistantCredentials {
  provider: AssistantProvider;
  key: string;
}

// Resolution order: explicit env vars first (hosted / power users), then the
// stored settings. Env: ANTHROPIC_API_KEY wins over GEMINI_API_KEY.
export async function getAssistantCredentials(): Promise<AssistantCredentials | null> {
  if (process.env.ANTHROPIC_API_KEY) return { provider: "anthropic", key: process.env.ANTHROPIC_API_KEY };
  if (process.env.GEMINI_API_KEY) return { provider: "gemini", key: process.env.GEMINI_API_KEY };
  const s = await read();
  const provider = s.assistantProvider ?? "anthropic";
  const key = provider === "gemini" ? s.geminiApiKey : s.anthropicApiKey;
  if (key) return { provider, key };
  // Fall back to whichever key exists.
  if (s.anthropicApiKey) return { provider: "anthropic", key: s.anthropicApiKey };
  if (s.geminiApiKey) return { provider: "gemini", key: s.geminiApiKey };
  return null;
}

export async function setAssistantKey(provider: AssistantProvider, key: string): Promise<void> {
  const s = await read();
  s.assistantProvider = provider;
  if (provider === "gemini") s.geminiApiKey = key;
  else s.anthropicApiKey = key;
  await write(s);
}

export async function clearAssistantKeys(): Promise<void> {
  const s = await read();
  delete s.assistantProvider;
  delete s.anthropicApiKey;
  delete s.geminiApiKey;
  await write(s);
}
