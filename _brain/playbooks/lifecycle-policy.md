---
type: playbook
created: 2026-08-18
tags: [lifecycle, curation, self-evolution, memory]
status: active
related: ["[[_brain/MEMORY.md]]"]
---

# Lifecycle & Self-Evolution Policy

The binding rules live in `CLAUDE.md` (§ Lifecycle & self-evolution). This
playbook holds the full policy and the reasoning. Synthesized from PKM
literature (Ahrens, Matuschak, zettelkasten.de, Forte/PARA, Appleton) and
agent-memory research (MemGPT/Letta, mem0, Generative Agents, A-MEM, CoALA,
Anthropic memory-tool & context-engineering guidance).

## 1. Memory tiers

- **Tier 0 — always loaded**: `IDENTITY.md`, `USER.md`, `MEMORY.md`.
  Hard budgets: 40 / 40 / 100 lines. `MEMORY.md` holds pointers, never detail.
  Rationale: context is a finite resource; an index past ~100–120 lines loses
  attention (observed Claude Code index-saturation failure).
- **Tier 1 — loaded on demand**: `_brain/memory/`, `_brain/playbooks/`,
  `projects/`, `knowledge/`. Reached via pointers and search, never preloaded.
- **Tier 2 — episodic stream**: `_brain/logs/`, `daily/`, `inbox/`.
  Append-only, short-lived, distilled upward then archived.

## 2. Cognitive types, different lifecycles

| Type | Lives in | Write mode | End of life |
|---|---|---|---|
| Episodic (what happened) | `logs/`, `daily/` | append-only | distill → archive |
| Semantic (what is true) | `MEMORY.md`, `_brain/memory/`, `knowledge/` | reconcile on write | supersede, then archive |
| Procedural (how we work) | `_brain/playbooks/`, skills | deliberate revision only | replace whole sections, never casual append |

- Logs older than 30 days: distill durable facts into topic files, move the
  original to `archive/logs/` (curator step, already implemented).
- Daily notes older than 90 days: move to `archive/daily/` by month.
- Playbooks are capped at ~150 lines each; if one outgrows that, split it.

## 3. Capture → triage

- Every `inbox/` item is triaged within **48 hours** of capture (Ahrens'
  fleeting-note window — after that the context that made it meaningful is gone).
- **Nothing is promoted verbatim.** A capture leaves the inbox only after being
  rewritten in original wording, or merged into an existing note, or linked
  into the graph. Unprocessed clips are the collector's-fallacy failure mode.
- Once promoted, the raw capture is deleted as part of the move — captures are
  disposable by design; keeping both is a failure to process.
- A capture that survives 3 triage passes untouched is not worth keeping:
  archive it with one line saying why, or drop it.

## 4. Knowledge-note maturity

- `status` ladder: `seedling → growing → evergreen`. Promotion happens **only
  through reuse** — the note gets touched, extended, or linked from new work.
  Never promote on a timer; a calendar can't tell if thinking matured.
- Every new note gets **≥1 outbound wikilink before it is closed**. This is
  the single highest-leverage rule against orphan graveyards.
- Atomicity gate for `evergreen`: one idea, cleanly nameable, understandable
  at a glance by a future session with zero context, nothing removable.
  Split a note when it fails this; keep composite while the idea is immature.
- Orphans (no links in or out) are structural waste: monthly sweep routes them
  into an existing note, a project, or `archive/`.

## 5. Staleness — domain-dependent, not universal

- Fast-decaying content (tools, software versions, APIs, prices, tech news):
  set `review_by: <created + 12 months>` in frontmatter at creation.
- Stable content (concepts, math, principles, personal reflection): no
  automatic staleness trigger — decay by usage, not by date.
- Feedback/correction-type memories are re-challenged after **90 days**:
  does this still apply? Corrections that stack without expiry end up
  contradicting each other.
- An overdue `review_by` never auto-deletes anything — it flags the note for
  the next curator pass.

## 6. Archive vs delete

- **Archive is the default.** `archive/` stays searchable but out of active
  views; git keeps the full record either way.
- Deletion is allowed in exactly three cases:
  1. Inbox originals after promotion (by design, see §3).
  2. Exact duplicates within one file (collapse to one line).
  3. A note that is simultaneously **(a)** unlinked, **(b)** fully superseded
     by a newer note, and **(c)** not load-bearing anywhere — and case 3 is
     only ever *proposed* by the curator and executed after the owner approves.
- Rationale: "never delete" alone produces unbounded growth and noise;
  unrestricted deletion loses load-bearing context. The triple condition +
  approval gate takes the middle path.

## 7. Consolidation contract (curator)

- Runs weekly (or on demand via `/curator`), never on every write.
- Per candidate fact, exactly one decision: **ADD / MERGE / SUPERSEDE / NOOP**
  — never blind append. Before ADD, search for near-duplicates first.
- On contradiction, **newer evidence wins, but the override is logged** in the
  surviving topic file or session log — supersession is visible, never silent.
- Safe operations (merge duplicates, fix pointers, distill logs) are applied
  directly. Destructive or structural operations (case-3 deletions, folder
  changes, budget-forced truncations of meaning) are **proposed as a table**
  for approval — evolution is decoupled from execution.

## 8. Anti-poisoning guardrails

- Provenance: facts from untrusted external content carry `source:` forever,
  through every merge and move. They never enter `USER.md` or `IDENTITY.md`.
- Corroboration gate: a fact seen only once, from one session, enters
  `_brain/memory/` with `confidence: low`. It is promoted into `MEMORY.md`
  only after a second independent session confirms or uses it. Durable status
  requires more than one observation — poisoning needs only one write.
- Protected files: `IDENTITY.md` and `CLAUDE.md` are never edited by an
  automated pass. Agents may propose a diff; only the owner applies it.
- Pinning: `pinned: true` exempts a fact from demotion. Maximum 10 pinned
  facts vault-wide; each pin is re-justified quarterly. Pinning without a cap
  is unbounded growth wearing a safety label.

## 9. The self-evolution loop

| Cadence | Ritual | Mode |
|---|---|---|
| Every session | Session log + MEMORY.md update (standing rule) | applies |
| Weekly | `/triage` (inbox → zero), then `/curator` (consolidate, budgets) | applies safe, proposes destructive |
| Monthly | Structural audit: budgets, orphans, overdue `review_by`, files untouched in many sessions, tag sprawl, contradiction stacking | **report only, never fixes** |
| Quarterly | Re-justify pins; review this policy itself against observed failures | proposes changes as decisions |

- The audit is deliberately separate from consolidation: memory systems
  degrade silently, and a pass that only reports can't cause the drift it is
  meant to catch.
- This policy evolves through the same gate it defines: a proposed diff plus
  a `decision`-tagged session-log entry, applied by the owner.

## 10. Growth control

- No new folder, tag, or taxonomy tier is added speculatively — only in
  response to an actual, encountered retrieval failure. Over-organization is
  procrastination with extra steps.
- Tags are descriptive (applied after the fact, reflecting what a note turned
  out to be about), never a prescriptive schema decided in advance.
- Health is measured by **retrieval, not volume**: the metric that matters is
  "notes that were re-used this month," not "notes captured." If nothing was
  retrieved in a month, the system is a write-only graveyard — fix that
  before adding anything.
