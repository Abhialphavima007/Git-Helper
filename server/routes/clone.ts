import { Router } from "express";
import os from "node:os";
import path from "node:path";
import type { Connection } from "../azdo";
import { azureAuthArgs, azureCloneUrl } from "../git";
import { startClone, getJob } from "../cloneJobs";
import { asyncRoute, requireConnection } from "../session";

const router = Router();

// GET /api/clone/defaults -> a suggested parent folder for new clones.
router.get("/clone/defaults", (_req, res) => {
  res.json({ baseDir: path.join(os.homedir(), "azdo-repos") });
});

// POST /api/clone  { repoName, parentDir }  -> { jobId }
router.post(
  "/clone",
  requireConnection,
  asyncRoute(async (req, res) => {
    const c = res.locals.connection as Connection;
    const repoName = typeof req.body?.repoName === "string" ? req.body.repoName.trim() : "";
    const parentDir = typeof req.body?.parentDir === "string" ? req.body.parentDir.trim() : "";
    if (!repoName || !parentDir) {
      res.status(400).json({ error: "missing_fields", message: "A repository name and a destination folder are required." });
      return;
    }
    const url = azureCloneUrl(c.org, c.project, repoName);
    const job = await startClone({ url, authArgs: azureAuthArgs(c.pat), parentDir, repoName });
    res.json({ jobId: job.id, dest: job.dest });
  })
);

// GET /api/clone/:id -> current job progress
router.get("/clone/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "no_such_job", message: "That clone job is unknown or has expired." });
    return;
  }
  res.json(job);
});

export default router;
