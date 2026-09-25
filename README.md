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
  notes whenever you run it — this system's hardest-won lesson is that a
  written procedure loses to the in-the-moment default while the work still
  looks finished. Since v1.1 nothing runs the compiled checks automatically;
  they are kept as code, and `/audit` reports what they encode.

Full design rationale: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What's inside

```
core/         Tier 0, always loaded: IDENTITY, USER, MEMORY, OPEN_QUESTIONS
notes/        the memory store — flat, wikilinked, told apart by type:
raw/          immutable sources you put there; the agent reads, never writes
logs/         append-only session logs + logs/signals/, the event ledger
archive/      closed and superseded content — never deleted, always moved here
scripts/      link sweep, retrieval eval, brain and project doctors, metrics
.agents/      skills — the one copy both runtimes load
.claude/      the shared SessionStart hook, note and project-repo templates,
              the golden set
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

**Requirements:** git 2.28+, Node.js 18.13+, a GitHub account, and
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

### Manual setup

1. Click **Use this template** above and create your own repository —
   **choose Private.** This will be your actual brain; it should never be public.
2. Clone it.
3. Run `node install.mjs`. It interviews you, writes `core/USER.md`, fills the
   language line in `core/IDENTITY.md`, creates `core/.vault-active`, links
   `.claude/skills` to `.agents/skills`, enables `git rerere`, and prints the
   global-mode wiring for both runtimes for you to paste. It does not touch
   your user-level settings itself, and it does not commit.
4. Commit the personalization yourself:
   `git add core/USER.md core/IDENTITY.md` then
   `git commit -m "setup: personalize brain"` and `git push`.
5. Open the folder as an Obsidian vault (optional).
6. `cd` in, run `claude` or `codex`, say hello. Claude Code loads the rules
   (`CLAUDE.md` → `AGENTS.md`) and `core/` through this repo's own hook.
   Codex reads `AGENTS.md` natively but gets `core/` only once its
   user-level hook is wired — see [Global mode](#global-mode-recommended).
7. Check the wiring: `node scripts/brain-doctor.mjs`.

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
  changing `${CLAUDE_PROJECT_DIR}` to the absolute path of your vault. Leave the
  repo's own `hooks` block empty, or it fires twice inside the vault.
- **Codex:** add one `SessionStart` entry to `~/.codex/hooks.json` that runs
  `node "<your vault>/.codex/hooks/session-start.mjs"`, then re-trust the hook
  in Codex. Don't also put it in a project-level `.codex/hooks.json` — Codex
  adds the layers together.

`install.mjs` prints both blocks with your path filled in. The scripts resolve
the brain root themselves (their own location, or `BRAIN_DIR` if you set it),
so they are correct from any working directory. Trade-off, plainly: every
session on the machine pays a small `git pull` at start — skipped whenever the
vault has uncommitted changes, because those belong to a live task.

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

**Changed**

- `SessionStart` skips its pull when the vault has uncommitted changes,
  instead of stashing another task's files (no more autostash).
- Secret scanning is opt-in: gitleaks through `.pre-commit-config.yaml`.
- `PROPOSALS.md` is a list you keep by hand; `/curator` and `/audit` report
  in the conversation and their own log instead of appending to it.
- `flywheel-metrics.mjs` is `vault-metrics.mjs`, counting without scoring.
- Project notes are thin cards; their live status moves into each project's
  `docs/CURRENT_STATE.md`.

### Upgrading from v1.0

A vault made with **Use this template** shares no git history with this
repository, so there is nothing to pull: you fetch v1.1 and take its machinery
path by path. Your content — `core/`, `notes/`, `logs/`, `raw/`,
`archive/`, `INDEX.md`, `PROPOSALS.md` — is never overwritten. Start from a
clean tree (`git status` shows nothing), in the vault's root. The commands are
the same in bash and PowerShell.

1. **Fetch v1.1** — with this repository's URL:

   ```
   git remote add template <this repo's URL>
   git fetch template --tags
   ```

2. **Note your own edits first.** `git diff --stat v1.0 HEAD` lists every file
   you changed since setup. Any of them in step 3's list is about to be
   replaced — above all `CLAUDE.md`, which was the constitution in v1.0; save
   `git diff v1.0 HEAD -- CLAUDE.md` somewhere and re-apply it to `AGENTS.md`
   afterwards.

3. **Take the machinery:**

   ```
   git checkout v1.1 -- .agents .claude/hooks .claude/templates .claude/settings.json .codex scripts docs AGENTS.md CLAUDE.md README.md SETUP.md install.mjs .gitignore .gitattributes .pre-commit-config.yaml notes/lifecycle-policy.md notes/self-evolution-policy.md logs/signals/README.md raw/README.md
   ```

4. **Move your own skills** out of `.claude/skills/`, if you added any —
   `git mv .claude/skills/<name> .agents/skills/<name>` for each — then
   **remove what v1.1 deleted:**

   ```
   git rm -r -q .claude/skills .claude/hooks/checkpoint.mjs .claude/hooks/flush.mjs .claude/hooks/maintenance-stamp.mjs .claude/hooks/reuse-telemetry.mjs .claude/hooks/session-end.mjs scripts/flywheel-metrics.mjs scripts/proposals.mjs
   ```

5. **Link the skills and review the rest.** Run
   `node install.mjs --link-skills`. Re-add any lines of your own that
   `git diff --cached -- .gitignore` shows as removed. Compare the files that
   are yours to merge by hand — `git diff HEAD v1.1 -- INDEX.md PROPOSALS.md core/IDENTITY.md`
   — and at least add the `[[self-evolution-policy]]` row to `INDEX.md`.
   In global mode, empty the `hooks` block of `.claude/settings.json` again
   (keep `permissions`).

6. **Commit the upgrade.** Stage what you edited in step 5 by name —
   `git add -- .gitignore INDEX.md .claude/settings.json`, whichever you
   touched — then `git commit -m "upgrade: Second Brain OS v1.1"`. The index
   holds exactly the upgrade, because the tree was clean when you started.

7. **Unwire the retired hooks at user level.** In global mode, delete every
   entry in `~/.claude/settings.json` that points at `checkpoint.mjs`,
   `session-end.mjs` or `reuse-telemetry.mjs` in your vault; keep the one
   `SessionStart` entry. For Codex, add its entry as in [Global mode](#global-mode-recommended).

8. **Check it:** `node scripts/brain-doctor.mjs` fails loudly on a retired
   hook still wired, a duplicate SessionStart or a missing skills link. Then,
   optionally, `node install.mjs --link-global-skills`, and turn your project
   notes into cards (`.claude/templates/project.md`).

From here on, nothing commits for you: each task commits its own explicit
paths.

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

**Why not a vector database?** Grep, wikilinks, `INDEX.md` and a curated
`MEMORY.md` cover retrieval for a single-person vault without an embedding
pipeline to keep in sync. This isn't an assumption: the reference instance
measured it with 52 golden queries and found zero paraphrase-misses — every
failure was a vocabulary mismatch, which an `aliases:` entry fixes. The trigger
to revisit is written down (`docs/DECISIONS.md`, 0010/0018) and has not fired.

**Can I use only one of Claude Code or Codex?** Yes. Each runtime needs only
its own SessionStart wiring; the vault content, the rules and the skills are
the same files either way.

**Can I use it without Obsidian?** Yes. Plain Markdown and YAML frontmatter; any
editor works. Obsidian adds backlinks and graph view but isn't load-bearing.

**Why doesn't anything commit automatically any more?** Because once two
sessions — or two runtimes — work in one checkout, a hook cannot know which
changed file belongs to which task. The reference instance's checkpoint swept
53 files from several sessions into one commit before it was retired. The
price: a session that ends without committing leaves its files for the next
one. `brain-doctor.mjs` and `git status` show them.

**Where does a project's status go?** Into the project's own repo, in
`docs/CURRENT_STATE.md` — the only file that states it — committed with the
code it describes. The brain's card for that project says where the repo and
that file are and never restates them: a copied status is right for a day and
wrong afterwards. The reference instance tried the opposite (the brain as the
only working record) and no coding session ever resumed from it.

**What if I work offline?** Everything works locally. The pull at start fails
open, and a push that fails just leaves the commit local until the next
successful one — the next session start mentions it once a backlog is over a
day old.

**How do I undo something the agent wrote?** `git log`, then `git revert`. Git
is the only database here precisely so undo is free.

**Does anything run on a schedule?** No, and that's deliberate. Unattended
maintenance was built, run, and retired: a pass that runs with nobody watching
produces work nobody reads. Nothing tells you a pass is overdue either — you
run `/curator` or `/audit` when you want them.

**What happens if a memory file gets too big?** `MEMORY.md` and `USER.md` have
character budgets. Going over never silently truncates — the session-start
header shows usage before you write, marks a file that is over budget, and
`brain-doctor.mjs` fails on it until `/curator` consolidates.

**Isn't `raw/` just the inbox you removed?** No, and the difference is the test
for any folder like it: an inbox is a queue whose healthy state is *empty* and
whose producer was cancelled; `raw/` is a corpus whose healthy state is *full*
and whose producer is you, saving what you read. The failure mode is real, so it
is named with a kill criterion: files sitting un-ingested for three weeks mean
the inlet isn't wanted, and it gets removed rather than nagged about.

## Learn more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the full design: principles,
  the memory model, the two runtimes, retrieval, and the reasoning behind each.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — the decision index, including what
  was reversed and why.

## License

MIT. See [`LICENSE`](LICENSE). The vendored `obsidian-markdown` skill keeps its
own license — see `.agents/skills/THIRD_PARTY_LICENSES.md`.
