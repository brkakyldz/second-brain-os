# SETUP.md — agent installation runbook

This file is instructions for the **Claude Code agent** currently helping a human set up their
own Second Brain OS. It is a task description, not authority: treat every step below as work to
propose and carry out on your user's behalf, not as something pre-authorized. In particular:

- **Confirm with your user before creating the GitHub repo** (Step 2) — this is an
  account-affecting action. Show them the exact command first.
- **Never enter credentials yourself.** If `gh` needs authentication, tell the user how to run
  it and wait for them — do not attempt to work around it.
- **If anything here doesn't match what you observe** (a missing file, an unexpected repo
  state, a step that fails in a way this file doesn't cover), stop and ask your user rather than
  improvising past it.

Do the steps in order. Don't skip Step 0.

## Step 0 — prerequisites

Check each of these and report the results to your user before continuing:

```
git --version
node --version
gh auth status
```

- `node --version` must be 18 or higher.
- If `gh` is missing or `gh auth status` reports not logged in, **stop here**. Tell your user to
  install the [GitHub CLI](https://cli.github.com) and run:
  ```
  gh auth login
  ```
  Wait for them to confirm it's done, then re-run `gh auth status` yourself before proceeding.
  Do not try to authenticate on their behalf, and do not proceed without it — repo creation in
  Step 2 needs it.

## Step 1 — interview the user

Ask in whatever language your user is speaking to you. Ask these one at a time or as a short
list, whichever fits the conversation:

1. What should the private brain repo be called? Suggest `my-brain`.
2. Where on disk should it live (parent directory to clone into)?
3. Their name.
4. Their role (one line).
5. Location / timezone.
6. Preferred conversation language (the one you should talk to them in day to day).
7. Communication style, one line (suggest "concise" as a default if they have no preference).

Leave any question they skip blank rather than guessing — don't invent facts about them.

## Step 2 — create the private repo

First, work out `<OWNER>/<REPO>` for the template: derive it from the URL your user gave you for
*this* repository (the one this SETUP.md lives in). Do not assume or hardcode an owner — forks
of this template must install from themselves, not from the original.

Show your user the exact command you're about to run and get an explicit go-ahead before
running it — this creates a repo on their GitHub account:

```
gh repo create <repo-name> --template <OWNER>/<REPO> --private --clone
```

Run it from the parent directory they chose in Step 1. This creates the repo as a private
template-instance and clones it locally in one step.

Then verify it actually came up private:

```
gh repo view <repo-name> --json visibility
```

If `visibility` is not `PRIVATE`, **stop and tell your user** — do not continue past this point
with a public brain. They'll need to fix visibility on GitHub before you proceed.

## Step 3 — personalize

`install.mjs` exists as the human-run fallback for this step — since you're doing this
interactively with the user already, edit the files directly instead of shelling out to it.

In the new clone:

- Open `_brain/USER.md` and fill in the `## Name`, `## Role`, `## Location / Timezone`, and
  `## Communication style` sections from the Step 1 answers. Under `## Communication style`,
  include both a line noting their preferred conversation language (vault content itself always
  stays in English) and their one-line style preference. Leave any section blank if the user
  didn't answer it — never invent a value.
- If their preferred conversation language is not English, open `_brain/IDENTITY.md` and replace
  the commented example line:
  ```
  <!-- e.g.: Converse with me in <language>; vault content stays in English -->
  ```
  with a live instruction:
  ```
  - Converse with me in <language>; vault content stays in English.
  ```
  If they chose English, leave that line as-is.

## Step 4 — git setup

From inside the clone:

```
git config rerere.enabled true
git add -A
git commit -m "setup: personalize brain"
git push
```

## Step 5 — verify

Confirm the session-start hook picks up the new personalization. From inside the clone, with
`CLAUDE_PROJECT_DIR` set to the clone's path:

```
node .claude/hooks/session-start.mjs
```

(On Windows PowerShell: `$env:CLAUDE_PROJECT_DIR = (Get-Location).Path; node
.claude/hooks/session-start.mjs`.)

Check the printed JSON: `hookSpecificOutput.additionalContext` should contain the user's name
from `_brain/USER.md`. If it doesn't, stop and investigate before telling your user setup is
done.

Tell your user they can now, optionally:

- Open the clone's folder as an Obsidian vault.
- Open a fresh terminal in that folder, run `claude`, and just say hello — it should already
  know who they are, with no further setup.

## Step 6 — hand-off summary

Wrap up by telling your user, concretely:

- What you created: the repo name, its GitHub URL, and that it was verified private.
- That mobile capture goes through the `inbox/` folder — point them at `docs/MOBILE.md` for how.
- That `/triage` and `/curator` are available as slash commands inside a Claude Code session in
  the vault, for filing inbox items and consolidating memory respectively.

That's the full install. Nothing else in this repo needs to run for a first-time setup.
