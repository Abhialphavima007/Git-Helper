// Prints the CHANGELOG.md section for a tag (e.g. v0.4.0) as GitHub Release
// notes, with a short download hint appended. Used by the release workflow.
//   node scripts/release-notes.mjs v0.4.0 > release-notes.md

import { readFileSync, existsSync } from "node:fs";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/release-notes.mjs <tag>");
  process.exit(1);
}

let body = "";
if (existsSync("CHANGELOG.md")) {
  const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## ") && l.includes(tag));
  if (start !== -1) {
    let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
    if (end === -1) end = lines.length;
    body = lines.slice(start + 1, end).join("\n").trim();
  }
}
if (!body) body = `Desktop installers for Git Helper ${tag}.`;

process.stdout.write(
  body +
    "\n\n**Windows:** Git-Helper-Setup-*.exe · **macOS (Intel & Apple Silicon):** Git-Helper-*-universal.dmg\n" +
    "Unsigned builds — see desktop/README.md for the one-time SmartScreen / Gatekeeper step.\n"
);
