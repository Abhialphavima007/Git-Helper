// Azure DevOps commit details and line diffs, against a fake Azure API.
const express = require("express");
const { freshHome, startApp, suite } = require("./helpers.cjs");

const { check, done } = suite("azure");
const files = { "/src/a.cs": { aaaa1111: "one\ntwo\nthree\n", bbbb2222: "one\ntwo changed\nthree\nfour\n" }, "/img.png": { aaaa1111: null, bbbb2222: null }, "/new.txt": { bbbb2222: "hello\n" } };
const fake = express();
fake.get("/org/_apis/connectionData", (_q, r) => r.json({ authenticatedUser: { id: "u", displayName: "Tester" } }));
fake.get("/org/proj/_apis/git/repositories", (_q, r) => r.json({ count: 1, value: [{ id: "r1", name: "Repo" }] }));
fake.get("/org/proj/_apis/git/repositories/r1/commits/:id", (q, r) => r.json({ commitId: q.params.id, comment: "Fix tax\n\nDetails here", author: { name: "Parag", email: "p@x", date: "2026-10-01T00:00:00Z" }, parents: q.params.id === "bbbb2222" ? ["aaaa1111"] : [], changeCounts: { Add: 1, Edit: 1 } }));
fake.get("/org/proj/_apis/git/repositories/r1/commits/:id/changes", (_q, r) => r.json({ changes: [{ item: { path: "/src/a.cs", gitObjectType: "blob" }, changeType: "edit" }, { item: { path: "/src", isFolder: true, gitObjectType: "tree" }, changeType: "edit" }, { item: { path: "/new.txt", gitObjectType: "blob" }, changeType: "add" }, { item: { path: "/img.png", gitObjectType: "blob" }, changeType: "edit" }] }));
fake.get("/org/proj/_apis/git/repositories/r1/items", (q, r) => {
  const f = files[q.query.path];
  const v = f && f[q.query["versionDescriptor.version"]];
  if (f === undefined || v === undefined) return r.status(404).json({ message: "not found" });
  if (v === null) return r.json({ path: q.query.path });
  r.json({ path: q.query.path, content: v });
});
const srv = fake.listen(0, async () => {
  process.env.AZDO_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
  const app = await startApp(freshHome("gh-az-"));
  check("connect to fake Azure", (await app.post("/api/connect", { org: "org", project: "proj", pat: "p" })).status === 200);
  const d = (await app.req("/api/repos/r1/commit/bbbb2222")).json;
  check("commit detail: message, files, folders dropped", d.subject === "Fix tax" && d.body === "Details here" && d.files.length === 3 && d.files.find((f) => f.path === "new.txt").kind === "added", JSON.stringify(d).slice(0, 300));
  const v = (await app.req("/api/repos/r1/commit/bbbb2222/diff?path=src/a.cs")).json;
  check("line diff vs parent", v.status === "modified" && v.diff.includes("-two\n+two changed") && v.diff.includes("+four"), v.diff);
  check("added file → status added, all +", (await app.req("/api/repos/r1/commit/bbbb2222/diff?path=new.txt")).json.diff.includes("+hello"));
  check("binary flagged", (await app.req("/api/repos/r1/commit/bbbb2222/diff?path=img.png")).json.binary === true);
  check("full file at commit", (await app.req("/api/repos/r1/commit/bbbb2222/file?path=src/a.cs")).json.lines.join("|") === "one|two changed|three|four|");
  check("bad commit id rejected", (await app.req("/api/repos/r1/commit/zzz")).status === 400);
  srv.close();
  done();
});
