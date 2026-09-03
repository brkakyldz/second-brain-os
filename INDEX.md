---
type: knowledge
created: 2026-09-03
tags: [index, catalog, navigation]
status: growing
related: ["[[lifecycle-policy]]"]
---

# Index — every page in the wiki, one line each

**Top line.** The catalog of `notes/` and of every ingested source: what exists,
what each page is for, and how mature it is. Read this first when answering a
question, then drill into the two or three pages that matter — it is the cheap
half of retrieval, and it is why no search index has been needed.

This is a *content* catalog. Its chronological twin is `logs/` (what happened,
when), the durable-fact index is `core/MEMORY.md` (one line per fact, budgeted),
and the open-work surface is `PROPOSALS.md`. Four files, four jobs, no overlap.

**Who writes it:** `/ingest`, `/file` and `/curator`, on every write that adds
or retires a page. The `index-coverage` check in `.claude/hooks/checks.mjs`
fires when a note in `notes/` is missing here — the catalog is kept honest by an
instrument, not by a reminder.

Keep the description column about *what the page is for*, not what it contains.
A row that reads "notes on X" tells a future session nothing it could not have
guessed from the filename, and the whole value of this file is deciding what to
open without opening it.

---

## Projects

| Page | What it is | Status |
|---|---|---|
| _(your first project note goes here)_ | | |

## Knowledge — the world

| Page | What it is | Status |
|---|---|---|
| _(what you have read and distilled)_ | | |

## Knowledge — the vault itself

| Page | What it is | Status |
|---|---|---|
| [[source-roots]] | External immutable source roots, registered as pointers rather than copied | seedling |

## Playbooks

| Page | What it is | Status |
|---|---|---|
| [[lifecycle-policy]] | The full lifecycle and self-evolution policy with rationale; binding rules live in `CLAUDE.md` | active |

## Lessons — corrections, captured verbatim

Kept in the language the correction was given in: a lesson's value is the
wording as it was said. Routed by the flywheel pass only after a second
independent occurrence.

| Page | The correction | Status |
|---|---|---|
| _(none yet — `/lesson` writes these)_ | | |

## Ingested sources

Each row is a document in `raw/`, read once and distilled into the notes named
beside it. A file in `raw/` with no row here has not been ingested — that, and
not the folder's size, is the graveyard signal.

| Source | Ingested | Fed into |
|---|---|---|
| _(none yet — `/ingest` writes these)_ | | |
