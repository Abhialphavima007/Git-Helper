import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { useLocalRepo } from "../context/LocalRepoContext";
import { Spinner } from "./ui";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  actions?: string[];
}

const ACTION_LABELS: Record<string, string> = {
  get_repo_status: "checked status",
  list_branches: "listed branches",
  create_branch: "created a branch",
  checkout_branch: "switched branch",
  stage_files: "staged files",
  commit_changes: "committed",
  merge_branch: "merged",
  compare_branches: "compared branches",
  get_history: "read history",
  stash_changes: "stashed changes",
  restore_stash: "restored stash",
  git_fetch: "fetched",
  git_pull: "pulled",
  git_push: "pushed",
  azure_list_branches: "listed Azure branches",
  azure_list_pull_requests: "listed PRs",
  azure_create_pull_request: "created a PR",
};

// Floating AI assistant: a chat panel that can act on the open repo and the
// Azure connection through server-side tools.
export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "gemini">("anthropic");
  const [mcpNote, setMcpNote] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const qc = useQueryClient();
  const { selectedRepoId } = useConnection();
  const { root } = useLocalRepo();
  const bottomRef = useRef<HTMLDivElement>(null);

  const statusQuery = useQuery({
    queryKey: ["assistant-status"],
    queryFn: () => api.assistant.status(),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const result = await api.assistant.chat(
        next.map((m) => ({ role: m.role, content: m.content })),
        selectedRepoId
      );
      setMessages([...next, { role: "assistant", content: result.reply, actions: result.actions }]);
      // The assistant may have changed repo state — refresh everything.
      if (result.actions.length > 0) {
        qc.invalidateQueries({ queryKey: ["local-state", root] });
        qc.invalidateQueries({ queryKey: ["local-branches", root] });
        qc.invalidateQueries({ queryKey: ["local-graph"] });
        qc.invalidateQueries({ queryKey: ["prs"] });
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong talking to the assistant.";
      setMessages([...next, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function saveKey() {
    setKeyError(null);
    try {
      await api.assistant.setKey(provider, keyInput.trim());
      setKeyInput("");
      setShowSettings(false);
      qc.invalidateQueries({ queryKey: ["assistant-status"] });
    } catch (e) {
      setKeyError(e instanceof ApiError ? e.message : "Couldn't save the key.");
    }
  }

  async function removeKey() {
    setKeyError(null);
    try {
      await api.assistant.removeKey();
      setShowSettings(false);
      qc.invalidateQueries({ queryKey: ["assistant-status"] });
    } catch (e) {
      setKeyError(e instanceof ApiError ? e.message : "Couldn't remove the key.");
    }
  }

  async function disconnectClaudeDesktop() {
    setMcpNote(null);
    try {
      const r = await api.local.disconnectClaudeDesktop();
      setMcpNote(`✅ ${r.message}`);
    } catch (e) {
      setMcpNote(`⚠️ ${e instanceof ApiError ? e.message : "Couldn't disconnect Claude Desktop."}`);
    }
  }

  async function connectClaudeDesktop() {
    setMcpNote(null);
    try {
      const r = await api.local.connectClaudeDesktop();
      setMcpNote(`✅ ${r.message}`);
    } catch (e) {
      setMcpNote(`⚠️ ${e instanceof ApiError ? e.message : "Couldn't connect Claude Desktop."}`);
    }
  }

  const status = statusQuery.data;

  return (
    <>
      {/* Floating launcher */}
      {!open &&
        createPortal(
          <button
            onClick={() => setOpen(true)}
            title="AI assistant"
            aria-label="Open AI assistant"
            className="fixed bottom-5 right-5 z-40 grid h-12 w-12 place-items-center rounded-full bg-accent text-white shadow-lg transition-transform hover:scale-105"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.4-.7L3 21l1.8-4.4a8.4 8.4 0 1 1 16.2-5.1z" />
              <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" strokeWidth="2.4" />
            </svg>
          </button>,
          document.body
        )}

      {/* Panel */}
      {open &&
        createPortal(
          <aside
            className="fixed bottom-0 right-0 z-50 flex h-[min(640px,90vh)] w-full flex-col rounded-t-2xl border border-line bg-card shadow-2xl sm:bottom-5 sm:right-5 sm:w-[400px] sm:rounded-2xl"
            role="dialog"
            aria-label="AI assistant"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="font-display text-sm font-semibold text-ink">Assistant</h2>
                <p className="text-[11px] text-muted">Can check status, branch, commit, compare, push & pull, and open PRs.</p>
              </div>
              <div className="flex items-center gap-1.5">
                {status?.canConfigure && (
                  <button
                    onClick={() => {
                      setShowSettings((v) => !v);
                      setMcpNote(null);
                      setKeyError(null);
                    }}
                    aria-label="Assistant settings"
                    title="Settings: change or remove key, Claude Desktop"
                    className={`rounded-md border border-line p-1.5 hover:bg-paper ${showSettings ? "text-accent" : "text-muted hover:text-ink"}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close assistant"
                  className="rounded-md border border-line p-1.5 text-muted hover:bg-paper hover:text-ink"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Setup / settings state */}
            {status && (!status.configured || showSettings) ? (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-ink">
                    {status.configured ? "Assistant settings" : "One-time setup"}
                  </h3>
                  {status.configured && (
                    <button onClick={() => setShowSettings(false)} className="text-xs font-medium text-accent hover:underline">
                      ← Back to chat
                    </button>
                  )}
                </div>
                {status.configured && (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-paper px-3 py-2">
                    <p className="text-sm text-ink">
                      Using <b>{status.provider === "gemini" ? "Gemini" : "Claude"}</b>
                      <span className="text-muted"> — paste a new key below to switch or update.</span>
                    </p>
                    <button
                      onClick={removeKey}
                      className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-danger hover:bg-card"
                    >
                      Remove key
                    </button>
                  </div>
                )}
                {status.canConfigure ? (
                  <>
                    <p className="mt-1.5 text-sm text-muted">
                      Pick an AI provider and paste its API key —{" "}
                      {status.hosted
                        ? "it's kept in your own encrypted session (private to you, like your Azure token) and used server-side."
                        : "it's stored only on this machine and used server-side, never in the browser."}
                    </p>
                    <div className="mt-3 inline-flex rounded-lg border border-line bg-card p-0.5">
                      {(["anthropic", "gemini"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            setProvider(p);
                            setKeyError(null);
                          }}
                          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            provider === p ? "bg-accent/10 text-accent" : "text-muted hover:text-ink"
                          }`}
                        >
                          {p === "anthropic" ? "Claude" : "Gemini"}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {provider === "anthropic" ? (
                        <>Get a key at <span className="font-mono">console.anthropic.com</span> → API keys.</>
                      ) : (
                        <>Get a free key at <span className="font-mono">aistudio.google.com</span> → Get API key. Both key formats work (<span className="font-mono">AIza…</span> and <span className="font-mono">AQ.…</span>).</>
                      )}
                    </p>
                    <input
                      type="password"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder={provider === "anthropic" ? "sk-ant-…" : "AIza… or AQ.…"}
                      className="mt-3 w-full rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm text-ink focus-visible:border-accent"
                    />
                    {keyError && <p className="mt-1.5 text-xs text-danger">{keyError}</p>}
                    <button
                      onClick={saveKey}
                      disabled={!keyInput.trim()}
                      className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      Save key
                    </button>

                    {!status.hosted && (
                      <>
                        <div className="mt-5 flex items-center gap-3">
                          <span className="h-px flex-1 bg-line" />
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">or, no key at all</span>
                          <span className="h-px flex-1 bg-line" />
                        </div>
                        <p className="mt-3 text-sm text-muted">
                          Have the <b>Claude Desktop app</b>? Connect it once and chat with your repos there — runs on
                          your Claude subscription, no API key.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={connectClaudeDesktop}
                            className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
                          >
                            Connect Claude Desktop
                          </button>
                          <button
                            onClick={disconnectClaudeDesktop}
                            title="Remove Git Helper from Claude Desktop"
                            className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-danger"
                          >
                            Disconnect
                          </button>
                        </div>
                        {mcpNote && <p className="mt-2 text-xs text-muted">{mcpNote}</p>}
                      </>
                    )}
                  </>
                ) : (
                  <p className="mt-1.5 text-sm text-muted">
                    On the hosted app, the site owner enables the assistant by setting the{" "}
                    <span className="font-mono">ANTHROPIC_API_KEY</span> (or <span className="font-mono">GEMINI_API_KEY</span>) environment variable.
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* Messages */}
                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {messages.length === 0 && (
                    <div className="rounded-xl bg-paper p-3 text-sm text-muted">
                      <p className="font-medium text-ink">Hi! I can work your repo for you.</p>
                      <p className="mt-1.5">Try:</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        <li>"What's the state of my repo?"</li>
                        <li>"Create a branch fix/tax and switch to it"</li>
                        <li>"Stage everything and commit with a good message"</li>
                        <li>"Compare my branch with master"</li>
                        <li>"Open a PR from my branch into main"</li>
                      </ul>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                      <div
                        className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                          m.role === "user" ? "bg-accent text-white" : "bg-paper text-ink"
                        }`}
                      >
                        {m.content}
                        {m.actions && m.actions.length > 0 && (
                          <p className="mt-1.5 border-t border-line/50 pt-1.5 text-[10px] uppercase tracking-wide opacity-70">
                            ✓ {[...new Set(m.actions)].map((a) => ACTION_LABELS[a] ?? a).join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  {busy && (
                    <div className="flex justify-start">
                      <div className="rounded-xl bg-paper px-3 py-2">
                        <Spinner label="Working…" />
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Input */}
                <div className="border-t border-line p-3">
                  <div className="flex gap-2">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      rows={1}
                      placeholder="Ask or instruct… (Enter to send)"
                      className="max-h-28 min-h-[38px] flex-1 resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus-visible:border-accent"
                    />
                    <button
                      onClick={() => void send()}
                      disabled={busy || !input.trim()}
                      className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
                      aria-label="Send"
                    >
                      ➤
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted">
                    Never discards work or completes merges/PRs — those stay in your hands.
                  </p>
                </div>
              </>
            )}
          </aside>,
          document.body
        )}
    </>
  );
}
