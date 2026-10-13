// Shared bits for the server tests: a throw-away HOME, a git repo factory, and
// an HTTP client that behaves like the app's own window (launch cookie, JSON,
// same-origin headers) against the bundled desktop server (desktop/server.cjs).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

function freshHome(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}

function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function newRepo(home, name = "repo") {
  const repo = path.join(home, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init -q -b main");
  git(repo, "config user.email test@example.com");
  git(repo, "config user.name Test");
  return repo;
}

// Build a zip with python's zipfile (always available on the dev machines/CI).
function writeZip(repo, relPath, entries) {
  const script = path.join(os.tmpdir(), `mkzip-${process.pid}-${Date.now()}.py`);
  const lines = Object.entries(entries).map(([name, body]) => `    z.writestr(${JSON.stringify(name)}, ${typeof body === "string" ? JSON.stringify(body) : "bytes(range(256)) * 4"})`);
  fs.writeFileSync(script, `import zipfile\nwith zipfile.ZipFile(${JSON.stringify(relPath)}, "w", zipfile.ZIP_DEFLATED) as z:\n${lines.join("\n")}\n`);
  execSync(`python3 "${script}"`, { cwd: repo });
  fs.unlinkSync(script);
}

async function startApp(home) {
  const { startServer } = require(path.join(__dirname, "..", "desktop", "server.cjs"));
  const token = "t".repeat(64);
  const port = await startServer(path.join(__dirname, "..", "desktop", "dist"), 0, token);
  const base = `http://127.0.0.1:${port}`;
  let cookie = "";
  const req = async (p, o = {}) => {
    const r = await fetch(base + p, { redirect: "manual", ...o, headers: { cookie, "sec-fetch-site": "same-origin", ...(o.headers || {}) } });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const s = sc.find((c) => c.startsWith("azdo.sess="));
    if (s) cookie = cookie.replace(/;?\s*azdo\.sess=[^;]*/, "") + "; " + s.split(";")[0];
    const body = await r.text();
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      /* not json */
    }
    return { r, status: r.status, body, json, sc };
  };
  const post = (p, b) => req(p, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json", origin: base } });
  const x = await req("/?launch=" + token);
  cookie = x.sc[0].split(";")[0];
  return { base, port, token, req, post, setCookie: (c) => (cookie = c), getCookie: () => cookie };
}

function suite(name) {
  let pass = 0;
  let fail = 0;
  const check = (label, ok, extra = "") => {
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : "  " + String(extra).slice(0, 300)}`);
  };
  const done = () => {
    console.log(`\n${name}: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  };
  return { check, done };
}

module.exports = { freshHome, git, newRepo, writeZip, startApp, suite };
