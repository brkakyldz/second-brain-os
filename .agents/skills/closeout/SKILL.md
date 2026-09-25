---
name: closeout
description: The last step of project work — brings the repo's docs/CURRENT_STATE.md and docs/WORKLOG.md up to date, writes the run report of an autonomous run, removes this task's merged worktrees, commits exactly the paths the task wrote, and leaves at most one short brain log that points back at the repo. Use when the owner says "closeout", "wrap up", "close the session", "finish the work", and at the end of every autonomous run without being asked.
---

# Closeout: leave the repo true, point the brain at it

Status lives in the project repo, committed; the brain keeps what outlives one
project (ADR 0045). In the reference instance, status rotted everywhere but
one living state file, completion reports vanished into chat, and no coding
session ever resumed from a vault note. Closeout makes the next session start
from the repo.

**Never copy live project state into the brain.** Milestones, gates, blockers
and the next action live in `docs/CURRENT_STATE.md`. A brain log or card
points at them (`docs/runs/<file>.md@<sha>`) and never restates them: a copy
is right for a day and wrong afterwards, and nothing says which day.

The formats (C1–C5) are in `references/execution-contract.md`. Read it before
writing any file below for the first time in a repo.

## Finding the brain

Every brain path below is written `<brain>/…`. Resolve `<brain>` once:

1. The session is in the brain itself (its root has `core/MEMORY.md` and
   `.claude/hooks/session-start.mjs`) → that root.
2. The SessionStart context says "The brain lives at `<path>`." (global
   mode) → that path.
3. `BRAIN_DIR` is set in the environment → that path.
4. This skill was loaded through a user-level link → the real path of this
   skill's folder, three levels up (`<brain>/.agents/skills/closeout`).
5. None of these → ask the owner. Never guess a path.

## Before the steps

Settle four facts from the repo, not from memory of the chat:

- **Paths this task wrote** — `git status --short` against what you know you
  touched. A dirty file you did not write belongs to another task; both
  runtimes may be working in this checkout.
- **Run or session** — a run is work that proceeded without the owner in the
  loop: a handoff executed end to end, an automation, "do the next milestone,
  don't stop". An interactive session is not a run.
- **Card id** — STATE's `project_id`; else the `type: project` note whose
  `repo:` is this repo: `rg -l -F "repo: <repo path, forward slashes>"
  <brain>/notes` (or `grep -rlF` where `rg` is missing). None found means
  none exists; never invent an id.
- **Interrupted run** — if STATE shows one, handle it first (last section).

Each step runs or is skipped with a one-line reason. The skip line is part of
the output; a silent skip reads the same as a forgotten step.

## 1. STATE — `docs/CURRENT_STATE.md` (C1)

- Bring milestones, open gates, blockers and next to what is true now. "Not
  run" is never PASS; an unverified claim is IN_PROGRESS or OPEN_GATE.
- Commit the STATE edit together with the code it describes (step 5); a
  docs-only follow-up commit is also fine. The freshness rule only asks that
  no commit after the latest STATE commit touches code. `as_of` records the
  sha your checks ran against (usually HEAD before the commit); it is
  information, not a key.
- No STATE, but the repo has execution work (milestones, a plan being
  implemented, runs)? Offer to create it from the C1 template and create it
  only on the owner's yes. A repo without execution work gets none.
- Status lives here only. Don't add "Status:" lines to plans, READMEs or
  architecture docs on the way past.
- If the repo keeps review findings (for example `docs/reviews/findings.md`),
  a CRITICAL or IMPORTANT finding that is neither an Open gate here nor named
  in a commit subject becomes an Open gate now.

## 2. WORKLOG — `docs/WORKLOG.md` (C2)

One line per decision, milestone or direction change this session made:
`- YYYY-MM-DD · <kind> · <what> · refs: <path@sha>`. Append only; a past line
is never edited. Tasks, attempts and diary entries are not worklog lines, so
a session with none of the three kinds adds nothing. No file yet: create it
with the first line that needs it.

## 3. Run report — `docs/runs/YYYY-MM-DD_<slug>.md` (C3)

Autonomous runs only. Fill the C3 template: commits, exact checks with
results ("not run" is a line, not a silence), acceptance IDs with evidence
paths, assumptions, open gates (copied into STATE too), cost from the
runtime's own numbers or `unknown`, next. Then set STATE `active_run: none`.
The chat summary is derived from this file, never the other way round.

## 4. Worktrees

`git worktree list`. For each worktree this task created: if
`git -C <wt> status --porcelain` is empty and its branch is merged
(`git merge-base --is-ancestor <branch> <target>`), run
`git worktree remove <wt>`. Never `--force`. List every other worktree with
why it stays: dirty, unmerged, or not this task's. Branches are left alone.

## 5. Commit

Only the paths this task wrote, by name:

```
git add -- <path> <path>
git commit -m "<what the work did>" -- <path> <path>
```

The pathspec on `commit` keeps anything another task staged out of yours.
Never `git add -A` / `git add .`, never `--no-verify`; when a commit hook
warns or blocks, fix the cause. If the tree is red and a gate refuses, report
the files as uncommitted instead of retrying. Never push unless the owner
asked in this session.

## 6. Brain log (C5)

Only for substantial work: behaviour changed, a decision, a milestone moved,
a change of direction. Q&A, planning-only sessions, status checks and
one-line fixes get none.

1. `git -C <brain> pull --ff-only` first. If it fails, say so and go on; the
   log still lands locally.
2. Write `<brain>/logs/YYYY-MM-DD_HHMM-<slug>.md` in the C5 shape:
   `project:` and `runtime:` in the frontmatter, at most 10 lines after it,
   detail left behind repo refs, and exactly one closing line
   `outcome | claim:… | verification:<verified|agent-claimed|partial> | refs:…`.
   `project:` must be an existing card id. No card: say so and offer to
   create one (C4); if the owner declines, omit the field and name the repo
   path in the body.
3. Commit that one path:
   `git -C <brain> add -- logs/<file>`, then
   `git -C <brain> commit -m "log: <work>" -- logs/<file>`.
   Other dirty files in the brain belong to other tasks and stay out.

## 7. Lessons

If the owner corrected the agent this session and it was not captured yet,
run `/lesson` once per correction. It writes into the brain and commits its
own paths.

## 8. MEMORY.md

Default: skip. Only a cross-project durable fact qualifies, and the brain's
corroboration gate still applies: a once-seen fact goes to `<brain>/notes/` as
`type: memory`, `confidence: low`, and reaches `<brain>/core/MEMORY.md` only
when a second independent session confirms it. Check the 4000-character
budget first; consolidate, never truncate. Project status never qualifies.

## Finish

One line per step, in the language the owner converses in: done (with the
path or sha) or skipped (with the reason). Derive it from the files just
written.

## Interrupted runs (C3)

STATE `active_run` names a report that is missing or has no `status:` — an
earlier run died mid-way. Before step 1: read `git log <base_sha or
as_of>..HEAD` and `git diff` for what actually landed; re-run the checks the
run owed, assuming nothing passed; correct STATE to what is true; then finish
the run or write its report as `ABANDONED` and set `active_run: none`.

## What this skill does not do

- Push, in either repo, unless asked.
- Write `MEMORY.md` by default, or `USER.md` / `IDENTITY.md` ever.
- Rewrite old brain logs, past WORKLOG lines or earlier run reports; they are
  evidence.
- Copy status, milestones or next steps into the brain.
- Create a STATE file or a project card without the owner's yes.
- Stage, commit or remove anything another task owns.
