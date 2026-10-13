// Electron main process. Starts the app's server in-process on a random local
// port, then opens a native window pointing at it. Because this runs on the
// user's own machine, all local-git features (clone, changes, commit, branches,
// compare, merge, conflicts, push/pull, Open in VS Code) are fully available.

const { app, BrowserWindow, shell } = require("electron");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const { startServer } = require("./server.cjs");

// Only hand ordinary web links to the OS. Anything else (file:, custom
// protocol handlers, ...) could launch programs on the user's machine.
function openExternalSafely(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") shell.openExternal(url);
  } catch {
    /* not a URL */
  }
}

// The built frontend: desktop/dist when packaged or built here, else the repo
// root ../dist for a dev run.
const DIST =
  [path.join(__dirname, "dist"), path.join(__dirname, "..", "dist")].find((p) =>
    fs.existsSync(path.join(p, "index.html"))
  ) || path.join(__dirname, "dist");

async function createWindow() {
  // Per-launch secret: the window proves it is the app's own page with it, so
  // nothing else on this machine can call the local API (see desktopServer.ts).
  const launchToken = crypto.randomBytes(32).toString("hex");
  const port = await startServer(DIST, 0, launchToken);
  const appOrigin = `http://127.0.0.1:${port}`;

  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: "Git Helper",
    backgroundColor: "#F7F8FA",
    webPreferences: { contextIsolation: true },
  });

  guardWindow(win.webContents, appOrigin);
  win.loadURL(`${appOrigin}/?launch=${launchToken}`);
}

// Applies to the main window and to every window it opens: the app's own
// pages (the full-page file viewer) may open as a second window, anything
// else goes to the real browser, and a window never navigates away from the app.
function guardWindow(contents, appOrigin) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appOrigin + "/")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 860,
          title: "Git Helper",
          backgroundColor: "#F7F8FA",
          webPreferences: { contextIsolation: true },
        },
      };
    }
    openExternalSafely(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appOrigin + "/")) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });
  contents.on("did-create-window", (child) => guardWindow(child.webContents, appOrigin));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
