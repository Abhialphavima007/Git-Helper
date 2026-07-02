# Git Helper — Desktop app

Runs the full app in a native window on your own machine, so **all local-git
features work** (clone, changes, commit, branches, compare, merge, conflicts,
push/pull, Open in VS Code) alongside the Azure DevOps features.

This folder is isolated from the web build — its own `package.json`, its own
`node_modules`. It does **not** affect the Vercel deployment.

## Run it (on your machine)

From the **repository root**:

```bash
npm install                # one time
cd desktop
npm install                # one time — installs Electron (~200 MB)
npm start                  # rebuilds the app, then opens the window
```

`npm start` **always rebuilds first**, so after a `git pull` you automatically
get the latest UI — no separate build step to forget. Use `npm run start:fast`
to skip the rebuild and just relaunch what was last built.

## Build an installer to share with other people

To produce a file others can install **without Node, npm, or this repo**:

```bash
cd desktop
npm install                # one time
npm run dist               # rebuilds the app, then packages -> desktop/release/
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

## Troubleshooting

**"This app can't run on your PC"** — the build targeted a different CPU
architecture. The config pins **x64** (runs on Intel/AMD and on ARM Windows via
emulation). If you still hit it, do a clean rebuild and clear the Electron
caches:

```powershell
echo %PROCESSOR_ARCHITECTURE%   REM AMD64 = x64 (normal), ARM64 = ARM

cd desktop
rmdir /s /q node_modules release
rmdir /s /q "%LOCALAPPDATA%\electron\Cache"
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache"
npm install
npm run dist
```

Install with **`release\Git Helper Setup <version>.exe`** (don't run the loose
`win-unpacked\Git Helper.exe`). If your PC reports `ARM64`, change
`build.win.target[0].arch` to `["arm64"]` in `package.json` and rebuild.

## What each person needs on their machine

- **Git** on the PATH — required for all local-git features (clone/commit/push…).
- **VS Code** with the `code` command on PATH — only for the "Open in VS Code"
  button (VS Code → Command Palette → *Shell Command: Install 'code' command*).
- Nothing else — Node/Electron are bundled inside the installer.
