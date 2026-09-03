# Decision index

The hooks, skills and scripts in this repo carry `ADR NNNN` references in their
comments. This is what those numbers mean.

They are real decisions from the reference instance — the private vault this
template is derived from — kept as-is rather than scrubbed, because a comment
that says *why* a line exists is worth more than a tidy one that doesn't. Where
a decision was later reversed, the reversal is in this table too; that is the
point of keeping the numbers.

You inherit the outcomes, not the obligations. Nothing here binds your vault —
but if you're about to change something a number is attached to, this table
tells you what it was protecting.

| # | status | decision |
|---|---|---|
| 0001 | accepted | Git is the only database — no SQLite, no vector store, no server |
| 0002 | accepted | Vault-native Markdown is canonical memory; the assistant's built-in auto-memory stays local scratch |
| 0003 | accepted | Five-way memory split with hard size budgets that fail loudly |
| 0004 | accepted | Automation via SessionStart/Stop/SessionEnd/PreCompact hooks, in fail-open Node scripts |
| 0005 | superseded by 0034 | Mobile is read + quick-capture only; no mobile git write parity |
| 0006 | accepted | Two repositories — public template, private personal brain. Personal data never enters the public one |
| 0007 | accepted | Agent-first installation — the agent installs the brain from the repo link |
| 0008 | accepted | Global brain mode — hooks live at user level, the brain follows you into every project |
| 0009 | accepted | The installer offers global mode as the recommended choice |
| 0010 | superseded by 0018 | Hybrid retrieval as a derived index — lexical first, vectors on a named trigger |
| 0011 | accepted | Enforcement-first memory gates — scoped PreToolUse denial alongside fail-open automation |
| 0012 | accepted | A write rubric, independent corroboration, delta-only curation |
| 0013 | accepted | Self-improvement flywheel on manufactured feedback; survival replaces acceptance as the outcome anchor |
| 0014 | accepted | Hooks are gated on an explicit vault activation marker — a fresh clone is inert |
| 0015 | accepted | The vault is a personal tool first; this template is updated in batches, behind a two-week bar |
| 0016 | accepted | The working record lives in the private vault, not the template |
| 0017 | accepted | The reporting contract is a global standard, not a vault-local habit |
| 0018 | accepted | Retrieval is lexical + links + conventions; a retrieval-failure ledger is the only trigger to revisit it |
| 0019 | accepted | The flywheel is capture → corroborate → enforce-or-retire; the escalation ladder is the mechanism |
| 0020 | accepted | One append-only signal ledger plus a machine-written session trace |
| 0021 | accepted | No off-site git bundle job — the local clone plus the remote are the backup |
| 0022 | accepted | Seed checks compile standing conventions into enforced rules |
| 0023 | accepted | The PreToolUse write gate is reinstated, scoped to vault paths and the control plane |
| 0024 | accepted | Instrument what the policy claims to measure — reuse sidecar, rollup, caused retrieval failures, computed acceptance rate |
| 0025 | accepted | The session log gets a mechanism — transcript flush on SessionEnd, swept at SessionStart |
| 0026 | accepted | One approval surface (`PROPOSALS.md`); resurfacing is question-framed and inbound-poor |
| 0027 | accepted | Stop checkpoints skip trace-only commits and debounce the push |
| 0028 | accepted | The archive is flat — no subtree structure inside `archive/` |
| 0029 | accepted | This template is re-derived from the vault; the old `_brain/` layout is retired |
| 0030 | accepted | Tier-0 budgets are counted in characters and shown to the agent up front |
| 0032 | accepted | Machine state leaves the tracked tree; the reuse metric gets a trigger that actually runs |
| 0033 | accepted | Unattended scheduled maintenance retired — the trigger becomes session start |
| 0034 | accepted | The capture inbox and every mobile-capture plan are removed |
| 0035 | accepted | A `raw/` source layer, `/ingest` to read a source into the wiki, `/file` to keep an answer, and `INDEX.md` as the page catalog (amends 0002 and 0034) |

There is no 0031: the number was allocated to a decision that was abandoned
before it was written. Gaps are left in place rather than renumbered — a
decision log you can renumber is one you can quietly rewrite.

## Recording your own

Once your vault is running, keep doing this. A choice that is expensive to
reverse — a folder architecture, a retrieval strategy, a rule about what the
agent may delete — gets a dated file with context, decision, rationale, and
consequences, and a `status:` that later decisions can flip to `superseded by
NNNN`. The value is not the writing; it is that the next contradiction is
visible instead of silent.
