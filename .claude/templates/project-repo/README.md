# Project-repo formats

The repo half of ADR 0045 (`docs/decisions/0045-project-execution-state-lives-in-the-repo.md`):
a project's execution state lives in the project's own repo, committed, and
the brain keeps only what outlives the project. These files are the formats
for that repo half. Nothing in the brain reads them from here — you copy them
into a project repo and they live there.

| File here | Becomes, in the project repo | What it holds |
|---|---|---|
| `AGENTS.template.md` | `AGENTS.md` | the contract: ownership map, commands, invariants, autonomy and blocker rules. Timeless — no status, no dated paragraphs |
| `CLAUDE.template.md` | `CLAUDE.md` | the shim: `@AGENTS.md` plus Claude-only lines |
| `docs/CURRENT_STATE.md` | `docs/CURRENT_STATE.md` | **the only file that states status** — milestones, open gates, blockers, the next action. At most 80 lines |
| `docs/WORKLOG.md` | `docs/WORKLOG.md` | the append-only direction log: one line per `decision`, `milestone` or `direction` change |
| `docs/runs/TEMPLATE.md` | `docs/runs/TEMPLATE.md` | the shape of a run report — one `docs/runs/YYYY-MM-DD_<slug>.md` per autonomous run |

The contract files carry a `.template.md` suffix so that an agent working
inside the brain never loads them as its own instructions.

Plans, ADRs, research and evidence belong in the same repo, committed.
Untracked memory is not memory.

## Adopting the formats in a project repo

The easy way: open a session in the project repo and ask the agent to adopt
the formats from this README. By hand, from the project repo's root:

```bash
# bash / zsh (macOS, Linux, Git Bash)
BRAIN="/path/to/your/brain"
T="$BRAIN/.claude/templates/project-repo"
mkdir -p docs/runs
[ -e AGENTS.md ] || cp "$T/AGENTS.template.md" AGENTS.md
[ -e CLAUDE.md ] || cp "$T/CLAUDE.template.md" CLAUDE.md
for f in docs/CURRENT_STATE.md docs/WORKLOG.md docs/runs/TEMPLATE.md; do
  [ -e "$f" ] || cp "$T/$f" "$f"
done
```

```powershell
# PowerShell (Windows)
$BRAIN = '<path to your brain>'
$T = Join-Path $BRAIN '.claude/templates/project-repo'
New-Item -ItemType Directory -Force docs/runs | Out-Null
if (-not (Test-Path AGENTS.md)) { Copy-Item "$T/AGENTS.template.md" AGENTS.md }
if (-not (Test-Path CLAUDE.md)) { Copy-Item "$T/CLAUDE.template.md" CLAUDE.md }
foreach ($f in 'docs/CURRENT_STATE.md', 'docs/WORKLOG.md', 'docs/runs/TEMPLATE.md') {
  if (-not (Test-Path $f)) { Copy-Item "$T/$f" $f }
}
```

Then:

1. **Fill the slots** in `AGENTS.md` from the repo as it is — only commands
   that actually ran green, the real plan path — and delete the rows and
   sections that do not apply. Keep the wording of the autonomy, blocker and
   status sections: rewording them per project is how two repos end up with
   two meanings of PASS.
2. **Fill STATE's frontmatter:** `project_id` (the brain card's filename, see
   below), `implementation_agent` (`claude-code` or `codex`), `branch`,
   `as_of` (the short sha of HEAD), and one `PLANNED` row per milestone.
3. **Write the first WORKLOG line**, e.g.
   `- 2026-01-15 · direction · Execution layer adopted, implementation agent claude-code · refs: <plan path>`.
4. **Commit all of it**, by explicit path.
5. **In the brain**, create the project card `notes/<project_id>.md` from
   `.claude/templates/project.md` and give it a row in `INDEX.md`. It names
   the repo and its state file; it never copies status.

A repo that already has instructions gains only what is missing. An existing
`AGENTS.md` gets the missing sections, not a rewrite. An existing `CLAUDE.md`
with content and no `AGENTS.md` stays the one file with content — never a
second copy beside it. A repo that already states status in several places (a
long state file with history, "Status:" lines in plans, ticked checklists):
list them all and consolidate into one STATE only when the owner asks.

## Read-first order

Every session in the repo — either runtime, interactive or autonomous —
resumes in this order and reads everything else on demand:

1. `AGENTS.md`
2. `docs/CURRENT_STATE.md`
3. the last 10 lines of `docs/WORKLOG.md`
4. the active milestone's section of the plan

Never resume from a chat or compaction summary. Re-anchor from STATE,
`git log --oneline <as_of>..HEAD`, `git status` and the diff.

## Status lives only in STATE

A plan defines acceptance and never ticks it. A README or architecture doc
carries no "Status:" line. The vault card points at STATE and never restates
it. A status written twice is right for a day and wrong afterwards, and
nothing says which day.

Vocabulary: `PLANNED | IN_PROGRESS | PASS | FAIL | BLOCKED(<type>) | ABANDONED | OPEN_GATE`.
"Not run" is never PASS.

STATE is **fresh** when no commit after the latest commit to
`docs/CURRENT_STATE.md` touches anything but that file, `docs/WORKLOG.md` and
`docs/runs/`. Code and its STATE update in one commit is the preferred shape; a
docs-only follow-up commit is fresh too. `as_of` is information — the sha the
checks ran against — not the freshness key. To check by hand (empty output
means fresh):

```bash
last=$(git log -1 --format=%H -- docs/CURRENT_STATE.md)
git log --format= --name-only "$last..HEAD" -- . ':!docs/CURRENT_STATE.md' ':!docs/WORKLOG.md' ':!docs/runs'
```

```powershell
$last = git log -1 --format=%H -- docs/CURRENT_STATE.md
git log --format= --name-only "$last..HEAD" -- . ':!docs/CURRENT_STATE.md' ':!docs/WORKLOG.md' ':!docs/runs'
```

`node <brain>/scripts/project-doctor.mjs` runs the same check — and the rest
of this contract — for every repo a brain card names, read-only.

## Interrupted runs

An autonomous run sets STATE `active_run: docs/runs/<file>.md` when it starts
and leaves the report's `status:` empty until it ends. So if STATE names an
`active_run` whose report is missing or has no `status:`, that run died
mid-way. Before any new work:

1. read `git log <base_sha or as_of>..HEAD` and `git diff` for what actually
   landed;
2. re-run the checks the run owed, assuming nothing passed;
3. correct STATE to what is true;
4. finish the run, or write its report with `status: ABANDONED`, and set
   `active_run: none`.

What is written down loses to git, the diff and a fresh test run.
`/closeout` runs this protocol first whenever it finds one.

## Ending work: `/closeout`

`/closeout` (in the brain's `.agents/skills/closeout/`) is the last step of
project work: STATE, WORKLOG, the run report of an autonomous run, this task's
merged worktrees, a commit of exactly the paths the task wrote — then, for
substantial work, one short session log in the brain that points back here.
From a project session it finds the brain through the global-mode SessionStart
line; `node install.mjs --link-global-skills` in the brain makes it loadable
there.

## Optional gates — not shipped

The reference instance also turns some of these sentences into hooks. They
are not part of this template: each is a runtime hook with its own config, and
this system adds machinery only when a failure demands it. Add one when you
see the failure it prevents.

- **Commit gate** — a `PreToolUse` hook on shell commands that runs the full
  offline suite before a `git commit` is allowed, and warns when code is
  committed without a STATE update.
- **Holdout lock** — a `PreToolUse` hook that refuses agent edits under
  `tests/acceptance/holdout/`, so the owner's product-level acceptance
  scenarios cannot be "fixed" by the agent that has to pass them.
- **Test gate** — a `Stop` hook that runs the fast offline suite before a
  session may end.

Whatever you add, commit its config: a worktree holds only tracked files, so
an untracked gate config silently disables the gate in every run worktree.
