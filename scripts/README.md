# scripts/ — automation roster

Deterministic work lives here as plain scripts (PowerShell + Node stdlib, no
npm installs). LLM spend is reserved for judgment calls (`/triage`,
`/curator`) — see `CLAUDE.md` and `_brain/playbooks/lifecycle-policy.md` for
the policy these scripts implement. Substrate: **Windows Task Scheduler +
headless `claude -p`**.

Two scripts touch git/vault state concurrently with each other, so they share
a lockfile: `scripts/.brain.lock` (PID + UTC timestamp + owner, one line;
stale and auto-broken after 2 hours). `lock.ps1` implements it for the
PowerShell scripts; `daily3-resurface.mjs` re-implements the same tiny
protocol inline since it's Node. **B1, B3, B5, and B6 all respect this
lock** — if another job is mid-run, the later one logs a message and exits 0
rather than racing it.

## B1 — `verify-backup.ps1`

- **What:** checks `origin` is reachable (`git ls-remote`), local HEAD is in
  sync with `origin/<branch>` (not ahead, not behind), and no uncommitted
  file is older than 12 hours.
- **When:** daily.
- **Output:** silent on success (exit 0, nothing written). On failure: an
  alert line on stdout plus `_brain/logs/YYYY-MM-DD_backup-alert.md`, exit
  non-zero.
- **Kill criterion:** never — keep this as long as the vault has a remote.

## B2 — `link-sweep.mjs`

- **What:** scans every `.md` file (excluding `.git/`, `.claude/`,
  `.obsidian/`, `archive/` as sources) for broken `[[wikilinks]]` (by
  filename or `aliases:` frontmatter), orphan notes (no inbound *and* no
  outbound resolved links — separately excluding `_brain/logs/`, `daily/`,
  `inbox/` from being *reported*, since that's episodic content, not the
  linked graph), and dangling pointer lines in `_brain/MEMORY.md`.
- **When:** weekly.
- **Output:** report note `_brain/logs/YYYY-MM-DD_link-sweep.md`.
- **Kill criterion:** orphan count flat for a month — simplify or drop it.

## B3 — `offsite-bundle.ps1`

- **What:** `git bundle create --all` to a destination directory, then `git
  bundle verify`. Keeps the last 8 `*.bundle` files in that directory,
  deletes older ones (bundle files only — nothing else in the destination is
  touched).
- **When:** weekly.
- **Output:** a verified `.bundle` file in the destination.
- **Kill criterion:** never; restore-test quarterly (`git clone
  <bundle-path> scratch-restore-test` and confirm history is intact).
- **Destination — action required:** resolved from `-Destination` param, else
  `$env:SECOND_BRAIN_BUNDLE_DIR`, else the placeholder
  `%USERPROFILE%\vault-backups`. **The placeholder is not a real off-site
  location.** You must set `SECOND_BRAIN_BUNDLE_DIR` to an actual second
  location (different physical drive, ideally a different machine or a
  cloud-synced folder) before this is scheduled for real — GitHub alone is
  not the "1" of 3-2-1 backup.

## B4 — gitleaks pre-commit hook

`.pre-commit-config.yaml` already runs `gitleaks` (the standard
`gitleaks/gitleaks` pre-commit repo, pinned at `v8.18.4`) as a second,
independent secret scanner alongside the always-on custom Node scanner in
`.claude/hooks/lib.mjs` (`scanStagedForSecrets`, runs on every checkpoint
commit with no setup required). Nothing needed to change here — this note
just documents that B4's script-side requirement is already in place.

- **Action required (manual, GitHub settings):** enable **push protection**
  for secret scanning on your vault's repo
  (Settings → Code security and analysis → Secret scanning → Push
  protection). This cannot be done from a script or from this vault's config
  — it's a GitHub repo setting.
- Local `pre-commit` framework install is optional and per-contributor:
  `pip install pre-commit && pre-commit install`. It's defense-in-depth for
  humans committing by hand; the Node scanner is what actually protects the
  vault by default.

## B5 — `weekly-maintenance.ps1`

- **What:** runs `claude -p "/triage then /curator"` headless from the vault
  root. `/triage` empties `inbox/` (48h rule); `/curator` consolidates and
  applies safe fixes directly, but proposes destructive/structural changes as
  a table rather than applying them (evolution decoupled from execution).
  Lockfile-guarded via `lock.ps1`.
- **When:** weekly.
- **Output:** filed inbox + a proposal doc/table for you to review.
- **Kill criterion:** approval backlog exceeding 1 week.
- **Do not run ad hoc** — it spawns a real headless Claude Code session
  against the live vault. Only meant to run unattended via Task Scheduler.

## B6 — `daily3-resurface.mjs`

- **What:** picks 3 notes from `knowledge/`, `_brain/memory/`, and
  `projects/` by weighted random selection — weight = days since
  `last_surfaced` (frontmatter; falls back to file mtime) + a link-sparsity
  bonus (favors under-linked notes) + jitter — excluding anything modified in
  the last 7 days. Appends a `## Resurfaced` section with the 3 picks (as
  wikilinks) to today's daily note (`daily/YYYY-MM-DD.md`, created from
  `_brain/templates/daily.md` if missing), then sets/updates
  `last_surfaced: YYYY-MM-DD` in each picked note's frontmatter without
  touching any other key. Supports `--dry-run` (prints picks, writes
  nothing). Lockfile-guarded.
- **When:** daily.
- **Output:** 3 links appended to today's daily note.
- **Kill criterion:** resurfaced notes ignored for 2+ weeks — if nobody's
  clicking through, the selection weighting or the whole job needs to change.

## Manual steps for you

1. **Set the off-site bundle destination.** Set the `SECOND_BRAIN_BUNDLE_DIR`
   environment variable (System Properties → Environment Variables, or
   `setx SECOND_BRAIN_BUNDLE_DIR "E:\your\real\path"`) to a real second
   location before B3 runs for real. See B3 above.
2. **Enable GitHub push protection** on your vault's repo (repo Settings →
   Code security and analysis) — see B4 above. Not doable from a script.
3. **Register the scheduled tasks.** Review `register-tasks.ps1`, then run it
   yourself:
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-tasks.ps1`
   Nothing in this repo runs it for you — that's deliberate. It registers 5
   Windows Task Scheduler entries under `\SecondBrain\` (B1, B2, B3, B5 daily/
   weekly as documented above, B6 daily).
4. **B9 — rotate to a fine-grained PAT.** Replace any classic GitHub PAT used
   by this vault's automation with a
   **fine-grained personal access token scoped to one repo
   (`<your-github-user>/<your-vault-repo>`) with Contents read/write only**
   — no other repos, no other permissions. Retire the classic PAT afterwards
   (GitHub → Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Delete). This is a one-time credential change you must
   do by hand in GitHub and wherever the token is stored locally — never put
   a token in vault content or in these scripts.

## B8 — acceptance-logging convention

Every agent suggestion that a human accepts or rejects (a link suggestion, an
MOC proposal, an "unexpected pair", a curator-proposed merge/archive/delete,
etc.) gets one line logged to `_brain/logs/` recording the suggestion and
whether it was accepted or rejected. This is a **convention for the agent
skills to follow** (`/triage`, `/curator`, and any future thinking-partner
feature), not a script — there's nothing here to run. The resulting
accept/reject data is the master metric: suggestion acceptance rate is what
tells you whether a thinking-partner feature is earning its keep or just
adding noise. Log format: a bullet in the relevant session log or a dedicated
`_brain/logs/YYYY-MM-DD_acceptance.md`, e.g.
`- [accepted] link suggestion: [[knowledge/x]] <-> [[knowledge/y]] (curator, 2026-08-19)`.
