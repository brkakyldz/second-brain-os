# Repository operating contract — <project>

<One paragraph: what this builds, for whom, and what it deliberately is not.
Link the intent or scope document for the rest.>

This file is timeless: rules and pointers only. Status lives in
`docs/CURRENT_STATE.md`, direction changes in `docs/WORKLOG.md`, run history in
`docs/runs/`. A dated paragraph here is a WORKLOG line in the wrong file.

## Read first

1. This file.
2. `docs/CURRENT_STATE.md` — the only file that states status.
3. The last 10 lines of `docs/WORKLOG.md`.
4. The active milestone's section of `<plan path>`.

Canonical documents are read on demand, when the milestone touches them. Keep
the read-first set small (a working target: under 40 KB); when it grows past
that, move detail out instead of skimming. `git worktree list` shows any
worktree an autonomous run is working in; that run's own STATE is the live one
for its branch.

Never resume from a chat or compaction summary. Re-anchor: STATE, then
`git log --oneline <as_of>..HEAD` and `git status`, then the milestone section.

## Canonical ownership

| Concern | Canonical location | Writer | How to verify |
|---|---|---|---|
| Intent, scope, non-goals | `<INTENT.md>` | owner | — |
| Architecture | `<docs/architecture.md>` | owner; a change needs an ADR | `<focused check>` |
| Decisions | `<docs/decisions/>` | owner, or the session the owner asks | superseded chain intact |
| Milestones, acceptance IDs, exit commands | `<plan path>` | owner | the acceptance commands |
| Status | `docs/CURRENT_STATE.md` | the implementing session | no code commit after the last STATE commit |
| Direction, decisions, milestone results | `docs/WORKLOG.md` | any session, append-only | — |
| Run reports | `docs/runs/` | the session that ran the work (`/closeout`) | frontmatter `status` set |
| Evidence *(optional)* | `docs/evidence/` | the check that produced it | revision recorded |
| Held-out acceptance *(optional)* | `tests/acceptance/holdout/` | owner only | `<acceptance command>` |
| `<source area>` | `<path>` | `<owner or lane>` | `<focused command>` |
| Generated output | `<path>` | `<generator>` only | `<regen command>` |

A fact lives in one row; everything else links to it. Status appears nowhere
but STATE: a plan defines acceptance and never ticks it, and a README or
architecture doc carries no "Status:" line (ADR frontmatter is the exception).
Delete the rows that do not apply rather than leaving slots in place.

## Commands

| Check | Command |
|---|---|
| Setup from a clean checkout | `<command>` |
| Focused (while iterating) | `<command>` |
| Full offline gate | `<command list>` |
| Product-level acceptance | `<command>` |
| Live (opt-in, never in CI) | `<command>` |

Only commands that ran green here are listed; anything else is `UNVERIFIED`.

## Environment

<OS, toolchains, services. Secrets live in `<gitignored file>`, loaded by the
application; an agent never reads, prints, copies or commits it. The variable
names are in `<.env.example>`.>

## Invariants

<Numbered, project-specific: the boundaries, who owns which state, what model
output or user input may never decide, secrets.>

### Invariants that break silently

<Named failure patterns a green suite does not catch, each with the scenario
that would expose it. "Look for bugs" is not an entry.>

## Autonomy contract

One launch of an autonomous run authorizes every milestone in its scope.
Milestones are internal scope, test and acceptance gates, not approval gates:
when one passes, update STATE, commit, and start the next without asking.
Work one milestone at a time in plan order; do not prebuild later ones.

Do not stop after a plan, at a milestone end, at a diagnosable test failure, or
to confirm a reversible local choice (module layout, compatible patch versions,
test helpers, small refactors) — record it under Assumptions in the run
report. Never relax an invariant, weaken or delete a failing acceptance test,
or put a test double into the product's default path to get green. Never push,
merge, deploy, force, reset or rewrite history.

Documentation changes authorize no implementation; implementation starts when
the owner launches the work. Before a compaction or a long pause, checkpoint
STATE; after one, re-anchor.

## Blockers

A blocker names the blocked operation, its type and its dependents — never a
bare "blocked".

| Type | When |
|---|---|
| `credentials` | a required secret or API key is missing |
| `external-dependency` | a required service, tool or environment is unreachable and no allowed fallback exists |
| `owner-decision` | accepted requirements conflict, scope must grow, or an action is destructive or irreversible outside the repo |
| `contract-change` | an accepted ADR, frozen contract or plan acceptance would have to change |
| `live-verification` | only live evidence is missing: the live path has no key, or its authorized allowance is spent |
| `unreliable-oracle` | the check itself cannot be trusted: flaky on unchanged code, or it measures the wrong thing |

Not blockers: routine uncertainty, a diagnosable failing test, a documentation
lookup, an unmerged branch, a milestone ending.

Dependency-aware continuation: finish every independent piece of the blocked
milestone, record `BLOCKED(<type>)` with its acceptance IDs and the smallest
unblock action in STATE, then continue with later work only if it does not
depend on the missing result — write that assessment on the Blockers line. A
reproducible correctness or security failure is never "only live": fix it
before building on it. `contract-change` stops the run. The run also stops
when every remaining milestone depends on an unresolved blocker.

## Status vocabulary

`PLANNED | IN_PROGRESS | PASS | FAIL | BLOCKED(<type>) | ABANDONED | OPEN_GATE`

- `PASS` — every acceptance ID of the milestone has evidence at the recorded
  revision, including its product-level acceptance command. Offline-complete
  with live evidence owed is `BLOCKED(live-verification)`. A green merge of
  parallel work is an input, not a PASS.
- `OPEN_GATE` — the work is built and committed, but a remaining gate is the
  owner's judgement. It is never written as passed.
- Not run never counts as PASS. A check that did not run is a line saying so.

## Evidence

- Offline checks are the gate. Live checks (paid, networked, a real model) are
  evidence: opt-in, bounded, never in CI.
- When the plan has live checks, reserve each live call in an append-only,
  committed ledger (`docs/evidence/`) before making it — bucket, allowance,
  revision — and append its result after. An exhausted allowance is
  `BLOCKED(live-verification)`, never a silently raised ceiling.
- Evidence records the revision (and whether the tree was dirty), the
  configuration, denominators and failures — kept, not cherry-picked. Older
  evidence is reused only with a diff-based reason it still applies. A test
  double is not live evidence; a later offline pass is not retroactive live
  proof.
- No secret, credential or unredacted sensitive trace in evidence.

## Self-review

Before each milestone commit, review the diff for drift from architecture and
ADRs, ownership and state boundaries, authorization, failure paths, missing
tests, secrets, scope, and claims the evidence does not support.

- **CRITICAL** — boundary, correctness or security failure, or false evidence.
- **IMPORTANT** — required behavior or required test missing.
- **OPTIONAL** — non-blocking improvement.

Fix CRITICAL and IMPORTANT and rerun the affected checks before dependent
work; OPTIONAL gates nothing. A separate reviewer, if you use one, works on
the same scale, and its CRITICAL and IMPORTANT findings are Open gates in STATE
until fixed.

## Final gates

After the last milestone: <full offline regression; the plan's final acceptance
IDs; bounded live regression if the plan has live checks; fresh-checkout
verification from a clean worktree with isolated data; secret scan;
documentation and evidence consistency>. The plan is complete only when every
milestone is PASS and no blocker, open required finding or owed live evidence
remains; otherwise the report says incomplete and why. The agent merges and
deploys nothing.
