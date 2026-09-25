# Upgrading

What each release changed, and how to bring a vault made from an earlier one
up to date. The README keeps the short version.

## What changed in v1.1

v1.1 (2026-09-25) brings the template in line with the reference instance as
it runs today. The one-line version: **one hook that never commits, two equal
runtimes, and project state that lives in the project's own repo.** Several of
these additions are younger than the usual two-week bar; the owner lifted it
for this release and
[ADR 0046](decisions/0046-template-v1-1-published-ahead-of-the-bar.md) says
which ones.

**Removed**

- The Stop / SessionEnd / PreCompact checkpoint that committed and pushed the
  whole tree (`checkpoint.mjs`, `session-end.mjs`). Commits are task-owned:
  each task stages its own explicit paths (ADR 0042, 0044).
- The session flush (`flush.mjs`), reuse telemetry (`reuse-telemetry.mjs`),
  the proposals sweep (`proposals.mjs`), `/flywheel` and the maintenance due
  line (`maintenance-stamp.mjs`) (ADR 0038, 0039).
- The Node secret scan inside hook commits — there are no hook commits left.

**Added**

- Codex as an equal runtime: `AGENTS.md` is the constitution (`CLAUDE.md`
  imports it), `.agents/skills/` is the one skills copy (`.claude/skills` is
  a link to it), `.codex/hooks/session-start.mjs` is the Codex adapter.
- Project work in the project's repo (ADR 0045): the repo-side formats in
  `.claude/templates/project-repo/`, thin project cards, `/closeout`, and
  `node install.mjs --link-global-skills` to reach it from any project.
- `scripts/brain-doctor.mjs` and `scripts/project-doctor.mjs`, both
  read-only; the ranked lookup `retrieval-eval.mjs --query`;
  `notes/self-evolution-policy.md`, split out of the lifecycle policy.
- A command line for the compiled checks,
  `node .claude/hooks/checks.mjs [--staged | --all] [--record]`, now that no
  hook runs them; `--help` on `install.mjs` and `link-sweep.mjs`, and
  `BRAIN_DIR` honoured by the link sweep like every other script.

**Changed**

- `SessionStart` skips its pull when the vault has uncommitted changes to
  tracked files, instead of stashing another task's files (no more autostash).
- Secret scanning is opt-in: gitleaks through `.pre-commit-config.yaml`.
- `PROPOSALS.md` is a list you keep by hand; `/curator` and `/audit` report
  in the conversation and their own log instead of appending to it.
- `flywheel-metrics.mjs` is `vault-metrics.mjs`, counting without scoring.
- Project notes are thin cards; their live status moves into each project's
  `docs/CURRENT_STATE.md`.

## Upgrading from v1.0

A vault made with **Use this template** shares no git history with this
repository, so there is nothing to pull: you fetch v1.1 and take its machinery
path by path. Your content — `core/`, `notes/`, `logs/`, `raw/`,
`archive/`, `INDEX.md`, `PROPOSALS.md` — is never overwritten. Start from a
clean tree (`git status` shows nothing), in the vault's root. The commands are
the same in bash and PowerShell.

1. **Fetch v1.1** — with this repository's URL:

   ```
   git remote add template <this repo's URL>
   git fetch template --tags
   ```

2. **Note your own edits first.** `git diff --stat v1.0 HEAD` lists every file
   you changed since setup. Any of them in step 3's list is about to be
   replaced — above all `CLAUDE.md`, which was the constitution in v1.0; save
   `git diff v1.0 HEAD -- CLAUDE.md` somewhere and re-apply it to `AGENTS.md`
   afterwards.

3. **Take the machinery:**

   ```
   git checkout v1.1 -- .agents .claude/hooks .claude/templates .claude/settings.json .codex scripts docs AGENTS.md CLAUDE.md README.md SETUP.md install.mjs .gitignore .gitattributes .pre-commit-config.yaml notes/lifecycle-policy.md notes/self-evolution-policy.md logs/signals/README.md raw/README.md
   ```

4. **Move your own skills** out of `.claude/skills/`, if you added any —
   `git mv .claude/skills/<name> .agents/skills/<name>` for each — then
   **remove what v1.1 deleted:**

   ```
   git rm -r -q .claude/skills .claude/hooks/checkpoint.mjs .claude/hooks/flush.mjs .claude/hooks/maintenance-stamp.mjs .claude/hooks/reuse-telemetry.mjs .claude/hooks/session-end.mjs scripts/flywheel-metrics.mjs scripts/proposals.mjs
   ```

5. **Link the skills and review the rest.** Run
   `node install.mjs --link-skills`. Re-add any lines of your own that
   `git diff --cached -- .gitignore` shows as removed. Compare the files that
   are yours to merge by hand — `git diff HEAD v1.1 -- INDEX.md PROPOSALS.md core/IDENTITY.md`
   — and at least add the `[[self-evolution-policy]]` row to `INDEX.md`.
   In global mode, empty the `hooks` block of `.claude/settings.json` again
   (keep `permissions`).

6. **Commit the upgrade.** Stage what you edited in step 5 by name —
   `git add -- .gitignore INDEX.md .claude/settings.json`, whichever you
   touched — then `git commit -m "upgrade: Second Brain OS v1.1"`. The index
   holds exactly the upgrade, because the tree was clean when you started.

7. **Unwire the retired hooks at user level.** In global mode, delete every
   entry in `~/.claude/settings.json` that points at `checkpoint.mjs`,
   `session-end.mjs` or `reuse-telemetry.mjs` in your vault; keep the one
   `SessionStart` entry. For Codex, add its entry as in
   [`SETUP.md`, Step 5](../SETUP.md#codex).

8. **Check it:** `node scripts/brain-doctor.mjs` fails loudly on a retired
   hook still wired, a duplicate SessionStart or a missing skills link. Then,
   optionally, `node install.mjs --link-global-skills`, and turn your project
   notes into cards (`.claude/templates/project.md`).

From here on, nothing commits for you: each task commits its own explicit
paths.
