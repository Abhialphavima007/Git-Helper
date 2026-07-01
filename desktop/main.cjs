// Electron main process. Starts the app's server in-process on a random local
// port, then opens a native window pointing at it. Because this runs on the
// user's own machine, all local-git features (clone, changes, commit, branches,
// compare, merge, conflicts, push/pull, Open in VS Code) are fully available.

const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { startServer } = require("./server.cjs");

// The built frontend lives in ../dist (repo root). See desktop/README.md.
const DIST = path.join(__dirname, "..", "dist");

async function createWindow() {
  const port = await startServer(DIST, 0);

  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: "Git Helper",
    backgroundColor: "#F7F8FA",
    webPreferences: { contextIsolation: true },
  });

  win.loadURL(`http://127.0.0.1:${port}/`);

  // Open external links (e.g. "open in Azure DevOps") in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
