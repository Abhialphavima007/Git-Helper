# Git Helper — Desktop app

Runs the full app in a native window on your own machine, so **all local-git
features work** (clone, changes, commit, branches, compare, merge, conflicts,
push/pull, Open in VS Code) alongside the Azure DevOps features.

This folder is isolated from the web build — its own `package.json`, its own
`node_modules`. It does **not** affect the Vercel deployment.

## Run it (on your machine)

From the **repository root**:

```bash
npm install
npm run desktop:build      # builds the frontend into desktop/dist + bundles the server
cd desktop
npm install                # installs Electron (one time, ~200 MB)
npm start                  # opens the Git Helper window
```

## Build an installer to share with other people

To produce a file others can install **without Node, npm, or this repo**:

```bash
# from the repo root
npm run desktop:build

# then in this folder
cd desktop
npm install
npm run dist               # runs electron-builder -> desktop/release/
```

The installer lands in **`desktop/release/`**:

| OS you build on | Output | The other person does |
|---|---|---|
| Windows | `Git Helper Setup <version>.exe` | double-click → install → launch |
| macOS | `Git Helper-<version>.dmg` | open → drag to Applications |
| Linux | `Git Helper-<version>.AppImage` | `chmod +x` → run |

Share the file from `desktop/release/`. **You must build on the same OS you're
targeting** — electron-builder does not cross-compile Windows ↔ macOS reliably.
(For a signed/notarized installer, add code-signing certs to the
`build` config in `package.json`.)

## What each person needs on their machine

- **Git** on the PATH — required for all local-git features (clone/commit/push…).
- **VS Code** with the `code` command on PATH — only for the "Open in VS Code"
  button (VS Code → Command Palette → *Shell Command: Install 'code' command*).
- Nothing else — Node/Electron are bundled inside the installer.
