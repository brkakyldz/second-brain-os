@AGENTS.md

## Claude Code only

- `AGENTS.md` is the constitution for both runtimes; this file only imports it.
  Edit the rules there, never here — a second copy is how two runtimes drift.
- The SessionStart hook is wired in exactly one place: this repo's
  `.claude/settings.json` (project scope) or `~/.claude/settings.json` (global
  mode) — never both, or it fires twice. No Claude hook commits: Stop,
  SessionEnd and PreCompact never touch Git here.
- Skills load through the `.claude/skills` link into `.agents/skills/`. If a
  skill is missing, run `node install.mjs --link-skills`; don't copy files.
