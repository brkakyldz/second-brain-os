# Second Brain OS

**A memory for your coding agents that you can read, correct and undo.**
It is an Obsidian vault that Claude Code and Codex share as equals, and a Git
repository, at once — Git is the only database. Your assistant knows who you
are and what you're working on the moment a session starts, in either runtime,
and writes down what it learned as ordinary files you commit.

<p>
  <a href="docs/UPGRADING.md"><img alt="version v1.1" src="https://img.shields.io/badge/version-v1.1-1c3d63"></a>
  <a href="LICENSE"><img alt="license MIT" src="https://img.shields.io/badge/license-MIT-5b7150"></a>
  <a href="docs/ARCHITECTURE.md#5-runtime-two-runtimes-one-hook-each"><img alt="runtimes: Claude Code and Codex" src="https://img.shields.io/badge/runtimes-Claude%20Code%20%C2%B7%20Codex-b0573a"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg">
    <img src="docs/assets/how-it-works-light.svg" width="520" alt="How it works. Claude Code and Codex sessions sit above a dashed line; below it there is no model. Both run one SessionStart hook, which pulls the vault and injects core/ at every start and never commits, and both share one set of rules and skills. Under them, the vault in tiers: core/ with IDENTITY, USER and MEMORY; notes/ read on demand through INDEX.md; logs/ searched last; raw/ for the sources you saved. Git sits underneath as the only database: a skill writes a note or a log, and the task commits exactly its own paths.">
  </picture>
</p>

## Why

- **A session starts from what you already told it.** Who you are, how the
  assistant should work with you and the facts that matter are injected at
  every start; everything else is read when a question needs it.
- **You can see and fix what your agent remembers.** Plain Markdown with YAML
  frontmatter and `[[wikilinks]]`, open in Obsidian or any editor. `git log`
  is the audit trail, `git revert` is undo.
- **Nothing to run or keep in sync.** No SQLite, no vector store, no server,
  no plugin dependency chain: Markdown, JSON and Node, with no build step and
  no dependency beyond Node itself, on Windows, macOS and Linux.
- **Project status stays true.** It lives in each project's own repo,
  committed with the code; the vault keeps what outlives the project.

This is the generic projection of a vault that has been running daily since
2026-08-18. Everything here is in use somewhere, and the parts that were tried
and removed are listed as removed rather than quietly dropped — see
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## How it works

Above the dashed line a model reads and decides. Below it there is no model —
only plain files, Node and Git.

- **One hook, and it never commits.** Both runtimes run the same
  `SessionStart` hook: it pulls the vault and injects `core/`. That is all the
  automation there is.
- **Three tiers of reading.** `core/` at every start; `INDEX.md` and the pages
  it points at when a question needs them; `logs/` and a full-text search only
  when those don't answer.
- **You talk, the agent distills.** Something worth keeping becomes a note on
  the spot; a source you drop in `raw/` becomes notes through `/ingest`.
  Nothing waits in a queue.
- **Commits belong to the task.** Each task commits the files it wrote, by
  name — never `git add -A` — so two sessions, or both runtimes, can share one
  checkout.
- **One copy of everything.** `AGENTS.md` is the only rulebook (`CLAUDE.md`
  just imports it) and `.agents/skills/` the only skills folder, for Claude
  Code and Codex alike.

Tiers, budgets and the reasoning behind each part:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

<details>
<summary><b>What's in the repo</b></summary>

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
SETUP.md      agent-run installation runbook, with a manual appendix
install.mjs   one-time interactive personalization (manual path)
docs/         architecture guide, decision index and full records from 0045,
              FAQ, upgrade guide, the README's figures
```

</details>

## What goes where

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/where-things-live-dark.svg">
    <img src="docs/assets/where-things-live-light.svg" width="520" alt="Where things live. A session in a project sits above the dashed line. Below it, the vault keeps what outlives a project: knowledge in notes/, one card per project, lessons, and short session logs. Each project's repo keeps its execution state: AGENTS.md, docs/CURRENT_STATE.md as the only status, docs/WORKLOG.md and docs/runs/. The card points at the state file and the session log points back at the repo; a crossed path marks live status copied into the vault, which never happens.">
  </picture>
</p>

| The vault — what outlives a project | Each project's repo — its execution state |
|---|---|
| knowledge and lessons, in `notes/` | `AGENTS.md` — the contract: timeless, no status |
| one thin card per project, `notes/<project_id>.md`: why it exists, where it lives, what it taught | `docs/CURRENT_STATE.md` — the only file that states status |
| short session logs in `logs/` that point back at the repo | `docs/WORKLOG.md`, the append-only direction log, and `docs/runs/`, one report per autonomous run |

In global mode, a session in any project is told to read that repo's
`AGENTS.md`, `docs/CURRENT_STATE.md` and the last lines of `docs/WORKLOG.md`
before planning, and to end substantial work with `/closeout`: STATE and
WORKLOG brought up to date, the run report of an autonomous run, one commit of
exactly the task's paths, then — for substantial work — one short log in the
vault. Formats and adoption steps: [`.claude/templates/project-repo/`](.claude/templates/project-repo/README.md);
the decision:
[ADR 0045](docs/decisions/0045-project-execution-state-lives-in-the-repo.md).

## Quickstart

**You need** git 2.28+, Node.js 18.13+, a GitHub account — plus the
[GitHub CLI](https://cli.github.com) (`gh`, logged in) for the agent-run
setup, which creates your repo with it — and
[Claude Code](https://claude.com/product/claude-code) or
[Codex](https://openai.com/codex) — or both. Obsidian is optional but
recommended; the vault is plain Markdown either way.

1. **Hand the setup to your agent.** Open Claude Code or Codex and paste this
   in, with this repository's URL in place of the placeholder:

   ```text
   Read SETUP.md from this repository and set up my second brain:
   <this repo's URL>/blob/main/SETUP.md
   ```

2. **Answer its questions.** It creates your repo from this template and checks
   that it is private, interviews you — including whether the brain should
   follow you into every project (global mode, recommended) or stay
   project-scoped — personalizes the core files, links the skills and verifies
   the hook fires. It asks before creating the repo and before writing
   user-level settings.
3. **Check the wiring:** `node scripts/brain-doctor.mjs`.
4. **Work normally.** Talk to your agent inside the vault about anything — plan
   a project, think a problem through, ask what you decided last month. It
   reads and writes the same Markdown you see in Obsidian, and when a piece of
   work is done, it commits exactly the files that work touched.

Prefer to do it by hand? [Manual setup](SETUP.md#manual-setup-without-an-agent)
runs `node install.mjs`, which interviews you and prints the wiring without
touching your user-level settings or committing anything.

**Global mode** — the intended way to run it — loads the brain in every
session on the machine, not only inside the vault. Two things not to miss;
the full wiring is in [`SETUP.md`, Step 5](SETUP.md#step-5--runtime-wiring).

- **Claude Code:** once the `SessionStart` entry lives in
  `~/.claude/settings.json`, empty the `hooks` block of the vault's own
  `.claude/settings.json` (keep `permissions`) and commit that file, or the
  hook fires twice inside the vault.
- **Codex** reads `AGENTS.md` natively but gets `core/` only once its
  `SessionStart` entry is wired in `~/.codex/hooks.json` — and not also in a
  project-level `.codex/hooks.json`, because Codex adds the layers together.

For `/closeout`, `/lesson` and `/recall` to load in other projects, link them
at user level: `node install.mjs --link-global-skills` (opt-in;
`--unlink-global-skills` undoes it).

## Everyday commands

| Command | What it does |
|---|---|
| `/recall` | four-layer lexical retrieval; logs the misses, so a search failure becomes data |
| `/lesson` | capture a correction you just made, verbatim, before it is rationalized away |
| `/file` | keep an analysis produced in conversation as a proper page, instead of losing it to the transcript |
| `/ingest` | read a source in `raw/` into the wiki — discuss, distill, reconcile, catalog |
| `/closeout` | end project work: the repo's STATE and WORKLOG, the run report of an autonomous run, one commit of exactly the task's paths, one short vault log |
| `/curator` | consolidate memory, resolve stale facts, keep the core files inside budget |
| `/audit` | structural and semantic report — budgets, orphans, contradictions, tag sprawl; reports only, never fixes |

Plus a few read-only scripts you run when you want them — nothing runs on a
schedule: `node scripts/brain-doctor.mjs` (is the setup healthy),
`node scripts/project-doctor.mjs` (is each project's memory committed and its
state fresh), `node scripts/link-sweep.mjs` (broken links, orphans — writes one
report) and `node .claude/hooks/checks.mjs --staged` before a commit (link
form, frontmatter, catalog). All of them: [`scripts/README.md`](scripts/README.md).

## What's new in v1.1

**One hook that never commits, two equal runtimes, and project state that lives
in the project's own repo.**

- No hook commits: the Stop / SessionEnd / PreCompact checkpoint is gone, and
  each task commits its own explicit paths.
- `SessionStart` skips its pull while tracked files have uncommitted changes,
  instead of stashing another task's work.
- Codex is an equal runtime: one constitution, one skills copy, a thin adapter.
- Project execution state lives in each project's repo: the repo-side
  formats, thin project cards, `/closeout` and `--link-global-skills`.
- Two read-only doctors, `brain-doctor.mjs` and `project-doctor.mjs`, and a
  ranked lookup, `retrieval-eval.mjs --query`.
- A command line for the compiled checks, now that no hook runs them.
- Retired: the session flush, reuse telemetry, the proposals sweep,
  `/flywheel` and the maintenance due line.
- Secret scanning is opt-in, through gitleaks and `.pre-commit-config.yaml`.

Several of these are younger than the template's usual two-week bar, which the
owner lifted for this release (ADR 0046). The complete list and the
step-by-step upgrade from v1.0: [`docs/UPGRADING.md`](docs/UPGRADING.md).

## Safety

- **Keep your clone private.** This template holds no personal data; your
  vault will hold your actual notes.
- **Turn on secret scanning** — opt-in since v1.1: `pip install pre-commit`,
  then `pre-commit install` inside the vault wires gitleaks into every commit;
  on GitHub, also enable secret-scanning push protection.
- **Nothing is deleted automatically, and nothing runs before you activate
  it.** Stale content moves to `archive/`, and the hook is inert until
  `core/.vault-active` exists. `AGENTS.md` and `core/IDENTITY.md` are protected
  by convention, not by a lock.

The details are in [`docs/FAQ.md`](docs/FAQ.md#safety).

## Learn more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the full design: principles,
  the memory model, the two runtimes, retrieval, and the reasoning behind each.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — the decision index, including what
  was reversed and why.
- [`SETUP.md`](SETUP.md) — the installation runbook your agent follows, and the
  manual path.
- [`docs/FAQ.md`](docs/FAQ.md) — safety notes, and why there is no vector
  database, no schedule and no automatic commit.
- [`docs/UPGRADING.md`](docs/UPGRADING.md) — everything v1.1 changed, and how
  to upgrade a v1.0 vault.
- [`scripts/README.md`](scripts/README.md) — what each script checks and when
  to run it.

## License

MIT. See [`LICENSE`](LICENSE). The vendored `obsidian-markdown` skill keeps its
own license — see `.agents/skills/THIRD_PARTY_LICENSES.md`.
