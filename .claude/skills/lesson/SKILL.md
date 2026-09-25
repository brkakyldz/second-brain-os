---
name: lesson
description: Captures a correction verbatim as a low-confidence lesson note plus a correction signal line — no interpretation at capture time.
---

# Lesson

Captures a mistake the moment it's corrected, before the agent can talk itself
into a fluent-but-false story about what went wrong. Full rationale: ADR 0019,
amended by 0038 (`docs/DECISIONS.md`).

## Trigger

- the owner corrects the agent — "no, actually…", a revert, a rejected suggestion
  they explain.
- `/lesson` invoked explicitly, with the correction as argument.

## Standing rule — verbatim only, no interpretation

Capture is mechanical, not analytical:

- Write the correction **exactly as given** and the artifact it corrects (the
  diff, error message, or wrong output) — unchanged, no cleanup.
- **Never** author an interpreted "lesson learned," generalize the mistake, or
  propose a fix. The confabulation risk (ADR 0019, arXiv:2605.29463) is that a
  plausible narrative is worse than no narrative — interpretation comes
  later, from a fresh instance, after corroboration. Since the `/flywheel`
  pass was retired (ADR 0038) that later step is the owner's judgment, not a
  pass's.
- A correction **stays in the language it was given in**. Translation, if it
  happens at all, happens later — never here. A lesson's whole
  value is the correction verbatim.
- The class slug assigned below is grouping for corroboration, not analysis —
  don't reach past the six listed slugs unless none of them fit.

## Steps

1. **Create the note.** Copy `.claude/templates/lesson.md` to
   `notes/lesson-YYYY-MM-DD-<class>.md` (kebab-case). On a filename collision
   for the same day, suffix `-2`, `-3`, etc.

2. **Assign a class slug.** Pick the closest of:
   `wrong-memory | no-memory | unused-memory | wrong-procedure | style | scope`
   — or a new short slug only if none of the six fit. This is a mechanical
   grouping key for the corroboration count, not a judgment about the mistake.

3. **Fill the note** — correction verbatim, artifact verbatim, context facts
   (session id, project, date). Leave `confidence: low` and `status: seedling`
   as the template sets them.

4. **Append the signal line** from the vault root:
   ```
   node .claude/hooks/append-signal.mjs correction class:<slug> note:<filename> "<verbatim excerpt, <=80 chars>" --sid <session id if known>
   ```

5. **Add one outbound wikilink** only if an obviously-related note already
   exists (every note needs >=1 link per `CLAUDE.md`) — link to the related
   note itself, never to an interpretation of the mistake. Skip this step
   rather than force a link.

6. **Confirm in one line** to the owner: what was captured and its class, e.g.
   "Captured as `wrong-procedure`: notes/lesson-2026-08-25-wrong-procedure.md".

## Standing rule — never edited after capture

A lesson note is a dated snapshot of what was believed wrong at that moment.
It is never edited after capture. A better understanding of it is either a
**new** note or a later decision by the owner (once corroborated, routing it
to a compiled check or a `MEMORY.md` line) — never a rewrite of this file.
