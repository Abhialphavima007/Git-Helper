import { Router } from "express";
import { asyncRoute } from "../session";
import { getAssistantApiKey, setAssistantApiKey, clearAssistantApiKey } from "../settings";
import { runAssistant, type AssistantContext, type ChatTurn } from "../assistant";
import { IS_HOSTED } from "../env";

const router = Router();

// GET /api/assistant/status -> is the assistant ready to use?
router.get(
  "/status",
  asyncRoute(async (_req, res) => {
    const key = await getAssistantApiKey();
    res.json({
      configured: !!key,
      // On hosted deployments the key comes from the ANTHROPIC_API_KEY env var;
      // there is no key-entry UI there.
      canConfigure: !IS_HOSTED,
    });
  })
);

// POST /api/assistant/key { key }  -> store the Anthropic API key (local only)
router.post(
  "/key",
  asyncRoute(async (req, res) => {
    if (IS_HOSTED) {
      res.status(403).json({ error: "hosted", message: "On the hosted app the key is set via the ANTHROPIC_API_KEY environment variable." });
      return;
    }
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    if (!key) {
      await clearAssistantApiKey();
      res.json({ configured: false });
      return;
    }
    if (!key.startsWith("sk-ant-")) {
      res.status(400).json({ error: "bad_key", message: "That doesn't look like an Anthropic API key (they start with sk-ant-)." });
      return;
    }
    await setAssistantApiKey(key);
    res.json({ configured: true });
  })
);

// POST /api/assistant/chat { messages: [{role, content}], azureRepoId? }
router.post(
  "/chat",
  asyncRoute(async (req, res) => {
    const key = await getAssistantApiKey();
    if (!key) {
      res.status(409).json({ error: "not_configured", message: "The assistant needs an Anthropic API key first." });
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
      const result = await runAssistant(key, ctx, turns);
      res.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "The assistant call failed.";
      res.status(502).json({ error: "assistant_failed", message });
    }
  })
);

export default router;
