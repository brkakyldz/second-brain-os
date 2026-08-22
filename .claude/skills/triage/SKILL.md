---
name: triage
description: Files inbox/ captures into their proper vault locations with correct frontmatter
---

# Triage

Empties `inbox/` by filing each capture where it belongs, with correct
frontmatter. Run after quick-capture sessions add files there.

## Standing rule — captures are always new files, never edits

Every capture path (manual, agent, automation) writes a **brand-new
file with a unique name** into `inbox/`. No capture ever edits an existing
note. This is what makes concurrent capture structurally conflict-immune —
two devices appending to one file is a merge conflict; two devices creating
two files is not. Triage is the *only* step allowed to merge a capture into an
existing note, and it runs here, on one machine, with the whole vault visible.

## Procedure

For each file in `inbox/`:

1. **Read it.** Quick captures are often just a title and a few lines with
   no frontmatter.

2. **Infer the type** from content:
   - Actionable item tied to an existing project → **task for a project**:
     append it to that project's note under a `## Tasks` or `## Next`
     section rather than creating a new file.
   - Standalone durable idea, reference, or atomic fact → **knowledge**
     note in `knowledge/`.
   - New project idea or update to an existing one → **project** note in
     `projects/` (create if new, update if it matches an existing one).
   - Dated observation, log-shaped, or clearly "today" scoped → **daily**
     addendum: append to `daily/YYYY-MM-DD.md` (create if missing).

3. **Rewrite with proper frontmatter** per the schema in the vault's
   `CLAUDE.md`:
   - `type`: `project | knowledge | daily | log | playbook | capture | decision`
   - `created`: `YYYY-MM-DD` (use the capture's original date if known,
     else today)
   - `tags`: inferred from content
   - `status`: knowledge → `seedling`; projects → `active` (unless clearly
     otherwise)
   - `source`: set if the capture originated from untrusted external
     content (e.g. pasted from a web page) — never drop this marker
   - `related`: `[[wikilinks]]` to obviously related existing notes
   - `last_triaged`: `YYYY-MM-DD` — today. This marker is the idempotency
     guard: a later pass reading a note already triaged today does not
     re-file, re-link, or re-sweep it.

4. **Move, don't copy.** The file's content moves to its filed location
   (kebab-case filename matching the vault's note conventions) or is
   merged into an existing note. The original file in `inbox/` is removed
   as part of the move — `git mv` where a straight rename applies, or
   create-then-delete when merging into an existing note.

5. **Link from related notes** where obvious (e.g. a new knowledge note
   referenced from the project note it relates to) — don't force links.

6. **Unlinked-mention sweep — exact matches only.** Grep the vault for the
   filed note's exact title and any explicit alias, and for the exact titles
   of existing notes inside the filed text. Where a match is a plain-text
   mention of an existing note, turn it into a `[[wikilink]]` in its
   surrounding sentence.
   - **Exact title or alias string only.** No stemming, no synonyms, no
     "these feel related". This step is calibrated for **zero false
     positives** — a wrong link costs more trust than a missed link costs
     value, and the missed ones get caught later anyway.
   - Skip matches inside code blocks, quoted external text, and `archive/`.
   - Cap it: if a sweep would add more than ~10 links, link the clearest ones
     and note the rest in the run summary rather than carpet-bombing.

7. **Route against the open questions.** Read `_brain/OPEN_QUESTIONS.md` and
   check the capture against every `open` row. If it **answers**, **refines**,
   or **contradicts** one:
   - link it — the note gets `related: [[_brain/OPEN_QUESTIONS]]` plus the
     question ID in the sentence that responds to it, and the question's row
     gets a `[[wikilink]]` to the note in its `related:` field;
   - say which of the three it did — "answers Q-04", "contradicts Q-09";
   - flip `status: answered` **only** when the question is genuinely closed.
     Refinements and partial evidence leave it `open`. Never delete a row.
   If the capture raises a *new* durable question, add it as a new `open` row
   rather than burying it in the filed note.

8. **Confirm inbox is empty**: every file present at the start is filed or
   merged; none remain.

9. **Commit once**: `triage: <n> items filed`, `<n>` = inbox files processed.
