---
type: log
created: 2026-09-02
tags: [proposals, review, approval-surface]
status: active
related: ["[[lifecycle-policy]]"]
---

# Proposals — the one approval surface

Every proposing pass (`/curator`, `/flywheel`, `/audit`) appends its asks here
instead of burying them in a log table. You answer by ticking a box in Obsidian
whenever you feel like it; the next sweep reads the marks, applies what was
accepted and safe, logs one `acceptance`/`rejection` signal per decided row, and
moves the row out.

Review cost is the whole point: seconds per row, and the backlog is one
glanceable number at the bottom of a sweep.

## How to answer

| mark | means |
|---|---|
| `- [ ]` | undecided — still waiting on you |
| `- [x]` | **accept** — the next pass applies it (or, for a protected file, you apply it by hand) |
| `- [-]` | **reject** — logged as a `rejection` and never re-raised |

Strikethrough (`~~text~~`) counts as a rejection too, for when it's faster to
type. Add a reason after the row text with ` // ` if the *why* matters — it is
carried into the decided log verbatim.

## Rules of the file

- **Single writer for structure.** Proposers only *append* rows; only the sweep
  (`node scripts/proposals.mjs`) removes, renumbers, or reorders anything.
- **Never re-raise** a rejected row, and never duplicate a pending one.
- **Protected files stay propose-only.** A tick on a `CLAUDE.md`,
  `core/IDENTITY.md`, hook, or settings row means "I will apply this by hand" —
  no pass edits those, accepted or not.
- **Cap: 20 open rows.** Past that the sweep refuses to stay quiet and the
  proposing passes consolidate before adding more — same spirit as the Tier-0
  budgets.
- **Backlog older than 7 days is a kill signal**, not a nag: if rows sit that
  long, the cadence or the scope is wrong, not you.
- Row format (allocate IDs with `--add`, never by hand):
  `- [ ] P-0NN (curator-merge, 2026-09-02) — text · evidence: pointer`

## Open

## Review

Resurfaced notes, framed as a question with a ≤10-second answer. `[x]` = still
true, `[-]` = stale (the next pass proposes what to do about it).

## Backlog

_(rewritten by each sweep — do not edit by hand.)_

- open rows: 0 · oldest: — · review rows: 0
