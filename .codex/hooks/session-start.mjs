#!/usr/bin/env node
// Codex adapter for the vault's SessionStart hook (ADR 0044).
//
// The implementation lives once, in .claude/hooks/session-start.mjs, and both
// runtimes run that same file: Claude Code calls it directly, Codex calls this
// adapter from ~/.codex/hooks.json. The directory name is historical, not
// ownership. Codex does not set CLAUDE_PROJECT_DIR, so this supplies it from
// the session's working directory, and the brain root from this file's own
// location — never from a hard-coded path, so the same file is correct in
// every clone. BRAIN_DIR, if already set, still wins.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// this file lives at <vault>/.codex/hooks/session-start.mjs
const brainRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.BRAIN_DIR ||= brainRoot;
process.env.CLAUDE_PROJECT_DIR ||= process.cwd();

await import(pathToFileURL(path.join(brainRoot, '.claude', 'hooks', 'session-start.mjs')).href);
