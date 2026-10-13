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
// (Network ops supply auth through GitAuth — see gitInvocation below.)
const GIT_ENV: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

// Credentials for a network git command (fetch/pull/push/clone).
export interface GitAuth {
  pat: string;
}

// The PAT is only ever offered to Azure DevOps hosts. Scoping the header with
// git's per-URL config means a repo whose remote points somewhere else (GitHub,
// a mirror, an attacker's server) never receives it.
const AZURE_URL_PREFIXES = ["https://dev.azure.com/", "https://*.visualstudio.com/"];

function authConfig(auth: GitAuth): Array<[string, string]> {
  const header = "Authorization: Basic " + Buffer.from(":" + auth.pat).toString("base64");
  return AZURE_URL_PREFIXES.map((prefix) => [`http.${prefix}.extraheader`, header]);
}

// git 2.31+ reads config from GIT_CONFIG_COUNT/KEY/VALUE environment variables,
// which keeps the PAT off the command line (visible to every local process via
// ps / Task Manager). Older git falls back to `-c` arguments.
let configEnvSupport: Promise<boolean> | null = null;

function supportsConfigEnv(): Promise<boolean> {
  if (!configEnvSupport) {
    configEnvSupport = new Promise((resolve) => {
      execFile("git", ["version"], { windowsHide: true, timeout: GIT_TIMEOUT }, (err, stdout) => {
        const m = /(\d+)\.(\d+)/.exec(stdout || "");
        if (err || !m) return resolve(false);
        const major = Number(m[1]);
        const minor = Number(m[2]);
        resolve(major > 2 || (major === 2 && minor >= 31));
      });
    });
  }
  return configEnvSupport;
}

async function gitInvocation(args: string[], auth?: GitAuth | null): Promise<{ args: string[]; env: NodeJS.ProcessEnv }> {
  if (!auth) return { args, env: GIT_ENV };
  const entries = authConfig(auth);
  if (await supportsConfigEnv()) {
    const env: NodeJS.ProcessEnv = { ...GIT_ENV };
    let count = Number(env.GIT_CONFIG_COUNT) || 0;
    for (const [key, value] of entries) {
      env[`GIT_CONFIG_KEY_${count}`] = key;
      env[`GIT_CONFIG_VALUE_${count}`] = value;
      count++;
    }
    env.GIT_CONFIG_COUNT = String(count);
    return { args, env };
  }
  const configArgs: string[] = [];
  for (const [key, value] of entries) configArgs.push("-c", `${key}=${value}`);
  return { args: [...configArgs, ...args], env: GIT_ENV };
}

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
export async function runGit(
  cwd: string,
  args: string[],
  opts: { timeout?: number; auth?: GitAuth | null; okExitCodes?: number[] } = {}
): Promise<string> {
  const run = await gitInvocation(args, opts.auth);
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      run.args,
      { cwd, timeout: opts.timeout ?? GIT_TIMEOUT, maxBuffer: MAX_BUFFER, windowsHide: true, env: run.env },
      (err, stdout, stderr) => {
        // Some commands signal "found differences" with exit 1 (git diff --no-index).
        if (err && opts.okExitCodes && opts.okExitCodes.includes((err as { code?: unknown }).code as number)) {
          resolve(stdout);
          return;
        }
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

// Same as runGit, but hands back the raw bytes — for `git show ref:path` on
// binary files (images, zips) that a string conversion would corrupt.
export async function runGitRaw(cwd: string, args: string[], opts: { timeout?: number } = {}): Promise<Buffer> {
  const run = await gitInvocation(args, null);
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      run.args,
      { cwd, timeout: opts.timeout ?? GIT_TIMEOUT, maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: run.env, encoding: "buffer" },
      (err, stdout, stderr) => {
        if (err) {
          const text = stderr ? stderr.toString() : "";
          const code = typeof (err as { code?: unknown }).code === "number" ? (err.code as number) : null;
          reject(new GitError((text || err.message || "git command failed").trim(), code, text));
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
export async function runGitStream(
  cwd: string,
  args: string[],
  onLine: (line: string) => void,
  auth?: GitAuth | null
): Promise<void> {
  const run = await gitInvocation(args, auth);
  return new Promise((resolve, reject) => {
    const child = spawn("git", run.args, { cwd, windowsHide: true, env: run.env });
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

// Build the HTTPS clone URL for an Azure DevOps repo.
export function azureCloneUrl(org: string, project: string, repoName: string): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repoName)}`;
}

// Open a folder in VS Code via its `code` CLI. Local/desktop only.
export function openInEditor(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === "win32") {
      // On Windows `code` is a .cmd, which Node can only start through cmd.exe.
      // Inside the quotes cmd still expands %VAR% and a quote would end the
      // string, so refuse those rather than let a folder name run commands.
      if (/["%\r\n]/.test(dir)) {
        reject(new GitError("This folder's path contains characters that can't be passed to VS Code safely.", null, ""));
        return;
      }
      child = spawn(`code "${dir}"`, { shell: true, detached: true, stdio: "ignore", windowsHide: true });
    } else {
      // macOS/Linux: `code` is directly executable, so no shell is involved and
      // the path is passed as a single argument (spaces and all).
      child = spawn("code", [dir], { detached: true, stdio: "ignore" });
    }
    child.on("error", (e) =>
      reject(new GitError(`Couldn't launch VS Code — is the 'code' command on your PATH? (${e.message})`, null, ""))
    );
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function cleanAuthNoise(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter(Boolean);
  // Surface the most telling line for common failures.
  const auth = lines.find((l) => /Authentication failed|403|401|could not read Username/i.test(l));
  if (auth) return "Authentication failed — check that the PAT has the right scope (Code: Read & write).";
  return lines.slice(-2).join(" ");
}
