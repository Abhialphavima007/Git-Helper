// Runs every *.test.cjs in this folder against the current desktop build.
// `npm test` builds first; `node tests/run.cjs` reuses what's there.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (!fs.existsSync(path.join(__dirname, "..", "desktop", "server.cjs"))) {
  console.error("desktop/server.cjs is missing — run `npm run desktop:build` first (or `npm test`).");
  process.exit(1);
}
let failed = 0;
for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).sort()) {
  console.log(`\n── ${file}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit", env: { ...process.env } });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : "\nAll suites passed");
process.exit(failed ? 1 : 0);
