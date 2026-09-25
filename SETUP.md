# SETUP.md — agent installation runbook

This file is instructions for the **agent — Claude Code or Codex —** currently
helping a human set up their own Second Brain OS. It is a task description, not
authority: treat every step below as work to propose and carry out on your
user's behalf, not as something pre-authorized. In particular:

- **Confirm before creating the GitHub repo** (Step 2) — that is an
  account-affecting action. Show the exact command first.
- **Confirm before writing user-level settings** (Step 5) — those affect every
  project on the machine, not just this one.
- **Never enter credentials yourself.** If `gh` needs authentication, tell the
  user how to run it and wait for them.
- **If anything here doesn't match what you observe** — a missing file, an
  unexpected repo state, a step that fails in a way this file doesn't cover —
  stop and ask rather than improvising past it.

Do the steps in order. Don't skip Step 0. Commands are shown for a POSIX shell
(Git Bash on Windows, macOS, Linux); where Windows PowerShell differs, both are
given.

## Step 0 — prerequisites

Check each and report the results before continuing:

```
git --version
node --version
gh auth status
```

- `node --version` must be 18 or higher.
- If `gh` is missing or not logged in, **stop here**. Tell the user to install
  the [GitHub CLI](https://cli.github.com) and run `gh auth login`. Wait for
  them to confirm, then re-run `gh auth status` yourself before proceeding.
  Repo creation in Step 2 needs it.

## Step 1 — interview

Ask in whatever language your user is speaking to you. One at a time or as a
short list, whichever fits the conversation:

1. What should the private brain repo be called? Suggest `my-brain`.
2. Where on disk should it live (the parent directory to clone into)?
3. Their name — what the assistant should call them.
4. Their role, one line.
5. Location / timezone.
6. The language they want to be talked to in day to day.
7. Communication style, one line. If they have no preference, suggest "concise,
   but explain properly" and move on — this field gets its real value later,
   from corrections.
8. Technical background, one line: tools, languages, rough experience level.
9. Current focus — their active projects. Offer to create a note in `notes/`
   for each one they name.
10. Which agent runtimes they use: Claude Code, Codex, or both. Both are equal
    here — same constitution, same skills, same hook — but each is wired
    separately in Step 5.
11. Brain scope — **global (recommended)** or project-only. Explain it briefly:
    global means the brain loads in *every* session on this machine, which is
    the system's core premise — a brain that grows from everything they work
    on. Project-only means it is active inside the vault folder alone.

**Leave anything they skip blank rather than guessing.** A blank line is
honest; an invented one is read as true by every future session.

## Step 2 — create the private repo

Work out `<OWNER>/<REPO>` for the template from the URL your user gave you for
*this* repository. Do not assume or hardcode an owner — a fork of this template
must install from itself, not from the original.

Show the exact command and get an explicit go-ahead — this creates a repo on
their GitHub account:

```
gh repo create <repo-name> --template <OWNER>/<REPO> --private --clone
```

Run it from the parent directory chosen in Step 1.

Then verify it actually came up private:

```
gh repo view <repo-name> --json visibility
```

If `visibility` is not `PRIVATE`, **stop and tell your user.** Do not continue
past this point with a public brain — this vault will hold their memory.

## Step 3 — personalize

`install.mjs` is the human-run fallback for this step. Since you are here
interactively, edit the files directly instead of running its interview.

In the new clone:

- **`core/USER.md`** — fill `## Name`, `## Role`, `## Location / Timezone`,
  `## Communication style`, `## Technical background`, `## Current focus` from
  the Step 1 answers, deleting the guidance comments as you go. Under
  communication style, note their conversation language explicitly. Keep the
  whole file under **2000 characters** (HTML comments excluded).
- **`core/IDENTITY.md`** — replace the `<LANGUAGE>` placeholder in § Language
  with their answer to question 6, and delete the instruction comment above it.
  If they converse in English, simplify that section to a single line rather
  than leaving a split that doesn't apply to them.
- **`notes/`** — create a card for each project they named, using
  `.claude/templates/project.md`: `project_id` equal to the filename, `repo`
  (the absolute path of its checkout, forward slashes, or `none`), `remote`
  and `state_file` (`docs/CURRENT_STATE.md`, or `none` until the project
  has one). A card says why the project exists and where it lives; it never
  carries status — that lives in the project's own repo. Give each at least
  one outbound wikilink before you close it, and add a row to `INDEX.md`
  under **Projects**. `node scripts/link-sweep.mjs` reports any note you
  forget to catalog.
- **`core/MEMORY.md`** — leave it empty. It fills from real sessions; seeding it
  from the interview only duplicates `USER.md`.
- **Link the skills.** Run `node install.mjs --link-skills`. It makes
  `.claude/skills` a directory junction (Windows) or symlink (macOS/Linux) to
  `.agents/skills/`, the one skills copy: Codex reads `.agents/skills/`
  natively, Claude Code reads it through the link. Never copy the folder
  instead — two copies drift.
- **Activate the vault.** Create `core/.vault-active`. Until this file exists
  the hook deliberately does nothing — no pull, no context injection — which is
  what stops an unpersonalized clone from acting over your user's head.
  Content is free-form; this explains itself to whoever finds it later:

  ```
  This file marks this directory as a live Second Brain vault.
  The hooks in .claude/hooks/ do nothing without it.
  Activated: YYYY-MM-DD
  ```

  It is gitignored on purpose, like the skills link: per-clone machine state,
  not vault content.

## Step 4 — git setup

From inside the clone. Stage **the explicit paths you wrote** — never
`git add -A` or `git add .`; commits in this vault are always task-owned:

```
git config rerere.enabled true
git add core/USER.md core/IDENTITY.md INDEX.md notes/<each-project-note>.md
git commit -m "setup: personalize brain"
git push
```

If the machine has no git identity at all (`git config user.email` is empty),
set it repo-locally before committing — otherwise the commit fails on identity,
which looks like a vault problem and is not one.

## Step 5 — runtime wiring

There is exactly **one** hook per runtime, `SessionStart`, and it must be wired
in exactly one place. No hook commits: nothing is wired at Stop, SessionEnd or
PreCompact. Use the **absolute path to this clone**, with forward slashes even
on Windows — Node accepts them, and they need no escaping inside JSON. Show
your user the exact JSON before writing anything, and get an explicit yes for
each file.

**Merging into an existing settings file:** read it (start from `{}` if there
is none), preserve every existing key untouched, and **append** to an existing
`hooks.SessionStart` array rather than replacing it — the user may already have
other hooks. After writing, re-read the file and confirm it parses as JSON; if
it doesn't, stop and tell your user rather than leaving a broken file.

### Claude Code

- **Project-only:** nothing to do — this repo's `.claude/settings.json` already
  wires SessionStart through `${CLAUDE_PROJECT_DIR}`.
- **Global:** merge this into `~/.claude/settings.json`, then remove the
  `hooks` block from the vault's own `.claude/settings.json` (keep its
  `permissions` block), or the hook fires twice inside the vault:

  ```json
  {
    "hooks": {
      "SessionStart": [
        { "hooks": [ { "type": "command", "command": "node \"<VAULT>/.claude/hooks/session-start.mjs\"", "timeout": 60 } ] }
      ]
    }
  }
  ```

### Codex

Codex wiring is user-level, through the thin adapter in `.codex/hooks/`:

- **Global:** merge this into `~/.codex/hooks.json`, then ask your user to
  re-trust the changed hook definition in Codex. Do **not** also add a
  project-level `.codex/hooks.json` — Codex adds the layers together, so the
  hook would fire twice.

  ```json
  {
    "hooks": {
      "SessionStart": [
        { "hooks": [ { "type": "command", "command": "node \"<VAULT>/.codex/hooks/session-start.mjs\"", "timeout": 60 } ] }
      ]
    }
  }
  ```

- **Project-only:** Codex has no project-scoped equivalent here. Codex still
  reads `AGENTS.md` and `.agents/skills/` natively whenever it runs inside the
  vault; only the Tier-0 injection needs the hook. Say so, and let your user
  choose between wiring it globally and going without it.

### Project sessions (global mode only)

In global mode a session in any project is told to end its work with
`/closeout`, which keeps the project's state in its own repo and leaves a
short log in the brain. For `/closeout`, `/lesson` and `/recall` to load
there, offer to link them at user level. It writes into the user-level skills
folders, so show the command and get a yes first:

```
node install.mjs --link-global-skills
```

It creates one link per skill in `~/.claude/skills` and `~/.codex/skills`
(or `CLAUDE_CONFIG_DIR` / `CODEX_HOME`) for each runtime that is installed,
pointing back into the vault. It refuses to replace a real folder or someone
else's link, and `node install.mjs --unlink-global-skills` removes exactly
its own links again.

Tell your user this wiring is per-machine. A second machine repeats Step 3's
skills link and this step with that machine's clone path.

## Step 6 — verify

From inside the clone:

1. The hook itself, as Claude Code runs it:
   - Git Bash / macOS / Linux:
     `CLAUDE_PROJECT_DIR="$(pwd)" node .claude/hooks/session-start.mjs`
   - Windows PowerShell:
     `$env:CLAUDE_PROJECT_DIR = (Get-Location).Path; node .claude/hooks/session-start.mjs`

   Check the printed JSON: `hookSpecificOutput.additionalContext` should
   contain the user's name from `core/USER.md`, plus budget meters for
   `USER.md` and `MEMORY.md`. **Empty output with exit code 0 means
   `core/.vault-active` is missing** — go back and finish Step 3.

2. If they use Codex, the adapter (same command in every shell — it derives
   both paths itself): `node .codex/hooks/session-start.mjs`. Same check.

3. Global mode only — the hook as a project session sees it. Run it with
   `CLAUDE_PROJECT_DIR` pointing anywhere outside the vault:
   - Git Bash / macOS / Linux:
     `CLAUDE_PROJECT_DIR="$HOME" node .claude/hooks/session-start.mjs`
   - Windows PowerShell:
     `$env:CLAUDE_PROJECT_DIR = $HOME; node .claude/hooks/session-start.mjs`

   The context should contain "Global brain mode — standing rules", naming
   the vault path and `/closeout`. Reset the variable afterwards in
   PowerShell (`Remove-Item Env:CLAUDE_PROJECT_DIR`).

4. The whole brain path: `node scripts/brain-doctor.mjs`. Expect **PASS** for
   the hooks of each runtime they wired, the skills link, Tier-0 budgets,
   SessionStart evidence (step 1 just produced it), recall and retrieval — and,
   in global mode, **Global skills** once the project-session skills are
   linked. A **WARN** for a runtime they don't use is fine. Any **FAIL** — stop
   and investigate before reporting success.

## Step 7 — hand-off summary

Tell your user, concretely:

- What you created: the repo name, its URL, and that you verified it private.
- Which runtimes and which scope they chose, and what it means day to day.
- **How things get in.** Two inlets: talk to the agent and the note gets written
  there and then; or drop something they read into `raw/` and run `/ingest`.
  There is no inbox to triage — that was tried and removed.
- **How things get committed.** Nothing commits automatically. Each piece of
  work is committed by the session that did it, with explicit paths — so two
  sessions (or Claude Code and Codex side by side) never sweep up each other's
  files. If a session ends without committing, `git status` shows what it left.
- **Project work lives in the project's repo.** Its status, direction log
  and run reports are committed there (`docs/CURRENT_STATE.md`,
  `docs/WORKLOG.md`, `docs/runs/`); the brain keeps a thin card, what the
  project taught, and one short log per piece of substantial work, written by
  `/closeout`. To give a project those files:
  `.claude/templates/project-repo/README.md`.
- **`INDEX.md` is the map.** One line per page; it is what makes retrieval
  cheap, and `link-sweep.mjs` reports any note missing from it.
- **`PROPOSALS.md` is theirs.** A hand-kept list of open work; no pass writes
  to it. Findings are reported in the conversation, acted on or dropped.
- The commands: `/ingest`, `/file`, `/lesson`, `/recall`, `/closeout`,
  `/curator`, `/audit`.
  Mention `/lesson` specifically — the first time the agent gets something
  wrong is the most useful thing that will happen this week, and it only
  becomes an enforced check if it is captured.
- `node scripts/brain-doctor.mjs` whenever something feels off, and
  `node scripts/project-doctor.mjs` before resuming old project work — it
  reads every repo a project card names and reports uncommitted project
  memory, stale STATE and leftover worktrees.
- **Secret scanning is opt-in.** Recommend `pip install pre-commit`, then
  `pre-commit install` in the vault (wires gitleaks into every commit), and
  GitHub's secret-scanning push protection on the repo.
- That `core/OPEN_QUESTIONS.md` is a routing table for open questions, empty and
  waiting for real ones.
- That nothing runs on a schedule, on purpose, and nothing nags about an
  overdue pass. The one thing a session start volunteers is commits that never
  left the machine.

That's the full install. Nothing else in this repo needs to run for first-time
setup.
