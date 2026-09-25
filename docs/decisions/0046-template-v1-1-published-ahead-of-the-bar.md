---
id: 0046
title: Template v1.1 is published ahead of the two-week bar, at the owner's request
date: 2026-09-25
status: accepted
amends: [0015, 0036]
---

# 0046 — Template v1.1 published ahead of the two-week bar

## Context

ADR 0015 holds an addition back from this template until it has run in the
reference instance for two weeks without being reverted. ADR 0036 made
removals exempt: a feature the vault deleted is not held back.

v1.1 carries both kinds. The removals — the whole-tree checkpoint, the flush,
reuse telemetry, proposal production (ADRs 0038, 0039, 0042) — ship under
0036 as they are. Several additions do not clear the bar on the day v1.1 is
cut:

- the ranked retrieval lookup and the brain doctor (one week in the vault);
- task-owned commits and the single user-level SessionStart per runtime
  (ADR 0042, five days);
- research snapshots with a live distillation (ADR 0043, five days);
- Claude Code and Codex as equal runtimes over one skills copy (ADR 0044,
  three days);
- the execution-layer contract, `/closeout` and the project doctor (ADR 0045,
  the same day).

## Decision

v1.1 ships them now, because the owner asked for the public template to be
brought in line with the vault now. This overrides ADR 0015 for this one
batch and says so; it does not change the rule. The next batch waits the two
weeks again, and removals stay exempt under 0036.

## Rationale

The bar is a filter on optimism about new work, not a law against shipping.
The owner can lift it knowingly; what makes that legitimate is that the lift
is written down here instead of happening silently — a silent exception is
how a rule stops meaning anything.

The risk is bounded the way 0036 bounded it: a reversal costs a commit. What
the override does give up is the evidence the two weeks would have produced,
so the young additions ship as what they are. The list above is that marking,
and the reference instance's later ADRs are where a reversal would show up.

## Consequences

- The public template matches the reference instance as it runs on the day of
  the tag, including parts that have had days, not weeks, of use.
- If one of the listed additions is reverted in the vault within its first
  two weeks, the removal ships immediately under 0036 — no bar applies to it.
- ADR 0015's cadence is unchanged for the next batch.
