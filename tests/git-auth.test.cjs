// The Azure PAT must reach Azure DevOps hosts only, and never the command line.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { suite } = require("./helpers.cjs");

const { check, done } = suite("git-auth");
(async () => {
  // The server bundle exports startServer only; reach runGit through the
  // TypeScript source with tsx (dev dependency).
  const src = path.join(__dirname, "git-auth.probe.ts");
  const out = execSync(`npx tsx "${src}"`, { cwd: path.join(__dirname, ".."), env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), "gh-auth-")) } }).toString();
  for (const line of out.trim().split("\n")) check(line.replace(/^(PASS|FAIL) /, ""), line.startsWith("PASS"));
  done();
})();
