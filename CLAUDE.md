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
- **Archive-first.** Stale or closed content moves to `archive/`, never into
  the void. Deletion is allowed only in the three narrow cases defined in
  [[_brain/playbooks/lifecycle-policy]] §6 — and the third (a superseded,
  unlinked, non-load-bearing note) only with the owner's explicit approval.

## Lifecycle & self-evolution

Full policy with rationale: [[_brain/playbooks/lifecycle-policy]]. The binding
rules:

- **Tiers.** Tier 0 (`IDENTITY.md` 40 / `USER.md` 40 / `MEMORY.md` 100 lines)
  is always loaded and holds pointers, not detail. Everything else is reached
  on demand via pointers and search — never preloaded.
- **Different lifecycles per memory type.** Episodic (`logs/`, `daily/`) is
  append-only and gets distilled then archived (logs at 30 days, dailies at
  90). Semantic (`MEMORY.md`, `_brain/memory/`, `knowledge/`) is reconciled on
  write: per new fact, decide ADD / MERGE / SUPERSEDE / NOOP — never blind
  append. Procedural (`playbooks/`, skills) changes only by deliberate
  revision, ≤150 lines per playbook.
- **Triage within 48h.** Nothing leaves `inbox/` verbatim — rewrite, merge,
  or link it first; then the raw capture is deleted as part of the move.
- **Maturity through reuse.** `seedling → growing → evergreen` promotion only
  when a note is touched or linked from new work, never on a timer. Every new
  note gets ≥1 outbound wikilink before it is closed.
- **Domain-dependent staleness.** Fast-decaying notes (tools, versions, APIs)
  get `review_by: created + 12 months`; stable concepts get none. Feedback
  memories are re-challenged after 90 days. Overdue `review_by` flags, never
  auto-deletes.
- **Contradictions:** newer evidence wins, but the override is logged —
  supersession is visible, never silent.
- **Corroboration gate:** a once-seen fact enters `_brain/memory/` as
  `confidence: low`; it reaches `MEMORY.md` only after a second independent
  session confirms it.
- **Protected files:** `IDENTITY.md` and this file are never edited by an
  automated pass — agents propose a diff, the owner applies it.
- **Pins:** `pinned: true` exempts from demotion; max 10 vault-wide,
  re-justified quarterly.
- **The loop:** weekly `/triage` + `/curator` (safe fixes applied, destructive
  changes proposed as a table); monthly structural audit (report-only:
  budgets, orphans, overdue reviews, tag sprawl); quarterly pin + policy
  review. Audit and consolidation stay separate passes.
- **Growth control:** no new folder/tag/taxonomy without an actual retrieval
  failure that demands it. Health metric is notes *re-used* this month, not
  notes captured.

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
