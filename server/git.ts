// Thin wrapper around the local `git` CLI. Mirrors the shape of azdo.ts:
// a single runner + a typed error, so route handlers stay small and the
// privileged thing (here, a filesystem path instead of a PAT) lives only
// in the server-side session.

import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

// Bound git output so a pathological repo can't exhaust memory.
const MAX_BUFFER = 16 * 1024 * 1024; // 16 MB
const GIT_TIMEOUT = 20_000; // ms

// Never let git block on an interactive credential prompt — fail fast instead.
// (Network ops supply auth via `-c http.extraheader=...`.)
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

export class GitError extends Error {
  code: number | null;
  stderr: string;
  constructor(message: string, code: number | null, stderr: string) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.stderr = stderr;
  }
}

// Run a git command inside `cwd` and resolve with stdout.
// Non-zero exit codes become a GitError carrying the real stderr.
// Network operations (fetch/pull/push) should pass a larger timeout.
export function runGit(cwd: string, args: string[], opts: { timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: opts.timeout ?? GIT_TIMEOUT, maxBuffer: MAX_BUFFER, windowsHide: true, env: GIT_ENV },
      (err, stdout, stderr) => {
        if (err) {
          // ENOENT means git isn't installed / not on PATH.
          const noGit = (err as NodeJS.ErrnoException).code === "ENOENT";
          const message = noGit
            ? "Git is not installed or not on the PATH for this server."
            : (stderr || err.message || "git command failed").trim();
          const code = typeof (err as { code?: unknown }).code === "number" ? (err.code as number) : null;
          reject(new GitError(message, code, stderr || ""));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// Resolve, validate, and normalise a user-supplied folder into the root of a
// git work tree. Throws a GitError with a friendly message otherwise.
export async function resolveRepo(inputPath: string): Promise<{ root: string; name: string }> {
  const candidate = path.resolve(inputPath.trim());

  let stat;
  try {
    stat = await fs.stat(candidate);
  } catch {
    throw new GitError(`That folder doesn't exist: ${candidate}`, null, "");
  }
  if (!stat.isDirectory()) {
    throw new GitError(`That path isn't a folder: ${candidate}`, null, "");
  }

  let inside: string;
  try {
    inside = (await runGit(candidate, ["rev-parse", "--is-inside-work-tree"])).trim();
  } catch (e) {
    if (e instanceof GitError && /not a git repository/i.test(e.stderr)) {
      throw new GitError(`That folder isn't a Git repository: ${candidate}`, null, "");
    }
    throw e;
  }
  if (inside !== "true") {
    throw new GitError(`That folder isn't a Git work tree: ${candidate}`, null, "");
  }

  // Normalise to the work-tree root so every later command is unambiguous.
  const root = (await runGit(candidate, ["rev-parse", "--show-toplevel"])).trim();
  return { root, name: path.basename(root) || root };
}

// Run a long git command (clone/fetch) inside `cwd`, streaming stderr lines to
// `onLine` so the UI can show progress. Resolves on exit 0, else GitError.
export function runGitStream(
  cwd: string,
  args: string[],
  onLine: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true, env: GIT_ENV });
    let stderrTail = "";

    child.on("error", (err) => {
      const noGit = (err as NodeJS.ErrnoException).code === "ENOENT";
      reject(
        new GitError(
          noGit ? "Git is not installed or not on the PATH for this server." : err.message,
          null,
          ""
        )
      );
    });

    // git writes progress to stderr; \r updates the same visual line.
    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      for (const line of text.split(/\r\n|\r|\n/)) {
        if (line.trim()) onLine(line.trim());
      }
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new GitError(cleanAuthNoise(stderrTail) || `git exited with code ${code}`, code, stderrTail));
    });
  });
}

// Azure DevOps Git over HTTPS authenticates with a PAT as Basic auth (empty
// username). Supplied as a per-command header so it never touches git config
// or the remote URL.
export function azureAuthArgs(pat: string): string[] {
  const token = Buffer.from(":" + pat).toString("base64");
  return ["-c", `http.extraheader=Authorization: Basic ${token}`];
}

// Build the HTTPS clone URL for an Azure DevOps repo.
export function azureCloneUrl(org: string, project: string, repoName: string): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repoName)}`;
}

function cleanAuthNoise(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter(Boolean);
  // Surface the most telling line for common failures.
  const auth = lines.find((l) => /Authentication failed|403|401|could not read Username/i.test(l));
  if (auth) return "Authentication failed — check that the PAT has the right scope (Code: Read & write).";
  return lines.slice(-2).join(" ");
}
