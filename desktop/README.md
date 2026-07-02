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

## Distribute to everyone (recommended): GitHub Releases

The repo has a GitHub Actions pipeline (`.github/workflows/release.yml`) that
builds the installers on **real Windows and macOS machines** and publishes
them to the repo's **Releases** page. This is the way to ship both platforms —
a Mac installer can only be built on macOS, which Actions provides.

**To publish a release:**

```bash
# 1. (when shipping a new version) bump "version" in desktop/package.json, commit
# 2. tag it (tag = v + that version) and push the tag:
git tag v0.1.0
git push origin v0.1.0
```

~10 minutes later both installers appear at:

> **https://github.com/Abhialphavima007/Git-Helper/releases/latest**

**What users do:** open that link and download —
- Windows: `Git Helper Setup <version>.exe` → run it
- macOS (Intel & Apple Silicon, one file): `Git Helper-<version>-universal.dmg` → open → drag to Applications

> The repo must be **public** for others to download (private repos require a
> GitHub account with access).

### First-launch warnings (unsigned builds)

The installers are not code-signed (signing needs paid certificates), so:
- **Windows SmartScreen**: "Windows protected your PC" → click **More info → Run anyway**.
- **macOS Gatekeeper**: "cannot verify the developer" → **right-click the app → Open → Open**
  (or System Settings → Privacy & Security → **Open Anyway**).

To remove these warnings later: a Windows code-signing certificate for the
`.exe`, and an Apple Developer ID ($99/yr) + notarization for the `.dmg` —
both slot into the `build` config in `package.json`.

## Build an installer locally (this OS only)

```bash
cd desktop
npm install                # one time
npm run dist               # rebuilds the app, then packages -> desktop/release/
```

This produces the installer for the OS you're on (Windows → `.exe`). Use the
GitHub Actions release flow above when you need macOS too.

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
