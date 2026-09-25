# FAQ

The safety notes behind the README's short list, and the questions a
first-time reader tends to ask. How the parts fit together is
[`ARCHITECTURE.md`](ARCHITECTURE.md); installing is [`SETUP.md`](../SETUP.md).

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

## Questions

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
