# Git Helper — Desktop app

Runs the full app in a native window on your own machine, so **all local-git
features work** (clone, changes, commit, branches, compare, merge, conflicts,
push/pull, Open in VS Code) alongside the Azure DevOps features.

This folder is isolated from the web build — its own `package.json`, its own
`node_modules`. It does **not** affect the Vercel deployment.

## Run it

From the **repository root**:

```bash
npm install                      # once
npm run desktop:build            # build the frontend + bundle the server -> desktop/server.cjs
cd desktop
npm install                      # once — installs Electron
npm start                        # opens the Git Helper window
```

`npm run desktop:build` runs `vite build` (produces `../dist`) and
`scripts/build-desktop.mjs` (produces `desktop/server.cjs`). The Electron main
process (`main.cjs`) starts that server on a random localhost port and loads it
in the window.

## Notes

- Requires the VS Code `code` command on your PATH for the "Open in VS Code"
  button (VS Code → Command Palette → "Shell Command: Install 'code' command").
- To produce a distributable installer, add `electron-builder` and a `build`
  config; this scaffold intentionally keeps to a runnable dev app.
