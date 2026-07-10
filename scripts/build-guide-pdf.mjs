// Render docs/USER-GUIDE.md to docs/Git-Helper-User-Guide.pdf.
// Pipeline: marked -> styled HTML (temp file next to the images so relative
// paths work under file://) -> headless Edge --print-to-pdf. Edge sometimes
// lingers after writing the file, so we poll for a stable PDF and then kill
// the process ourselves.

import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = path.join(root, "docs", "USER-GUIDE.md");
const htmlPath = path.join(root, "docs", "_guide.html");
const pdfPath = path.join(root, "docs", "Git-Helper-User-Guide.pdf");

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) {
  console.error("Microsoft Edge not found — needed to print the PDF.");
  process.exit(1);
}

const md = readFileSync(mdPath, "utf8");
const body = marked.parse(md, { mangle: false, headerIds: true });

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", -apple-system, sans-serif; color: #1a2233; margin: 0; padding: 28px 34px; font-size: 11.5px; line-height: 1.55; }
  h1 { font-size: 24px; border-bottom: 3px solid #4353c9; padding-bottom: 8px; margin: 0 0 14px; }
  h2 { font-size: 17px; color: #2a3990; border-bottom: 1px solid #d8ddf0; padding-bottom: 4px; margin-top: 26px; page-break-after: avoid; }
  h3 { font-size: 13.5px; color: #333f63; margin-top: 18px; page-break-after: avoid; }
  code { background: #eef1fb; border-radius: 3px; padding: 1px 4px; font-family: Consolas, monospace; font-size: 10.5px; }
  pre { background: #eef1fb; border-radius: 6px; padding: 10px; overflow-x: hidden; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; page-break-inside: avoid; }
  th, td { border: 1px solid #cdd4ea; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #eef1fb; }
  img { max-width: 100%; border: 1px solid #d8ddf0; border-radius: 6px; margin: 6px 0; page-break-inside: avoid; }
  blockquote { border-left: 3px solid #4353c9; margin: 10px 0; padding: 2px 12px; color: #47506b; background: #f6f7fd; }
  a { color: #2a3990; text-decoration: none; }
  hr { border: none; border-top: 1px solid #d8ddf0; margin: 20px 0; }
  li { margin: 2.5px 0; }
</style></head><body>${body}</body></html>`;

writeFileSync(htmlPath, html, "utf8");

if (existsSync(pdfPath)) unlinkSync(pdfPath);

const child = spawn(
  edge,
  [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    `--print-to-pdf=${pdfPath}`,
    "--print-to-pdf-no-header",
    pathToFileURL(htmlPath).href,
  ],
  { stdio: "ignore" }
);

// Wait until the PDF exists and its size has been stable for a second.
const started = Date.now();
let lastSize = -1;
const timer = setInterval(() => {
  const timedOut = Date.now() - started > 90_000;
  let size = -1;
  try {
    size = statSync(pdfPath).size;
  } catch {
    /* not written yet */
  }
  if ((size > 0 && size === lastSize) || timedOut) {
    clearInterval(timer);
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    try {
      unlinkSync(htmlPath);
    } catch {
      /* fine */
    }
    if (timedOut && size <= 0) {
      console.error("Timed out waiting for Edge to produce the PDF.");
      process.exit(1);
    }
    console.log(`Wrote ${pdfPath} (${Math.round(size / 1024)} KB)`);
    process.exit(0);
  }
  lastSize = size;
}, 1000);
