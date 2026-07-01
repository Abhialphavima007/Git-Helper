import { Router } from "express";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Lets the UI browse the local filesystem to choose a folder — the server-side
// equivalent of a native "choose folder" dialog. Only directory names are
// exposed (no file contents).
const router = Router();

const isWindows = process.platform === "win32";

// GET /api/fs/browse?path=<dir>
router.get("/browse", async (req, res) => {
  const input = typeof req.query.path === "string" && req.query.path.trim() ? req.query.path.trim() : os.homedir();
  const dir = path.resolve(input);

  let drives: string[] | undefined;
  if (isWindows) {
    drives = [];
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      try {
        await fs.access(`${c}:\\`);
        drives.push(`${c}:\\`);
      } catch {
        /* no such drive */
      }
    }
  }

  const parent = path.dirname(dir) === dir ? null : path.dirname(dir);

  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const entries = dirents
      .filter((d) => {
        try {
          return d.isDirectory();
        } catch {
          return false;
        }
      })
      .map((d) => ({ name: d.name, path: path.join(dir, d.name) }))
      .filter((e) => !e.name.startsWith("$") && !e.name.startsWith(".")) // hide system/hidden dirs
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ path: dir, parent, isWindows, drives, entries, home: os.homedir() });
  } catch {
    // Unreadable folder (permissions, etc.) — still allow navigating away.
    res.json({ path: dir, parent, isWindows, drives, entries: [], home: os.homedir(), error: "Can't read this folder." });
  }
});

export default router;
