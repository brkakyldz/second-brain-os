---
name: curator
description: Explicit maintenance pass that reconciles the vault's live memory, distills due logs, archives stale evidence, and verifies Tier-0 budgets.
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
written — surface it in the report, or as a question in
`core/OPEN_QUESTIONS.md` instead. A reflective pass that writes confident,
unsourced beliefs poisons every session after it.

## Procedure

1. **Protect the working tree, then read current state.** Run `git status` and
   attribute every pre-existing change before writing. Pull with `--ff-only` as
   the vault sync rule requires. Load `core/MEMORY.md`, `core/USER.md`,
   `core/IDENTITY.md`, `INDEX.md`, all topic files under `notes/`, the previous
   curator log, and every log currently due under step 4. Read a newer log only
   when it is evidence for a live contradiction; there is no reliable
   "already distilled" marker for the entire recent log stream.

   Then run the two instruments this pass acts on. `node scripts/link-sweep.mjs`
   writes `logs/YYYY-MM-DD_link-sweep.md`: its broken links, orphans, dangling
   `MEMORY.md` pointers and notes missing from `INDEX.md` are this pass's to fix,
   and the report is committed with this pass in step 10. If any note is a
   project card, `node scripts/project-doctor.mjs` (read-only) lists log
   `project:` ids with no card and focus lines pointing at a paused or done
   card; fix what is vault-side, report the rest — a project repo's own state
   is never this pass's to change.

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
   - a playbook past **150 lines** → split by sub-topic;
   - another note past **150 lines** → classify it before acting. A research
     report may need an immutable archived source plus a short live
     distillation, but only under an accepted storage decision; an active plan
     or genuinely atomic long reference is not mechanically split.
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

4. **Distill old logs.** For every file directly in `logs/` whose date prefix
   is more than 30 days before today — session logs and pass reports alike,
   never the signal ledger in `logs/signals/`:
   - Extract durable facts and decisions into the matching
     `notes/<topic>.md` topic file (append, don't duplicate).
   - Move the original log file to `archive/` (never delete it — the raw
     record stays available, just out of the searched-by-default path;
     archive is flat, so the filename stays as it was, ADR 0028).
   - Record the batch size and how many logs produced a genuinely new fact
     (ADD) versus only facts already present (NOOP). This is the evidence for
     whether the 30-day rule earns its cost.

5. **Verify budgets.** Recount **characters** in `MEMORY.md` (limit 4000, or
   `BRAIN_MEMORY_BUDGET` if set) and `USER.md` (limit 2000, or
   `BRAIN_USER_BUDGET` if set), stripping HTML comments (ADR 0030 — the unit
   was lines until 2026-08-27). The session-start header shows the same numbers.
   If still over budget after steps 2–4, repeat consolidation — do not stop
   with a file over budget.
   Two kinds of entry do not belong in `MEMORY.md` at all and are moved rather
   than compressed: the vault's own construction history goes to a note of
   its own, and open work items go to the hand-kept list in `PROPOSALS.md` —
   only ever on the owner's say-so, never as a queue this pass fills for
   itself.

6. **Never delete — propose instead.** Nothing produced by this pass is ever
   deleted outright. Stale content always lands in `notes/` or in `archive/`,
   which is flat — a distilled log keeps its dated filename and
   moves to `archive/` itself, never into a subfolder (ADR 0028, and step 4
   above says the same thing). Only exact duplicate lines within
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

8. **Mark what you touched (idempotency).** Every note this pass rewrote gets
   `curator_proposed: YYYY-MM-DD` in its frontmatter. Before raising anything,
   read those markers and the previous curator logs: the same finding reported
   run after run is how a maintenance pass stops being read.

9. **Report what you found; do not open a queue.** Everything this pass
   applied goes in the session log with its evidence. Everything it did *not*
   apply — because the file is protected, because the change is destructive,
   because it is a judgment call — is said to the owner in the same conversation,
   in the report, and nowhere else.

   The `PROPOSALS.md` approval queue was retired (ADR 0038): in the reference
   instance it accumulated 38 rows, 19 of them still open with four past a
   week, and the review cost it promised ("seconds per row") never showed up.
   A finding the owner reads now and acts on or drops is worth more than a row
   answered later. Anything they do want to keep for later goes in the
   hand-kept list in
   `PROPOSALS.md`, which nothing writes automatically.

   Cap what surfaces proactively at three items — the AGENTS.md notification
   budget is three a day across every surface, and this pass is one of them.

10. **Commit without stealing another task's work.** Stage only the explicit
    paths this pass created, moved or edited — never `git add -A`, `git add .`
    or a wildcard. If this pass and a pre-existing change share one file,
    stage only this pass's hunk or leave that file out and report it. Make
    exactly one commit: `curator: consolidation <YYYY-MM-DD>` (ADR 0042).

11. **Nothing to stamp.** The maintenance stamp and the session-start due
    line it fed were removed (ADR 0038). The owner runs this pass when they
    want it; the vault does not tell them it is overdue.
