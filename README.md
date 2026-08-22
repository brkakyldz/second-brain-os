# Second Brain OS

A second brain that is an Obsidian vault, a Claude Code memory, and a git repository, all at
once. **Git is the only database** — no SQLite, no vector store, no server, no plugin
dependency chain. Your assistant knows who you are and what you're working on the moment a
session starts, and automatically writes down what it learned before the session ends —
committed, with no manual steps.

## How it works

- **`_brain/` is the memory core**, split into five kinds of memory with no overlap:
  `IDENTITY.md` (how the assistant behaves), `USER.md` (who you are), `MEMORY.md` (durable
  facts, one line each, pointers to detail), `playbooks/` (procedural "how we do X" recipes),
  and `logs/` (append-only session logs).
- **Three context tiers**: Tier 0 (`CLAUDE.md` + the `_brain/` core files + the tail of the
  last session log) is injected automatically at session start and stays small on purpose.
  Tier 1 (topic files, project notes) is read on demand. Tier 2 (the whole vault, git history)
  is reached by search only when Tiers 0–1 don't answer. Nothing is bulk-loaded.
- **A hook loop does the git work for you**: `SessionStart` pulls and injects Tier 0;
  every turn ends with a checkpoint commit (`Stop`); `SessionEnd` does a final best-effort
  flush; `PreCompact` snapshots state before context compaction. A secret scanner and a
  size-budget guard run inside every checkpoint. Everything fails open — a failed pull or push
  never blocks your session.

Full design rationale: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What's inside

```
_brain/           the memory core: IDENTITY.md, USER.md, MEMORY.md, OPEN_QUESTIONS.md, memory/,
                  playbooks/, templates/, logs/ — plus .vault-active, the marker that
                  switches the hooks on (setup creates it; this template ships without it)
projects/         one note per active project — goal, status, decisions
knowledge/        atomic, wikilinked permanent notes (PKM layer)
daily/            daily notes, YYYY-MM-DD.md
inbox/            quick capture, triaged later
archive/          closed projects and stale notes — never deleted, always moved here
scripts/          optional automation roster (backup verify, link sweep, off-site bundle,
                  scheduled triage/curator, daily resurfacing) — see scripts/README.md
.claude/          hooks (session-start, checkpoint, session-end) + skills (curator, triage,
                  plus vendored obsidian-markdown)
SETUP.md          agent-run installation runbook — see Quickstart
install.mjs       one-time interactive setup for your personalized clone (manual path)
docs/             architecture guide
```

Everything here is plain Markdown, JSON, and Node — no build step, no runtime dependency
beyond Node itself.

## Quickstart

**Requirements:** git, Node.js 18+, [Claude Code](https://claude.com/product/claude-code), a
GitHub account. Obsidian is optional but recommended — the vault is just Markdown either way.

1. Open Claude Code and paste this in, swapping the link for this repo's own `SETUP.md` URL
   (take the URL you're reading this on and add `/blob/main/SETUP.md`):

   > Read SETUP.md from this repository and set up my second brain:
   > `<this repo's URL>/blob/main/SETUP.md`

Claude handles the rest: creates your private repo, interviews you — including asking whether
the brain should follow you into every project (global mode, recommended) or stay
project-scoped — personalizes the brain, and verifies it works.

### Manual setup (without Claude doing it)

1. Click **Use this template** above and create your own repository — **choose Private.** This
   will be your actual brain; it should never be public.
2. Clone it to your machine.
3. Run the interactive setup:
   ```
   node install.mjs
   ```
   It asks a few questions (name, role, timezone, preferred language, communication style),
   seeds `_brain/USER.md` and `_brain/IDENTITY.md`, and enables `git rerere` for smoother
   conflict handling.
4. Open the folder as a vault in Obsidian (optional, but this is meant to be read/edited as
   one).
5. In a terminal, `cd` into the folder and run `claude`.
6. Say hello. Claude Code loads `CLAUDE.md` and the `_brain/` core automatically — it already
   knows who you are.

## Daily use

Just work. Talk to Claude Code inside the vault the way you would about anything else — ask it
to research something, plan a project, write a note, remember a decision. It reads and writes
the same Markdown files you see in Obsidian, and checkpoints its own work as commits every
turn.

Quick, half-formed thoughts go into `inbox/` as they come. Later, run `/triage` to file them
properly, and run `/curator` periodically (or on a schedule) to consolidate memory, resolve
stale facts, and keep core files inside their size budgets.

## Global mode (recommended)

This is the intended way to run the system: the brain grows from *every* session you have with
Claude Code, not just sessions inside the vault folder. If you install with the agent-first
path above, the installer offers this during the Step 1 interview and wires it for you after
showing you exactly what it's about to write. The manual instructions below are for people who
installed by hand (the `install.mjs` path) and want to switch to global mode afterward.

By default the hooks only fire inside the vault, because they're wired in this repo's
`.claude/settings.json` (project scope). Global mode makes the brain follow you into *every*
project on the machine: move the `hooks` block out of the vault's `.claude/settings.json` and
into `~/.claude/settings.json` instead, changing each command from
`${CLAUDE_PROJECT_DIR}/.claude/hooks/...` to an absolute path to your vault's scripts, e.g.
`node "<path-to-your-brain>/.claude/hooks/session-start.mjs"`. The scripts resolve the brain
root themselves (script location, or `BRAIN_DIR` if set), so once wired this way any session
anywhere on the machine will load the brain at start and checkpoint into it at Stop —
`SessionStart` context gains a `Current project: <path>` line and a short standing-rules note
whenever you're outside the vault. Leave the vault's own project-level `hooks` block empty when
you do this, to avoid double-firing inside the vault. Trade-off: every session on the machine,
in every project, now pays a small brain pull at start and a brain commit at each Stop. There's
also a rare, harmless concurrency edge case: if two sessions on the machine start at the exact
same moment, one pull can fail — this fails open and recovers on the next run, so it's never
destructive, just a missed sync that one session.

## Safety

- **Your clone must be private.** This template is public and contains no personal data; your
  personalized clone will contain your actual notes and should never be.
- Every checkpoint commit runs a built-in secret scanner over staged files (API keys, private
  key blocks, tokens, password literals). Anything that matches is left uncommitted and logged
  — it never gets pushed.
- **Nothing is ever deleted automatically.** Stale or closed content is moved to `archive/`,
  never removed. The curator can propose deletions for your approval in three narrow cases
  (see the lifecycle policy) — it never executes them itself. `git revert` covers everything else.
- For an extra layer, install [pre-commit](https://pre-commit.com) and run `pre-commit install`
  — this repo ships a `.pre-commit-config.yaml` that wires up
  [gitleaks](https://github.com/gitleaks/gitleaks) as an independent, human-side secret check.

## FAQ

**Why not a vector database?** Grep, wikilinks, and a curated `MEMORY.md` index cover
retrieval for a single-person vault without adding infrastructure, an embedding pipeline, or
another moving part to keep in sync. Nothing here stops you from layering search on top later
— it just isn't required to get value on day one.

**Can I use it without Obsidian?** Yes. The vault is plain Markdown and YAML frontmatter; any
editor works. Obsidian adds backlinks and graph view, but it's not load-bearing.

**What if I work offline?** Everything works locally. `SessionStart` tries to pull and
`Stop`/`SessionEnd` try to push, but both fail open — a failed pull means you work from local
state with a visible warning; a failed push just means the commit stays local until the next
successful push.

**How do I undo something the agent wrote?** `git log` to find the commit, `git revert` it.
Git is the only database here on purpose — recovery and undo are free.

**Do I need a scheduled job for anything?** No, everything can be run manually (`/curator`,
`/triage`). A weekly `/curator` schedule is a nice-to-have, not a requirement. `scripts/` ships
an optional Windows Task Scheduler roster (backup verification, link sweeps, off-site bundles,
scheduled `/triage`+`/curator`, daily resurfacing) for anyone who wants the deterministic parts
running unattended — see `scripts/README.md`. Nothing registers itself; you opt in by hand.

**Why doesn't anything happen when I run Claude Code in a fresh clone?** By design. The hooks
check for `_brain/.vault-active` and no-op without it — no pull, no commit, no push, no context
injection. Setup creates that file, and this template deliberately ships without one, so a clone
you haven't personalized yet (or the template repo itself, if you're contributing to it) can
never auto-commit and auto-push over your head. Create the file and the hooks come alive.

**What happens if a memory file gets too big?** `MEMORY.md` and `USER.md` have explicit line
budgets. Going over budget never silently truncates — the checkpoint hook warns loudly and
asks you to run `/curator` to consolidate.

## Learn more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — full design: principles, the memory model,
  the hook loop, sync strategy, and the reasoning behind each decision.
