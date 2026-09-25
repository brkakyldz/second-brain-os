# Second Brain OS

A second brain that is an Obsidian vault, the shared memory of your coding
agents — Claude Code and Codex, as equals — and a git repository, all at once.
**Git is the only database** — no SQLite, no vector store, no server, no plugin
dependency chain. Your assistant knows who you are and what you're working on
the moment a session starts, in either runtime, and writes down what it learned
as ordinary files you commit.

This is the generic projection of a vault that has been running daily since
2026-08-18. Everything here is in use somewhere, and the parts that were tried
and removed are listed as removed rather than quietly dropped — see
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## How it works

- **`core/` is the always-loaded tier**, and it is deliberately tiny:
  `IDENTITY.md` (how the assistant behaves), `USER.md` (who you are, 2000-char
  budget), `MEMORY.md` (durable facts, one line each, 4000-char budget, pointers
  instead of detail), and `OPEN_QUESTIONS.md` (what the vault is listening
  for), which arrives as a pointer rather than inlined. A session in any other
  project (global mode) gets `USER.md` and `MEMORY.md` only.
- **One folder per lifecycle, not per category.** `notes/` is flat and holds
  every durable page; what a note *is* lives in its `type:` frontmatter, and how
  mature it is lives in `status:`. A note never moves because it grew up, so a
  link never breaks. The only move is into `archive/`, when it closes.
- **Two inlets, both ending in distillation.** Something said in conversation
  gets written as a note there and then — there is no capture inbox to triage
  later. Something you *read* goes into `raw/` and is pulled in with `/ingest`,
  which discusses it with you first, then writes the distilled note, reconciles
  it against what the vault already believes, and catalogs it.
- **Three retrieval tiers.** Tier 0 (`core/`) is injected at session start.
  Tier 1 (`INDEX.md`, then the two or three pages it points at) is read on
  demand. Tier 2 (the whole vault, git history) is reached by search only when
  the first two don't answer. Nothing is bulk-loaded.
- **Two runtimes, one source for everything.** `AGENTS.md` is the constitution
  (Claude Code's `CLAUDE.md` just imports it), `.agents/skills/` is the one
  skills copy (Claude sees it through a `.claude/skills` link), and both
  runtimes run the same SessionStart hook. Nothing exists twice, so nothing
  drifts.
- **One hook, and it never commits.** `SessionStart` pulls and injects Tier 0.
  That is all the automation there is. Commits are made by the task that wrote
  the files, with explicit paths — never a whole-tree `git add -A` from a hook,
  because two sessions working in one checkout would sweep up each other's
  half-written files. Everything fails open: a failed pull never blocks a
  session.
- **Project state lives in the project's repo; the brain keeps what outlives
  it.** A project's status, direction log and run reports are committed in
  its own repo (`docs/CURRENT_STATE.md`, `docs/WORKLOG.md`, `docs/runs/`);
  the brain holds a thin card per project, the knowledge and lessons it
  produced, and short session logs that point back at the repo. The
  lifecycle: card → repo STATE → work → `/closeout` → one short brain log.
  Formats and adoption steps: `.claude/templates/project-repo/`.
- **The rules that can be checked are written as checks.** Wikilink form, note
  frontmatter and catalog coverage are encoded in `.claude/hooks/checks.mjs`,
  and `scripts/link-sweep.mjs` reports broken links, orphans and uncatalogued
  notes — this system's hardest-won lesson is that a written procedure loses
  to the in-the-moment default while the work still looks finished. Since
  v1.1 neither runs on its own: run `node .claude/hooks/checks.mjs` before a
  commit (`--staged` for what is staged, `--all` for the whole vault; it
  exits 1 on a finding) and the sweep when you tidy. `/audit` reports what
  the checks encode either way.

Full design rationale: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What's inside

```
core/         Tier 0: IDENTITY, USER, MEMORY inlined; OPEN_QUESTIONS by pointer
notes/        the memory store — flat, wikilinked, told apart by type:
raw/          immutable sources you put there; the agent reads, never writes
logs/         append-only session logs + logs/signals/, the event ledger
archive/      closed and superseded content — never deleted, always moved here
scripts/      link sweep, retrieval eval, brain and project doctors, metrics
.agents/      skills — the one copy both runtimes load
.claude/      the shared SessionStart hook, the compiled checks, note and
              project-repo templates, the golden set
.codex/       the thin Codex adapter into that same hook
AGENTS.md     the constitution — the rules you and both agents work under
CLAUDE.md     one line that imports AGENTS.md, plus Claude-only notes
INDEX.md      the page catalog — read this first when answering a question
PROPOSALS.md  open work you keep by hand; no pass writes to it
SETUP.md      agent-run installation runbook
install.mjs   one-time interactive personalization (manual path)
docs/         architecture guide, the decision index, full records from 0045
```

Plain Markdown, JSON and Node — no build step, no runtime dependency beyond
Node itself. Written to run on Windows, macOS and Linux; nothing in the live
tree is platform-bound.

## Quickstart

**Requirements:** git 2.28+, Node.js 18.13+, a GitHub account — plus the
[GitHub CLI](https://cli.github.com) (`gh`, logged in) for the agent-run
setup, which creates your repo with it — and
[Claude Code](https://claude.com/product/claude-code) or
[Codex](https://openai.com/codex) — or both. Obsidian is optional but
recommended — the vault is plain Markdown either way.

Open Claude Code or Codex and paste this in, with this repo's own `SETUP.md` URL:

> Read SETUP.md from this repository and set up my second brain:
> `<this repo's URL>/blob/main/SETUP.md`

The agent handles the rest: creates your private repo, interviews you —
including whether the brain should follow you into every project (global mode,
recommended) or stay project-scoped — personalizes the core files, links the
skills, and verifies the hook fires.

Prefer to do it by hand? See
[Manual setup](SETUP.md#manual-setup-without-an-agent) in `SETUP.md`.

## Daily use

Work normally. Talk to your agent inside the vault about anything — plan a
project, think a problem through, ask what you decided last month. It reads and
writes the same Markdown you see in Obsidian. When a piece of work is done, it
commits exactly the files that work touched.

The commands worth knowing:

| | |
|---|---|
| `/ingest <file>` | read a source in `raw/` into the wiki — discuss, distill, reconcile, catalog |
| `/file` | keep an analysis produced in conversation as a proper page, instead of losing it to the transcript |
| `/lesson` | capture a correction you just made, verbatim, before it is rationalized away |
| `/closeout` | end project work: update the repo's STATE and WORKLOG, write the run report of an autonomous run, commit exactly the task's paths, leave one short brain log |
| `/recall` | four-layer lexical retrieval, and it logs the misses so search failure becomes data |
| `/curator` | consolidate memory, resolve stale facts, keep the core files inside budget |
| `/audit` | structural and semantic report — budgets, orphans, contradictions, tag sprawl. Reports only, never fixes |

And the scripts, all read-only except the link sweep's one report file:
`node scripts/brain-doctor.mjs`, `node scripts/project-doctor.mjs` (every
repo a project card names: uncommitted project memory, stale STATE, leftover
worktrees), `node scripts/link-sweep.mjs`,
`node scripts/retrieval-eval.mjs --query "…"`, `node scripts/vault-metrics.mjs`.

## Global mode (recommended)

This is the intended way to run the system: the brain loads in *every* session
you have, not just the ones inside the vault folder.

There is exactly one hook per runtime — `SessionStart` — and it lives in exactly
one place:

- **Claude Code:** move the `SessionStart` entry out of this repo's
  `.claude/settings.json` into your user-level `~/.claude/settings.json`,
  changing `${CLAUDE_PROJECT_DIR}` to the absolute path of your vault. Empty the
  repo's own `hooks` block and commit that file, or it fires twice inside the
  vault.
- **Codex:** add one `SessionStart` entry to `~/.codex/hooks.json` that runs
  `node "<your vault>/.codex/hooks/session-start.mjs"`, then re-trust the hook
  in Codex. Don't also put it in a project-level `.codex/hooks.json` — Codex
  adds the layers together.

`install.mjs` prints both blocks with your path filled in. The scripts resolve
the brain root themselves (their own location, or `BRAIN_DIR` if you set it),
so they are correct from any working directory. Trade-off, plainly: every
session on the machine pays a small `git pull` at start — skipped whenever the
vault has uncommitted changes to tracked files, because those belong to a live
task.

In a project session the hook also injects standing rules: the project's
state lives in its own repo, so read its `AGENTS.md`, `docs/CURRENT_STATE.md`
and the last lines of `docs/WORKLOG.md` before planning, and end substantial
work with `/closeout`. For `/closeout`, `/lesson` and `/recall` to load
there, link them at user level — opt-in, and `--unlink-global-skills` undoes
it:

```
node install.mjs --link-global-skills
```

It links the three skill folders into `~/.claude/skills` and
`~/.codex/skills` (or `CLAUDE_CONFIG_DIR` / `CODEX_HOME`) for each runtime
that is installed, never replaces anything but a broken link, and the skills
find the vault from the hook's "The brain lives at …" line. Some Codex builds
read user skills from `~/.agents/skills` instead; `SETUP.md` Step 5 says how
to check and what to do. To give a project the repo-side formats, see
[`.claude/templates/project-repo/README.md`](.claude/templates/project-repo/README.md).

## What's new in v1.1

v1.1 (2026-09-25) brings the template in line with the reference instance as
it runs today. The one-line version: **one hook that never commits, two equal
runtimes, and project state that lives in the project's own repo.** Several of
these additions are younger than the usual two-week bar; the owner lifted it
for this release and ADR 0046 says which ones.

**Removed**

- The Stop / SessionEnd / PreCompact checkpoint that committed and pushed the
  whole tree (`checkpoint.mjs`, `session-end.mjs`). Commits are task-owned:
  each task stages its own explicit paths (ADR 0042, 0044).
- The session flush (`flush.mjs`), reuse telemetry (`reuse-telemetry.mjs`),
  the proposals sweep (`proposals.mjs`), `/flywheel` and the maintenance due
  line (`maintenance-stamp.mjs`) (ADR 0038, 0039).
- The Node secret scan inside hook commits — there are no hook commits left.

**Added**

- Codex as an equal runtime: `AGENTS.md` is the constitution (`CLAUDE.md`
  imports it), `.agents/skills/` is the one skills copy (`.claude/skills` is
  a link to it), `.codex/hooks/session-start.mjs` is the Codex adapter.
- Project work in the project's repo (ADR 0045): the repo-side formats in
  `.claude/templates/project-repo/`, thin project cards, `/closeout`, and
  `node install.mjs --link-global-skills` to reach it from any project.
- `scripts/brain-doctor.mjs` and `scripts/project-doctor.mjs`, both
  read-only; the ranked lookup `retrieval-eval.mjs --query`;
  `notes/self-evolution-policy.md`, split out of the lifecycle policy.
- A command line for the compiled checks,
  `node .claude/hooks/checks.mjs [--staged | --all] [--record]`, now that no
  hook runs them; `--help` on `install.mjs` and `link-sweep.mjs`, and
  `BRAIN_DIR` honoured by the link sweep like every other script.

**Changed**

- `SessionStart` skips its pull when the vault has uncommitted changes to
  tracked files, instead of stashing another task's files (no more autostash).
- Secret scanning is opt-in: gitleaks through `.pre-commit-config.yaml`.
- `PROPOSALS.md` is a list you keep by hand; `/curator` and `/audit` report
  in the conversation and their own log instead of appending to it.
- `flywheel-metrics.mjs` is `vault-metrics.mjs`, counting without scoring.
- Project notes are thin cards; their live status moves into each project's
  `docs/CURRENT_STATE.md`.

### Upgrading from v1.0

Step by step in [`docs/UPGRADING.md`](docs/UPGRADING.md#upgrading-from-v10).

## Safety

- **Your clone must be private.** This template is public and holds no personal
  data; your vault will hold your actual notes and should never be public.
- **Secret scanning is opt-in since v1.1.** The Node scanner used to run inside
  every hook-made commit; with no hook committing, it has nothing to run in.
  Install the independent one: `pip install pre-commit`, then
  `pre-commit install` inside the vault (two commands — Windows PowerShell 5
  has no `&&`) wires [gitleaks](https://github.com/gitleaks/gitleaks) into
  every commit via `.pre-commit-config.yaml`. On GitHub, also turn on secret-scanning push
  protection for your vault repo.
- **Nothing is deleted automatically.** Stale or closed content moves to
  `archive/`. The only deletions are the two narrow cases in
  `notes/lifecycle-policy.md` §6: an exact duplicate line within one core
  file, which `/curator` collapses, and a note that is unlinked, superseded
  and load-bearing nowhere, which it proposes and only you approve. `git
  revert` covers everything else.
- The hook is inert until `core/.vault-active` exists, so a fresh clone never
  pulls or injects anything over your head.
- `AGENTS.md` and `core/IDENTITY.md` are protected **by convention**: agents
  propose a diff, you apply it. Nothing technically stops a shell command from
  writing them — it holds because the agent follows the constitution.

## FAQ

Moved to [`docs/FAQ.md`](docs/FAQ.md).

## Learn more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the full design: principles,
  the memory model, the two runtimes, retrieval, and the reasoning behind each.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — the decision index, including what
  was reversed and why.

## License

MIT. See [`LICENSE`](LICENSE). The vendored `obsidian-markdown` skill keeps its
own license — see `.agents/skills/THIRD_PARTY_LICENSES.md`.
