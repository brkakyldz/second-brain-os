---
type: playbook
created: 2026-09-02
tags: [lifecycle, curation, memory]
status: active
aliases: [corroboration gate, archiving rules, contradictions, pinning, staleness]
description: What happens to a note or a fact, with rationale — tiers, distillation, maturity, staleness, archive-vs-delete, consolidation and anti-poisoning. How the system changes itself is self-evolution-policy; binding rules live in AGENTS.md.
related: ["[[MEMORY]]", "[[self-evolution-policy]]"]
---

# Lifecycle Policy

Binding rules live in `AGENTS.md`; this playbook holds the *why*. **Scope: what
happens to a note or a fact.** How the *system* changes itself — the
maintenance loop, growth control, the noise budget — is
[[self-evolution-policy]]; the machine they run on is `docs/ARCHITECTURE.md`.
None of the three restates a rule from another. Synthesized from PKM literature
(Ahrens, Matuschak, Forte/PARA, Appleton) and agent-memory research
(MemGPT/Letta, mem0, A-MEM, CoALA), then corrected against the reference
instance actually running it.

## 1. Memory tiers

- **Tier 0 — always loaded**: `IDENTITY.md` + `USER.md` + `MEMORY.md` in the
  vault, `USER.md` + `MEMORY.md` in any other project (the rest is
  vault-internal). Budgets (ADR 0030): `USER.md` 2000 characters, `MEMORY.md`
  4000; `IDENTITY.md` is a 40-line convention. Pointers, never detail. The
  budget protects loading itself — past roughly 10KB of payload the harness is
  *believed* to stop inlining Tier 0, a hypothesis the hook logs its measured
  size against on every run rather than assuming.
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
  original to `archive/` — flat, no subfolder (ADR 0028). Curator step.
- Playbooks are capped at ~150 lines each; if one outgrows that, split it.
- A long research report that crowds out retrieval may be kept twice: a
  byte-identical, date-prefixed snapshot in `archive/` and a short live note of
  the same name in `notes/` that holds the conclusion and points at the
  snapshot (ADR 0043). A selective pressure valve, not a rule that every long
  note is split — plans, playbooks and references whose detail *is* the
  retrieval target stay whole.

## 3. Distillation

There is no capture queue, on purpose. Two paths lead into the memory store and
both end in distillation: **live distillation inside a session** — something is
said, the note is written then and there — and **`/ingest` of a source** the
owner saved into `raw/` (ADR 0035). Nothing is queued for a later pass that
never comes. One rule is load-bearing:

- **Nothing enters `notes/` verbatim.** A thought is rewritten in original
  wording, merged into an existing note, or linked into the graph. Unprocessed
  clips are the collector's fallacy, however they arrive.

## 4. Knowledge-note maturity

- `status` ladder: `seedling → growing → evergreen`, promoted **only when a
  human or a pass actually rewrites the note** — never on a timer, and never
  from an access count. Being read is not maturing, and nothing here counts
  reads any more (ADR 0039).
- Every new note gets **≥1 outbound wikilink before it is closed** — the
  highest-leverage rule against orphan graveyards. **One exception, at capture
  time only:** a `notes/lesson-*.md` links only when an obviously-related note
  already exists (`/lesson` step 5). Choosing what a fresh mistake relates to
  is interpretation, and ADR 0019 keeps interpretation out of capture; the link
  arrives with corroboration or not at all.
- Atomicity gate for `evergreen`: one idea, cleanly nameable, understandable
  with zero context, nothing removable. Split a note that fails it.
- Orphans are structural waste, but the audit only **reports** them. Never
  manufacture a link to clear the count — a forced link is the documented PKM
  anti-pattern.

## 5. Staleness — domain-dependent, not universal

- **Verify before relying, whatever the date.** A claim about a tool, version,
  API, price or product behaviour is checked against its source at the moment
  something depends on it. Twelve months was never a freshness guarantee — an
  API can move in a week — and a `review_by` a year out mostly reassures.
- `review_by:` stays optional, for decay that is genuinely predictable.
  Nothing schedules a review: an overdue date is something a reader notices.
- Stable content (concepts, principles, reflection): no trigger at all.
- Correction memories are re-challenged after ~90 days; corrections that stack
  without expiry end up contradicting each other.

## 6. Archive vs delete

- **Archive is the default** — searchable, out of active views; git keeps the
  record either way.
- Deletion is allowed in exactly two cases: exact duplicates within one file,
  and a note that is simultaneously unlinked, fully superseded, and not
  load-bearing anywhere — proposed by the curator, executed only after the
  owner approves.
- Rationale: "never delete" is unbounded noise, free deletion loses
  load-bearing context; the conditions plus approval are the middle.

## 7. Consolidation contract (curator)

- **Runs when the owner starts it** (ADR 0033), never on every write and never
  on a clock.
- Per candidate fact, exactly one decision: **ADD / MERGE / SUPERSEDE / NOOP**,
  never blind append. Before ADD, search for near-duplicates.
- On contradiction **newer evidence wins and the override is logged** in the
  surviving note or session log — supersession is visible, never silent.
- Safe operations (merge duplicates, fix pointers, distill logs) are applied
  directly; destructive or structural ones are reported in the conversation and
  left to the owner. No queue is opened for them (ADR 0038).

## 8. Anti-poisoning guardrails

- Provenance: facts from untrusted external content carry `source:` forever,
  through every merge and move, and never enter `USER.md` or `IDENTITY.md`.
  A merge preserves each fact's source, date, scope and uncertainty; a newer
  line does not outrank an older one merely for being newer.
- Corroboration gate: a fact seen once enters `notes/` (`type: memory`) at
  `confidence: low` and reaches `MEMORY.md` only on a **second independent
  source** — independence being a property of the source, not a count of
  sessions. Re-reading one summary is one observation seen twice (ADR 0038).
- Protected files: `IDENTITY.md` and `AGENTS.md` are never edited by an
  automated pass — agents propose a diff, the owner applies it. **A
  convention, not a security boundary**: the clients carry no path deny-rule
  for either, and a shell command writes any file whatever the Write/Edit
  permissions say. It holds because the agent follows `AGENTS.md`.
- Pinning: `pinned: true` exempts a fact from demotion, capped at 10
  vault-wide. The quarterly re-justification went with the calendar (ADR
  0033); the cap stays in case pins start being used.
