import { Router } from "express";
import type { Request } from "express";
import { asyncRoute } from "../session";
import { getAssistantCredentials, setAssistantKey, clearAssistantKeys, type AssistantProvider } from "../settings";
import type { AssistantCredentials } from "../settings";
import { runAssistant, type AssistantContext, type ChatTurn } from "../assistant";
import { IS_HOSTED } from "../env";

const router = Router();

// Where a key can come from, in order: env vars (site-wide), the visitor's
// encrypted session cookie (hosted per-user keys), the machine settings file
// (desktop/local).
async function resolveCredentials(req: Request): Promise<AssistantCredentials | null> {
  if (process.env.ANTHROPIC_API_KEY) return { provider: "anthropic", key: process.env.ANTHROPIC_API_KEY };
  if (process.env.GEMINI_API_KEY) return { provider: "gemini", key: process.env.GEMINI_API_KEY };
  if (req.session.assistantKey?.key) return req.session.assistantKey;
  if (!IS_HOSTED) return getAssistantCredentials();
  return null;
}

// GET /api/assistant/status -> is the assistant ready, and on which provider?
router.get(
  "/status",
  asyncRoute(async (req, res) => {
    const creds = await resolveCredentials(req);
    res.json({
      configured: !!creds,
      provider: creds?.provider ?? null,
      canConfigure: true, // everyone can bring their own key now
      hosted: IS_HOSTED, // hosted keys live in the visitor's session cookie
    });
  })
);

// POST /api/assistant/key { provider: "anthropic"|"gemini", key }
// Hosted: stored in the visitor's encrypted session cookie (private per user).
// Local/desktop: stored on this machine so it survives restarts.
router.post(
  "/key",
  asyncRoute(async (req, res) => {
    const provider: AssistantProvider = req.body?.provider === "gemini" ? "gemini" : "anthropic";
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    if (!key) {
      req.session.assistantKey = undefined;
      if (!IS_HOSTED) await clearAssistantKeys();
      res.json({ configured: false });
      return;
    }
    if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
      res.status(400).json({ error: "bad_key", message: "That doesn't look like an Anthropic API key (they start with sk-ant-)." });
      return;
    }
    // Gemini keys come in several formats (classic AIza…, newer AQ.…) — just
    // sanity-check the shape and let Google validate for real.
    if (provider === "gemini" && (key.length < 20 || /\s/.test(key))) {
      res.status(400).json({ error: "bad_key", message: "That Gemini key looks incomplete — paste the whole key (no spaces)." });
      return;
    }
    if (IS_HOSTED) {
      req.session.assistantKey = { provider, key };
    } else {
      await setAssistantKey(provider, key);
    }
    res.json({ configured: true, provider });
  })
);

// POST /api/assistant/chat { messages: [{role, content}], azureRepoId? }
router.post(
  "/chat",
  asyncRoute(async (req, res) => {
    const creds = await resolveCredentials(req);
    if (!creds) {
      res.status(409).json({ error: "not_configured", message: "The assistant needs an API key first (Claude or Gemini)." });
      return;
    }

    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const turns: ChatTurn[] = raw
      .filter((m: { role?: string; content?: string }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20); // keep the request bounded
    if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
      res.status(400).json({ error: "bad_messages", message: "Send the chat history ending with a user message." });
      return;
    }

    const ctx: AssistantContext = {
      repoRoot: !IS_HOSTED ? req.session.localRepo?.root ?? null : null,
      repoName: !IS_HOSTED ? req.session.localRepo?.name ?? null : null,
      connection: req.session.connection ?? null,
      azureRepoId: typeof req.body?.azureRepoId === "string" && req.body.azureRepoId ? req.body.azureRepoId : null,
    };

    if (!ctx.repoRoot && !ctx.connection) {
      res.status(409).json({
        error: "no_context",
        message: "Open a local repository or connect to Azure DevOps first — then I have something to work with.",
      });
      return;
    }

    try {
      const result = await runAssistant(creds, ctx, turns);
      res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "The assistant call failed.";
      res.status(502).json({ error: "assistant_failed", message });
    }
  })
);

export default router;
