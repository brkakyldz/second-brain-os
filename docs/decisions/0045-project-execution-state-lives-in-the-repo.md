---
id: 0045
title: Project execution state lives in the repo; the vault keeps what outlives a project
date: 2026-09-25
status: accepted
related: [0016, 0042, 0044]
---

# 0045 — Project execution state lives in the repo

Generalized from the reference instance's record of the same number: the
reasoning is kept, the names and figures of its projects are not.

## Context

The rule before this one said the brain was the only working record: durable
memory, open work and session history lived in the vault and nowhere else, so
that no project would grow a parallel record. The projects did the opposite,
and they were right to. A survey of the reference instance's repos and session
logs found:

- **The one repo that worked kept its state in the repo.** The only project
  that carried a multi-milestone plan through to its final gates unattended
  did it on a single living state file in its own repo, with acceptance IDs
  tied to evidence paths and its checks wired as commit gates. Its contract
  named the repo, not the vault, as the persistent project context.
- **No coding session ever resumed from a vault note.** The project notes were
  linked from many session logs, every one of them on the write side. The
  vault was the record furthest from the work — exactly the failure the old
  rule was written to prevent.
- **Status rots everywhere except a living state file.** Plans still headed
  "ready to execute" after the work had shipped; a README announcing a version
  that had since been replaced; a plan marked complete with nothing committed.
- **Project memory was not in git.** Plans, ADRs and research sat untracked in
  several repos, and one project was never a git repo at all. Untracked memory
  is not memory.
- **Completion reports went to chat** and were gone. One parallel delivery was
  called integrated while its own README showed most of its acceptance checks
  failing.

ADR 0016 is not in question: it is about where the *vault's own* construction
record lives. This decision is about project execution state, which that one
never covered.

## Decision

Split by what the record is for, not by where the rule-writer happens to be.

| Record | Lives in | Why |
|---|---|---|
| Contract — ownership map, invariants, autonomy rules | repo `AGENTS.md` | read on every session start by both runtimes |
| Status — the only place a project states it | repo `docs/CURRENT_STATE.md` | one living file is the one that did not rot |
| Direction — decisions, milestones, runtime switches | repo `docs/WORKLOG.md`, append-only | a dated owner paragraph in `AGENTS.md` is how a contract accretes |
| Run history — one report per autonomous run | repo `docs/runs/` | the chat summary is derived from it, never the reverse |
| Plans, ADRs, research, evidence | repo, committed | untracked memory is not memory |
| Cross-project knowledge, lessons, domain notes | vault `notes/` | outlives any one repo |
| Which projects exist, why, what they taught | vault project cards (`project_id`, `repo`, `state_file`) | the bridge; never a copy of live status |
| What happened in a session | vault `logs/`, short, with `project` and `runtime` | points into the repo for detail |

The formats ship with this template: the repo side in
`.claude/templates/project-repo/`, the project card in
`.claude/templates/project.md`. The step that writes both sides at the end of
work is `/closeout` (`.agents/skills/closeout/`); the read-only
`scripts/project-doctor.mjs` reports where the split is not holding.

## Rationale

A record earns its keep by being read at the moment it matters. Status is read
at resume time, inside the repo, by an agent that has already loaded the repo's
`AGENTS.md`; putting it anywhere else guarantees a second, staler copy.
Knowledge that should carry into the *next* project has the opposite shape: it
must survive the repo being closed, and it is read at research and planning
time. The old rule protected against two brains; in practice it produced one
brain nobody read and one record nobody committed.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the rule, enforce it harder | The only project that finished cleanly did the opposite; enforcement would break the thing that works |
| Mirror repo state into the vault on a hook | Two copies of status reconciled by a job — the drift this design keeps removing (ADR 0044) |
| A hub or database for execution state | Solves multi-tenant, multi-host problems a personal setup does not have; files plus git already give history and resume |
| Leave it implicit | Every new session re-reads a rule that contradicts the project's own contract and has to guess which one wins |

## Consequences

- **Upside:** resume reads four files in the repo instead of every plan the
  project ever wrote; status has one owner; the vault keeps only what
  compounds.
- **Cost:** every project repo commits its memory, plans and research
  included. A public repo either publishes them or stays private while it is
  being built.
- **Reach:** `/closeout`, `/lesson` and `/recall` have to work from a project
  session, not only inside the vault. They find the vault through the
  global-mode SessionStart line ("The brain lives at …"), and
  `node install.mjs --link-global-skills` makes them loadable there (opt-in).
- **Watch:** the project doctor's flags over the next sessions of project
  work. If the state files go stale as fast as the old status headers did,
  the contract is wrong, not the agents — revisit this decision rather than
  adding enforcement first.
