---
type: playbook
created: 2026-09-09
tags: [lifecycle, self-evolution, maintenance, growth-control]
status: active
aliases: [self-evolution loop, maintenance loop, growth control, anti-noise, notification budget, proactive cap]
description: How the vault changes itself — who triggers a maintenance pass, what may be added at all, and the noise budget that keeps a review surface alive. The content lifecycle is lifecycle-policy.
related: ["[[lifecycle-policy]]"]
---

# Self-Evolution Policy

**Top line.** The vault changes only when a person starts the change, only
after a failure that demands it, and only inside a fixed budget of attention —
three rules that between them decide what machinery is allowed to exist here.

Split out of [[lifecycle-policy]] once that file outgrew the ~150-line cap it
states for playbooks: what happens to a *note* stayed there, what happens to
the *system* came here. Binding rules live in `AGENTS.md`; this playbook holds
the *why*. The scripts themselves and their kill criteria are in
`scripts/README.md`; the machine they run on is `docs/ARCHITECTURE.md`.

## 1. The loop

| Trigger | Ritual | Mode |
|---|---|---|
| After substantial work | Session log, plus a `MEMORY.md` update when a durable fact emerged (standing rule) | applies |
| The owner runs it | `/curator`, which runs `link-sweep.mjs` and, with project cards, `project-doctor.mjs` — by hand, with someone watching | applies safe, reports the rest |
| The owner runs it | `/audit` — budgets, orphans, overdue `review_by`, tag sprawl, contradiction stacking | **report only, never fixes** |

Every trigger is a person. Nothing is scheduled (ADR 0033) and nothing reports
a pass as overdue either (ADR 0038) — a reminder to run a pass is not a
finding. A session start volunteers one thing: commits that never left this
machine, which no later session can recover.

The audit stays separate from consolidation: a pass that only reports cannot
cause the drift it exists to catch. This policy evolves through the gate it
defines — a proposed diff plus a `decision`-tagged log entry.

## 2. Growth control

- No new folder, tag or taxonomy tier speculatively — only after an actual
  retrieval failure. Over-organization is procrastination with extra steps.
- Tags are descriptive, applied after the fact, never a schema decided ahead.
- **The same gate applies to machinery**: a new hook, script or job needs an
  encountered failure, exactly as a folder does. The reference instance left
  this unwritten for nine days and accumulated ~5,400 lines of hooks and
  scripts around 17 notes (ADR 0032). Machinery acquires callers, so it is
  harder to remove than a folder.
- Health is **retrieval, not volume** — and it is judged, not counted. The
  access telemetry that once measured it recorded that a file was opened, never
  that opening it helped, and it informed no decision in the benefit check it
  was kept for, so it was retired (ADR 0039).

## 3. Anti-noise economics

A review queue dies from noise long before it dies from difficulty.

- **3 proactive items per local day, across every surface together** — one
  shared counter (`emitNotices` in `.claude/hooks/lib.mjs`), not several
  surfaces each promising the same cap; a backup failure outranks everything
  in it.
- **A suggestion feature that is not acted on gets killed, not tuned.** It was
  once scored as a proposal acceptance rate; the rate died with the queue it
  scored — 19 of 38 rows open, no rejection ever recorded (ADR 0038).
- **Every script carries a kill criterion** in `scripts/README.md`. A job with
  no defined way to fail is one nobody turns off.
- **Review cost is the design constraint** — a checkbox was not cheap enough.
  A finding acted on or dropped within the hour costs less than a row answered
  later.
