---
name: ingest
description: Reads a raw source into the wiki — a file in raw/, a registered source root, or a document the owner points at — and distills it into notes/, reconciling it against what the vault already believes. Use when the owner says "bunu ingest et", "şu makaleyi oku ve işle", "raw'daki dosyayı al", "ingest this paper", or invokes /ingest.
---

# Ingest

The one operation that turns a source into memory. A source is read **once**;
after that the vault answers from the distillation, not by re-reading. That is
the whole economics of the thing — the cross-references, the contradictions and
the synthesis are compiled at ingest time instead of re-derived per question.

Contracts this obeys: `raw/README.md` (sources are immutable), `CLAUDE.md`
§ Distillation and § Memory rules, ADR 0035, ADR 0012 (untrusted-source veto).

## Trigger

The owner pointing at something: `/ingest <path>`, "read this into the notes",
or dropping a file in `raw/` and asking for it to be read. Never fires on its own — a file appearing in `raw/` is not a trigger, it
is a document at rest.

If the owner names several sources, ingest them **one at a time**, fully, and
check in between. A batch pass writes wiki content with nobody reading the output,
which is the shape ADR 0033 retired.

## Steps

### 1. Locate and read the source, completely

`raw/<file>`, a path they gave, or a file inside a root in [[source-roots]]. Read
the whole thing before writing anything — a partial read produces a summary
that is confidently wrong about the part you skipped.

Markdown with inline images needs two passes: read the text, then view the
images that carry real content (a chart, a diagram, a screenshot of data).
Skip decorative ones.

If the source is not yet in `raw/` and has no other home, ask the owner whether
to save it there first — naming it `YYYY-MM-DD_<slug>.<ext>`. Fetching into
`raw/` happens only on their say-so.

### 2. Talk it through before writing

Give the owner the takeaways in a few sentences: what the source claims, what is
actually new relative to the vault, and what you would *not* keep. This is the
step that makes ingest supervised rather than automatic, and it is where they
redirect emphasis. Wait for their response.

For a source that turns out to say nothing the vault does not already hold, the
correct outcome is a one-line log entry and **no note**. A note per source is
not the goal; not re-reading the source is.

### 3. Reconcile against what the vault already believes — in two steps

Never decide in one pass (P-004: single-step freshness judging measures ~54%,
split ~82-93%).

**3a. List candidates.** Search for what this source touches, following the
four layers in `/recall`: `INDEX.md` first, then `grep` over `notes/`, then
`core/MEMORY.md`, then `logs/`. Write down the pages that could conflict or
absorb this material.

**3b. Decide per fact** against that list — ADD / MERGE / SUPERSEDE / NOOP.
NOOP is the most common answer and costs nothing; the failure mode of this
step is a new note that restates an existing one under a different title.

A **SUPERSEDE never overwrites.** Close the old fact's window
(`valid_to`, `superseded_by: [[new-note]]`) and write the new fact as a new
entry, plus a visible `Superseded by [[x]] on YYYY-MM-DD` line in the body.
The old belief and the date it died are themselves data.

### 4. Write the distillation

- **Nothing verbatim.** Rewrite in your own wording. The verbatim copy already
  exists in `raw/` and that is the only place it may live. Quote only when the
  exact phrasing is the point — one or two lines, in quotes, attributed.
- **`source:` is mandatory** in frontmatter: `raw/2026-09-02_slug.md` or the
  root path plus the file. Anything derived from external content carries it.
- **Date anything perishable.** A version number, a price, a benchmark result,
  "the current state of X" — each gets the date it was true. Fast-decaying
  material gets `review_by: created + 12 months`.
- New note → `.claude/templates/knowledge.md`, `status: seedling`,
  `confidence: low` if the claim is single-sourced. Merge into an existing note
  → append or revise the relevant section, never a wholesale rewrite of a note
  the owner wrote themselves.
- **≥1 outbound wikilink** before the note is closed, short form
  (`[[note-name]]`, no path).

### 5. Update the neighbourhood

A real ingest touches more than one page. Add the inbound links that now make
sense from existing notes — not a link dump, one sentence of context each. If
the source contradicts something the vault says, the contradiction is recorded
in both places, not just the new one.

### 6. Update `INDEX.md`

- A row in **Ingested sources**: the source, the date, and the notes it fed.
- A row in the right category for any new page, with its one-line description.
- Fix the description of any page whose scope this ingest changed.

The `index-coverage` check will fire on a missed note. Do not rely on it —
it is the net, not the procedure.

### 7. Append a log entry

`logs/YYYY-MM-DD_HHMM.md`, tagged `discovery` (or `decision` where the ingest
settled something). Record what was ingested, what was written, and — this is
the part that gets skipped — **what was deliberately not kept**, so a future
session does not re-ingest the same source hoping for more.

## Standing rules

- **`MEMORY.md` is never written by an ingest.** A fact from a source enters
  `notes/` as `type: memory`, `confidence: low`; it reaches `MEMORY.md` only
  after a second *independent* session confirms it. External content is
  hard-vetoed from `USER.md` and `core/IDENTITY.md` entirely (ADR 0012).
- **`raw/` is never modified.** Not renamed, not reformatted, not tidied, not
  deleted after reading. If a source is wrong, that is a fact about the source
  and it goes in the note.
- **One source at a time, the owner in the loop.** The discussion in step 2 is not
  optional politeness; it is the supervision that makes this safe to run.
- **The 3-proactive-items-per-day cap still applies.** Findings that are worth
  raising go in the note and the log, not into a list of suggestions.
- If the source is the owner's own writing, this is the wrong skill. Their own
  words are theirs; the vault distills what they read, not what they wrote.
