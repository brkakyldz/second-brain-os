---
name: audit
description: Monthly structural audit of the vault, report-only — reads the live memory in one context, writes logs/YYYY-MM-DD_audit.md with pointer-backed findings, appends at most three proposal rows, and never fixes anything itself.
disable-model-invocation: true
---

# Audit

The one pass in [[lifecycle-policy]] §9 that only reports. Consolidation
(`/curator`) and corroboration (`/flywheel`) change memory; the audit exists
because memory systems degrade silently, and a pass that cannot write cannot
cause the drift it is meant to catch. Trigger is the owner, never a clock
(ADR 0033). Written 2026-09-02 for a session model with a 1M context: the
vault's live memory (`core/`, `notes/`, ADRs, recent `logs/`) fits in one
read, so the audit judges meaning, not just structure.

## Goal

One report a future session can act on: every finding names the file and
line, quotes the evidence, and says which existing pass fixes it. A finding
without a pointer is not a finding. A clean check is recorded too — the next
audit diffs against this one, and "checked, nothing" is data.

## What to check

Structure (the policy's list): Tier-0 budgets; notes with no inbound link;
overdue `review_by`; notes never opened since the reuse sidecar started
(`.claude/.access.json`); tag sprawl (a tag used once); pins past ten;
`PROPOSALS.md` rows older than seven days (the Q-13 kill signal); logs past
thirty days still undistilled; playbooks past 150 lines or still at
`uses: 1`; `status: evergreen` without the top-line distillation the gate
requires; the `type:` values in use versus `ALLOWED_TYPES` in
`.claude/hooks/checks.mjs`.

Meaning (what only a full read catches): **contradiction stacking** — two
live statements that cannot both be true, neither carrying `valid_to` or a
"superseded by" line; **dead pointers** in `MEMORY.md`, `USER.md` and note
bodies (a path, log, note or ADR that no longer exists or no longer says what
the pointer claims); facts that appear in two places with different dates or
wording; a `MEMORY.md` line whose detail note has since moved on; an ADR
whose `status:` no longer matches what later ADRs did to it.

Not re-reported: what the write-time checks already fire on
(`note-conventions`, `wikilink-short-form`).

## How

Mechanical counts come from shell one-liners inside the run — no script
file; the growth-control gate applies to machinery too (ADR 0032). The
semantic pass is the session model reading `core/`, `notes/`, every ADR in
`archive/`, `PROPOSALS.md` and the logs of the last thirty days. Older logs
and the rest of `archive/` may go to a cheaper sub-agent with a strict
contract (pointer + verbatim quote ≤120 chars per claim); its output is
evidence, and every finding it feeds is re-opened at the cited line before it
enters the report. Judgment never leaves the session model. If a previous
`_audit.md` log exists, read it first and mark each of its findings
resolved / still open / regressed.

## Output

- `logs/YYYY-MM-DD_audit.md`, taxonomy `discovery`, with: a numbers table;
  findings grouped by severity (**blocks a rule** / **drifts** / **cosmetic**),
  each with `file:line`, the quote, and the fixing pass; the clean checks;
  the proposal IDs appended.
- Proposal rows via `node scripts/proposals.mjs --add --feature audit`, at
  most three per run — the notification cap is three items a day across
  every surface. Everything else stays in the report as a pull artifact.
  Never re-raise a pending or rejected row; cite the existing ID instead.
- A one-paragraph summary to the owner, in whatever language they speak to
  you in: the numbers that changed their next action, nothing else.

## Constraints

- Writes exactly two things: the new log file and, through the script,
  proposal rows. Nothing else is touched — not `core/`, not the note that is
  wrong, not the ADR whose status is stale. Report, propose, stop.
- No fact is inferred by combining two others; no claim enters the report
  without the line it was read from.
