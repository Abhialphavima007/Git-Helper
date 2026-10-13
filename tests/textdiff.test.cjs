// The built-in line diff used for Azure commits.
const { execSync } = require("node:child_process");
const path = require("node:path");
const { suite } = require("./helpers.cjs");
const { check, done } = suite("textdiff");
const out = execSync(`npx tsx "${path.join(__dirname, "textdiff.probe.ts")}"`, { cwd: path.join(__dirname, "..") }).toString();
for (const line of out.trim().split("\n")) check(line.replace(/^(PASS|FAIL) /, ""), line.startsWith("PASS"));
done();
