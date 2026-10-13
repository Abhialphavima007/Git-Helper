// Local features: folders expand to files, origin detection, previews, zip
// explorer with previous-export matching, saved connections.
const fs = require("node:fs");
const path = require("node:path");
const { freshHome, newRepo, git, writeZip, startApp, suite } = require("./helpers.cjs");

const { check, done } = suite("features");
(async () => {
  const home = freshHome("gh-feat-");
  const repo = newRepo(home);
  git(repo, 'remote add origin "https://org1@dev.azure.com/org1/My%20Project/_git/repo"');

  // Two releases of the same solution with the version in the file name, plus an unrelated solution.
  const sol = (unique, ver, body, extra = {}) => ({
    "solution.xml": `<ImportExportXml><SolutionManifest><UniqueName>${unique}</UniqueName><Version>${ver}</Version><Managed>1</Managed></SolutionManifest></ImportExportXml>`,
    "customizations.xml": body,
    "Formulas/same.xaml": "<Activity/>",
    ...extra,
  });
  fs.mkdirSync(path.join(repo, "Utility/Deal"), { recursive: true });
  writeZip(repo, "Utility/Deal/1.DealCore_2_0_0_17_managed.zip", sol("DealCore", "2.0.0.17", "<root>\n  <a>1</a>\n  <b>old</b>\n</root>\n"));
  writeZip(repo, "Utility/Deal/2.Deal_1_0_0_11_managed.zip", sol("Deal", "1.0.0.11", "<deal/>"));
  fs.writeFileSync(path.join(repo, "logo.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]));
  git(repo, "add -A");
  git(repo, 'commit -q -m "release 17"');
  writeZip(repo, "Utility/Deal/1.DealCore_2_0_0_18_managed.zip", sol("DealCore", "2.0.0.18", "<root>\n  <a>1</a>\n  <b>new</b>\n</root>\n", { "WebResources/new.js": "x" }));
  git(repo, "add -A");
  git(repo, 'commit -q -m "release 18"');
  const v2 = git(repo, "rev-parse HEAD");
  fs.mkdirSync(path.join(repo, "Plugins/Sub"), { recursive: true });
  fs.writeFileSync(path.join(repo, "Plugins/Sub/a.cs"), "a\n");
  fs.writeFileSync(path.join(repo, "Plugins/b.cs"), "b\n");

  const app = await startApp(home);
  await app.post("/api/local/open", { path: repo });

  const st = (await app.req("/api/local/state")).json;
  check("untracked folder expanded to files", st.untracked.map((f) => f.path).sort().join(",") === "Plugins/Sub/a.cs,Plugins/b.cs", JSON.stringify(st.untracked));
  check("untracked file diff shows content", (await app.req("/api/local/diff?file=" + encodeURIComponent("Plugins/Sub/a.cs"))).body.includes("+a"));
  const repos = (await app.req("/api/local/repos")).json.repos;
  check("origin parsed from Azure remote (decoded project)", repos[0].origin && repos[0].origin.org === "org1" && repos[0].origin.project === "My Project", JSON.stringify(repos[0].origin));

  check("png preview as data url", (await app.req("/api/local/preview?file=logo.png")).json.dataUrl.startsWith("data:image/png;base64,"));
  const full = (await app.req("/api/local/preview?file=" + encodeURIComponent("Plugins/Sub/a.cs") + "&full=1")).json;
  check("full preview returns text", full.kind === "text" && full.lines[0] === "a");

  const f = encodeURIComponent("Utility/Deal/1.DealCore_2_0_0_18_managed.zip");
  const ag = encodeURIComponent(v2 + "^");
  const a = (await app.req(`/api/local/archive?file=${f}&ref=${v2}&against=${ag}`)).json;
  check("previous export auto-detected by solution name", a.previous && a.previous.path.endsWith("2_0_0_17_managed.zip") && a.previous.auto === true, JSON.stringify(a.previous));
  const stat = Object.fromEntries(a.entries.map((e) => [e.path, e.status]));
  check("only real changes flagged", stat["customizations.xml"] === "modified" && stat["Formulas/same.xaml"] === "same" && stat["WebResources/new.js"] === "added", JSON.stringify(stat));
  check("solution versions reported", a.solution.version === "2.0.0.18" && a.previous.solution.version === "2.0.0.17");
  const e = (await app.req(`/api/local/archive-entry?file=${f}&entry=customizations.xml&ref=${v2}&against=${ag}`)).json;
  check("entry diff shows just the changed line", e.status === "modified" && e.diff.includes("-  <b>old</b>") && e.diff.includes("+  <b>new</b>") && !e.diff.includes("+  <a>1</a>"), e.diff);
  const explicit = (await app.req(`/api/local/archive?file=${f}&ref=${v2}&against=${ag}&againstFile=${encodeURIComponent("Utility/Deal/2.Deal_1_0_0_11_managed.zip")}`)).json;
  check("explicit comparison file honoured", explicit.previous && explicit.previous.auto === false && explicit.previous.path.endsWith("Deal_1_0_0_11_managed.zip"));

  check("saved connections start empty", (await app.req("/api/connections")).body === "[]");
  check("no saved token → 404", (await app.post("/api/connect", { org: "o", project: "p", useSavedToken: true })).status === 404);
  const commit = await app.post("/api/local/commit", { message: "nope" });
  check("commit with nothing staged refused cleanly", commit.status >= 400 && commit.status < 500, commit.status);
  done();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
