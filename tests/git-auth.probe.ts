import { runGit } from "../server/git";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-"));
execSync("git init -q", { cwd: dir });
const auth = { pat: "SECRETPAT" };
const expected = "Authorization: Basic " + Buffer.from(":SECRETPAT").toString("base64");
const q = (url: string) => runGit(dir, ["config", "--get-urlmatch", "http.extraheader", url], { auth }).then((s) => s.trim()).catch(() => "");

(async () => {
  console.log((await q("https://dev.azure.com/org/proj/_git/repo")) === expected ? "PASS dev.azure.com gets the PAT" : "FAIL dev.azure.com");
  console.log((await q("https://fabrikam.visualstudio.com/proj/_git/repo")) === expected ? "PASS visualstudio.com gets the PAT" : "FAIL visualstudio.com");
  console.log((await q("https://github.com/x/y.git")) === "" ? "PASS github gets nothing" : "FAIL github");
  console.log((await q("https://dev.azure.com.evil.example/x")) === "" ? "PASS look-alike host gets nothing" : "FAIL look-alike");
  if (process.platform !== "win32") {
    const out = await runGit(dir, ["-c", "alias.showargs=!ps -o args= -p $PPID", "showargs"], { auth }).catch((e) => String(e));
    console.log(!out.includes("Basic") ? "PASS PAT not on the git command line" : "FAIL argv");
  }
})();
