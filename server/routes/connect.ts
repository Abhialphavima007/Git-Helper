import { Router } from "express";
import type { Connection, ConnectionData, GitRepository, ListResponse } from "../azdo";
import { gitGet, orgGet } from "../azdo";
import { asyncRoute, requireConnection } from "../session";
import { IS_HOSTED } from "../env";
import { listConnections, rememberConnection, savedToken, forgetConnection } from "../connectionStore";

const router = Router();

// POST /api/connect  { org, project, pat, rememberToken?, useSavedToken? }
// Validates the credentials, captures the signed-in identity, stores it server-side.
// Desktop: with useSavedToken the PAT remembered for this org/project is used
// instead of a typed one; rememberToken keeps the typed PAT for next time.
router.post(
  "/connect",
  asyncRoute(async (req, res) => {
    const { org, project } = req.body || {};
    let pat = typeof req.body?.pat === "string" ? req.body.pat : "";
    const useSavedToken = !IS_HOSTED && req.body?.useSavedToken === true;
    const rememberToken = !IS_HOSTED && req.body?.rememberToken === true;
    if (!pat && useSavedToken && org && project) {
      pat = (await savedToken(String(org).trim(), String(project).trim())) ?? "";
      if (!pat) {
        res.status(404).json({
          error: "no_saved_token",
          message: "No token is saved for this project on this computer. Paste your personal access token.",
        });
        return;
      }
    }
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

    if (!IS_HOSTED) {
      const user = me ? me.displayName || me.uniqueName || null : null;
      // Keep an already-saved token when signing in with it again.
      await rememberConnection({ org: connection.org, project: connection.project, user }, pat, rememberToken || useSavedToken).catch(
        () => undefined
      );
    }

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

// Desktop only: the connections used before on this machine (never the PAT).
if (!IS_HOSTED) {
  // GET /api/connections
  router.get(
    "/connections",
    asyncRoute(async (_req, res) => {
      res.json(await listConnections());
    })
  );

  // POST /api/connections/forget  { org, project }
  router.post(
    "/connections/forget",
    asyncRoute(async (req, res) => {
      const org = typeof req.body?.org === "string" ? req.body.org.trim() : "";
      const project = typeof req.body?.project === "string" ? req.body.project.trim() : "";
      if (org && project) await forgetConnection(org, project);
      res.json(await listConnections());
    })
  );
}

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
// Drops only the Azure side of the session — an open local repo stays open.
router.post("/disconnect", (req, res) => {
  req.session.connection = undefined;
  req.session.me = undefined;
  req.session.assistantKey = undefined;
  res.status(204).end();
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
