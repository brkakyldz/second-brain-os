---
name: lesson
description: Captures a correction verbatim into the brain as a low-confidence lesson note plus a correction signal line — no interpretation at capture time. Use from any repo when the owner corrects the agent, when /closeout finds an uncaptured correction, or on /lesson.
---

# Lesson

Captures a mistake the moment it's corrected, before the agent can talk itself
into a fluent-but-false story about what went wrong. Full rationale: ADR 0019,
amended by 0038 (`docs/DECISIONS.md` in the brain).

## Writes always land in the brain

Whichever repo the session is in, the note goes to `<brain>/notes/` and the
signal line to `<brain>/logs/signals/` — never into the current project. A
lesson is about the agent, not the project, which is why one store serves
every repo. Resolve `<brain>` once:

1. The session is in the brain itself (its root has `core/MEMORY.md` and
   `.claude/hooks/session-start.mjs`) → that root.
2. The SessionStart context says "The brain lives at `<path>`." (global
   mode) → that path.
3. `BRAIN_DIR` is set in the environment → that path.
4. This skill was loaded through a user-level link → the real path of this
   skill's folder, three levels up (`<brain>/.agents/skills/lesson`).
5. None of these → ask the owner. Never guess a path.

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

0. **Outside the brain, pull it first:** `git -C <brain> pull --ff-only`. If
   that fails, say so in one line and capture anyway.

1. **Create the note.** Copy `<brain>/.claude/templates/lesson.md` to
   `<brain>/notes/lesson-YYYY-MM-DD-<class>.md` (kebab-case). On a filename
   collision for the same day, suffix `-2`, `-3`, etc.

2. **Assign a class slug.** Pick the closest of:
   `wrong-memory | no-memory | unused-memory | wrong-procedure | style | scope`
   — or a new short slug only if none of the six fit. This is a mechanical
   grouping key for the corroboration count, not a judgment about the mistake.

3. **Fill the note** — correction verbatim, artifact verbatim, context facts
   (session id; project as the repo path, plus its brain card id when one
   exists; date). Leave `confidence: low` and `status: seedling` as the
   template sets them.

4. **Append the signal line.** The script resolves the brain from its own
   location, so it works from any working directory:
   ```
   node <brain>/.claude/hooks/append-signal.mjs correction class:<slug> note:<filename> "<verbatim excerpt, <=80 chars>" --sid <session id if known>
   ```

5. **Add one outbound wikilink** only if an obviously-related note already
   exists (every note needs >=1 link per `AGENTS.md`) — link to the related
   note itself, never to an interpretation of the mistake. Skip this step
   rather than force a link.

6. **Commit, when outside the brain.** Inside a brain session the session's
   own commit carries these paths. From any other repo, commit them now, by
   explicit path:
   ```
   git -C <brain> add -- notes/<file> logs/signals/<YYYY-MM>.md
   git -C <brain> commit -m "lesson: <class> (<project>)" -- notes/<file> logs/signals/<YYYY-MM>.md
   ```
   Include the signals file (in both commands) only if it is new this month
   or `git -C <brain> diff -- logs/signals/<YYYY-MM>.md` shows your line
   alone; other uncommitted lines belong to another task, so then commit the
   note only and say the signal line is left uncommitted. Never push.

7. **Confirm in one line** to the owner: what was captured and its class, e.g.
   "Captured as `wrong-procedure`: notes/lesson-2026-08-25-wrong-procedure.md".

## Standing rule — never edited after capture

A lesson note is a dated snapshot of what was believed wrong at that moment.
It is never edited after capture. A better understanding of it is either a
**new** note or a later decision by the owner (once corroborated, routing it
to a compiled check or a `MEMORY.md` line) — never a rewrite of this file.
