// Prints the GitHub Release notes for a tag (e.g. v0.4.1): the matching
// CHANGELOG.md section plus a download table with direct links per device.
// Used by the release workflow:
//   node scripts/release-notes.mjs v0.4.1 > release-notes.md

import { readFileSync, existsSync } from "node:fs";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/release-notes.mjs <tag>");
  process.exit(1);
}
const version = tag.replace(/^v/, "");

// Where the installers live: the repo this runs in, else the publish target
// from desktop/package.json (local runs).
let repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  const pkg = JSON.parse(readFileSync("desktop/package.json", "utf8"));
  const gh = (pkg.build?.publish || []).find((p) => p.provider === "github");
  repo = gh ? `${gh.owner}/${gh.repo}` : "";
}
const download = (file) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`;

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

const exe = `Git-Helper-Setup-${version}.exe`;
const dmg = `Git-Helper-${version}-universal.dmg`;

const downloads = `## Download / update

| Your device | Download | Then |
|---|---|---|
| Windows 10 / 11 (64-bit, Intel/AMD or ARM) | [${exe}](${download(exe)}) | Run it. It installs over an existing Git Helper; your repositories, saved projects and settings are kept. |
| macOS (Intel & Apple Silicon, one file) | [${dmg}](${download(dmg)}) | Open it, drag Git Helper to Applications, replace the old copy. |
| Browser (nothing to install) | Hosted app on Vercel | Updates on its own. |

**Already have Git Helper?** Download the same file as a new install and run it — that is the update. Nothing to uninstall first.

The builds are not code-signed, so on first launch: **Windows** SmartScreen → *More info* → *Run anyway*; **macOS** → right-click the app → *Open* → *Open*. Details in [desktop/README.md](https://github.com/${repo}/blob/main/desktop/README.md).`;

process.stdout.write([body, downloads].filter(Boolean).join("\n\n") + "\n");
