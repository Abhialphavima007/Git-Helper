// The in-app AI assistant: Claude with tool use over the same operations the
// UI exposes. Runs entirely server-side (the API key never reaches the
// browser); tools execute against the session's open repo / Azure connection.
// Destructive operations (discard, delete branch, complete PR, push --force)
// are deliberately NOT exposed as tools.

import Anthropic from "@anthropic-ai/sdk";
import type { AssistantCredentials } from "./settings";
import type { Connection, GitBranchStat, ListResponse, PullRequest } from "./azdo";
import { gitGet, gitPost } from "./azdo";
import { azureAuthArgs } from "./git";
import {
  getState,
  getBranches,
  getGraph,
  checkoutBranch,
  createBranch,
  mergeBranch,
  stage,
  stageAll,
  commit,
  stashSave,
  stashPop,
  compareBranches,
  fetchRemote,
  pull,
  push,
} from "./localGit";
import { mapPullRequest, shortRef } from "./util";

const CLAUDE_MODEL = process.env.ASSISTANT_MODEL || "claude-opus-4-8";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_ITERATIONS = 8;

export interface AssistantContext {
  repoRoot: string | null; // open local repo (null when none / hosted)
  repoName: string | null;
  connection: Connection | null; // Azure session (null when not connected)
  azureRepoId: string | null; // repo selected in the Azure sidebar
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantResult {
  reply: string;
  actions: string[]; // human-readable log of tools executed
}

function toolDefs(ctx: AssistantContext): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  const obj = (props: Record<string, unknown>, required: string[] = []) => ({
    type: "object" as const,
    properties: props,
    required,
  });

  if (ctx.repoRoot) {
    tools.push(
      {
        name: "get_repo_status",
        description:
          "Get the open local repository's working-tree status: current branch, upstream, ahead/behind counts, staged/unstaged/untracked/conflicted files, stash count, and last commit.",
        input_schema: obj({}),
      },
      {
        name: "list_branches",
        description: "List local and remote branches of the open repository with ahead/behind and last commit.",
        input_schema: obj({}),
      },
      {
        name: "create_branch",
        description: "Create a new branch from the current one and switch to it.",
        input_schema: obj({ name: { type: "string", description: "Branch name, e.g. feature/login" } }, ["name"]),
      },
      {
        name: "checkout_branch",
        description:
          "Switch to a branch. Use the branch ref from list_branches (remote-only branches use e.g. origin/feature-x and become local tracking branches).",
        input_schema: obj({ ref: { type: "string" } }, ["ref"]),
      },
      {
        name: "stage_files",
        description: "Stage files for commit. Pass specific paths, or all=true to stage everything.",
        input_schema: obj({
          files: { type: "array", items: { type: "string" } },
          all: { type: "boolean" },
        }),
      },
      {
        name: "commit_changes",
        description: "Commit the currently staged files with a message. Stage files first if nothing is staged.",
        input_schema: obj({ message: { type: "string", description: "Commit message (imperative summary line)" } }, ["message"]),
      },
      {
        name: "merge_branch",
        description:
          "Merge the named branch into the CURRENT branch. If conflicts occur they are reported and the user must resolve them in the Resolve conflicts screen.",
        input_schema: obj({ name: { type: "string" } }, ["name"]),
      },
      {
        name: "compare_branches",
        description:
          "Compare two branches: how far ahead/behind, the commits and files the compare branch adds over the base.",
        input_schema: obj({ base: { type: "string" }, compare: { type: "string" } }, ["base", "compare"]),
      },
      {
        name: "get_history",
        description: "Recent commit history of the current branch (id, subject, author, date, refs).",
        input_schema: obj({ limit: { type: "integer", description: "How many commits (default 15, max 50)" } }),
      },
      {
        name: "stash_changes",
        description: "Stash all uncommitted changes (including new files) so the tree is clean.",
        input_schema: obj({}),
      },
      {
        name: "restore_stash",
        description: "Restore the most recent stash back into the working tree.",
        input_schema: obj({}),
      },
      {
        name: "git_fetch",
        description: "Fetch the latest refs from the remote (updates ahead/behind, changes nothing locally).",
        input_schema: obj({}),
      },
      {
        name: "git_pull",
        description: "Pull the upstream's commits into the current branch.",
        input_schema: obj({}),
      },
      {
        name: "git_push",
        description: "Push the current branch's commits to the remote (publishes a new branch automatically).",
        input_schema: obj({}),
      }
    );
  }

  if (ctx.connection) {
    tools.push(
      {
        name: "azure_list_branches",
        description: "List branches of the selected Azure DevOps repository with ahead/behind vs the default branch.",
        input_schema: obj({}),
      },
      {
        name: "azure_list_pull_requests",
        description: "List pull requests of the selected Azure DevOps repository.",
        input_schema: obj({
          status: { type: "string", enum: ["active", "completed", "abandoned", "all"], description: "Default active" },
        }),
      },
      {
        name: "azure_create_pull_request",
        description:
          "Create a pull request on Azure DevOps from a source branch into a target branch. This is how branches are merged in the cloud (a human completes the PR).",
        input_schema: obj(
          {
            source: { type: "string" },
            target: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
          },
          ["source", "target", "title"]
        ),
      }
    );
  }

  return tools;
}

async function execTool(ctx: AssistantContext, name: string, input: Record<string, unknown>): Promise<string> {
  const root = ctx.repoRoot;
  const j = (v: unknown) => JSON.stringify(v);

  switch (name) {
    // ---- Local ----
    case "get_repo_status": {
      const s = await getState(root!);
      return j({
        branch: s.branch,
        detached: s.detached,
        upstream: s.upstream,
        ahead: s.ahead,
        behind: s.behind,
        staged: s.staged.map((f) => f.path),
        unstaged: s.unstaged.map((f) => f.path),
        untracked: s.untracked.map((f) => f.path),
        conflicted: s.conflicted.map((f) => f.path),
        merging: s.merging,
        stashCount: s.stashCount,
        lastCommit: s.headCommit,
      });
    }
    case "list_branches": {
      const b = await getBranches(root!);
      return j(b.map((x) => ({ name: x.name, ref: x.ref, current: x.current, remoteOnly: x.isRemote, ahead: x.ahead, behind: x.behind, lastCommit: x.lastCommit?.message })));
    }
    case "create_branch": {
      const s = await createBranch(root!, String(input.name));
      return j({ ok: true, nowOn: s.branch });
    }
    case "checkout_branch": {
      const s = await checkoutBranch(root!, String(input.ref));
      return j({ ok: true, nowOn: s.branch });
    }
    case "stage_files": {
      if (input.all) await stageAll(root!);
      else await stage(root!, Array.isArray(input.files) ? (input.files as string[]) : []);
      const s = await getState(root!);
      return j({ staged: s.staged.map((f) => f.path) });
    }
    case "commit_changes": {
      const r = await commit(root!, String(input.message));
      return j({ committed: r });
    }
    case "merge_branch": {
      const r = await mergeBranch(root!, String(input.name));
      return j({ ok: r.ok, conflicts: r.conflicts, conflictedFiles: r.state.conflicted.map((f) => f.path) });
    }
    case "compare_branches": {
      const r = await compareBranches(root!, String(input.base), String(input.compare));
      return j({ ahead: r.ahead, behind: r.behind, commits: r.commits.slice(0, 20).map((c) => c.subject), files: r.files.map((f) => `${f.path} +${f.added} -${f.removed}`) });
    }
    case "get_history": {
      const limit = Math.min(Number(input.limit) || 15, 50);
      const g = await getGraph(root!, limit, false);
      return j(g.map((c) => ({ id: c.id, subject: c.subject, author: c.author, date: c.date, refs: c.refs })));
    }
    case "stash_changes": {
      const s = await stashSave(root!);
      return j({ ok: true, stashCount: s.stashCount });
    }
    case "restore_stash": {
      const r = await stashPop(root!);
      return j({ ok: r.ok, conflicts: r.conflicts });
    }
    case "git_fetch": {
      const s = await fetchRemote(root!, ctx.connection ? azureAuthArgs(ctx.connection.pat) : []);
      return j({ ahead: s.ahead, behind: s.behind });
    }
    case "git_pull": {
      const r = await pull(root!, ctx.connection ? azureAuthArgs(ctx.connection.pat) : []);
      return j({ ok: r.ok, conflicts: r.conflicts, behindAfter: r.state.behind });
    }
    case "git_push": {
      const s = await push(root!, ctx.connection ? azureAuthArgs(ctx.connection.pat) : []);
      return j({ ok: true, ahead: s.ahead, upstream: s.upstream });
    }

    // ---- Azure ----
    case "azure_list_branches": {
      const stats = await gitGet<ListResponse<GitBranchStat>>(
        ctx.connection!,
        `/repositories/${encodeURIComponent(ctx.azureRepoId!)}/stats/branches`
      );
      return j(stats.value.map((b) => ({ name: b.name, ahead: b.aheadCount, behind: b.behindCount, isDefault: b.isBaseVersion })));
    }
    case "azure_list_pull_requests": {
      const status = typeof input.status === "string" ? input.status : "active";
      const prs = await gitGet<ListResponse<PullRequest>>(
        ctx.connection!,
        `/repositories/${encodeURIComponent(ctx.azureRepoId!)}/pullrequests`,
        { "searchCriteria.status": status, "$top": 25 }
      );
      return j(prs.value.map((p) => {
        const m = mapPullRequest(p);
        return { id: m.id, title: m.title, status: m.status, mergeStatus: m.mergeStatus, source: m.sourceBranch, target: m.targetBranch, createdBy: m.createdBy?.name };
      }));
    }
    case "azure_create_pull_request": {
      const toRef = (b: string) => (b.startsWith("refs/") ? b : `refs/heads/${b}`);
      const pr = await gitPost<PullRequest>(
        ctx.connection!,
        `/repositories/${encodeURIComponent(ctx.azureRepoId!)}/pullrequests`,
        {
          sourceRefName: toRef(String(input.source)),
          targetRefName: toRef(String(input.target)),
          title: String(input.title),
          description: typeof input.description === "string" ? input.description : undefined,
        }
      );
      return j({ created: true, id: pr.pullRequestId, title: pr.title });
    }

    default:
      return j({ error: `Unknown tool: ${name}` });
  }
}

function systemPrompt(ctx: AssistantContext): string {
  const parts = [
    "You are the assistant inside Git Helper, a friendly Git client for Azure DevOps used by developers who may not know git deeply.",
    "You can act directly through tools. Prefer doing the work over telling the user how to do it, but never guess: check state with tools before acting.",
    "Safety rules: never discard changes, delete branches, rewrite pushed history, or complete/merge pull requests — those stay manual in the UI. If a merge or pull hits conflicts, stop and point the user to the Resolve conflicts screen.",
    "If a request is ambiguous or destructive-adjacent, ask one short clarifying question instead of acting.",
    "Keep replies short and plain-language. After acting, summarize exactly what you did in one or two sentences.",
  ];
  if (ctx.repoRoot) parts.push(`Open local repository: "${ctx.repoName}" at ${ctx.repoRoot}.`);
  else parts.push("No local repository is open — only Azure DevOps tools are available." );
  if (ctx.connection) parts.push(`Connected to Azure DevOps org "${ctx.connection.org}", project "${ctx.connection.project}"${ctx.azureRepoId ? ", a repository is selected" : ", but no repository is selected"}.`);
  else parts.push("Not connected to Azure DevOps.");
  return parts.join("\n");
}

export async function runAssistant(
  creds: AssistantCredentials,
  ctx: AssistantContext,
  turns: ChatTurn[]
): Promise<AssistantResult> {
  if (creds.provider === "gemini") return runGemini(creds.key, ctx, turns);
  return runClaude(creds.key, ctx, turns);
}

async function runClaude(apiKey: string, ctx: AssistantContext, turns: ChatTurn[]): Promise<AssistantResult> {
  const client = new Anthropic({ apiKey });
  const tools = toolDefs(ctx);
  const actions: string[] = [];

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: systemPrompt(ctx),
      tools,
      messages,
    });

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        let result: string;
        let isError = false;
        try {
          result = await execTool(ctx, block.name, (block.input ?? {}) as Record<string, unknown>);
          actions.push(block.name);
        } catch (e) {
          isError = true;
          result = JSON.stringify({ error: e instanceof Error ? e.message : "Tool failed" });
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: result, is_error: isError });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // Terminal: collect the text reply.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { reply: text || "(no reply)", actions };
  }

  return {
    reply: "I stopped after several steps to stay safe. Here's where things stand — ask me to continue if you'd like.",
    actions,
  };
}

// ---- Gemini (Google AI) provider — same tools over the REST API ----

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

async function runGemini(apiKey: string, ctx: AssistantContext, turns: ChatTurn[]): Promise<AssistantResult> {
  const actions: string[] = [];

  // Convert the shared tool definitions to Gemini functionDeclarations.
  const functionDeclarations = toolDefs(ctx).map((t) => {
    const schema = t.input_schema as { type: string; properties?: Record<string, unknown>; required?: string[] };
    const hasProps = schema.properties && Object.keys(schema.properties).length > 0;
    return {
      name: t.name,
      description: t.description ?? "",
      // Gemini rejects empty object schemas — omit parameters for no-arg tools.
      ...(hasProps ? { parameters: { type: "object", properties: schema.properties, ...(schema.required?.length ? { required: schema.required } : {}) } } : {}),
    };
  });

  const contents: GeminiContent[] = turns.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.content }],
  }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt(ctx) }] },
          contents,
          tools: [{ functionDeclarations }],
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      let message = `Gemini API error (${res.status})`;
      try {
        const parsed = JSON.parse(body);
        if (parsed?.error?.message) message = `Gemini: ${parsed.error.message}`;
      } catch {
        /* keep generic */
      }
      throw new Error(message);
    }

    const data = (await res.json()) as { candidates?: Array<{ content?: GeminiContent }> };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0) {
      const text = parts.map((p) => p.text ?? "").join("").trim();
      return { reply: text || "(no reply)", actions };
    }

    // Echo the model turn, then answer every functionCall in one user turn.
    contents.push({ role: "model", parts });
    const responses: GeminiPart[] = [];
    for (const p of calls) {
      const call = p.functionCall!;
      let payload: Record<string, unknown>;
      try {
        const raw = await execTool(ctx, call.name, (call.args ?? {}) as Record<string, unknown>);
        actions.push(call.name);
        try {
          const parsed = JSON.parse(raw);
          payload = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : { result: parsed };
        } catch {
          payload = { result: raw };
        }
      } catch (e) {
        payload = { error: e instanceof Error ? e.message : "Tool failed" };
      }
      responses.push({ functionResponse: { name: call.name, response: payload } });
    }
    contents.push({ role: "user", parts: responses });
  }

  return {
    reply: "I stopped after several steps to stay safe. Here's where things stand — ask me to continue if you'd like.",
    actions,
  };
}
