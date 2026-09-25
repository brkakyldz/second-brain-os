# Decision index

The hooks, skills and scripts in this repo carry `ADR NNNN` references in their
comments. This is what those numbers mean.

They are real decisions from the reference instance — the private vault this
template is derived from — kept as-is rather than scrubbed, because a comment
that says *why* a line exists is worth more than a tidy one that doesn't. Where
a decision was later reversed, the reversal is in this table too; that is the
point of keeping the numbers.

**Where the full records live.** For 0001–0044 this table is the whole of what
ships: the full records stay in the reference instance. From 0045 on, the full
record ships beside this index as `docs/decisions/NNNN-<slug>.md`,
generalized — the reasoning is kept, the names and figures of the reference
instance's projects are not. An annotation in *italics* says where the
template differs from the reference instance.

You inherit the outcomes, not the obligations. Nothing here binds your vault —
but if you're about to change something a number is attached to, this table
tells you what it was protecting.

| # | status | decision |
|---|---|---|
| 0001 | accepted | Git is the only database — no SQLite, no vector store, no server |
| 0002 | accepted | Vault-native Markdown is canonical memory; the assistant's built-in auto-memory stays local scratch |
| 0003 | accepted | Five-way memory split with hard size budgets that fail loudly |
| 0004 | accepted | Automation via SessionStart/Stop/SessionEnd/PreCompact hooks, in fail-open Node scripts (since 0042/0044 only SessionStart remains) |
| 0005 | superseded by 0034 | Mobile is read + quick-capture only; no mobile git write parity |
| 0006 | accepted | Two repositories — public template, private personal brain. Personal data never enters the public one |
| 0007 | accepted | Agent-first installation — the agent installs the brain from the repo link |
| 0008 | superseded by 0042 | Global brain mode — hooks live at user level, the brain follows you into every project (the global SessionStart survives in 0042/0044) |
| 0009 | accepted | The installer offers global mode as the recommended choice |
| 0010 | superseded by 0018 | Hybrid retrieval as a derived index — lexical first, vectors on a named trigger |
| 0011 | accepted | Enforcement-first memory gates — scoped PreToolUse denial alongside fail-open automation *(the template wires no PreToolUse gate; see 0023)* |
| 0012 | accepted | A write rubric, independent corroboration, delta-only curation |
| 0013 | accepted | Self-improvement flywheel on manufactured feedback; survival replaces acceptance as the outcome anchor *(the `/flywheel` pass itself was retired by 0038)* |
| 0014 | accepted | Hooks are gated on an explicit vault activation marker — a fresh clone is inert |
| 0015 | accepted | The vault is a personal tool first; this template is updated in batches, behind a two-week bar |
| 0016 | accepted | The working record lives in the private vault, not the template |
| 0017 | accepted | The reporting contract is a global standard, not a vault-local habit *(reference instance only — the template ships no reporting contract)* |
| 0018 | accepted | Retrieval is lexical + links + conventions; a retrieval-failure ledger is the only trigger to revisit it |
| 0019 | amended by 0038 | The flywheel is capture → corroborate → enforce-or-retire; the escalation ladder is the mechanism |
| 0020 | accepted | One append-only signal ledger plus a machine-written session trace *(the session trace went with 0038; the ledger stays)* |
| 0021 | accepted | No off-site git bundle job — the local clone plus the remote are the backup |
| 0022 | accepted | Seed checks compile standing conventions into enforced rules *(since 0042 nothing runs them automatically; they are kept as code)* |
| 0023 | accepted | The PreToolUse write gate is reinstated, scoped to vault paths and the control plane *(no PreToolUse gate is wired in v1.1 — protected files are a convention, `notes/lifecycle-policy.md` §8)* |
| 0024 | accepted | Instrument what the policy claims to measure — reuse sidecar, rollup, caused retrieval failures, computed acceptance rate (amended by 0038, 0039) |
| 0025 | superseded by 0038 | The session log gets a mechanism — transcript flush on SessionEnd, swept at SessionStart |
| 0026 | accepted | One approval surface (`PROPOSALS.md`); resurfacing is question-framed and inbound-poor (proposal production retired by 0038) |
| 0027 | superseded by 0042 | Stop checkpoints skip trace-only commits and debounce the push |
| 0028 | accepted | The archive is flat — no subtree structure inside `archive/` |
| 0029 | accepted | This template is re-derived from the vault; the old `_brain/` layout is retired |
| 0030 | accepted | Tier-0 budgets are counted in characters and shown to the agent up front |
| 0032 | accepted | Machine state leaves the tracked tree; the reuse metric gets a trigger that actually runs *(the reuse metric was retired by 0039)* |
| 0033 | accepted | Unattended scheduled maintenance retired — the trigger becomes session start |
| 0034 | accepted | The capture inbox and every mobile-capture plan are removed |
| 0035 | accepted | A `raw/` source layer, `/ingest` to read a source into the wiki, `/file` to keep an answer, and `INDEX.md` as the page catalog (amends 0002 and 0034) |
| 0036 | accepted | Template v1.0 published ahead of the two-week bar; the bar governs additions, never removals |
| 0037 | amended by 0040 | The owner's own-notes folder is structured into kind folders *(reference instance only — that folder does not ship here)* |
| 0038 | accepted | The flush mechanism and proposal production are removed; delivery, notices and measurement are made truthful (supersedes 0025) |
| 0039 | accepted | The notes earn their keep, the instrumentation does not — reuse telemetry is retired |
| 0040 | accepted | The own-notes folder goes flat again; `kind:` is the only classifier *(reference instance only)* |
| 0041 | accepted | `raw/` admits one named automatic writer, a video-transcript pipeline *(reference instance only — here `raw/` has no automatic writer)* |
| 0042 | accepted | Vault commits are task-owned: no hook stages or commits the whole tree; one user-level SessionStart per runtime (supersedes 0008, 0027) |
| 0043 | accepted | A research report that crowds out retrieval is kept as an archived snapshot plus a short live distillation (amends 0035) |
| 0044 | accepted | Claude Code and Codex are equal runtimes over one kit — `AGENTS.md` is the constitution, `.agents/skills/` the one skills copy (amends 0042) |
| 0045 | accepted | Project execution state lives in the project repo (contract, `CURRENT_STATE`, `WORKLOG`, run reports); the vault keeps what outlives a project — [full record](decisions/0045-project-execution-state-lives-in-the-repo.md) |
| 0046 | accepted | Template v1.1 published ahead of the two-week bar at the owner's request; an override for one batch, not a new rule (amends 0015, 0036) — [full record](decisions/0046-template-v1-1-published-ahead-of-the-bar.md) |

There is no 0031: the number was allocated to a decision that was abandoned
before it was written. Gaps are left in place rather than renumbered — a
decision log you can renumber is one you can quietly rewrite.

## Recording your own

Once your vault is running, keep doing this. A choice that is expensive to
reverse — a folder architecture, a retrieval strategy, a rule about what the
agent may delete — gets a dated record with context, decision, rationale, and
consequences, and a `status:` that later decisions can flip to `superseded by
NNNN`. The value is not the writing; it is that the next contradiction is
visible instead of silent.

In your vault a decision is a note: `type: decision`, created from
`.claude/templates/decision.md`, kept in `notes/` while it is live and moved
to `archive/` once it is superseded or reversed (the reference instance files
its ADRs straight into `archive/`). `docs/decisions/` stays the template's
own record, so taking a newer template version never touches yours.
