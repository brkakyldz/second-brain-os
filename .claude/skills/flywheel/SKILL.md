---
name: flywheel
description: Weekly self-improvement pass — mines logs for missed corrections, corroborates lesson classes, routes corroborated lessons to a compiled check or a prose line, and reports metrics.
disable-model-invocation: true
---

# Flywheel

The weekly capture → corroborate → enforce-or-retire pass (ADR 0019,
`archive/0019-flywheel-capture-corroborate-enforce.md`).
Only run via `/flywheel` — the rollup that feeds it now runs from the
SessionEnd hook once the weekly window has elapsed (ADR 0033), never
auto-triggered as a pass itself.

## Standing rules

- **Uncorroborated lessons are never routed**, however plausible the class
  looks. A single occurrence waits; only a second, independent occurrence
  authorizes a routing decision.
- **The pass never edits protected files**: `CLAUDE.md`, `core/IDENTITY.md`,
  `.claude/hooks/*`, `.claude/settings.json`, or other active skills. Every
  change there is a row in the proposal table, for the owner to apply.
- **Proposals are pull artifacts** — they sit as checkbox rows in
  `PROPOSALS.md`, the vault's one approval surface. At most the top 3 surface
  proactively (the vault's 3-per-day notification budget spans all surfaces,
  not just this pass).
- **Never re-raise a proposal** already pending or previously rejected —
  check earlier flywheel logs first (same idempotency spirit as `/curator`).

## Procedure

0. **DECIDE FIRST.** Read `PROPOSALS.md` before anything else. For each row
   the owner ticked `- [x]`:
   - **safe and unprotected** (a note edit, an archive move, an `aliases:`
     addition, a `MEMORY.md` line) → apply it now, in this pass;
   - **protected** (`CLAUDE.md`, `core/IDENTITY.md`, `.claude/hooks/*`,
     `.claude/settings.json`, skills) → leave it for the owner and say so in the
     report; the tick means "they will apply it by hand";
   - **destructive** (deletion) → still ask, per [[lifecycle-policy]] §6.

   Rows in the **## Review** section are resurfacing answers, not work items:
   `[x]` means the note's top line still holds (nothing to do), `[-]` means it
   has gone stale — raise *one* new proposal row for the note (update,
   supersede, or archive) rather than editing it on a one-word answer.

   Rejected rows (`- [-]` or struck) need no action beyond never being raised
   again. Then, and only then, run the sweep in step 7 — it archives decided
   rows and writes their ledger lines, so anything you have not applied by
   then is a proposal that quietly died.

1. **MINE.** Scan the last 14 days of `logs/` session logs, `logs/signals/*.md`,
   and `git log --oneline` for corrections that never got a `/lesson` capture:
   reverts of agent commits, `rejection` acceptance-ledger lines, corrections
   quoted verbatim in a session log with no matching `correction` signal line.
   Dedup against existing `correction` lines first. For each genuinely missed
   one, run the `/lesson` capture procedure now, using the verbatim quote from
   the log/commit as the artifact — same verbatim-only rule, no interpretation.

2. **CORROBORATE.** Run `node scripts/flywheel-metrics.mjs` and read the
   correction-recurrence table:
   - class count >=2 from independent sessions -> **corroborated**, proceed to
     ROUTE.
   - single occurrence -> leave it waiting.
   - single occurrence, >90 days old -> **expire-candidate**: move the lesson
     note to `archive/` (archive-first, never delete).

3. **ROUTE** each corroborated class by one question — *is it mechanically
   checkable (would a grep/assert catch a repeat)?*
   - **Checkable** -> add a row to the proposal table (and to `PROPOSALS.md`,
     step 6): the finding plus a draft check body for
     `.claude/hooks/checks.mjs`. Never edit `checks.mjs` directly — the owner
     applies it.
   - **Judgment-only** -> add one line to `core/MEMORY.md`, one-in-one-out
     (name the line you retire in the same edit; `core/MEMORY.md` is not
     protected; MEMORY.md stays within its 4000-character budget, ADR 0030). If the right home is
     actually `CLAUDE.md`, propose it as a table row instead — `CLAUDE.md` is
     protected.

4. **MEASURE.** Include the `flywheel-metrics.mjs` output in the report: check
   fire-counts, prune candidates, correction recurrence, note re-use,
   retrieval-failure causes, acceptance rate, lesson survival. A check with
   0 fires across 2 cycles -> propose its deletion in the table. Three of
   those sections are read for a decision, not just printed:

   - **Note re-use (Q-14).** Zero re-use in a month is the write-only-
     graveyard signal and outranks everything else in the report — say so at
     the top. A note re-used from a *new* session is also the evidence that
     authorizes a `seedling -> growing -> evergreen` promotion (maturity
     through reuse, never a timer).
   - **Retrieval failures by cause (Q-12).** Only `paraphrase-miss` argues for
     a search index; `wrong-term` gets an `aliases:` proposal, `not-exists`
     gets a note-worth-writing row, `typo` gets nothing. An `uncaused` count
     above zero is a skill-discipline finding, not evidence.
   - **Acceptance rate (the master metric).** A feature whose rate is bottoming
     out gets a kill proposal, not another round of tuning. A "convention
     warning" line means proposals ran unanswered — that is the Q-13 backlog
     showing up, and it is a proposal about the *cadence*, not about content.

   The rollup that feeds the re-use table runs from the SessionEnd hook once
   the weekly window has elapsed, before this pass (`flywheel-metrics.mjs
   --rollup`). Don't run `--rollup` yourself — a second run mid-week just
   splits one window into two meaningless ones.

5. **RICH-LOG GAP.** List `session-digest` ledger lines from the 14-day window
   that have no matching `logs/YYYY-MM-DD_HHMM.md` rich log — the cheapest
   detection of a skipped session log (`logs/signals/README.md`).

6. **REPORT.** Write one proposal table into a session log entry
   (`logs/YYYY-MM-DD_HHMM.md`) — the evidence, with the reasoning:

   | # | proposal | evidence pointer | type |
   |---|---|---|---|
   | 1 | ... | note/signal-line/commit | check / prose / prune / archive |

   Then raise each row as an *ask* in `PROPOSALS.md`, one line each, id
   allocated by the script:

   ```
   node scripts/proposals.mjs --add --feature flywheel-check --text "add a checks.mjs rule for X · evidence: logs/2026-08-25_1200.md"
   ```

   `--feature` is what the acceptance-rate table groups by (`flywheel-check`,
   `flywheel-prose`, `flywheel-prune`, `flywheel-archive`). Skip any proposal
   already pending or previously rejected per the standing rule above.

7. **SWEEP.** After step 0's applications and step 6's new rows:

   ```
   node scripts/proposals.mjs
   ```

   It writes one `acceptance`/`rejection` ledger line per decided row, moves
   those rows to `logs/YYYY-MM-DD_proposals.md`, and rewrites the backlog
   block. Report its backlog line verbatim: a warning there is the Q-13
   finding, and the answer to it is less proposing, not more reminding.

8. **COMMIT once**: `flywheel: weekly pass YYYY-MM-DD`.

9. **STAMP** the run for the session-start due check (ADR 0033):

   ```
   node .claude/hooks/maintenance-stamp.mjs flywheel
   ```

