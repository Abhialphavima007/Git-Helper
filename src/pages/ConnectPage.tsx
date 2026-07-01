import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { useLocalRepo } from "../context/LocalRepoContext";
import { ErrorNote, StatusDot } from "../components/ui";
import { OpenRepoForm } from "../components/OpenRepoForm";

export function ConnectPage() {
  const { applyConnect, connected } = useConnection();
  const { localEnabled } = useLocalRepo();
  const navigate = useNavigate();
  const [org, setOrg] = useState("");
  const [project, setProject] = useState("");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [showHelp, setShowHelp] = useState(false);

  if (connected) {
    navigate("/", { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.connect({ org: org.trim(), project: project.trim(), pat });
      applyConnect(result.org!, result.project!, result.me, result.repos);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus-visible:border-accent";

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-12 px-6 py-12 lg:grid-cols-2">
        {/* Thesis: know where you stand, and what's safe to do next. */}
        <section className="order-2 lg:order-1">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Git, in plain language</p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight text-ink">
            Know exactly where your repo stands — and what's safe to do next.
          </h1>
          <p className="mt-4 max-w-md text-muted">
            A calmer way to work with Azure DevOps Repos. No CLI flags, no guessing whether it's safe to pull. Every
            screen tells you where you are, what the state is, and your next safe step.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-ink">
            <li className="flex items-center gap-3">
              <StatusDot light="ok" /> Green means up to date and safe to act.
            </li>
            <li className="flex items-center gap-3">
              <StatusDot light="warn" /> Amber means something needs your attention first.
            </li>
            <li className="flex items-center gap-3">
              <StatusDot light="danger" /> Red means blocked or in conflict — handle with care.
            </li>
          </ul>
        </section>

        {/* Connection form */}
        <section className="order-1 lg:order-2">
          <div className="rounded-2xl border border-line bg-card p-6 shadow-card">
            <h2 className="font-display text-lg font-semibold text-ink">Connect to Azure DevOps</h2>
            <p className="mt-1 text-sm text-muted">
              Your token is sent to this app's local server and kept in your session — never stored in the browser.
            </p>

            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Organization</label>
                <input
                  className={inputClass}
                  placeholder="contoso"
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  autoComplete="off"
                  required
                />
                <p className="mt-1 text-xs text-muted">From dev.azure.com/<b>{org || "your-org"}</b></p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Project</label>
                <input
                  className={inputClass}
                  placeholder="Payments Platform"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">Personal access token</label>
                <input
                  className={`${inputClass} font-mono`}
                  type="password"
                  placeholder="••••••••••••••••"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  autoComplete="off"
                  required
                />
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-accent hover:text-accent-hover"
                  onClick={() => setShowHelp((v) => !v)}
                >
                  {showHelp ? "Hide" : "How do I create a token?"}
                </button>
              </div>

              {showHelp && (
                <div className="rounded-lg border border-line bg-paper px-3 py-3 text-xs text-muted">
                  <p className="font-medium text-ink">Create a PAT in Azure DevOps</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-4">
                    <li>User settings (top right) → Personal access tokens → New token.</li>
                    <li>Scope this app needs now: <b>Code → Read</b>.</li>
                    <li>For later actions (creating PRs, completing merges): <b>Code → Read &amp; Write</b>.</li>
                    <li>Copy the token and paste it above. You can revoke it anytime.</li>
                  </ol>
                </div>
              )}

              {error != null && <ErrorNote error={error} />}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {busy ? "Connecting…" : "Connect"}
              </button>
            </form>
          </div>
          <p className="mt-3 text-center text-xs text-muted">
            Prototype mode · read-only access is enough to explore
          </p>

          {/* Or: work entirely against a local repo on this machine (desktop only). */}
          {localEnabled && (
            <>
              <div className="mt-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted">or</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="mt-6 rounded-2xl border border-line bg-card p-6 shadow-card">
                <h2 className="font-display text-lg font-semibold text-ink">Work with a local repository</h2>
                <p className="mt-1 text-sm text-muted">
                  No token needed. Open a Git folder on this machine to visualise history, stage and commit, and resolve
                  merge conflicts — all in plain language.
                </p>
                <OpenRepoForm compact />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
