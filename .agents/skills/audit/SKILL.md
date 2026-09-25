---
name: audit
description: Explicit report-only structural and semantic audit of the vault; writes one pointer-backed audit log, changes nothing else, and never opens a proposal queue.
disable-model-invocation: true
---

# Audit

The one pass in [[self-evolution-policy]] §1 that only reports. Consolidation
(`/curator`) changes memory; the audit exists
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
overdue `review_by`; tag sprawl (a tag used once); pins past ten;
logs past thirty days still undistilled; playbooks past 150 lines or still at
`uses: 1`; `status: evergreen` without the top-line distillation the gate
requires; the `type:` values in use versus `ALLOWED_TYPES` in
`.claude/hooks/checks.mjs`. Parse frontmatter blocks only — examples inside a
note do not count as metadata.

Also record the `notes/` size distribution and files over 150 lines, inbound
degree per note, weekly log-mention reuse proxy, `raw/` citation rate, and the
30-day log projection. Run the frozen retrieval eval
(`node scripts/retrieval-eval.mjs`) only when its cost fits the requested
audit; otherwise name the latest dated result and mark it not rerun.

Meaning (what only a full read catches): **contradiction stacking** — two
live statements that cannot both be true, neither carrying `valid_to` or a
"superseded by" line; **dead pointers** in `MEMORY.md`, `USER.md` and note
bodies (a path, log, note or ADR that no longer exists or no longer says what
the pointer claims); facts that appear in two places with different dates or
wording; a `MEMORY.md` line whose detail note has since moved on; an ADR
whose `status:` no longer matches what later ADRs did to it.

Run the compiled checks over the whole vault, read-only:
`node .claude/hooks/checks.mjs --all` (never `--record` here — that writes
the ledger). Since v1.1 nothing runs them on its own, so the audit is where a
violation surfaces; report each finding like any other. Run
`node scripts/vault-metrics.mjs` too (stdout only) and carry its check-fire,
correction-recurrence and retrieval-failure counts into the numbers table.

## How

Mechanical counts come from read-only shell one-liners and the read-only
scripts named above (`checks.mjs` without `--record`, `vault-metrics.mjs`,
`retrieval-eval.mjs`) — no new script file; the growth-control gate applies to
machinery too (ADR 0032). Do not run a report-writing helper such as
`link-sweep.mjs` during the audit; read its latest report or reproduce the
count without writes.

Read `core/`, `INDEX.md`, the previous audit, all live note frontmatter and the
full text needed for semantic claims, every decision note (`type: decision`,
in `notes/` and `archive/`), and relevant
logs from the last thirty days. If the live corpus cannot fit in one context,
process it in bounded batches and record the coverage; never claim a full
semantic read that did not occur. A finding from a batch summary enters the
report only after its cited file and line are reopened. Mark every previous
finding resolved / still open / regressed.

## Output

- `logs/YYYY-MM-DD_audit.md`, taxonomy `discovery`, with: a numbers table;
  findings grouped by severity (**blocks a rule** / **drifts** / **cosmetic**),
  each with `file:line`, the quote, and the fixing pass; the clean checks.
- At most three findings surfaced proactively — the notification cap is three
  items a day across every surface. Everything else stays in the report, which
  is a pull artifact: the owner opens it when they want it. The audit no longer
  opens an approval queue (retired 2026-09-06); a finding is reported and
  either acted on now or dropped.
- A one-paragraph summary to the owner, in whatever language they speak to
  you in: the numbers that changed their next action, nothing else.

## Constraints

- Writes exactly one thing on the tree: the new log file.
  Nothing else is touched — not `core/`, not the note that is
  wrong, not the ADR whose status is stale. Report, propose, stop.
- No fact is inferred by combining two others; no claim enters the report
  without the line it was read from.
