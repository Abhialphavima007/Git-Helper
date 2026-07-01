import { Router } from "express";
import type { Connection, ConnectionData, GitRepository, ListResponse } from "../azdo";
import { gitGet, orgGet } from "../azdo";
import { asyncRoute, requireConnection } from "../session";

const router = Router();

// POST /api/connect  { org, project, pat }
// Validates the credentials, captures the signed-in identity, stores it server-side.
router.post(
  "/connect",
  asyncRoute(async (req, res) => {
    const { org, project, pat } = req.body || {};
    if (!org || !project || !pat) {
      res.status(400).json({
        error: "missing_fields",
        message: "Provide organization, project, and a personal access token.",
      });
      return;
    }

    const connection: Connection = { org: String(org).trim(), project: String(project).trim(), pat: String(pat) };

    // Validates org + PAT and tells us who we are.
    // /connectionData is a preview-only resource, so it needs the -preview flag.
    const conn = await orgGet<ConnectionData>(connection, "/connectionData", {}, "7.1-preview");
    const me = conn.authorizedUser || conn.authenticatedUser;

    // Validates the project (and that the PAT can read Code).
    const repos = await gitGet<ListResponse<GitRepository>>(connection, "/repositories");

    req.session.connection = connection;
    req.session.me = me;

    res.json({
      connected: true,
      org: connection.org,
      project: connection.project,
      me: me ? { id: me.id, name: me.displayName || me.uniqueName } : null,
      repos: repos.value
        .map((r) => ({
          id: r.id,
          name: r.name,
          defaultBranch: r.defaultBranch ? r.defaultBranch.replace(/^refs\/heads\//, "") : null,
          webUrl: r.webUrl || null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  })
);

// GET /api/connection  -> current connection state (never returns the PAT)
router.get("/connection", (req, res) => {
  const c = req.session.connection;
  const me = req.session.me;
  res.json({
    connected: !!c,
    org: c?.org ?? null,
    project: c?.project ?? null,
    me: me ? { id: me.id, name: me.displayName || me.uniqueName } : null,
  });
});

// POST /api/disconnect
router.post("/disconnect", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("azdo.sid");
    res.status(204).end();
  });
});

// GET /api/repos
router.get(
  "/repos",
  requireConnection,
  asyncRoute(async (_req, res) => {
    const c = res.locals.connection as Connection;
    const repos = await gitGet<ListResponse<GitRepository>>(c, "/repositories");
    res.json(
      repos.value
        .map((r) => ({
          id: r.id,
          name: r.name,
          defaultBranch: r.defaultBranch ? r.defaultBranch.replace(/^refs\/heads\//, "") : null,
          webUrl: r.webUrl || null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  })
);

export default router;
