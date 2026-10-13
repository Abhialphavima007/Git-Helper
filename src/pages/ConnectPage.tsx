import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type SavedConnection } from "../api/client";
import { useConnection } from "../context/ConnectionContext";
import { useLocalRepo } from "../context/LocalRepoContext";
import { ErrorNote, StatusDot } from "../components/ui";
import { OpenRepoForm } from "../components/OpenRepoForm";

export function ConnectPage() {
  const { applyConnect, connected, org: currentOrg, project: currentProject } = useConnection();
  const { localEnabled } = useLocalRepo();
  const navigate = useNavigate();
  // /connect?switch=1 — sign in to a different org/project while connected.
  const [params] = useSearchParams();
  const switching = params.get("switch") === "1";
  const [org, setOrg] = useState("");
  const [project, setProject] = useState("");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [showHelp, setShowHelp] = useState(false);
  // Desktop: the projects signed into before on this computer.
  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const [rememberToken, setRememberToken] = useState(true);
  const patRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!localEnabled) return;
    api.getSavedConnections().then(setSaved).catch(() => setSaved([]));
  }, [localEnabled]);

  if (connected && !switching) {
    navigate("/", { replace: true });
  }

  const isCurrent = (c: { org: string; project: string }) =>
    connected &&
    c.org.toLowerCase() === (currentOrg ?? "").toLowerCase() &&
    c.project.toLowerCase() === (currentProject ?? "").toLowerCase();

  async function signIn(body: { org: string; project: string; pat: string; rememberToken?: boolean; useSavedToken?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.connect(body);
      applyConnect(result.org!, result.project!, result.me, result.repos);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    return signIn({ org: org.trim(), project: project.trim(), pat, rememberToken: localEnabled && rememberToken });
  }

  // One click when a token is saved; otherwise fill the form and ask for it.
  function pickSaved(c: SavedConnection) {
    setOrg(c.org);
    setProject(c.project);
    if (c.hasToken) {
      void signIn({ org: c.org, project: c.project, pat: "", useSavedToken: true });
    } else {
      patRef.current?.focus();
    }
  }

  async function forgetSaved(c: SavedConnection) {
    try {
      setSaved(await api.forgetConnection(c.org, c.project));
    } catch {
      /* list simply stays as it was */
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
            <h2 className="font-display text-lg font-semibold text-ink">
              {switching && connected ? "Switch Azure DevOps project" : "Connect to Azure DevOps"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {switching && connected
                ? `You're signed in to ${currentProject} (${currentOrg}). Pick another project or sign in with a different token.`
                : "Your token is sent to this app's local server and kept in your session — never stored in the browser."}
            </p>
            {switching && connected && (
              <Link to="/" className="mt-2 inline-block text-xs font-medium text-accent hover:text-accent-hover">
                ← Keep using {currentProject}
              </Link>
            )}

            {saved.length > 0 && (
              <div className="mt-5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Recent projects</p>
                <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {saved.map((c) => (
                    <li key={`${c.org}/${c.project}`} className="flex items-center gap-2 bg-paper/60 pr-2">
                      <button
                        type="button"
                        disabled={busy || isCurrent(c)}
                        onClick={() => pickSaved(c)}
                        title={isCurrent(c) ? "Currently signed in" : c.hasToken ? "Sign in with the saved token" : "Fill in and paste your token"}
                        className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-paper disabled:opacity-60"
                      >
                        <span className="block truncate text-sm font-medium text-ink">
                          {c.project}
                          {isCurrent(c) && <span className="ml-2 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">current</span>}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {c.org}
                          {c.user ? ` · ${c.user}` : ""}
                          {c.hasToken ? " · token saved" : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => forgetSaved(c)}
                        title="Forget this project"
                        aria-label={`Forget ${c.project}`}
                        className="rounded-md p-1 text-muted hover:bg-paper hover:text-danger"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted">or sign in to another</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              </div>
            )}

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
                  ref={patRef}
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

              {localEnabled && (
                <label className="flex items-start gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={rememberToken}
                    onChange={(e) => setRememberToken(e.target.checked)}
                  />
                  <span>
                    Remember this token on this computer, so next time the project is one click.
                    <span className="block text-muted/80">Stored encrypted in your user profile; forget it any time from the list above.</span>
                  </span>
                </label>
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
