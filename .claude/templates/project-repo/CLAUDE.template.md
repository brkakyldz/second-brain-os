@AGENTS.md

## Claude Code only

- Keep implementation in the main agent. Subagents do read-only lookups and
  reviews. A milestone that genuinely has two independently owned workstreams
  is split deliberately — one frozen contract, one owner per workstream — not
  handed to ad-hoc writing subagents.
- Before a context compaction or a long pause, checkpoint
  `docs/CURRENT_STATE.md`. After one, re-anchor before the next edit: re-read
  STATE, `git log --oneline <as_of>..HEAD`, `git status` and the diff, then the
  active milestone's plan section. The compaction summary is not a source.
