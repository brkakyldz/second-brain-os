---
type: project
created: YYYY-MM-DD
tags: []
status: active
project_id: <this filename without .md>
repo: <absolute path of the primary checkout, forward slashes — or none>
remote: <git remote URL — or none>
state_file: docs/CURRENT_STATE.md
project_aliases: []
related: []
---

# Project Name

<!-- A thin card (ADR 0045): why the project exists, where it lives, what it
     taught — at most 25 lines of body. Live status (milestones, gates,
     blockers, the next action) lives in the repo's state_file and is never
     copied here: a copy is right for a day and wrong afterwards.
     project_id equals the filename; project_aliases lists older ids that
     session logs used, so they still resolve. No repo yet: repo: none and
     state_file: none. Status is active | paused | done. -->

<Why it exists, in one line.>

## Where

- Repo: `<repo>` · remote: `<remote>`
- Live status: the repo's `docs/CURRENT_STATE.md` — read it there.

## What it taught

- <wikilinks to the lessons and knowledge notes this project produced>

## Lineage

- <predecessor or successor project, if any>
