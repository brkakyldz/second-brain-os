# Architecture

A file-native agent memory system: plain Markdown as the substrate, git as the
database, Claude Code and Codex as two equal runtimes over the same files, and
an explicit lifecycle policy as the thing that keeps it from rotting. Each
durable piece has one source that both runtimes point at (ADR 0044). No index
server, no vector store, no tool-internal format.

**Scope of this document: mechanism.** What the parts are and how they fit. The
*policy* they enforce is `notes/lifecycle-policy.md` (what happens to a note)
and `notes/self-evolution-policy.md` (how the system changes itself); the
*binding rules* are `AGENTS.md`; the *decisions* behind all of them are indexed
in `DECISIONS.md`. Those have non-overlapping charters on purpose — a rule
stated in two places is a contradiction waiting for one of them to be edited.

## 1. Design premises

Four constraints drive every other decision:

1. **Human-readable substrate.** Everything must be openable in Obsidian and
   editable by hand. Markdown + flat YAML frontmatter + `[[wikilinks]]` is the
   single source of truth. If an agent's memory can only be read by the agent,
   the human loses the ability to audit or correct it.
2. **Git is the only database.** Every change is a commit, `git log` is the
   audit trail, `git revert` is undo. That buys versioning, sync, conflict
   handling and backup from one mechanism instead of four.
3. **Context is a finite budget, not storage.** Retrieval is tiered and
   pointer-based; the always-loaded surface is capped in characters.
4. **Fail-open automation.** No hook or script may block a working session.
   Every hook path exits 0.

Two more were added by what went wrong:

5. **Machine state does not live on the tracked tree** (ADR 0032). In the
   reference instance the first four let ~5,400 lines of machinery accumulate
   around 17 notes; a counter a
   hook ticks every turn is not evidence. Derived, rebuild-tolerant state goes
   in a gitignored sidecar.
6. **Commits belong to the task that wrote the files** (ADR 0042, 0044). Two
   runtimes — or two sessions of one — can work in one checkout at the same
   time, and a hook cannot know which dirty file belongs to which task. So no
   hook commits, and nothing ever stages the whole tree.

## 2. Layers

```
  Obsidian (human read/write)  ---+
                                  +-- plain .md files -- git -- remote
  Claude Code / Codex (agents) ---+       (substrate)    (db)   (sync)
        |
        +-- AGENTS.md   the constitution; CLAUDE.md only imports it
        +-- .agents/    judgment procedures (/ingest, /curator, /lesson …) — the
        |               one skills copy; .claude/skills is a link to it
        +-- .claude/    shared hook implementation, note and project-repo
        |               templates, eval set
        +-- .codex/     thin Codex SessionStart adapter
        +-- scripts/    deterministic maintenance (by hand or from a skill)
```

The split between skills, hooks and scripts is the core engineering rule:
**deterministic work is a script, judgment work is an LLM call.** Link checking
and metric counts are scripts because they have a correct answer. Deciding
whether two facts are the same fact is a skill because it does not.

**One source per piece.** Codex cannot import a file and reads `AGENTS.md` and
`.agents/skills/` natively; Claude Code reads `CLAUDE.md` (which is one
`@AGENTS.md` import plus Claude-only lines) and `.claude/skills`, which
`install.mjs` makes a directory junction (Windows) or symlink (macOS/Linux) to
`.agents/skills/`. The link is gitignored machine state — a copy would be two
live implementations, and in the reference instance two copies drifted both
ways within a week.

## 3. Storage model

| Folder | Cognitive type | Write mode | End of life |
|---|---|---|---|
| `logs/` | Episodic — what happened | append-only | distill → `archive/` |
| `core/MEMORY.md`, `notes/` (`memory` / `knowledge`) | Semantic — what is true | reconcile on write | supersede → archive |
| `notes/` (`playbook`), `.agents/skills/` | Procedural — how we work | deliberate revision | replace whole sections |
| `raw/` | Evidence — what a source said | write-once, by the human | never; a source is permanent |
| `.claude/*.json` sidecars | Derived machine state | overwrite, lock-free | discarded; never committed |

Mixing the first three is the classic failure of "one notes folder": episodic
content grows without bound, semantic content gets appended to instead of
reconciled, and procedural content drifts because nobody owns it.

`raw/` is separate for a different reason. It is the only place verbatim
external content may live, which is what makes "nothing enters `notes/`
verbatim" enforceable rather than aspirational — without a legal home, a quoted
paragraph either gets paraphrased into a note (losing the fidelity that made it
worth keeping) or is lost.

A long research report that crowds out retrieval may be split in two: a
byte-identical, date-prefixed snapshot in `archive/` that owns the sources and
the detail, and a short live note of the same name in `notes/` that holds the
conclusion (ADR 0043).

## 4. Retrieval: tiers, not search

- **Tier 0 — always loaded.** `IDENTITY.md` (40 lines), `USER.md` (2000 chars),
  `MEMORY.md` (4000 chars) inside the vault; `USER.md` and `MEMORY.md` only in
  any other project. Injected by the SessionStart hook, which heads each file
  with its usage against its budget so the agent sees its remaining room
  *before* writing. `MEMORY.md` holds **pointers, never detail**: one fact per
  line, ending in a `[[wikilink]]`. `OPEN_QUESTIONS.md` gets a pointer, not
  its content.
- **Tier 1 — the catalog, then the page.** `INDEX.md` lists every note in one
  line each. Read it, pick the two or three pages that matter, open those.
  `node scripts/retrieval-eval.mjs --query "…"` ranks `notes/` + `core/` by
  query-token overlap when the catalog is not enough.
- **Tier 2 — grep and the episodic stream.** `logs/` and full-text search, when
  the first two don't answer.
- **`archive/` is not a tier below these** — it is live evidence at Tier 1
  depth. Superseded decisions are meant to be read before an expensive new one.

The budgets are mechanism, not decoration: past roughly 10KB of session-start
payload the harness is believed to stop inlining Tier 0 at all, so a budget
overrun does not degrade attention gracefully — it turns the always-loaded tier
off. That threshold is a hypothesis, so the hook logs its measured payload size
on every run and, over the limit, drops optional sections whole before any
Tier-0 content. Over budget, the rule is **consolidate, never silently
truncate**. Writer-only HTML comments are stripped before injection, so the
text that is counted and the text that is delivered are the same text.

Why there is no vector index: it was measured, not assumed. A golden set of 52
queries against the reference instance found zero paraphrase-misses — every
failure was a vocabulary mismatch (the query used a different word, or another
language's inflection), whose remedy is an `aliases:` line, not an embedding.
`scripts/retrieval-eval.mjs` re-runs `.claude/eval/golden-set.md` so that
finding stays falsifiable, and the trigger to revisit is written down.

## 5. Runtime: two runtimes, one hook each

Claude Code and Codex are equal (ADR 0044). Each has exactly one brain
SessionStart, and both land in the same implementation:

- **Claude Code:** `.claude/settings.json` (project scope, the default) or
  `~/.claude/settings.json` (global mode) → `.claude/hooks/session-start.mjs`
  directly; Claude supplies `CLAUDE_PROJECT_DIR`. Never both, or it fires twice.
- **Codex:** `~/.codex/hooks.json` → `.codex/hooks/session-start.mjs`, which sets
  `BRAIN_DIR` and `CLAUDE_PROJECT_DIR` and imports the same file. Not also in a
  project-level `.codex/hooks.json`: Codex adds hook layers together.

Every script resolves the vault root from its own location (or `BRAIN_DIR`), so
the same file is correct from any working directory, in any clone.

| Event | Job (both runtimes) |
|---|---|
| `SessionStart` | Skip if `core/.vault-active` is missing. Otherwise `git pull --rebase` — skipped when tracked changes exist, because they belong to a live task — then inject Tier 0 with budget meters and, at most, one notice about unpushed commits. Outside the vault it also injects the global-mode standing rules (§10) |
| `Stop` / `SessionEnd` / `PreCompact` | Nothing. The task stages and commits only its own explicit paths |

Design notes worth keeping:

- **Task-owned commits are the backbone.** A task stages exact paths and
  commits one coherent change; no hook infers ownership. The price is stated
  plainly: a session that dies before committing leaves its files uncommitted
  until someone picks them up, and there is no one-turn checkpoint any more.
- **No autostash.** The pull used to lift uncommitted changes off the disk and
  put them back; when the put-back failed, another task's files were stranded
  in a stash while their owner kept working. A skipped pull costs one stale
  session start; the vault still loads from disk.
- **Push failure is non-fatal.** The commit stays local; the next session start
  says so once a backlog is over a day old.
- **A stuck rebase is aborted, not left half-applied.**
- **One sidecar, gitignored and lock-free:** `.claude/.maintenance.json`, the
  shared daily notice counter. The session-trace and access sidecars went with
  the flush and telemetry hooks (ADR 0038, 0039).

## 6. What the runtime enforces

Only the parts of the policy that exist as running code belong here.

- **SessionStart** enforces the activation marker, attempts the pull, measures
  Tier-0 budgets and injects the bounded context.
- **The daily notice budget** — three proactive items across every surface, one
  shared counter (`emitNotices` in `lib.mjs`); a backup failure outranks
  everything in it.
- **`brain-doctor.mjs`** reports, read-only, whether each runtime has exactly
  one SessionStart and no retired git-writing hook, whether the skills link
  resolves, whether a runtime in global mode can load `/closeout`, `/lesson`
  and `/recall` in project sessions, and whether the budgets hold.

Written as code but **not run automatically** since v1.1:

- **Compiled checks** (`.claude/hooks/checks.mjs`) — wikilink short form, note
  frontmatter, `INDEX.md` coverage. They ran from the Stop checkpoint until
  v1.1. Now they run when someone runs them:
  `node .claude/hooks/checks.mjs [--staged | --all] [--record]` prints every
  finding and exits 1 when there is one — by hand before a commit, or from a
  git pre-commit hook if the owner wants the warning to become a gate (the
  template wires none; that is a policy call). It is read-only unless
  `--record` appends new fires to the Signal Ledger, which is the only way
  `vault-metrics.mjs` gets fires to count. `link-sweep.mjs` carries a
  git-blind twin of the index-coverage check, `/audit` runs the checks
  read-only, and `scripts/tests/index-coverage.test.mjs` covers both.
- **The secret scanner** (`scanStagedForSecrets` in `lib.mjs`). The scan that
  runs, once you install it, is gitleaks via `.pre-commit-config.yaml`.

Everything else — the corroboration gate, bi-temporal supersession, the maturity
ladder, archive-vs-delete, the protected files — is enforced by convention and
by the passes the owner runs. **Protected files are a convention, not a
security boundary**: nothing stops a shell command from writing `AGENTS.md`. That
distinction is worth keeping honest, and there is a measurement behind it:
TRACE (arXiv 2606.13174) found prose corrections re-violated **57.5%** of the
time against 2–38% for a compiled check. Telling a model its mistake in writing
does not stick — which is why the checks are kept as code even while nothing
runs them on every turn.

## 7. The ingestion paths

Two inlets, one destination. This is the shape of the whole system rather than
a rule, which is why it is drawn rather than described.

```
  something you said                    something you read
  in any session                        (a paper, an article, an export)
        |                                       |
        | standing instruction,                 | you save it, deliberately
        | model-driven — not a hook             v
        v                                 raw/YYYY-MM-DD_<slug>.<ext>
  logs/YYYY-MM-DD_HHMM.md                       |  immutable; never edited
        | episodic, append-only, tagged         |
        | decision|bugfix|feature|…             |  /ingest — read it, discuss it,
        |                                       |  then distill and reconcile
        | /curator, at 30 days: extract         |
        | durable facts, archive the original   |
        v                                       v
  notes/<topic>.md  <-------------------------- +   semantic, confidence: low,
        |                                            source: on anything external
        |  corroboration gate: a second independent source confirms it
        v
  core/MEMORY.md          one pointer line, Tier 0, 4000 chars
```

Three properties are deliberate:

- **Only distillate travels upward.** The vault stores summaries, decisions and
  their reasons, never raw transcripts — those stay in the runtime's own
  session storage. `raw/` is the exception that proves it: sources stay
  verbatim *because* they are outside the wiki.
- **Promotion is asynchronous.** A session writes episodic content immediately,
  but a fact becomes always-loaded memory only after a curator pass and a
  second, independent confirmation — independence being a property of the
  source, not a count of sessions.
- **A source is never memory on its own.** Anything from `raw/` carries
  `source:`, enters at `confidence: low`, and is closed out of `USER.md` and
  `IDENTITY.md` entirely. One document asserting something is not the vault
  believing it.

## 8. Known trade-offs

- **No semantic search.** Retrieval is catalog + pointers + grep + wikilinks.
  Fine at single-vault scale and it keeps the substrate portable; revisit when
  the retrieval-failure ledger says so, not before.
- **Task-owned commits trade automatic recovery for ownership.** An interrupted
  task may leave a dirty tree until it resumes; the gain is that concurrent
  tasks cannot be swept into one another's commits. The session-log rule is
  the agent's to follow — no hook reconstructs a log it forgot to write.
- **Single-writer assumption for scripts.** The lockfile
  (`scripts/.brain.lock`, stale after 2h) serializes the pull and ledger
  appends; real multi-device concurrent editing would need more than that.
- **The Windows skills junction stores an absolute path.** Move the vault
  folder and the link breaks; `node install.mjs --link-skills` repairs it and
  `brain-doctor.mjs` reports it. The user-level links from
  `--link-global-skills` behave the same way, and rerunning that flag repairs
  them.
- **The policy is only as good as its enforcement.** Anything enforced only by
  prose will drift; §6 lists what is code and what is not.
- **The machinery can outgrow the content.** Measured once, in the reference
  instance, at ~5,400 lines of hooks and scripts against 17 notes. A new
  hook or script now needs a failure that demanded it, the same gate a new
  folder faces.
- **`raw/` can become a graveyard.** Files land, nothing ingests them. The
  symptom is visible (an un-ingested file appears in no index and no note) and
  the response is written down in advance: three weeks of that means the inlet
  isn't wanted, and it gets removed rather than nagged about.
- **Every project repo has to commit its memory** (§10) — plans and research
  included. A public project either publishes them or stays private while it
  is being built.

## 9. From correction to check

Capture → corroborate → enforce-or-retire (ADR 0019, amended by 0038).

`/lesson` captures a correction verbatim into `notes/lesson-*.md` plus a
`correction` signal, with **no interpretation at capture time** — agents
confabulate their own failure stories, so the agent never authors the lesson in
the same session it earned.

The corroborate-and-route half used to be a `/flywheel` pass that mined the
ledger and proposed checks into an approval queue. It was retired with proposal
production (ADR 0038): a lesson becomes a compiled check because the owner
decides it should, not because a pass proposed it. `scripts/vault-metrics.mjs`
is the deterministic count that informs that decision — check fires,
correction recurrence by class, lesson and check survival — with no LLM call
anywhere in it.

`/recall` is the four-layer lexical retrieval procedure, and it logs a
`retrieval-failure` signal with a cause when the vault misses. That signal is
the only thing that can reverse the no-vector-index decision.

The seed checks were bootstrapped from standing constitution rules rather than
waiting for organic corroboration. That shortcut has a cost worth knowing: a
check that never fires cannot be distinguished from a check that *cannot* fire,
so a check earns its place by catching a synthetic offender, not by staying
quiet.

## 10. Project work: the vault and the repo

Two stores, split by what the record is for (ADR 0045). Each fact has one
owner.

- **The vault holds what outlives a project:** distilled knowledge, lessons,
  one thin card per project (`notes/<project_id>.md` — why it exists, where
  it lives, what it taught), and short session logs.
- **Each project repo holds its own execution state, committed:** `AGENTS.md`
  (the contract — timeless, no status), `docs/CURRENT_STATE.md` (the only
  file that states status), `docs/WORKLOG.md` (the append-only direction
  log), `docs/runs/` (one report per autonomous run), and its plans, ADRs,
  research and evidence.

The lifecycle of one piece of project work:

```
  vault: notes/<project_id>.md     thin card: repo, state_file, why, what it
        |                          taught — never a copy of status
        | points at
        v
  repo: docs/CURRENT_STATE.md      read first, with AGENTS.md and the last
        |                          10 lines of docs/WORKLOG.md
        v
  work in the repo                 code and its STATE update committed together
        |
        v
  /closeout                        STATE, WORKLOG, the run report of an
        |                          autonomous run, this task's worktrees,
        |                          one commit of exactly the paths it wrote
        v
  vault: logs/YYYY-MM-DD_HHMM-<slug>.md
                                   project: <card id>, runtime:, <= 10 lines,
                                   one outcome line pointing at repo refs
```

Why the split runs this way: in the reference instance, the one project that
carried a multi-milestone plan to its final gates unattended did it on a
single living state file in its own repo; status rotted everywhere else (plans
still "ready to execute" after shipping, READMEs a version behind);
completion reports went to chat and were lost; and no coding session ever
resumed from a vault note. A record earns its keep by being read at the moment
it matters. Status is read at resume time, inside the repo; knowledge that
should carry into the *next* project has to survive the repo being closed.

How the pieces meet:

- **The formats** ship in `.claude/templates/project-repo/` (`AGENTS`
  contract, `CLAUDE` shim, STATE, WORKLOG, run report — with a README on
  adopting them) and `.claude/templates/project.md` (the card). Copied into
  a project, they live there; the vault never reads them back.
- **Global mode carries the rule into every project.** Outside the vault the
  SessionStart hook injects standing rules: read the repo's `AGENTS.md`,
  STATE and last WORKLOG lines before planning; end substantial work with
  `/closeout`; never copy live status into the brain. Its first line, "The
  brain lives at …", is how the skills find the vault from any repo.
- **Three skills cross the boundary** — `/closeout`, `/lesson`, `/recall`.
  Each resolves the brain (the vault itself, that SessionStart line,
  `BRAIN_DIR`, or its own link target) and writes only brain paths into the
  brain, committed by explicit path. `node install.mjs --link-global-skills`
  links them into each runtime's user-level skills folder, opt-in and
  reversible; everything else in `.agents/skills/` stays vault-scoped.
- **An interrupted run is visible from files alone:** STATE names an
  `active_run` whose report is missing or has no `status:`. The next session
  trusts git, the diff and a fresh test run over what is written down, then
  corrects STATE.
- **`scripts/project-doctor.mjs` reports where the split is not holding**,
  read-only, across every repo a card names: project memory that is not
  committed, no remote, a stale or missing STATE, an interrupted run, leftover
  worktrees, status claimed outside STATE, log ids that resolve to no card,
  and drifted copies of one skill.

Deliberately not shipped: the reference instance also has commit-gate,
holdout-lock and test-gate hooks for its project repos. They are runtime hooks
with their own configs, and a template user adds one when they see the failure
it prevents. The project-repo README describes them.
