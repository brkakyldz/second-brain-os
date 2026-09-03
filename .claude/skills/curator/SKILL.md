---
name: curator
description: Consolidates the vault's memory: merges duplicate facts, resolves contradictions (newer evidence wins), archives stale entries, distills old session logs into topic files, and re-checks size budgets
disable-model-invocation: true
---

# Curator

Runs a maintenance pass over the memory core. Only invoked explicitly via
`/curator` (never auto-triggered) because it rewrites shared memory files.

## Standing rule — evidence pointers (anti-confabulation)

**Never write an inferred fact without a `source:` pointer.** The pointer is
one of: a vault file path, a verbatim quote from the material it came from, or
a commit hash. Summarizing a note is inference; so is "combining" two facts
into a third. If the evidence can't be pointed at, the fact does not get
written — surface it as a row in the proposal table or a question in
`core/OPEN_QUESTIONS.md` instead. A reflective pass that writes confident,
unsourced beliefs poisons every session after it.

## Procedure

1. **Read the current state.** Load `core/MEMORY.md`, `core/USER.md`,
   `core/IDENTITY.md`, the topic files under `notes/`, and every
   session log in `logs/` not already distilled.

2. **Dedupe and merge.** For each pair of facts in `MEMORY.md`/`USER.md`
   that describe the same thing, keep one line. When two facts conflict,
   the one with the newer date or more recent session log wins; note what
   was superseded in the surviving topic file if it matters for context.
   Where the losing fact carries bi-temporal keys, close its window
   (`valid_to`, `superseded_by`) rather than deleting the line.

   **Numeric consolidation targets** — merge when a topic crosses these:
   - one topic spread over **>5 notes** → consolidate to **≤2** (one topic
     file in `notes/`, one pointer line in `MEMORY.md`);
   - one topic holding **>5 lines in `MEMORY.md`** → push the detail down into
     `notes/<topic>.md`, leave **1** pointer line;
   - a `notes/<topic>.md` past **150 lines** → split by sub-topic.
   These are triggers, not quotas: never merge notes that are about
   genuinely different things just to hit a number.

3. **Apply the retention rule.** Every line in `MEMORY.md`/`USER.md` must be
   **timeless, dated, or a pointer to a live source**. For each line, check
   which bucket it falls in:
   - Timeless (still true, no date needed) → keep as is.
   - Dated but now stale (event passed, project closed, preference
     changed) → move the detail into the relevant `notes/<topic>.md`
     file (create it if needed) or into `archive/` if the whole thing is
     closed; leave at most a one-line pointer behind, or remove the line
     entirely if nothing forward-looking remains.
   - Pointer with a dead target → fix the pointer or remove the line.

4. **Distill old logs.** For every file in `logs/` named
   `YYYY-MM-DD_HHMM.md` whose date is more than 30 days before today:
   - Extract durable facts and decisions into the matching
     `notes/<topic>.md` topic file (append, don't duplicate).
   - Move the original log file to `archive/` (never delete it — the raw
     record stays available, just out of the searched-by-default path;
     archive is flat, so the filename stays `YYYY-MM-DD_HHMM.md`, ADR 0028).

5. **Verify budgets.** Recount **characters** in `MEMORY.md` (limit 4000, or
   `BRAIN_MEMORY_BUDGET` if set) and `USER.md` (limit 2000, or
   `BRAIN_USER_BUDGET` if set), stripping HTML comments (ADR 0030 — the unit
   was lines until 2026-08-27). The session-start header shows the same numbers.
   If still over budget after steps 2–4, repeat consolidation — do not stop
   with a file over budget.
   Two kinds of entry do not belong in `MEMORY.md` at all and are moved rather
   than compressed: the vault's own construction history goes to
   [[vault-build-history]], and open work items go to `PROPOSALS.md`.

6. **Never delete — propose instead.** Nothing produced by this pass is ever
   deleted outright. Stale content always lands in `notes/`,
   `archive/`, or `archive/logs/`. Only exact duplicate lines within
   `MEMORY.md`/`USER.md` itself may be collapsed to one. If a note meets all
   three deletion conditions of [[lifecycle-policy]] §6
   (unlinked + superseded + not load-bearing), list it in a **deletion
   candidates table** at the end of the pass for the owner to approve — do not
   execute the deletion.

7. **Provenance stays intact.** Facts carrying a `source:` marker (derived
   from untrusted external content) keep that marker through any merge or
   move. Never let an untrusted-sourced fact merge into a plain, unmarked
   line in `USER.md` or `IDENTITY.md` — those two files never take
   untrusted-sourced content, full stop.

8. **Mark what you touched (idempotency).** Every note this pass rewrote, or
   raised a proposal about, gets `curator_proposed: YYYY-MM-DD` in its
   frontmatter. Before proposing anything, read those markers: a note already
   marked for a proposal that the owner has not yet answered is **not** re-raised,
   and a proposal they rejected (open rows in `PROPOSALS.md`, decided rows in
   `logs/*_proposals.md` and the ledger's `rejection` lines) is never raised a
   second time. Past 20 open rows, consolidate instead of appending more —
   that cap is the file's own budget. Repeated identical
   proposals are how a review queue dies.

9. **Raise every proposal in `PROPOSALS.md`, log the table in `logs/`.**
   The session-log table stays (it is the evidence, with the reasoning), but
   the *ask* goes to the one approval surface the owner actually reviews — one
   appended row per proposal, id allocated by the script, never hand-formatted:

   ```
   node scripts/proposals.mjs --add --feature curator-merge --text "merge X into Y · evidence: logs/2026-08-25_1200.md"
   ```

   `--feature` is the slug the acceptance rate groups by (`curator-merge`,
   `curator-archive`, `curator-delete`, …). Keep the row to one line: the
   detail lives behind the evidence pointer. Proposers only *append* —
   removing, reordering, or renumbering rows is the sweep's job alone.

   Answered rows need no hand-written ledger line any more: `/flywheel`'s
   sweep turns each `[x]`/`[-]` mark into the `acceptance`/`rejection` signal
   that `flywheel-metrics.mjs` groups by feature. Only log a line by hand for
   a decision that never went through `PROPOSALS.md`:

   ```
   node .claude/hooks/append-signal.mjs acceptance feature:curator-merge ref:P-007
   ```

   A decision recorded only as prose in a log is invisible to the metric that
   decides whether this pass survives.

10. **Commit.** Stage everything touched by this pass and make exactly one
    commit: `curator: consolidation <YYYY-MM-DD>`. The `Stop` hook's own
    checkpoint commit is separate — this commit is the curator's explicit
    record of what it changed and why.

11. **Stamp the run.** Nothing is scheduled any more (ADR 0033); the
    session-start due check is what remembers this pass exists, and it cannot
    see a consolidation from the tree:

    ```
    node .claude/hooks/maintenance-stamp.mjs curator
    ```

    Skip this and the next session is told "curator never run" no matter how
    well this pass went.

