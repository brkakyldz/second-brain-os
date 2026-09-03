#!/usr/bin/env node
// Second Brain OS — one-time personalization for a fresh clone.
//
// What it does, and nothing more:
//   1. asks a short interview,
//   2. writes core/USER.md and the language line in core/IDENTITY.md,
//   3. creates core/.vault-active — the marker every hook is gated on,
//   4. turns on git rerere,
//   5. prints the global-mode block for you to paste, and does NOT write it.
//
// Step 5 is deliberate: user-level settings are outside this repo, they affect
// every project on the machine, and an installer that edits them without you
// watching is exactly the kind of thing this system's rules forbid.
//
// Safe to abort at any prompt (Ctrl-C) — nothing is written until the summary
// is confirmed.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.join(ROOT, 'core');
const MARKER = path.join(CORE, '.vault-active');

const rl = readline.createInterface({ input: stdin, output: stdout });

// Lines are queued rather than awaited one at a time. With a real terminal the
// two are identical, but with piped input readline delivers a whole buffered
// chunk at once and every line after the first is dropped on the floor — which
// makes the installer impossible to smoke-test and silently truncates anyone's
// scripted run. Queue first, hand out one line per question.
const pending = [];
const waiting = [];
let closed = false;
rl.on('line', (line) => {
  const next = waiting.shift();
  if (next) next(line);
  else pending.push(line);
});
rl.on('close', () => {
  closed = true;
  while (waiting.length) waiting.shift()(null);
});

function nextLine() {
  if (pending.length) return Promise.resolve(pending.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
}

const ask = async (q, fallback = '') => {
  stdout.write(q);
  const line = await nextLine();
  if (line === null) return fallback; // input ended — take the default
  const a = line.trim();
  return a === '' ? fallback : a;
};

function bail(msg) {
  stdout.write(`\n${msg}\n`);
  rl.close();
  process.exit(1);
}

if (!fs.existsSync(CORE)) {
  bail('No core/ directory here. Run this from the root of your brain clone.');
}

if (fs.existsSync(MARKER)) {
  const again = await ask(
    'core/.vault-active already exists — this vault looks personalized.\n' +
      'Re-run setup and overwrite core/USER.md? [y/N] ',
    'n',
  );
  if (!/^y(es)?$/i.test(again)) bail('Nothing changed.');
}

stdout.write(`
Second Brain OS — setup
-----------------------
Answer what you can. Leave anything blank rather than guessing: a blank line
is honest, an invented one is read as true by every future session.

`);

const name = await ask('Your name (what should the assistant call you?): ');
const role = await ask('Your role, one line: ');
const where = await ask('Location / timezone: ');
const lang = await ask('Language you want to be talked to in [English]: ', 'English');
const style = await ask('Communication style, one line [concise, explain properly]: ',
  'concise, but explain properly — a summary that needs a follow-up failed');
const background = await ask('Technical background, one line: ');
const focusRaw = await ask('Current focus — active projects, comma-separated: ');
const focus = focusRaw.split(',').map((s) => s.trim()).filter(Boolean);

const today = new Date().toISOString().slice(0, 10);

const userMd = `# User

## Name
${name || '<!-- unanswered -->'}${name ? `. Address as "${name}".` : ''}

## Role
${role || '<!-- unanswered -->'}

## Location / Timezone
${where || '<!-- unanswered -->'}

## Communication style
- Converses in **${lang}**; durable vault content is written in English —
  rationale in \`IDENTITY.md\`.
- ${style}

## Technical background
- ${background || '<!-- unanswered -->'}

## Current focus
${focus.length
    ? focus.map((f) => `- **${f}** — <!-- one line on where it stands --> → [[${slug(f)}]]`).join('\n')
    : '<!-- unanswered -->'}

<!-- Filled ${today} by install.mjs from a setup interview.
     Correct it rather than growing it: when a line here turns out to be wrong,
     the fix is an edit plus a dated comment, not a second line saying otherwise.
     Budget: 2000 characters, HTML comments excluded. -->
`;

function slug(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

stdout.write(`
About to write:

  core/USER.md          (${userMd.length} chars)
  core/IDENTITY.md      (language line only)
  core/.vault-active    (switches the hooks on)
  git config rerere.enabled true

`);

const go = await ask('Write these? [Y/n] ', 'y');
if (!/^y(es)?$/i.test(go)) bail('Nothing changed.');

fs.writeFileSync(path.join(CORE, 'USER.md'), userMd, 'utf8');

// IDENTITY.md keeps its own wording; only the placeholder is filled.
const idPath = path.join(CORE, 'IDENTITY.md');
if (fs.existsSync(idPath)) {
  const id = fs.readFileSync(idPath, 'utf8');
  const filled = id.replace('<LANGUAGE>', lang);
  if (filled !== id) fs.writeFileSync(idPath, filled, 'utf8');
}

fs.writeFileSync(
  MARKER,
  `# This file switches the hooks on. It is gitignored on purpose: a fresh
# clone of the template must never auto-commit or auto-push over your head.
# Created ${today} by install.mjs.
`,
  'utf8',
);

try {
  execFileSync('git', ['config', 'rerere.enabled', 'true'], { cwd: ROOT, stdio: 'ignore' });
} catch {
  stdout.write('  (git config rerere failed — harmless, set it by hand if you want it)\n');
}

const abs = ROOT.replace(/\\/g, '/');
const hookLines = [
  ['SessionStart', 'session-start.mjs'],
  ['PostToolUse (Read|Grep|Glob)', 'reuse-telemetry.mjs'],
  ['Stop', 'checkpoint.mjs'],
  ['PreCompact', 'checkpoint.mjs'],
  ['SessionEnd', 'session-end.mjs'],
].map(([evt, script]) => `    ${evt.padEnd(30)} node "${abs}/.claude/hooks/${script}"`);

stdout.write(`
Done. Your brain is live in this folder.

Next, optional but recommended — GLOBAL MODE
--------------------------------------------
By default the hooks fire only inside this folder. Global mode makes the brain
load and record in *every* Claude Code session on this machine, which is the
way this system is meant to run: it grows from everything you work on, not just
from the sessions you remember to start here.

To switch, move the "hooks" block out of this repo's .claude/settings.json and
into your user-level ~/.claude/settings.json, with absolute paths:

${hookLines.join('\n')}

That is five entries, not four. The PostToolUse one is the entire input side of
the note-reuse metric — skip it and that number reads zero forever, which looks
like a vault nobody uses rather than a hook nobody wired.

Leave this repo's own "hooks" block empty when you do, or they fire twice.

The scripts resolve the brain root themselves (their own location, or BRAIN_DIR
if you set it), so they are correct from any working directory.

Trade-off, stated plainly: every session on the machine then pays a small pull
at start and a commit at each Stop.

Now open this folder as an Obsidian vault (optional), run \`claude\` in it, and
say hello — CLAUDE.md and core/ load automatically.
`);

rl.close();
