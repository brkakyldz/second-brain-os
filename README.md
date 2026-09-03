# Second Brain OS

A second brain that is an Obsidian vault, a Claude Code memory, and a git
repository, all at once. **Git is the only database** — no SQLite, no vector
store, no server, no plugin dependency chain. Your assistant knows who you are
and what you're working on the moment a session starts, and writes down what it
learned before the session ends — committed, with no manual steps.

This is the generic projection of a vault that has been running daily since
2026-08-18. Everything here is in use somewhere, and the parts that were tried
and removed are listed as removed rather than quietly dropped — see
[`docs/DECISIONS.md`](docs/DECISIONS.md).

## How it works

- **`core/` is the always-loaded tier**, and it is deliberately tiny:
  `IDENTITY.md` (how the assistant behaves), `USER.md` (who you are, 2000-char
  budget), `MEMORY.md` (durable facts, one line each, 4000-char budget, pointers
  instead of detail), `OPEN_QUESTIONS.md` (what the vault is listening for).
- **One folder per lifecycle, not per category.** `notes/` is flat and holds
  every durable page; what a note *is* lives in its `type:` frontmatter, and how
  mature it is lives in `status:`. A note never moves because it grew up, so a
  link never breaks. The only move is into `archive/`, when it closes.
- **Two inlets, both ending in distillation.** Something said in conversation
  gets written as a note there and then — there is no capture inbox to triage
  later. Something you *read* goes into `raw/` and is pulled in with `/ingest`,
  which discusses it with you first, then writes the distilled note, reconciles
  it against what the vault already believes, and catalogs it.
- **Three retrieval tiers.** Tier 0 (`CLAUDE.md` + `core/` + the tail of the
  last session log) is injected at session start. Tier 1 (`INDEX.md`, then the
  two or three pages it points at) is read on demand. Tier 2 (the whole vault,
  git history) is reached by search only when the first two don't answer.
  Nothing is bulk-loaded.
- **A hook loop does the git work for you**: `SessionStart` pulls and injects
  Tier 0; every turn ends with a checkpoint commit (`Stop`); `SessionEnd`
  flushes the session into a log; `PreCompact` snapshots state before context
  compaction. A secret scanner and a budget guard run inside every checkpoint.
  Everything fails open — a failed pull or push never blocks your session.
- **The rules that matter are compiled into checks**, not left as prose the
  model may skip: wikilink form, note frontmatter, catalog coverage, and an
  uncaptured correction all fire from `.claude/hooks/checks.mjs` at checkpoint
  time. This is the system's own hardest-won lesson — a written procedure loses
  to the in-the-moment default while the work still looks finished.

Full design rationale: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What's inside

```
core/         Tier 0, always loaded: IDENTITY, USER, MEMORY, OPEN_QUESTIONS
notes/        the memory store — flat, wikilinked, told apart by type:
raw/          immutable sources you put there; the agent reads, never writes
logs/         append-only session logs + logs/signals/, the event ledger
archive/      closed and superseded content — never deleted, always moved here
scripts/      link sweep, flywheel metrics, proposals sweep, retrieval eval
.claude/      hooks, skills, note templates, the retrieval golden set
INDEX.md      the page catalog — read this first when answering a question
PROPOSALS.md  the one approval surface: agents append, you tick or strike
CLAUDE.md     the constitution — the rules both you and the agent work under
SETUP.md      agent-run installation runbook
install.mjs   one-time interactive personalization (manual path)
docs/         architecture guide and the decision index
```

Plain Markdown, JSON and Node — no build step, no runtime dependency beyond
Node itself. Verified on Windows and macOS; nothing in the live tree is
platform-bound.

## Quickstart

**Requirements:** git, Node.js 18+, [Claude Code](https://claude.com/product/claude-code),
a GitHub account. Obsidian is optional but recommended — the vault is plain
Markdown either way.

Open Claude Code and paste this in, with this repo's own `SETUP.md` URL:

> Read SETUP.md from this repository and set up my second brain:
> `<this repo's URL>/blob/main/SETUP.md`

Claude handles the rest: creates your private repo, interviews you — including
whether the brain should follow you into every project (global mode,
recommended) or stay project-scoped — personalizes the core files, and verifies
the hooks fire.

### Manual setup

1. Click **Use this template** above and create your own repository —
   **choose Private.** This will be your actual brain; it should never be public.
2. Clone it.
3. Run `node install.mjs`. It interviews you, writes `core/USER.md`, fills the
   language line in `core/IDENTITY.md`, creates `core/.vault-active`, enables
   `git rerere`, and prints the global-mode block for you to paste. It does not
   touch your user-level settings itself.
4. Open the folder as an Obsidian vault (optional).
5. `cd` in, run `claude`, say hello. `CLAUDE.md` and `core/` load automatically.

## Daily use

Work normally. Talk to Claude Code inside the vault about anything — plan a
project, think a problem through, ask what you decided last month. It reads and
writes the same Markdown you see in Obsidian and checkpoints its own work as
commits.

The commands worth knowing:

| | |
|---|---|
| `/ingest <file>` | read a source in `raw/` into the wiki — discuss, distill, reconcile, catalog |
| `/file` | keep an analysis produced in conversation as a proper page, instead of losing it to the transcript |
| `/lesson` | capture a correction you just made, verbatim, before it is rationalized away |
| `/recall` | four-layer lexical retrieval, and it logs the misses so search failure becomes data |
| `/curator` | consolidate memory, resolve stale facts, keep the core files inside budget |
| `/flywheel` | turn corroborated lessons into enforced checks, or retire them |
| `/audit` | monthly structural report — budgets, orphans, overdue reviews, tag sprawl. Reports only, never fixes |

## Global mode (recommended)

This is the intended way to run the system: the brain grows from *every*
session you have with Claude Code, not just the ones inside the vault folder.

By default the hooks are wired in this repo's `.claude/settings.json`, so they
only fire here. To go global, move that `hooks` block into your user-level
`~/.claude/settings.json`, changing each `${CLAUDE_PROJECT_DIR}/...` command to
an absolute path to your vault. The scripts resolve the brain root themselves
(their own location, or `BRAIN_DIR` if you set it), so they are correct from any
working directory. Leave this repo's own `hooks` block empty when you do, or
they fire twice.

**Wire all five hooks.** `SessionStart`, `Stop`, `PreCompact` and `SessionEnd`
are the obvious ones; the fifth is a `PostToolUse` hook on `Read|Grep|Glob` that
feeds the note-reuse metric. Skip it and that metric reads zero forever, which
looks like a vault nobody uses rather than a hook nobody wired.

Trade-off, plainly: every session on the machine then pays a small pull at start
and a commit at each Stop.

## Safety

- **Your clone must be private.** This template is public and holds no personal
  data; your vault will hold your actual notes and should never be public.
- Every checkpoint commit runs a secret scanner over staged files (API keys,
  private key blocks, tokens, password literals). Anything matching is left
  uncommitted and logged — it never gets pushed.
- **Nothing is deleted automatically.** Stale or closed content moves to
  `archive/`. The curator can *propose* a deletion in two narrow cases; it never
  executes one. `git revert` covers everything else.
- Hooks are inert until `core/.vault-active` exists, so a fresh clone can never
  auto-commit or auto-push over your head.
- For an independent check, install [pre-commit](https://pre-commit.com) and run
  `pre-commit install` — this repo ships a `.pre-commit-config.yaml` wiring
  [gitleaks](https://github.com/gitleaks/gitleaks) on the human side.

## FAQ

**Why not a vector database?** Grep, wikilinks, `INDEX.md` and a curated
`MEMORY.md` cover retrieval for a single-person vault without an embedding
pipeline to keep in sync. This isn't an assumption: the reference instance
measured it with 52 golden queries and found zero paraphrase-misses — every
failure was a vocabulary mismatch, which an `aliases:` entry fixes. The trigger
to revisit is written down (`docs/DECISIONS.md`, 0010/0018) and has not fired.

**Can I use it without Obsidian?** Yes. Plain Markdown and YAML frontmatter; any
editor works. Obsidian adds backlinks and graph view but isn't load-bearing.

**What if I work offline?** Everything works locally. The pull at start and the
push at Stop both fail open — a failed push just means the commit stays local
until the next successful one.

**How do I undo something the agent wrote?** `git log`, then `git revert`. Git
is the only database here precisely so undo is free.

**Does anything run on a schedule?** No, and that's deliberate. Unattended
maintenance was built, run, and retired: a pass that runs with nobody watching
produces work nobody reads. The trigger is you opening a session — session start
prints one line when something is actually due.

**What happens if a memory file gets too big?** `MEMORY.md` and `USER.md` have
character budgets. Going over never silently truncates — the session-start
header shows usage before you write, and the checkpoint hook warns loudly and
asks you to run `/curator` to consolidate.

**Isn't `raw/` just the inbox you removed?** No, and the difference is the test
for any folder like it: an inbox is a queue whose healthy state is *empty* and
whose producer was cancelled; `raw/` is a corpus whose healthy state is *full*
and whose producer is you, saving what you read. The failure mode is real, so it
is named with a kill criterion: files sitting un-ingested for three weeks mean
the inlet isn't wanted, and it gets removed rather than nagged about.

## Learn more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the full design: principles,
  the memory model, the hook loop, retrieval, and the reasoning behind each.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — the decision index, including what
  was reversed and why.

## License

MIT. See [`LICENSE`](LICENSE). The vendored `obsidian-markdown` skill keeps its
own license — see `.claude/skills/THIRD_PARTY_LICENSES.md`.
