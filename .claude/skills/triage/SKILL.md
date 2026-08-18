---
name: triage
description: Files inbox/ captures into their proper vault locations with correct frontmatter
---

# Triage

Empties `inbox/` by filing each capture where it belongs, with correct
frontmatter. Run after mobile or quick-capture sessions add files there.

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
   - `type`: `project | knowledge | daily | log | playbook | capture`
   - `created`: `YYYY-MM-DD` (use the capture's original date if known,
     else today)
   - `tags`: inferred from content
   - `status`: knowledge → `seedling`; projects → `active` (unless clearly
     otherwise)
   - `source`: set if the capture originated from untrusted external
     content (e.g. pasted from a web page) — never drop this marker
   - `related`: `[[wikilinks]]` to obviously related existing notes

4. **Move, don't copy.** The file's content moves to its filed location
   (kebab-case filename matching the vault's note conventions) or is
   merged into an existing note. The original file in `inbox/` is removed
   as part of the move — `git mv` where a straight rename applies, or
   create-then-delete when merging into an existing note.

5. **Link from related notes** where obvious (e.g. a new knowledge note
   referenced from the project note it relates to) — don't force links.

6. **Confirm inbox is empty**: every file present at the start is filed or
   merged; none remain.

7. **Commit once**: `triage: <n> items filed`, `<n>` = inbox files processed.
