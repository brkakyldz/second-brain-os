---
project_id: <vault card id>
implementation_agent: claude-code
branch: <branch this state describes>
as_of: <short sha>
active_milestone: none
active_run: none
---
# Current state

<!-- project_id = the filename of the brain's project card, notes/<id>.md, without .md
     implementation_agent: claude-code | codex
     as_of = the sha the checks ran against (information, not the freshness key)
     active_milestone: <id> | none · active_run: docs/runs/<file>.md | none
     status: PLANNED | IN_PROGRESS | PASS | FAIL | BLOCKED(<type>) | ABANDONED | OPEN_GATE — "not run" is never PASS
     blocker types: credentials | external-dependency | owner-decision | contract-change | live-verification | unreliable-oracle
     fresh = no commit after the latest commit to this file touches anything but this file,
     docs/WORKLOG.md and docs/runs/ · at most 80 lines · no history, no feature list, no rules -->

## Milestones
| ID | Status | Evidence | Commit |
|---|---|---|---|
| <M1> | PLANNED | — | — |

## Open gates
<!-- owner decisions and human checks pending; one line each -->

## Blockers
<!-- BLOCKED(<type>): what, since when, what unblocks it -->

## Next
<!-- the single next action -->
