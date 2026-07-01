// In-memory registry of clone operations. A clone can take a while, so the
// route starts it, returns a job id immediately, and the UI polls for progress.

import { promises as fs } from "node:fs";
import path from "node:path";
import { runGitStream } from "./git";

export interface CloneJob {
  id: string;
  repoName: string;
  status: "cloning" | "done" | "error";
  phase: string;
  percent: number; // 0–100, best-effort from git's progress output
  message: string;
  dest: string;
  error?: string;
}

const jobs = new Map<string, CloneJob>();
let counter = 0;

export function getJob(id: string): CloneJob | undefined {
  return jobs.get(id);
}

// git emits lines like "Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s".
function parseProgress(job: CloneJob, line: string): void {
  const m = /^(remote: )?([A-Za-z][A-Za-z ]+?):\s+(\d+)%/.exec(line);
  if (m) {
    job.phase = m[2].trim();
    job.percent = Number(m[3]);
  }
  job.message = line.replace(/^remote:\s*/, "");
}

export async function startClone(opts: {
  url: string;
  authArgs: string[];
  parentDir: string;
  repoName: string;
}): Promise<CloneJob> {
  const parent = path.resolve(opts.parentDir.trim());
  await fs.mkdir(parent, { recursive: true });

  const dest = path.join(parent, opts.repoName);

  // Refuse to clone onto an existing non-empty folder.
  try {
    const entries = await fs.readdir(dest);
    if (entries.length > 0) {
      throw new Error(`A non-empty folder already exists at ${dest}. Choose another location or remove it first.`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const id = `clone_${++counter}_${Date.now()}`;
  const job: CloneJob = {
    id,
    repoName: opts.repoName,
    status: "cloning",
    phase: "Starting",
    percent: 0,
    message: "Preparing to clone…",
    dest,
  };
  jobs.set(id, job);

  const args = [...opts.authArgs, "clone", "--progress", opts.url, dest];

  // Fire and forget; the UI polls getJob(id).
  runGitStream(parent, args, (line) => parseProgress(job, line))
    .then(() => {
      job.status = "done";
      job.phase = "Done";
      job.percent = 100;
      job.message = "Clone complete.";
    })
    .catch((err) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : "Clone failed.";
      job.message = job.error;
    });

  return job;
}
