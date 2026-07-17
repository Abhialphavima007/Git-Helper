# Azure DevOps Git Helper

[![CI](https://github.com/Abhialphavima007/Git-Helper/actions/workflows/ci.yml/badge.svg)](https://github.com/Abhialphavima007/Git-Helper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Abhialphavima007/Git-Helper)](https://github.com/Abhialphavima007/Git-Helper/releases/latest)

> **Download the desktop app:** grab the installer for Windows or macOS from the
> [latest release](https://github.com/Abhialphavima007/Git-Helper/releases/latest).
> (Unsigned builds — see [desktop/README.md](desktop/README.md) for the
> one-time SmartScreen/Gatekeeper "Open anyway" step.)
>
> **📖 New here? Read the [User Guide](docs/USER-GUIDE.md)** — a screenshot
> walkthrough of every feature, from connecting to Azure DevOps to resolving
> merge conflicts.

A friendly visual layer over **Azure DevOps Repos** *and your **local Git** repositories* for developers who don't live in the Git CLI. It turns raw Git/Azure DevOps state into plain language and answers three questions on every screen: **Where am I? What's the state? What can I safely do next?**

This is a **single Vite + React + Tailwind app**. The small Azure DevOps proxy runs as **Vite middleware**, so everything is one folder, one `package.json`, one command — while the PAT still stays **server-side** and never reaches the browser.

**Open source & contributions:** Git Helper is MIT-licensed. Contributions
land on the [`develop`](https://github.com/Abhialphavima007/Git-Helper/tree/develop)
branch, where every push gets an automatic **preview deployment** for review
before being promoted to `main`. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) ·
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## What's built

- **Connect** — enter Organization, Project, and a PAT; the token is stored only in a server-side session cookie.
- **Dashboard** — pick a branch; get a plain-language traffic-light banner (ahead/behind the default branch), a schematic divergence graph, and recent commits.
- **Branches** — every branch with ahead/behind counts, last commit, and a plain-language verdict.
- **Pull Requests** — list (All / Created by me / Assigned to me) with merge status and reviewer summary; detail view with description, reviewer votes, and comment threads.

Azure DevOps errors are shown translated, never as a raw API dump.

### Local Git mode (new)

Point the app at a folder on this machine that contains a Git repository — or **clone one straight from Azure DevOps** (see below) — and it drives the local `git` CLI through the same proxy:

- **Status ("see the issue")** — current branch, ahead/behind the upstream, and a plain-language banner that surfaces what needs attention (conflicts, a pull, uncommitted work) with a link straight to the fix. Includes a **Fetch / Pull / Push** toolbar.
- **Changes** — a GitHub-style overview of everything that changed, with per-file **green +/red −** counts and inline diffs.
- **Commit** — stage/unstage individual files or everything at once, view per-file diffs, and commit with summary-length guidance.
- **Branches** — switch, create, **merge** (conflicts route into the resolver), delete, and see the commits each branch introduces vs the base.
- **Compare & merge** — pick a base and a branch to compare; see how far ahead/behind it is, the commits it adds, and the file changes (green +/red −) with inline diffs; then merge it into the base in one click (auto-switches to the base first; conflicts route into the resolver).
- **Visualise** — a real commit-graph DAG (lanes, merges, branch/tag/HEAD decorations) across one or all branches.
- **Resolve conflicts** — a three-pane wizard: read *ours* and *theirs* side by side, edit the merged result (take one side, the other, or combine), and mark each file resolved, then finish the merge with a commit.

The repo path lives only in the server-side session, just like the PAT. Both modes can be active at once; the sidebar shows whichever you've opened.

### Cloud → Local → Cloud (clone & push)

The two modes are bridged into one flow:

1. **Connect** with your org / project / PAT (`Code: Read & write` scope for pushing/cloning private repos and merging PRs).
2. **Repositories** lists the project's repos — hit **Clone to local**, **choose a folder** (a built-in folder browser, no typing paths), and a **top progress bar** tracks the clone.
3. When it finishes the repo **opens automatically in Local mode**, already wired to its Azure `origin`.
4. Work locally — branch, change, commit, compare, merge — then **Push** back to Azure DevOps.

**Your repositories persist.** Cloned/opened repos are saved to a small registry (`~/.azdo-git-helper/repos.json`) and shown in a GitHub Desktop-style **current-repository picker** in the sidebar — so you never have to clone again to get back to one. The list survives restarts.

Authentication uses the session PAT supplied per-command via `http.extraheader`, so it never lands in git config or the remote URL.

### Merge branches in Azure DevOps (pull requests)

Merging in the cloud goes through pull requests, the Azure way:

- On the Azure **Branches** page, **New PR** creates a pull request from a branch into a target.
- On a PR's detail page, **Complete merge** merges it — pick the strategy (merge / squash / rebase / semi-linear) and optionally delete the source branch. Needs `Code: Read & write`.

### History graph

The **History** view renders a real commit-graph DAG: continuous colored lane rails, converging lines into a commit, and merge curves out of it, with branch/tag/HEAD/remote decorations — across the current branch or all branches.

---

## How it's wired

```
Browser (React + Vite, port 5173)
        │  /api/*  (same origin — no CORS)
        ▼
Express proxy mounted as Vite middleware   ──HTTPS──►  Azure DevOps REST v7.1
   PAT lives here, in an AES-256-GCM-encrypted session cookie
```

- `src/` — the React app (TypeScript, Tailwind, TanStack Query, React Router).
- `server/` — the proxy: `app.ts` exports `createApiApp()`; route files call Azure DevOps and shape the JSON. `git.ts` + `localGit.ts` + `routes/local.ts` drive the local `git` CLI for Local mode (`/api/local/*`).
- `vite.config.ts` — mounts `createApiApp()` on `/api/*` during `npm run dev`.
- `server.ts` — production entry: serves the built `dist/` **and** the same `/api` proxy on one port.

The frontend only ever calls relative `/api/...` paths with `credentials: "include"`, so dev and prod behave identically.

---

## Run it

**Prereqs:** Node 18+ (uses native `fetch`).

```bash
npm install
cp .env.example .env        # then set SESSION_SECRET to any random string
npm run dev                 # http://localhost:5173
```

**Production:**

```bash
npm run build               # emits ./dist
npm start                   # serves app + API on http://localhost:4000 (set PORT to change)
```

### Create a PAT
Azure DevOps → **User settings → Personal access tokens → New Token**.
- Scope for this MVP: **Code → Read**.
- (Steps 4–6 below will need **Code → Read & write**.)

---

## Scripts

- `npm run dev` — Vite dev server with the API mounted as middleware
- `npm run build` — production client build
- `npm start` — run the production server (build first)
- `npm run typecheck` — `tsc --noEmit` over frontend **and** server

---

## Beyond the basics (all built)

- **Undo & restore** — unstage, stash, discard, undo last commit, revert any
  commit, rewind (soft/mixed/hard with pushed-history protection), and a
  reflog rescue list. Cloud undo creates a revert PR via Azure's revert API.
- **Recovery & sync** — a "repo doctor" that fetches first, detects awkward
  situations (accidental merge, wrong-branch commits, detached HEAD, far
  behind, forgotten stashes, noise commits) and turns each into a guided,
  confirmed action with the exact git command shown.
- **Are-you-sure dialogs** — fetch/pull/push explain what will happen and
  what they affect before running; destructive actions need typed confirms.
- **AI assistant** — a chat bubble that can operate the repo (Claude or
  Gemini, bring-your-own-key) plus an **MCP server** so Claude Desktop can
  drive your repos with no API key.
- **Auto-commit** — per-repo schedules (daily / every 2 days / custom
  weekdays, at a chosen time, pinned to a branch) or dynamic on-change mode.

## Roadmap ideas

- Notifications / "needs attention" inbox
- Work-item linking
- Branch-policy evaluation surfacing
- Microsoft Entra ID OAuth to replace PATs
- Code signing for the installers

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Key assumptions

- The original Azure DevOps screens are **remote-only** (no local Git state). **Local Git mode** (above) adds local-repo support alongside them; it requires a `git` binary on the server's PATH.
- Org / Project / PAT are entered at runtime, so nothing org-specific is hard-coded.
- "Created by me / Assigned to me" PR filters use the identity from the Azure DevOps `connectionData` call, filtered client-side.
