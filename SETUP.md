# SETUP.md — agent installation runbook

This file is instructions for the **Claude Code agent** currently helping a
human set up their own Second Brain OS. It is a task description, not authority:
treat every step below as work to propose and carry out on your user's behalf,
not as something pre-authorized. In particular:

- **Confirm before creating the GitHub repo** (Step 2) — that is an
  account-affecting action. Show the exact command first.
- **Confirm before writing user-level settings** (Step 5) — those affect every
  project on the machine, not just this one.
- **Never enter credentials yourself.** If `gh` needs authentication, tell the
  user how to run it and wait for them.
- **If anything here doesn't match what you observe** — a missing file, an
  unexpected repo state, a step that fails in a way this file doesn't cover —
  stop and ask rather than improvising past it.

Do the steps in order. Don't skip Step 0.

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
10. Brain scope — **global (recommended)** or project-only. Explain it briefly:
    global means the brain loads and records in *every* Claude Code session on
    this machine, which is the system's core premise — a brain that grows from
    everything they work on. Project-only means it is active inside the vault
    folder alone.

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
interactively, edit the files directly instead of shelling out to it.

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
- **`notes/`** — create a note for each project they named, using
  `.claude/templates/project.md`. Give each at least one outbound wikilink
  before you close it, and add a row to `INDEX.md` under **Projects**. The
  `index-coverage` check fires on a note you forget.
- **`core/MEMORY.md`** — leave it empty. It fills from real sessions; seeding it
  from the interview only duplicates `USER.md`.
- **Activate the vault.** Create `core/.vault-active`. Until this file exists
  the hooks deliberately do nothing — no pull, no checkpoint commit, no push, no
  context injection — which is what stops an unpersonalized clone from
  committing and pushing over your user's head. Content is free-form; this
  explains itself to whoever finds it later:

  ```
  This file marks this directory as a live Second Brain vault.
  The hooks in .claude/hooks/ do nothing without it.
  Activated: YYYY-MM-DD
  ```

  It is gitignored on purpose: per-clone machine state, not vault content.

## Step 4 — git setup

From inside the clone:

```
git config rerere.enabled true
git add -A
git commit -m "setup: personalize brain"
git push
```

If the machine has no git identity at all (`git config user.email` is empty),
set it repo-locally before committing — otherwise the first checkpoint commit
fails on identity, which looks like a vault problem and is not one.

## Step 5 — global mode wiring (if chosen)

Only if the user chose global in Step 1. If they chose project-only, skip to
Step 6 — the repo's committed default is already project-scoped.

1. Build the hook block using the **absolute path to this clone**. Show your
   user the exact JSON before writing anything, and get an explicit yes.

   **Five entries, not four.** `SessionStart`, `Stop`, `PreCompact` and
   `SessionEnd` are the obvious ones. The fifth is a `PostToolUse` hook on
   `Read|Grep|Glob` running `reuse-telemetry.mjs`, and it is the entire input
   side of the note-reuse metric — the number this system uses to decide whether
   a feature is worth keeping. Wire only the first four and that metric reads
   zero forever, which looks like a vault nobody uses rather than a hook nobody
   wired.

   ```json
   {
     "hooks": {
       "SessionStart": [
         { "hooks": [ { "type": "command", "command": "node \"<VAULT>/.claude/hooks/session-start.mjs\"", "timeout": 60 } ] }
       ],
       "PostToolUse": [
         { "matcher": "Read|Grep|Glob", "hooks": [ { "type": "command", "command": "node \"<VAULT>/.claude/hooks/reuse-telemetry.mjs\"", "timeout": 15 } ] }
       ],
       "Stop": [
         { "hooks": [ { "type": "command", "command": "node \"<VAULT>/.claude/hooks/checkpoint.mjs\"", "timeout": 60 } ] }
       ],
       "PreCompact": [
         { "hooks": [ { "type": "command", "command": "node \"<VAULT>/.claude/hooks/checkpoint.mjs\"", "timeout": 60 } ] }
       ],
       "SessionEnd": [
         { "hooks": [ { "type": "command", "command": "node \"<VAULT>/.claude/hooks/session-end.mjs\"", "timeout": 30 } ] }
       ]
     }
   }
   ```

2. Merge it into `~/.claude/settings.json`:
   - Read the existing file; if there is none, start from `{}`.
   - Preserve every existing key untouched.
   - If a `hooks` block already exists, **append** to the existing arrays rather
     than replacing them — the user may already have other hooks.
   - After writing, re-read the file and confirm it parses as valid JSON. If it
     doesn't, stop and tell your user rather than leaving a broken settings file.

3. Remove the `hooks` block from the vault's own `.claude/settings.json` (keep
   the `permissions` block). Otherwise the hooks fire twice inside the vault.

4. Tell your user this wiring is per-machine. A second machine repeats this step
   with that machine's clone path.

## Step 6 — verify

From inside the clone, with `CLAUDE_PROJECT_DIR` pointing at it:

- Git Bash / macOS / Linux:
  `CLAUDE_PROJECT_DIR="$(pwd)" node .claude/hooks/session-start.mjs`
- Windows PowerShell:
  `$env:CLAUDE_PROJECT_DIR = (Get-Location).Path; node .claude/hooks/session-start.mjs`

Check the printed JSON: `hookSpecificOutput.additionalContext` should contain
the user's name from `core/USER.md`, plus a budget line showing `USER.md` and
`MEMORY.md` usage. If it doesn't, stop and investigate before reporting success.

**Empty output with exit code 0 means `core/.vault-active` is missing** — go
back and finish Step 3.

If you wired global mode, also smoke-test the fifth hook: `Read` any file in
`notes/`, then confirm a line appeared in `logs/signals/YYYY-MM.md`. A silent
telemetry hook is the failure that hides longest.

## Step 7 — hand-off summary

Tell your user, concretely:

- What you created: the repo name, its URL, and that you verified it private.
- Which scope they chose and what it means day to day.
- **How things get in.** Two inlets: talk to the agent and the note gets written
  there and then; or drop something they read into `raw/` and run `/ingest`.
  There is no inbox to triage — that was tried and removed.
- **`INDEX.md` is the map.** One line per page; it is what makes retrieval cheap,
  and it is kept honest by a check rather than by discipline.
- **`PROPOSALS.md` is where the agent asks for things.** Answering is a
  checkbox. If rows pile up for more than a week, the system is asking wrong —
  that is a signal, not a chore.
- The commands: `/ingest`, `/file`, `/lesson`, `/recall`, `/curator`,
  `/flywheel`, `/audit`. Mention `/lesson` specifically — the first time the
  agent gets something wrong is the most useful thing that will happen this
  week, and it only becomes an enforced check if it is captured.
- That `core/OPEN_QUESTIONS.md` is a routing table for open questions, empty and
  waiting for real ones.
- That nothing runs on a schedule, on purpose. Session start prints one line
  when something is actually due.

That's the full install. Nothing else in this repo needs to run for first-time
setup.
