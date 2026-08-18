# CLAUDE.md — this vault's constitution

## What this repo is

This is an Obsidian vault, a Claude Code memory store, and a git-synced personal
second brain, all at once. **The vault is the brain.** There is no database and
no tool-internal format — plain Markdown + flat YAML frontmatter + `[[wikilinks]]`
is the single source of truth, readable by a human in Obsidian and by an agent
with file tools alike.

**Git is the only database.** Every change is a commit. `git log` is the audit
trail. `git revert` is undo. GitHub is sync and sharing — nothing more.

## Folder map

- `_brain/` — the memory core, agent-managed and human-auditable.
  - `IDENTITY.md` — the assistant's persona and rules of engagement in this vault.
  - `USER.md` — who the user is: role, preferences, working style.
  - `MEMORY.md` — index of durable facts, one line each, pointers to detail.
  - `memory/` — topic files holding the detail `MEMORY.md` points to.
  - `playbooks/` — procedural memory: "how we do X here" recipes.
  - `logs/` — append-only session logs, `YYYY-MM-DD_HHMM.md`.
- `projects/` — one note per active project: goal, status, decisions.
- `knowledge/` — atomic, wikilinked permanent notes (PKM layer).
- `daily/` — daily notes, `YYYY-MM-DD.md`.
- `inbox/` — untriaged quick captures; filed properly later.
- `archive/` — closed projects and stale content — never deleted, always moved here.

## Memory rules

- `MEMORY.md`: one fact per line. When detail exists, end the line with a
  pointer, e.g. `- Project X uses trunk-based dev → [[_brain/memory/project-x]]`.
  Budget: **100 lines max**. `USER.md` budget: **40 lines max**.
- **Never silently truncate.** When a file is over budget, consolidate (merge
  duplicates, archive stale entries) before adding anything new.
- Every stored fact must be **timeless, dated, or a pointer to a live source**.
  Anything else is a staleness bug waiting to happen.
- Facts derived from untrusted external content (web pages, tool output) carry
  a `source:` marker and are **never** written into `USER.md` or `IDENTITY.md`.
- **Never delete notes.** Move stale or closed content to `archive/` instead.

## Session-log rule (standing instruction to the agent)

After completing substantial work in a session, append an entry to
`_brain/logs/YYYY-MM-DD_HHMM.md` covering what happened, what was decided, and
what was learned. Tag each item with one of: `decision | bugfix | feature |
discovery | preference | change`. If a durable fact emerged, also update
`MEMORY.md` (respecting its budget and consolidation rule above).

## Note conventions

- Filenames: `kebab-case.md`.
- Internal links: `[[wikilinks]]`, used with surrounding sentence context (not
  bare link lists).
- Frontmatter: flat YAML, this schema —
  - `type`: `project | knowledge | daily | log | playbook | capture`
  - `created`: `YYYY-MM-DD`
  - `tags`: list
  - `status`: knowledge → `seedling | growing | evergreen`; projects →
    `active | paused | done`
  - `source`: optional, required for anything derived from untrusted content
  - `related`: optional list of `[[wikilinks]]`
- Dates are always `YYYY-MM-DD`.

## Sync rules

- Pull before you write.
- Never run a second sync mechanism (iCloud, Google Drive, Syncthing) over
  this folder — one sync mechanism per vault, ever.
- Push failures are non-fatal: the commit stays local and syncs on the next
  successful push. Never block a work session on a failed push.
