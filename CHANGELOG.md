# Changelog

## v0.4.0 — 2026-10-13

### Security
- Local API answers only the app's own window: launch token + cookie, Host / Origin / Sec-Fetch-Site checks, JSON-only bodies, request size limit.
- Azure PAT is sent only to dev.azure.com / *.visualstudio.com, passed to git through the environment (never on the command line).
- All repo paths and refs from the UI are validated: no reading or writing outside the repository, no option injection via branch names or refs.
- Per-machine session key (no shared default secret); hosted deployments refuse to start without SESSION_SECRET; sessions expire.
- Settings and Claude Desktop config files restricted to the current user; zip previews capped against decompression bombs.
- Electron 44, electron-builder 26, dependency advisories cleared for production packages; GitHub Actions pinned to commit SHAs.
- Server test suite (`npm test`) runs in CI: security, features, Azure commits, git auth, diff engine.

### New
- Sidebar with a Local / Azure switch, repos grouped by the Azure project they were cloned from, Switch project / account.
- Connect page remembers recent projects; optional encrypted token so a project is one click.
- Dashboard redesign: tiles, branch focus, branches to look at, open pull requests.
- Azure DevOps History page: commits per branch, commit details, changed files by folder, red/green line diffs.
- Search on Repositories, Pull requests, Branches, History, Changes and Commit.
- Changes / Commit / History group files by folder (collapsed by default), with Stage/Unstage folder.
- Binary file preview: images, zip contents (with Dynamics solution name/version), hex view.
- Zip explorer compares an archive with its previous version — including a previous export of the same solution when the file name carries the version — and shows per-file Added / Changed / Removed with line diffs.
- Full-page file viewer in its own window: line numbers, unified or side by side, Changes / Full file.
- Commit page keeps the commit box in view however many files are staged.
- `AZDO_BASE_URL` for Azure DevOps Server (on-premises).

### Fixed
- Files inside new folders are listed individually (and show in history).
- Disconnecting Azure no longer closes the open local repository.
- Repos cloned with different casing of the organization name are grouped together.
