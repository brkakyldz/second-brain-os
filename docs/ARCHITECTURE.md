# Architecture

A file-native agent memory system: plain Markdown as the substrate, git as the
database, Claude Code hooks as the runtime, and an explicit lifecycle policy as
the thing that keeps it from rotting. No index server, no vector store, no
tool-internal format.

**Scope of this document: mechanism.** What the parts are and how they fit. The
*policy* they enforce is `notes/lifecycle-policy.md`; the *binding rules* are
`CLAUDE.md`; the *decisions* behind both are indexed in `DECISIONS.md`. Those
have non-overlapping charters on purpose — a rule stated in two places is a
contradiction waiting for one of them to be edited.

## 1. Design premises

Four constraints drive every other decision:

1. **Human-readable substrate.** Everything must be openable in Obsidian and
   editable by hand. Markdown + flat YAML frontmatter + `[[wikilinks]]` is the
   single source of truth. If an agent's memory can only be read by the agent,
   the human loses the ability to audit or correct it.
2. **Git is the only database.** Every change is a commit, `git log` is the
   audit trail, `git revert` is undo. That buys versioning, sync, conflict
   handling and backup from one mechanism instead of four.
3. **Context is a finite budget, not storage.** Retrieval is tiered and
   pointer-based; the always-loaded surface is capped in characters.
4. **Fail-open automation.** No hook or script may block a working session.
   Every hook path exits 0.

A fifth was added later, after the first four let ~5,400 lines of machinery
accumulate around 17 notes: **machine state does not live on the tracked tree.**
A counter a hook ticks every turn is not evidence, and storing it as evidence
costs a commit, a lock acquisition and a Markdown parse per turn. Derived,
rebuild-tolerant state goes in a gitignored sidecar.

## 2. Layers

```
  Obsidian (human read/write)  ---+
                                  +-- plain .md files -- git -- remote
  Claude Code (agent read/write) -+       (substrate)    (db)   (sync)
        |
        +-- hooks/     deterministic runtime (session lifecycle)
        +-- skills/    judgment procedures (/ingest, /curator, /flywheel …)
        +-- scripts/   deterministic maintenance (by hand or from a skill)
```

The split between the last three is the core engineering rule: **deterministic
work is a script, judgment work is an LLM call.** Link checking and metric
rollups are scripts because they have a correct answer. Deciding whether two
facts are the same fact is a skill because it does not.

## 3. Storage model

| Folder | Cognitive type | Write mode | End of life |
|---|---|---|---|
| `logs/` | Episodic — what happened | append-only | distill → `archive/` |
| `core/MEMORY.md`, `notes/` (`memory` / `knowledge`) | Semantic — what is true | reconcile on write | supersede → archive |
| `notes/` (`playbook`), `.claude/skills/` | Procedural — how we work | deliberate revision | replace whole sections |
| `raw/` | Evidence — what a source said | write-once, by the human | never; a source is permanent |
| `.claude/*.json` sidecars | Derived machine state | overwrite, lock-free | discarded; never committed |

Mixing the first three is the classic failure of "one notes folder": episodic
content grows without bound, semantic content gets appended to instead of
reconciled, and procedural content drifts because nobody owns it.

`raw/` is separate for a different reason. It is the only place verbatim
external content may live, which is what makes "nothing enters `notes/`
verbatim" enforceable rather than aspirational — without a legal home, a quoted
paragraph either gets paraphrased into a note (losing the fidelity that made it
worth keeping) or is lost.

## 4. Retrieval: tiers, not search

- **Tier 0 — always loaded.** `IDENTITY.md` (40 lines), `USER.md` (2000 chars),
  `MEMORY.md` (4000 chars). Injected into every session by the SessionStart
  hook, which also prints each file's usage against its budget so the agent sees
  its remaining room *before* writing. `MEMORY.md` holds **pointers, never
  detail**: one fact per line, ending in a `[[wikilink]]`.
- **Tier 1 — the catalog, then the page.** `INDEX.md` lists every note in one
  line each. Read it, pick the two or three pages that matter, open those. This
  is the cheap half of retrieval and the reason no search index has been needed.
- **Tier 2 — grep and the episodic stream.** `logs/` and full-text search, when
  the first two don't answer.
- **`archive/` is not a tier below these** — it is live evidence at Tier 1
  depth. Superseded decisions are meant to be read before an expensive new one.

The budgets are mechanism, not decoration: past ~10KB of session-start payload
the harness stops inlining Tier 0 at all, so a budget overrun does not degrade
attention gracefully — it turns the always-loaded tier off. Over budget, the
rule is **consolidate, never silently truncate**.

Why there is no vector index: it was measured, not assumed. A golden set of 52
queries against the reference instance found zero paraphrase-misses — every
failure was a vocabulary mismatch (the query used a different word, or another
language's inflection), whose remedy is an `aliases:` line, not an embedding.
`scripts/retrieval-eval.mjs` re-runs `.claude/eval/golden-set.md` so that
finding stays falsifiable, and the trigger to revisit is written down.

## 5. Runtime: the hooks

Registered either in the vault's `.claude/settings.json` (project scope) or in
`~/.claude/settings.json` (global mode). Each script resolves the vault root
from its own file location, so the same script is correct from any working
directory.

| Event | Script | Job |
|---|---|---|
| `SessionStart` | `session-start.mjs` | `git pull --rebase --autostash`, inject Tier 0 with budget meters, sweep any session still owed a flush |
| `Stop` | `checkpoint.mjs` | tick the session trace, run the compiled checks, checkpoint-commit — bounds worst-case data loss to **one turn** |
| `PreCompact` | `checkpoint.mjs` | the same, before context is compacted away |
| `SessionEnd` | `session-end.mjs` | trace backstop, weekly reuse rollup if due, final commit with a shorter push timeout, then spawn the flush |
| `PostToolUse` (`Read`/`Grep`/`Glob`) | `reuse-telemetry.mjs` | count one (note, session) pair into the reuse sidecar |
| detached | `flush.mjs` | reconstruct a session log from the transcript when the agent ended without writing one |

Design notes worth keeping:

- **The Stop checkpoint is the backbone; SessionEnd is a bonus.** SessionEnd is
  unreliable on real OS session close, so nothing depends on it.
- **Push failure is non-fatal.** The commit stays local and syncs next time.
- **Guards before writing.** `lib.mjs` runs a staged-file secret scan and a
  Tier-0 budget check on every checkpoint commit, plus a second independent
  scanner (`gitleaks`) via pre-commit.
- **A stuck rebase is aborted, not left half-applied.**
- **Two sidecars, both gitignored, both lock-free.** `.claude/.access.json`
  buffers reuse counts until the rollup folds them into one durable ledger line;
  `.claude/.sessions.json` holds the per-session turn counter the flush reads.
  Losing either is bounded — the durable half of each record is a ledger line.
- **Flush is serialized by an exclusive claim file**, not by a check. A check
  cannot serialize work that outlives the gap between spawns; that bug produced
  three identical digests for one session before it was fixed this way.

## 6. What the runtime enforces

Only the parts of the policy that exist as code belong here; the policy itself
is `notes/lifecycle-policy.md`.

- **Compiled checks** (`.claude/hooks/checks.mjs`) run from the checkpoint path,
  warn-first, each fire deduplicated per (check, file, detail) per month into the
  signal ledger. Four ship: wikilink short form, note frontmatter conventions,
  an uncaptured correction, and `INDEX.md` coverage.
- **Tier-0 budgets** are measured on every checkpoint and shown at session start.
- **Protected files.** `IDENTITY.md` and `CLAUDE.md` are never edited by an
  automated pass; agents propose a diff into `PROPOSALS.md`, the owner applies it.
- **Secret scanning** on every staged commit, twice, by two independent tools.

Everything else — the corroboration gate, bi-temporal supersession, the maturity
ladder, archive-vs-delete — is enforced by convention and by the maintenance
passes the owner runs, not by code. That distinction is worth keeping honest,
and there is a measurement behind it: TRACE (arXiv 2606.13174) found prose
corrections re-violated **57.5%** of the time against 2–38% for a compiled
check. Telling a model its mistake in writing does not stick. This is the
single most load-bearing finding in the research this system was built on, and
the flywheel exists to move checkable rules out of prose and into the list
above.

## 7. The ingestion paths

Two inlets, one destination. This is the shape of the whole system rather than
a rule, which is why it is drawn rather than described.

```
  something you said                    something you read
  in any session                        (a paper, an article, an export)
        |                                       |
        | standing instruction,                 | you save it, deliberately
        | model-driven — not a hook             v
        v                                 raw/YYYY-MM-DD_<slug>.<ext>
  logs/YYYY-MM-DD_HHMM.md                       |  immutable; never edited
        | episodic, append-only, tagged         |
        | decision|bugfix|feature|…             |  /ingest — read it, discuss it,
        |                                       |  then distill and reconcile
        | /curator, at 30 days: extract         |
        | durable facts, archive the original   |
        v                                       v
  notes/<topic>.md  <-------------------------- +   semantic, confidence: low,
        |                                            source: on anything external
        |  corroboration gate: a second independent session confirms it
        v
  core/MEMORY.md          one pointer line, Tier 0, 4000 chars
```

Three properties are deliberate:

- **Only distillate travels upward.** The vault stores summaries, decisions and
  their reasons, never raw transcripts — those stay in Claude Code's own session
  storage. `raw/` is the exception that proves it: sources stay verbatim
  *because* they are outside the wiki.
- **Promotion is asynchronous.** A session writes episodic content immediately,
  but a fact becomes always-loaded memory only after a curator pass and a second
  independent confirmation.
- **A source is never memory on its own.** Anything from `raw/` carries
  `source:`, enters at `confidence: low`, and is closed out of `USER.md` and
  `IDENTITY.md` entirely. One document asserting something is not the vault
  believing it.

## 8. Known trade-offs

- **No semantic search.** Retrieval is catalog + pointers + grep + wikilinks.
  Fine at single-vault scale and it keeps the substrate portable; revisit when
  the retrieval-failure ledger says so, not before.
- **Single-writer assumption.** Concurrent scripts share one lockfile
  (`scripts/.brain.lock`, stale after 2h); the per-turn hooks were moved *off*
  that lock rather than made to queue on it. Real multi-device concurrent
  editing would need more than either.
- **Checkpoint commits outnumber content commits.** Bounding data loss to one
  turn means committing whenever a turn changed something. That is the intended
  trade, but `git log` reads as machine noise until you filter it.
- **The policy is only as good as its enforcement.** Anything enforced only by
  prose will drift; §6 lists what is not prose.
- **The machinery can outgrow the content.** Measured once at ~5,400 lines of
  hooks and scripts against 17 notes. The growth-control rule that governs
  folders and tags had never been applied to hooks and scripts, which is exactly
  how that happened. It now is — a new hook needs a failure that demanded it.
- **`raw/` can become a graveyard.** Files land, nothing ingests them. The
  symptom is visible (an un-ingested file appears in no index and no note) and
  the response is written down in advance: three weeks of that means the inlet
  isn't wanted, and it gets removed rather than nagged about.

## 9. The flywheel

Capture → corroborate → enforce-or-retire.

`/lesson` captures a correction verbatim into `notes/lesson-*.md` plus a
`correction` signal, with **no interpretation at capture time** — agents
confabulate their own failure stories, so the agent never authors the lesson in
the same session it earned.

`/flywheel` runs when the owner starts it, mines the ledger, corroborates repeat
classes, and proposes each as either a compiled check or a prose line —
proposals only, per the protected-files rule.

`/recall` is the four-layer lexical retrieval procedure, and it logs a
`retrieval-failure` signal with a cause when the vault misses. That signal is
the only thing that can reverse the no-vector-index decision.

`scripts/flywheel-metrics.mjs` is the deterministic measure step — fire counts,
prune candidates, correction recurrence, 30-day lesson survival, and the
note-reuse table — with no LLM call anywhere in it.

The seed checks were bootstrapped from standing `CLAUDE.md` conventions rather
than waiting for organic corroboration. That shortcut has a cost worth knowing:
a check that never fires cannot be distinguished from a check that *cannot*
fire, so a check earns its place by catching a synthetic offender, not by
staying quiet.
