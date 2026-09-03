---
type: playbook
created: 2026-09-02
tags: [lifecycle, curation, self-evolution, memory]
status: active
aliases: [corroboration gate, archiving rules, contradictions, pinning, staleness]
description: The full lifecycle & self-evolution policy with rationale — tiers, distillation, maturity, staleness, contradiction handling, and the maintenance loop. Binding rules live in CLAUDE.md.
related: ["[[MEMORY]]"]
---

# Lifecycle & Self-Evolution Policy

The binding rules live in `CLAUDE.md` (§ Lifecycle & self-evolution); this
playbook holds the reasoning and is the single home for *why*. Synthesized from
PKM literature (Ahrens, Matuschak, zettelkasten.de, Forte/PARA, Appleton) and
agent-memory research (MemGPT/Letta, mem0, Generative Agents, A-MEM, CoALA,
Anthropic), then corrected against a year of one instance actually running it.

## 1. Memory tiers

- **Tier 0 — always loaded**: `IDENTITY.md`, `USER.md`, `MEMORY.md`. Budgets:
  `USER.md` 2000 characters, `MEMORY.md` 4000 (`IDENTITY.md` stays a 40-line
  convention, unmetered — it is protected). `MEMORY.md` holds pointers, never
  detail. Rationale: an index past ~4k characters loses attention, and past
  ~10KB of session-start payload the harness stops inlining Tier 0 at all — the
  budget protects loading itself, not just attention. The unit is characters,
  not lines, because a line cap silently varies 2× with how long your lines are.
- **Tier 1 — on demand**: `notes/` (`memory | playbook | project | knowledge`),
  reached by pointer and search, never preloaded.
- **Tier 2 — episodic**: `logs/`, append-only, distilled upward then archived.

## 2. Cognitive types, different lifecycles

| Type | Lives in | Write mode | End of life |
|---|---|---|---|
| Episodic (what happened) | `logs/` | append-only | distill → archive |
| Semantic (what is true) | `MEMORY.md`, `notes/` (`memory` / `knowledge`) | reconcile on write | supersede, then archive |
| Procedural (how we work) | `notes/` (`playbook`), skills | deliberate revision only | replace whole sections, never casual append |

- Logs older than 30 days: distill durable facts into notes, then move the
  original to `archive/` — flat, no subfolder. Curator step.
- Playbooks are capped at ~150 lines each; if one outgrows that, split it.

## 3. Distillation

There is no capture queue, on purpose. The one path into the memory store is
**live distillation inside a session**: something is said, the note is written
then and there, nothing is queued for a later pass that never comes. One rule
is load-bearing:

- **Nothing enters `notes/` verbatim.** A thought is rewritten in original
  wording, merged into an existing note, or linked into the graph. Unprocessed
  clips are the collector's-fallacy failure mode, whether they arrive through a
  queue or straight from a conversation.

## 4. Knowledge-note maturity

- `status` ladder: `seedling → growing → evergreen`, promoted **only through
  reuse** — touched, extended, or linked from new work. Never on a timer: a
  calendar cannot tell whether thinking matured.
- Every new note gets **≥1 outbound wikilink before it is closed** — the
  highest-leverage rule against orphan graveyards.
- Atomicity gate for `evergreen`: one idea, cleanly nameable, understandable by
  a future session with zero context, nothing removable. Split a note that
  fails it; keep it composite while the idea is immature.
- Orphans are structural waste, but the audit only **reports** them and
  `/curator` proposes what to do. Never manufacture a link to clear the count —
  a forced link is the documented PKM anti-pattern.

## 5. Staleness — domain-dependent, not universal

- Fast-decaying content (tools, versions, APIs, prices, news): `review_by:
  <created + 12 months>` at creation.
- Stable content (concepts, principles, reflection): no automatic trigger —
  decay by usage, not by date.
- Feedback and correction memories are re-challenged after **90 days**:
  corrections that stack without expiry end up contradicting each other.
- An overdue `review_by` never auto-deletes; it flags the note for the next
  curator pass.

## 6. Archive vs delete

- **Archive is the default.** `archive/` stays searchable but out of active
  views; git keeps the record either way.
- Deletion is allowed in exactly two cases: exact duplicates within one file,
  and a note that is simultaneously unlinked, fully superseded, and not
  load-bearing anywhere — proposed by the curator, executed only after the
  owner approves.
- Rationale: "never delete" produces unbounded noise, unrestricted deletion
  loses load-bearing context; the conditions plus approval are the middle.

## 7. Consolidation contract (curator)

- **Runs when the owner starts it**, never on every write and never on a clock.
- Per candidate fact, exactly one decision: **ADD / MERGE / SUPERSEDE / NOOP**,
  never blind append. Before ADD, search for near-duplicates.
- On contradiction **newer evidence wins and the override is logged** in the
  surviving note or session log — supersession is visible, never silent.
- Safe operations (merge duplicates, fix pointers, distill logs) are applied
  directly; destructive or structural ones (deletions, folder changes,
  budget-forced truncations of meaning) are **proposed as a table**. Evolution
  is decoupled from execution.

## 8. Anti-poisoning guardrails

- Provenance: facts from untrusted external content carry `source:` forever,
  through every merge and move, and never enter `USER.md` or `IDENTITY.md`.
- Corroboration gate: a fact seen only once enters `notes/` (`type: memory`) at
  `confidence: low`, and is promoted into `MEMORY.md` only after a second
  **independent** session confirms or uses it. Durable status requires more than
  one observation; poisoning requires only one write.
- Protected files: `IDENTITY.md` and `CLAUDE.md` are never edited by an
  automated pass — agents propose a diff, only the owner applies it.
- Pinning: `pinned: true` exempts a fact from demotion. Max 10 vault-wide,
  re-justified quarterly; a cap-free pin is growth wearing a safety label.

## 9. The self-evolution loop

The trigger is the owner opening a session, never a clock. Unattended
scheduling was tried in the reference instance and retired: a job that runs
without someone watching produces work nobody reads.

| Cadence | Ritual | Mode |
|---|---|---|
| Every session | Session log + `MEMORY.md` update (standing rule) | applies |
| When the session-start due line says so | `/curator`, `/flywheel`, `link-sweep.mjs` — by hand, with someone watching | applies safe, proposes destructive |
| Monthly | `/audit` — budgets, orphans, overdue `review_by`, unread notes, tag sprawl, contradiction stacking | **report only, never fixes** |
| Quarterly | Re-justify pins; review this policy against observed failures | proposes changes as decisions |

The audit is deliberately separate from consolidation: memory systems degrade
silently, and a pass that only reports cannot cause the drift it exists to
catch. This policy evolves through the gate it defines — a proposed diff plus a
`decision`-tagged log entry, applied deliberately.

## 10. Growth control

- No new folder, tag, or taxonomy tier speculatively — only after an actual
  retrieval failure. Over-organization is procrastination with extra steps.
- Tags are descriptive, applied after the fact, never a schema decided ahead.
- **The same gate applies to machinery**: a new hook, script or job needs an
  encountered failure, exactly as a folder does. The reference instance left
  this unwritten for nine days and accumulated ~5,400 lines of hooks and
  scripts around 17 notes. Machinery is harder to remove than a folder — it
  acquires callers.
- Health is **retrieval, not volume** — "notes re-used this month", never
  "notes captured". Nothing retrieved in a month is a write-only graveyard, and
  that gets fixed before anything is added.

## 11. Anti-noise economics

A review queue dies from noise long before it dies from difficulty, so these
protect the owner's attention as policy, not preference.

- **3 proactive items per day, hard cap, across every surface together** —
  session start, briefs, alerts, proposals. Everything past it is a pull
  artifact. False positives kill a queue permanently.
- **Acceptance logging is the master metric**, through `PROPOSALS.md` and the
  signal ledger; a suggestion feature that is not accepted gets **killed, not
  tuned forever**.
- **Every automated job carries a kill criterion** written down beside its
  purpose. A job with no defined way to fail is one nobody turns off.
- **Review cost is the design constraint.** Answering a proposal is a checkbox.
  If rows sit longer than a week, the cadence or scope is wrong — not the owner.
