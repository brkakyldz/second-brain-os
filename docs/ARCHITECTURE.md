# Architecture

A general, forkable blueprint for a personal "second brain" operating system built on
**Claude Code + Obsidian + Git/GitHub**.

> **Research provenance.** This design is based on research into Hermes-style agent
> memory architecture (bounded, tiered context with explicit budgets), Claude Code's
> native session/hook/skill capabilities, established Obsidian + git vault practice,
> and a survey of prior art in AI-assisted personal knowledge management. No single
> source is authoritative; the design synthesizes convergent patterns across all four.

---

## 1. Vision

One git repository that is simultaneously:

- an **Obsidian vault** the human reads and writes,
- the **persistent memory** Claude Code loads every session,
- a **GitHub-synced** store reachable from any device.

Claude starts every session already knowing who you are, what you're working on, and what
happened last time. It ends every session by writing down what it learned, committing, and
pushing — with no manual steps.

## 2. Design principles

These are the load-bearing decisions. Everything else follows from them.

1. **Git is the only database.** No SQLite, no vector store, no server, no plugin dependency
   chain. Every memory change is a commit; `git log` is the audit trail; `git revert` is undo;
   GitHub is sync and sharing. Every surveyed prior-art system added a database — and their
   most-requested features were recovery and undo, which Git gives us for free.
2. **The vault is the brain.** Plain Markdown + flat YAML frontmatter + `[[wikilinks]]`. A human
   with Obsidian and an agent with file tools read and write the same files. No tool-internal
   formats as the source of truth.
3. **Small always-loaded core, everything else on demand.** A bounded set of core memory files
   (a few thousand tokens) is injected at session start. Deeper knowledge is reached through
   pointers, file reads, and search — never bulk-loaded. (This is the frozen-snapshot pattern
   found in Hermes-style agent memory, Claude Code's native index pattern, and Anthropic's
   stated context-engineering philosophy — all three converge here.)
4. **Bounded memory fails loudly.** Core files have explicit size budgets. When a file exceeds
   its budget the system warns and demands consolidation — it never silently truncates.
5. **Automation fails open.** A failed `git pull` (offline, conflict) must never block a work
   session. Hooks always exit successfully, log durably, and surface a visible warning. A failed
   push keeps the commit local and retries later.
6. **Minimal surface.** Few folders, few skills, few hooks. Complexity creep is the documented
   failure mode of every system in this space. Anything that can be a convention instead of a
   mechanism is a convention.
7. **Memory writes are a security boundary.** Content from untrusted sources (web pages, tool
   output) is never auto-persisted into trusted memory without provenance marking. Secrets are
   kept out of the repo by layered defenses.

## 3. Architecture

### 3.1 Repository layout (the vault)

```
your-brain/                    # private GitHub repo = Obsidian vault = the brain
├── CLAUDE.md                  # conventions & rules for the agent (< 150 lines, hard budget)
├── _brain/                    # the memory core (agent-managed, human-auditable)
│   ├── IDENTITY.md            # how the assistant behaves here (persona, tone, rules of engagement)
│   ├── USER.md                # who the user is: role, preferences, working style   [budget ~40 lines]
│   ├── MEMORY.md              # index of durable facts, one line each + pointer     [budget ~100 lines]
│   ├── OPEN_QUESTIONS.md      # routing table: questions the vault is listening for answers to
│   ├── memory/                # topic files holding the detail MEMORY.md points to
│   ├── playbooks/             # procedural memory: "how we do X here" recipes (promoted after ≥2 uses)
│   ├── templates/             # note templates, incl. decision.md (pre-mortem + outcome)
│   └── logs/                  # append-only session logs, YYYY-MM-DD_HHMM.md
├── projects/                  # one note (or folder) per active project: goal, status, decisions
├── knowledge/                 # PKM layer: atomic, wikilinked permanent notes
├── daily/                     # daily notes, YYYY-MM-DD.md
├── inbox/                     # quick capture (mobile writes land here; triaged later)
├── archive/                   # closed projects, stale notes — never deleted, always archived
├── scripts/                   # optional deterministic automation roster (see § 3.7)
└── .claude/
    ├── settings.json          # hook wiring (committed, shared across devices)
    ├── hooks/                 # Node.js .mjs hook scripts (cross-platform)
    └── skills/                # the (few) skills: curator, triage
```

The `_brain/` split is deliberate: **IDENTITY** (persona) / **USER** (relationship memory) /
**MEMORY** (world+project facts) / **playbooks** (procedural) / **logs** (episodic). Five kinds
of memory, five places, no overlap.

### 3.2 Context loading — three tiers

| Tier | What | When loaded | Budget |
|---|---|---|---|
| 0 — Always | `CLAUDE.md`, `_brain/IDENTITY.md`, `USER.md`, `MEMORY.md`, tail of the latest session log | Injected at `SessionStart` | ~2–3k tokens total |
| 1 — Pointed | `_brain/memory/*` topic files, `projects/*` notes, playbooks | Read on demand when a Tier-0 pointer or the task makes them relevant | pay-as-you-go |
| 2 — Searched | Whole vault, git history | grep / Obsidian search / `git log` when Tiers 0–1 don't answer | pay-as-you-go |

Every `MEMORY.md` line is one fact plus (where detail exists) a pointer:
`- Project X uses trunk-based dev; details → [[memory/project-x]]`. The agent never needs to
bulk-read the vault to "catch up" — that is exactly the token-waste failure mode documented
against unbounded session-replay memory designs.

Claude Code's own machine-local auto memory stays at its default location as per-machine
scratch. The vault is the canonical, synced brain; we do not point `autoMemoryDirectory` into
it (avoids coupling to an internal format and merge races on an internally-managed index).

### 3.3 The automation loop (hooks)

All hook logic is written in **Node.js (`.mjs`)** invoked via `node` — Node ships with Claude
Code, which sidesteps shell fragmentation across platforms entirely. All hooks: fail open
(`exit 0`), log to `_brain/logs/.automation.log`, never block a session.

| Hook | Action |
|---|---|
| `SessionStart` | `git pull --rebase --autostash` (on failure: proceed with local state + visible warning). Then inject Tier 0 as `additionalContext`. |
| `Stop` (each turn end) | Checkpoint: `git add -A && git commit` if the tree changed (skip empty diffs). Push best-effort. At most one turn's work is ever at risk. |
| `SessionEnd` | Final fast local commit + best-effort push. Treated as bonus, not backbone — it's documented as unreliable on crash and has open platform-specific bugs. |
| `PreCompact` | Snapshot session state into the current session log before compaction discards detail. |

**Session logs are written by the model, not the hook.** `SessionEnd` cannot inject context
(the session is over), so `CLAUDE.md` carries a standing rule: *after completing substantial
work, append what happened / what was decided / what was learned to today's session log and
update `MEMORY.md` if a durable fact emerged.* The `Stop` hook's commit then persists it.
Log entries use a fixed taxonomy: `decision | bugfix | feature | discovery | preference | change`.

### 3.4 Multi-device sync

- **Desktop (primary):** Claude Code hooks do all the git work; optionally the Obsidian Git
  plugin ("pull on startup", debounced auto-commit) covers Obsidian-only sessions.
- **Single-user conflict strategy:** `git pull --rebase --autostash` + `git rerere` enabled.
  `merge=union` only for the append-only `_brain/logs/` path. Never auto-push if a
  rebase exited non-zero or conflict markers remain — a garbled auto-merge must not propagate.
- **Mobile = read + quick capture, by design.** Mobile git is the field's documented weak link
  (Android FUSE storage corrupts `.git`; the workaround needs Termux + `--separate-git-dir`).
  Reading happens via the GitHub app or Obsidian+git-sync where set up; capture lands in
  `inbox/` (GitHub app file edit = a commit) and a triage skill files it properly later. See
  `docs/MOBILE.md`.
- **One sync mechanism per vault, ever.** Git + iCloud/Drive/Syncthing on the same folder is a
  documented cause of repo corruption.

### 3.5 Security & privacy

- The brain repo (your clone of this template) should be **private**. This template repo
  itself contains no personal data.
- Layered secret defense: `.gitignore` for secret-shaped files (`.env`, `*.key`,
  `*credentials*`) → a secret scan built into every checkpoint commit → optional gitleaks via
  a committed `.pre-commit-config.yaml` → optional gitleaks GitHub Action as backstop.
- Provenance rule in `CLAUDE.md`: facts derived from untrusted external content are written
  with a `source:` marker and never into `USER.md`/`IDENTITY.md`. (Memory poisoning via
  permissive write policies is a measured, documented attack class.)
- Maintenance agents may append and edit; they may **not delete** — archive only.

### 3.6 Maintenance — the Curator

A `/curator` skill (run manually, or scheduled e.g. weekly): merges duplicate facts, resolves
contradictions in favor of newer evidence, archives stale entries, distills old session logs
into topic files, and re-checks size budgets. Retention heuristic (borrowed from prior art):
**every stored fact must be timeless, dated, or a pointer to a live source** — anything else
is a staleness bug waiting to happen. Contradictions never overwrite: a superseded fact gets its
`valid_to`/`superseded_by` keys set (bi-temporal frontmatter, see `CLAUDE.md` § Note conventions)
and the new belief is written as a new entry — the old one stays as a visible, dated record. Every inferred
fact the curator writes carries a `source:` pointer (file path, quote, or commit hash); every
proposal it can't apply directly (a merge, an archive, a delete) is logged as a row in a
proposal table rather than executed, so acceptance/rejection stays auditable. Procedures follow
the same discipline one level up: a workflow only promotes from a one-off recipe to
`_brain/playbooks/` after **two independent successful uses** — evolution decoupled from
execution, applied to the vault's own procedures.

### 3.7 Scheduled automation (optional)

An optional `scripts/` folder (PowerShell + Node stdlib, no dependencies) covers the
deterministic half of upkeep, wired to Windows Task Scheduler via `scripts/register-tasks.ps1`
(reviewed and run by hand — never auto-registered): daily backup/push verification, a weekly
broken-link/orphan sweep, a weekly off-site `git bundle` snapshot, a weekly headless
`claude -p "/triage then /curator"` pass, and a daily weighted-random "resurface 3 notes" job.
All scripts that touch vault state share a cooperative lockfile (`scripts/.brain.lock`) so two
jobs never race. This keeps deterministic, no-judgment work off the LLM budget entirely — see
`scripts/README.md` for the full roster and kill criteria per job. None of it is required: every
job it automates can also be run manually or skipped.

## 4. The two repositories

This project follows a two-repository model:

| | This template (public) | Your clone (private) |
|---|---|---|
| Purpose | Starter kit anyone forks | Your actual brain |
| Contains | Folder skeleton, `CLAUDE.md` template, hooks, skills, install script, docs | Your notes, memory, logs |
| Created by | This project | Running `node install.mjs` in your own private clone |

The install script asks for name/preferences, seeds `USER.md`/`IDENTITY.md`, and wires up git —
personalization happens entirely inside your own private repository, never in this template.

## 5. Decisions & rationale

| # | Decision | Rationale (short) |
|---|---|---|
| 1 | Git is the only database | Simplest surveyed design; free undo/audit/sync; the unmet need in prior art |
| 2 | Vault-native Markdown is canonical; Claude's auto memory stays local scratch | Tool-agnostic, transparent, no internal-format coupling |
| 3 | Five-way memory split with hard budgets | Bounded always-loaded core is the convergent pattern; loud failure forces curation |
| 4 | Hook trio `SessionStart`/`Stop`/`SessionEnd` + `PreCompact`, Node `.mjs`, fail-open | Matches documented reliability limits; cross-platform without shell fragmentation |
| 5 | Mobile is read + capture only | Mobile git is the documented weak link; scope discipline over parity |
| 6 | Public template / private brain, two repos | Shareable without leaking personal data |

## 6. Out of scope (deliberately)

- Task/project management (GTD) — the brain records knowledge, not todo state.
- Vector search / embeddings / RAG chat — grep + links + a curated index cover the need; any
  of these can be layered on later without changing the storage model.
- Multi-user collaboration — this is a single-person brain; Git makes sharing possible later.
- Full mobile write parity — see decision 5.
