# Security Policy

Git Helper handles credentials (Azure DevOps PATs, AI provider API keys) and
runs git commands on users' machines, so we take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's **private vulnerability reporting**: on the repository page go to
*Security → Report a vulnerability*. Include steps to reproduce and what an
attacker could gain. You'll get an acknowledgement within a few days; please
give us a reasonable window to fix before disclosing publicly.

## Supported versions

Only the **latest release** is supported. Desktop users should update from
the [releases page](https://github.com/Abhialphavima007/Git-Helper/releases/latest);
the hosted web app always runs the latest `main`.

## Security model (what "secure" means here)

- **PATs and API keys never reach the browser.** They live in an
  AES-256-GCM-encrypted, server-side session cookie (hosted) or on the local
  machine (desktop), and are supplied to git per-command via
  `http.extraheader` — never written into git config or remote URLs.
- **The hosted app cannot touch your filesystem.** Local-git features are
  disabled on hosted deployments (`IS_HOSTED`); they exist only in the
  desktop app / locally-run server.
- **Destructive actions are gated.** Hard resets, discards and cleans demand
  explicit — sometimes typed — confirmation, and pushed history is never
  rewritten silently.
- **The AI assistant and MCP server follow the same rules**: no destructive
  tools, conflicts are reported rather than "fixed", and keys are used
  server-side only.

## Guidelines for contributors

- Never log, echo, or serialize a PAT, API key, or session secret.
- Anything that executes git must go through `server/git.ts` /
  `server/localGit.ts` (argument arrays, no shell interpolation).
- New endpoints touching the filesystem must stay inside the repo root they
  were given (see `untrackedFileDiff` for the pattern).
- Dependencies: CI runs `npm audit`; Dependabot keeps actions and packages
  fresh. Don't add a dependency where 20 lines of code will do.
