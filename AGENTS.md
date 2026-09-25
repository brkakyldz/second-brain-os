# AGENTS.md — this vault's constitution

## What this repo is

This is an Obsidian vault, the shared memory store of two equal agent runtimes
(Claude Code and Codex), and a git-synced personal second brain, all at once.
**The vault is the brain.** There is no database and no tool-internal format —
plain Markdown + flat YAML frontmatter + `[[wikilinks]]` is the single source
of truth, readable by a human in Obsidian and by an agent with file tools alike.

**Git is the only database.** Every change is a commit. `git log` is the audit
trail. `git revert` is undo. The remote is sync and backup — nothing more.

## Folder map

One folder per **lifecycle**, not per category. What a note *is* lives in its
frontmatter `type:`; how it is written and retired decides which folder holds
it. A note's maturity changes its `status:`, never its path — so a link never
breaks because a thought grew up.

- `core/` — Tier 0, injected by the SessionStart hook. Four files; the first
  three are budgeted, and `OPEN_QUESTIONS.md` arrives as a pointer, not inlined.
  - `IDENTITY.md` — the assistant's persona and rules of engagement in this vault.
  - `USER.md` — who the owner is: role, preferences, working style.
  - `MEMORY.md` — index of durable facts, one line each, pointing into `notes/`.
  - `OPEN_QUESTIONS.md` — the live question ledger.
- `notes/` — the memory store: every durable note, flat. Knowledge, projects,
  playbooks and memory topics sit side by side and are told apart by
  `type: knowledge | project | playbook | memory`, never by folder. Everything
  here is wikilinked, has frontmatter, and earned its place.
  A `type: project` note is a thin card: it names the repo and its state file
  and never copies live status — execution state lives in the repo (ADR 0045).
- `raw/` — the source store: immutable documents the owner put there.
  Articles, papers, transcripts, exports, images. **The agent reads and never
  writes** — no edit, rename, move or delete; the one exception is fetching a
  source in when the owner asks for that specific fetch. Flat,
  `YYYY-MM-DD_<slug>.<ext>`. This is the only place verbatim external content
  may live, which is what keeps it out of `notes/`. Full is the healthy state.
  Contract: `raw/README.md`.
- `logs/` — append-only session logs, `YYYY-MM-DD_HHMM.md` or
  `YYYY-MM-DD_HHMM-<slug>.md`; a pass report names its pass instead
  (`YYYY-MM-DD_link-sweep.md`, `YYYY-MM-DD_audit.md`) — the date prefix is
  the part that never varies. Plus the signal ledger in `logs/signals/`.
  Written as evidence — read it, never rewrite it.
- `archive/` — closed projects, stale content, and the historical working
  record. Never deleted, always moved here.
- `.agents/skills/` — the vault's skills, the one canonical copy both runtimes
  load. Codex reads it natively; `.claude/skills` is a gitignored junction
  (Windows) or symlink (macOS/Linux) to it, created by `node install.mjs`.
  There is only one copy — an edit through either path is an edit to it.
- `.claude/` — the shared machinery both runtimes call: `hooks/`,
  `templates/`, `eval/`. The name is historical, not ownership. `.codex/`
  holds only the thin Codex SessionStart adapter. Not vault content; this is
  how the agent runs, not what it knows about the world.
- `scripts/` — helper jobs (link sweep, metrics, retrieval eval, brain
  doctor, project doctor), each invoked by hand or by a skill. Nothing here
  runs on a clock: unattended scheduling was retired (ADR 0033).
- `docs/` — documentation about the vault, not vault content: the
  architecture guide, the decision index (`DECISIONS.md`) and the template's
  full decision records (`docs/decisions/`).
- Root files: `INDEX.md` is the page catalog — every note, one line each, the
  first thing to read when answering a question. `PROPOSALS.md` is a list of
  open work the owner keeps by hand — no pass writes it. `README.md` is the
  vault's front door; `SETUP.md` and `install.mjs` are the agent-run and the
  manual installer. `CLAUDE.md` only imports this file (`@AGENTS.md`) plus
  any Claude-only lines — one constitution, never two copies (ADR 0044).

## Distillation

There are two paths into the memory store, and both end in distillation.

**Live distillation inside a session** — the owner says something, the note
gets written, nothing is ever queued. There is no capture inbox on purpose: a
queue with no producer is a folder that fills up with guilt.

**Ingest of a source** — `/ingest` reads a document in `raw/` or a registered
root, discusses it with the owner, and distills it into `notes/` with a
`source:` marker. The source is read once and stays read; the vault then answers
from the distillation, never by re-reading. `raw/` has a producer by design —
the owner saving what they are reading — which is the property an inbox lacks.

- **Nothing enters `notes/` verbatim.** A thought is rewritten in original
  wording, merged into an existing note, or linked from one. A copy that
  survives in two places is two sources of truth.
  The one legal home for verbatim external content is `raw/`, and a note points
  back at it rather than reproducing it. Quote only where the exact phrasing is
  the point — a line or two, in quotes, attributed.
- **A source is never memory on its own.** Anything derived from `raw/` or a
  registered root carries `source:`, enters as `confidence: low`, and reaches
  `MEMORY.md` only through the corroboration gate. `USER.md` and
  `core/IDENTITY.md` are closed to external content outright.
- **Maturity is frontmatter, not location.** A note that grows from `seedling`
  to `evergreen` never moves. Exactly one transition moves a file: anything →
  `archive/` (it closed).

## Memory rules

- `MEMORY.md`: one fact per line. When detail exists, end the line with a
  pointer, e.g. `- Project X uses trunk-based dev → [[project-x]]`.
  Budget: **4000 characters max**. `USER.md` budget: **2000 characters max**.
  HTML comments don't count — they are instructions to the writer, not facts.
  The unit is characters, not lines, because a line cap silently varies 2× with
  how long your lines happen to run. The session-start header shows each file's
  usage, so check it *before* writing, not after.
- **Two things are never `MEMORY.md` entries.** The vault's own construction
  history goes in a note of its own; open work items go to `PROPOSALS.md`.
- **Never silently truncate.** When a file is over budget, consolidate (merge
  duplicates, archive stale entries) before adding anything new.
- Every stored fact must be **timeless, dated, or a pointer to a live source**.
  Anything else is a staleness bug waiting to happen.
- Facts derived from untrusted external content (web pages, tool output) carry
  a `source:` marker and are **never** written into `USER.md` or `IDENTITY.md`.
- **Archive-first.** Stale or closed content moves to `archive/`, never into
  the void. Deletion is allowed only in the narrow cases defined in
  [[lifecycle-policy]] §6 — and the second (a superseded, unlinked,
  non-load-bearing note) only with the owner's explicit approval.

## Lifecycle & self-evolution

Full policy with rationale: [[lifecycle-policy]] (what happens to a note or a
fact) and [[self-evolution-policy]] (how the system changes itself). The
binding rules:

- **Tiers.** Tier 0 (`IDENTITY.md` 40 lines / `USER.md` 2000 chars /
  `MEMORY.md` 4000 chars) is always loaded and holds pointers, not detail.
  Everything else is reached on demand via pointers and search — never
  preloaded. Past ~10KB of session-start payload the harness stops inlining
  Tier 0 at all, so the budgets protect loading itself, not just attention.
- **Different lifecycles per memory type.** Episodic (`logs/`) is append-only
  and gets distilled then archived (logs at 30 days). Semantic (`MEMORY.md`,
  `notes/` with `type: memory | knowledge`) is reconciled on write: per new
  fact, decide ADD / MERGE / SUPERSEDE / NOOP — never blind append. Procedural
  (`type: playbook`, skills) changes only by deliberate revision, ≤150 lines
  per playbook.
- **Maturity through reuse.** `seedling → growing → evergreen` promotion only
  when someone reworks the note in new work — never on a timer, never from an
  access count. Every new
  note gets ≥1 outbound wikilink before it is closed. **Evergreen gate:**
  `status: evergreen` additionally requires a 1–2 sentence top-line
  distillation at the head of the note. If the idea can't be stated that
  briefly, it hasn't matured yet — leave it `growing`.
- **Domain-dependent staleness.** A claim about a tool, version, API or price
  is checked against its source whenever something depends on it, whatever its
  date. `review_by:` is optional, for decay that is genuinely predictable;
  stable concepts get none. Correction memories are re-challenged after ~90
  days. An overdue `review_by` is reported by the audit, never auto-deleted.
- **Contradictions:** newer evidence wins, but the override is logged —
  supersession is visible, never silent. Mechanically: close the old fact's
  window and point it forward (bi-temporal keys, § Note conventions).
- **Corroboration gate:** a once-seen fact enters `notes/` as `type: memory`,
  `confidence: low`; it reaches `MEMORY.md` only after a second independent
  source confirms it — independence is a property of the source, not a count
  of sessions.
- **Playbook gate:** a note is promoted to `type: playbook` only after
  **≥2 verified successful uses**. A workflow that just worked may be drafted
  as a playbook in the same session, marked `uses: 1`, and stays there until
  a second use corroborates it. Every playbook carries a one-line frontmatter
  `description:` — good enough to judge relevance without opening the file.
- **Protected files:** `IDENTITY.md` and this file are never edited by an
  automated pass — agents propose a diff, the owner applies it.
- **Pins:** `pinned: true` exempts from demotion; max 10 vault-wide.
- **The loop:** the trigger is the owner opening a session, never a clock
  (ADR 0033), and nothing reports a pass as overdue (ADR 0038). They run
  `/curator` (safe fixes applied, destructive changes reported and left to
  them) when they want it. The structural audit stays report-only — budgets,
  orphans, overdue reviews, tag sprawl — and audit and consolidation stay
  separate passes. Pins and policy get re-justified when the audit says they
  need it, not on a calendar.
- **Notification budget:** hard cap **3 proactive items per day**, counted
  across *all* surfaces together (session start, briefs, alerts, pass reports).
  Everything past the cap becomes a pull artifact — a file the owner opens when
  they want it, never a push. False positives kill a review queue permanently.
- **Suggestions are acted on or dropped, not queued.** A pass reports its
  findings in the conversation and its own log; nothing appends to an approval
  queue (ADR 0038). A suggestion feature that is not acted on gets killed, not
  tuned forever. A decision worth recording may still be logged by hand as an
  `acceptance` / `rejection` line in the signal ledger.
- **Growth control:** no new folder/tag/taxonomy without an actual retrieval
  failure that demands it. Health metric is notes *re-used* this month, not
  notes captured. **No new hook or script without an actual failure that
  demands it either** — the same gate folders and tags already pass. Machinery
  is harder to remove than a folder, because it acquires callers.

## Session-log rule (standing instruction to the agent)

After completing substantial work in a session, append an entry to
`logs/YYYY-MM-DD_HHMM.md` covering what happened, what was decided, and what
was learned. Tag each item with one of: `decision | bugfix | feature |
discovery | preference | change`. If a durable fact emerged, also update
`MEMORY.md` (respecting its budget and consolidation rule above).

End every substantial-work log with exactly one `outcome` line:
`outcome | claim:<what is now true> | verification:<verified|agent-claimed|partial> | refs:<paths, commits or [[wikilinks]]>`.
`verified` requires a test, readback, external result, or the owner's
acceptance; a file existing or an agent saying "done" is only
`agent-claimed`. Use `partial` when the implementation landed but an external
or fresh-session check remains. The line indexes existing evidence; it never
copies tool output.

A log about project work carries `project: <card id>` — the filename of a
`notes/<project_id>.md` card; older values resolve through the card's
`project_aliases` — and `runtime: claude-code | codex`. It stays under ten body
lines and points at the repo's run report or commit for detail, because the
repo holds execution state (ADR 0045). `/closeout` writes it.

## Note conventions

- Filenames: `kebab-case.md`. Filenames are vault-unique, which is what lets
  links stay short.
- Internal links: `[[wikilinks]]`, **short form — the filename without a path
  or extension** (`[[project-x]]`, never `[[notes/project-x]]`). Used with
  surrounding sentence context, not as bare link lists.
- Frontmatter: flat YAML, this schema —
  - `type`: `project | knowledge | memory | playbook | log | decision`. The
    live list is `ALLOWED_TYPES` in `.claude/hooks/checks.mjs`; when the two
    disagree, the check is the newer of the pair.
  - `created`: `YYYY-MM-DD`
  - `tags`: list
  - `status`: knowledge → `seedling | growing | evergreen`; projects →
    `active | paused | done`; decisions → `accepted | superseded | reversed`;
    memory → the knowledge values (a fact matures the same way); playbooks →
    `active | superseded`
  - `source`: optional, required for anything derived from untrusted content
  - `related`: optional list of `[[wikilinks]]`
  - Project cards add `project_id` (= filename), `repo`, `remote`,
    `state_file` and `project_aliases`; project logs add `project` and
    `runtime`. `scripts/project-doctor.mjs` reports ids that resolve to no
    card.
  - `aliases`: optional. Its job is to catch the query that would otherwise
    miss the note — including the same term in another language, since
    retrieval here is lexical.
- Dates are always `YYYY-MM-DD`.
- **Bi-temporal keys** — optional, for durable facts whose truth has a window:
  `valid_from` (when the fact became true), `valid_to` (when it stopped),
  `recorded_at` (when we learned it), `superseded_by` (`[[wikilink]]` to what
  replaced it). Knowledge time and event time are different things; keeping
  both is what lets a future session answer "what did we believe, and when".
- **A contradiction closes a window, it never overwrites one.** Set `valid_to`
  and `superseded_by` on the old fact, then write the new fact as a *new*
  entry or note. Never edit a superseded fact in place, never delete it — the
  old belief and the date it died are themselves data.

## Sync rules

- Pull before you write.
- **Commits are task-owned (ADR 0042, 0044).** Claude Code and Codex may work
  in this checkout at the same time, so no hook commits for you and no task
  stages the whole tree. Stage the explicit paths your task wrote, commit once
  with a message that names the work, and leave every other dirty file alone —
  it belongs to whoever created it. `git add -A` / `git add .` are never part of
  the protocol.
- Never run a second sync mechanism (iCloud, Google Drive, Syncthing) over
  this folder — one sync mechanism per vault, ever.
- Push failures are non-fatal: the commit stays local and syncs on the next
  successful push. Never block a work session on a failed push.
