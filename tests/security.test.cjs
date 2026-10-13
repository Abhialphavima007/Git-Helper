// The local API must only answer the app's own window, and must never read,
// write or run outside the open repository.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { freshHome, newRepo, git, startApp, suite } = require("./helpers.cjs");

const { check, done } = suite("security");
(async () => {
  const home = freshHome("gh-sec-");
  const repo = newRepo(home);
  git(repo, "commit -q --allow-empty -m init");
  fs.mkdirSync(path.join(home, "repo-secrets"));
  fs.writeFileSync(path.join(home, "repo-secrets", "s.txt"), "SECRET");

  const app = await startApp(home);
  const saved = app.getCookie();

  app.setCookie("");
  check("api blocked without launch cookie", (await app.req("/api/health")).status === 401);
  app.setCookie(saved);
  check("api ok with cookie", (await app.req("/api/health")).status === 200);
  const hostStatus = await new Promise((res) => http.get({ host: "127.0.0.1", port: app.port, path: "/api/health", headers: { host: "evil.example:" + app.port, cookie: saved } }, (r) => res(r.statusCode)));
  check("DNS-rebinding host rejected", hostStatus === 403, hostStatus);
  check("cross-site fetch rejected", (await app.req("/api/health", { headers: { "sec-fetch-site": "cross-site" } })).status === 403);
  check("text/plain POST rejected", (await app.req("/api/local/open", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status === 415);
  check("foreign Origin POST rejected", (await app.req("/api/local/open", { method: "POST", body: "{}", headers: { "content-type": "application/json", origin: "https://evil.example" } })).status === 403);

  check("open repo works", (await app.post("/api/local/open", { path: repo })).status === 200);
  check("session key file created", fs.existsSync(path.join(home, ".azdo-git-helper", "session.key")));

  const outside = encodeURIComponent("../repo-secrets/s.txt");
  check("conflict read traversal blocked", !(await app.req("/api/local/conflict?file=" + outside)).body.includes("SECRET"));
  check("diff sibling traversal blocked", !(await app.req("/api/local/diff?file=" + outside)).body.includes("SECRET"));
  check("preview traversal blocked", !(await app.req("/api/local/preview?file=" + outside)).body.includes("SECRET"));
  await app.post("/api/local/resolve", { file: "../pwned.txt", content: "x" });
  check("conflict write traversal blocked", !fs.existsSync(path.join(home, "pwned.txt")));

  const target = path.join(home, "pwn-out");
  await app.post("/api/local/checkout", { name: "--output=" + target });
  await app.req("/api/local/branch-commits?name=" + encodeURIComponent("--output=" + target));
  check("option-injection via branch names blocked", !fs.existsSync(target));
  check("option-looking ref rejected (preview)", (await app.req("/api/local/preview?file=x&ref=" + encodeURIComponent("--output=" + target))).status === 400);
  check("option-looking ref rejected (archive)", (await app.req("/api/local/archive?file=x&against=" + encodeURIComponent("--output=" + target))).status === 400);
  check("option-looking againstFile rejected", (await app.req("/api/local/archive?file=x&against=HEAD&againstFile=" + encodeURIComponent("--output=" + target))).status === 400);
  check("oversized body rejected", (await app.req("/api/local/open", { method: "POST", body: "x".repeat(51 * 1024 * 1024), headers: { "content-type": "application/json", origin: app.base } })).status === 413);
  check("normal branch create still works", (await app.post("/api/local/branch", { name: "feature/test" })).status === 200);
  check("azure disconnect keeps local repo open", (await app.post("/api/disconnect", {})).status === 204 && (await app.req("/api/local/state")).status === 200);
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
