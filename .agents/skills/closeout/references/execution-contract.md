# Execution-layer formats (C1–C5)

The file shapes closeout reads and writes. A change to a format is a
decision, not an edit made in passing (ADR 0045).

## C1–C3 — repo side: one canonical copy

The repo formats live in `<brain>/.claude/templates/project-repo/`, and that
folder is the only copy — read it, do not re-type it here. Its `README.md`
covers adoption, the read-first order and the interrupted-run protocol.

- C1 `docs/CURRENT_STATE.md` — the only file that states status. The status
  vocabulary, the blocker types and the freshness rule (no commit after the
  latest STATE commit touches code) are in its comments.
- C2 `docs/WORKLOG.md` — append-only, `decision | milestone | direction`, one
  line each.
- C3 `docs/runs/TEMPLATE.md` — one report per autonomous run. `status:` stays
  empty while the run is live; a report without a status next to a set
  `active_run` is an interrupted run (see closeout § Interrupted runs).

## C4 — brain project card `<brain>/notes/<project_id>.md`

Template: `<brain>/.claude/templates/project.md`.

```yaml
---
type: project
created: YYYY-MM-DD
tags: [...]
status: active | paused | done
project_id: <must equal the filename without .md>
repo: /absolute/path/to/checkout   # forward slashes; the primary checkout
remote: https://example.com/you/repo.git | none
state_file: docs/CURRENT_STATE.md | none   # relative to repo
project_aliases: [older ids seen in logs]
related: ["[[...]]"]
---
```

Body ≤ 25 lines: why it exists (one line); where it lives; a sentence that
live status is in the repo's state file and is never copied here; what it
taught (links to lessons and knowledge notes); lineage (predecessor or
successor). Needs ≥1 outbound wikilink and an `INDEX.md` row, like any brain
note.

## C5 — brain log for project work

Carries `project: <card id>` and `runtime: claude-code | codex`, is ≤ 10 body
lines, points at repo refs (run report path @ sha) for detail, and ends with
exactly one outcome line:

```
outcome | claim:<what is now true> | verification:<verified|agent-claimed|partial> | refs:<...>
```

`verified` requires a test, a readback, an external result or the owner's
acceptance; a file existing or an agent saying "done" is only
`agent-claimed`; `partial` when the implementation landed but an external or
fresh-session check remains.

The whole file, as closeout writes it to
`<brain>/logs/YYYY-MM-DD_HHMM-<slug>.md` (local time, kebab-case slug):

```markdown
---
type: log
created: YYYY-MM-DD
tags: [<card id>, <decision|bugfix|feature|discovery|preference|change>]
project: <card id>
runtime: claude-code | codex
---
# <Project>: <what happened, in a few words>
- **decision** — one line; the detail stays behind the repo ref
outcome | claim:<what is now true> | verification:<verified|agent-claimed|partial> | refs:<docs/runs/…@sha>
```

Old logs are append-only evidence and are never rewritten; older `project:`
values are mapped through the card's `project_aliases`.
