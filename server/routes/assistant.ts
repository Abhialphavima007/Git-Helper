import { Router } from "express";
import { asyncRoute } from "../session";
import { getAssistantCredentials, setAssistantKey, clearAssistantKeys, type AssistantProvider } from "../settings";
import { runAssistant, type AssistantContext, type ChatTurn } from "../assistant";
import { IS_HOSTED } from "../env";

const router = Router();

// GET /api/assistant/status -> is the assistant ready, and on which provider?
router.get(
  "/status",
  asyncRoute(async (_req, res) => {
    const creds = await getAssistantCredentials();
    res.json({
      configured: !!creds,
      provider: creds?.provider ?? null,
      // On hosted deployments keys come from env vars; no key-entry UI there.
      canConfigure: !IS_HOSTED,
    });
  })
);

// POST /api/assistant/key { provider: "anthropic"|"gemini", key }  (local only)
router.post(
  "/key",
  asyncRoute(async (req, res) => {
    if (IS_HOSTED) {
      res.status(403).json({
        error: "hosted",
        message: "On the hosted app, keys are set via the ANTHROPIC_API_KEY or GEMINI_API_KEY environment variables.",
      });
      return;
    }
    const provider: AssistantProvider = req.body?.provider === "gemini" ? "gemini" : "anthropic";
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    if (!key) {
      await clearAssistantKeys();
      res.json({ configured: false });
      return;
    }
    if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
      res.status(400).json({ error: "bad_key", message: "That doesn't look like an Anthropic API key (they start with sk-ant-)." });
      return;
    }
    if (provider === "gemini" && !key.startsWith("AIza")) {
      res.status(400).json({ error: "bad_key", message: "That doesn't look like a Gemini API key (they start with AIza)." });
      return;
    }
    await setAssistantKey(provider, key);
    res.json({ configured: true, provider });
  })
);

// POST /api/assistant/chat { messages: [{role, content}], azureRepoId? }
router.post(
  "/chat",
  asyncRoute(async (req, res) => {
    const creds = await getAssistantCredentials();
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
