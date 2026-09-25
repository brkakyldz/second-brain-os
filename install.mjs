#!/usr/bin/env node
// Second Brain OS — one-time personalization for a fresh clone.
//
// What it does, and nothing more:
//   1. asks a short interview,
//   2. writes core/USER.md and the language line in core/IDENTITY.md,
//   3. creates core/.vault-active — the marker every hook is gated on,
//   4. links .claude/skills to .agents/skills, the one skills copy both
//      runtimes load (a junction on Windows, a symlink elsewhere — ADR 0044),
//   5. turns on git rerere,
//   6. prints the global-mode wiring for Claude Code and Codex for you to
//      paste, and does NOT write it.
//
// Step 6 is deliberate: user-level settings are outside this repo, they affect
// every project on the machine, and an installer that edits them without you
// watching is exactly the kind of thing this system's rules forbid.
//
// `node install.mjs --link-skills` does step 4 alone and exits — for a second
// machine, a moved folder (a Windows junction stores an absolute path), or a
// clone upgraded from v1.0, where the skills still lived in .claude/skills.
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
const SKILLS_TARGET = path.join(ROOT, '.agents', 'skills');
const SKILLS_LINK = path.join(ROOT, '.claude', 'skills');

function samePath(a, b) {
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}

// Creates or repairs the .claude/skills link. Never deletes anything that is
// not itself a link: a real directory there is a copy, and a copy is the drift
// this layout exists to prevent — so it is reported, not overwritten.
function linkSkills() {
  if (!fs.existsSync(SKILLS_TARGET)) {
    return { ok: false, note: '.agents/skills/ is missing — is this a Second Brain OS clone?' };
  }
  let st = null;
  try {
    st = fs.lstatSync(SKILLS_LINK);
  } catch {
    st = null;
  }
  if (st && !st.isSymbolicLink()) {
    return {
      ok: false,
      note:
        '.claude/skills exists as a real directory, not a link. Move it aside ' +
        '(anything in it that is not already in .agents/skills/ belongs there) ' +
        'and re-run `node install.mjs --link-skills`.',
    };
  }
  if (st) {
    let real = null;
    try {
      real = fs.realpathSync(SKILLS_LINK);
    } catch {
      real = null; // broken link, e.g. the vault folder was moved
    }
    if (real && samePath(real, fs.realpathSync(SKILLS_TARGET))) {
      return { ok: true, note: 'already linked' };
    }
    try {
      // Removes the link itself, never what it points at.
      fs.rmSync(SKILLS_LINK, { recursive: false, force: true });
    } catch (err) {
      return { ok: false, note: `could not replace the stale link: ${err.message}` };
    }
  }
  try {
    fs.mkdirSync(path.dirname(SKILLS_LINK), { recursive: true });
    if (process.platform === 'win32') {
      // A junction needs no admin rights or Developer Mode; a symlink does.
      fs.symlinkSync(SKILLS_TARGET, SKILLS_LINK, 'junction');
    } else {
      fs.symlinkSync(path.relative(path.dirname(SKILLS_LINK), SKILLS_TARGET), SKILLS_LINK, 'dir');
    }
    return { ok: true, note: st ? 'repaired' : 'created' };
  } catch (err) {
    return { ok: false, note: err.message };
  }
}

if (process.argv.includes('--link-skills')) {
  const r = linkSkills();
  stdout.write(`.claude/skills -> .agents/skills: ${r.ok ? r.note : `FAILED — ${r.note}`}\n`);
  process.exit(r.ok ? 0 : 1);
}

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
  if (!/^y(es)?$/i.test(again)) {
    bail('Nothing changed. (To repair only the skills link: node install.mjs --link-skills)');
  }
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
  .claude/skills        (link to .agents/skills — the one skills copy)
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
# clone of the template must never inject context or pull over your head.
# Created ${today} by install.mjs.
`,
  'utf8',
);

const link = linkSkills();
stdout.write(`  .claude/skills -> .agents/skills: ${link.ok ? link.note : `FAILED — ${link.note}`}\n`);

try {
  execFileSync('git', ['config', 'rerere.enabled', 'true'], { cwd: ROOT, stdio: 'ignore' });
} catch {
  stdout.write('  (git config rerere failed — harmless, set it by hand if you want it)\n');
}

const abs = ROOT.replace(/\\/g, '/');
const claudeBlock = JSON.stringify(
  {
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: `node "${abs}/.claude/hooks/session-start.mjs"`, timeout: 60 }] },
      ],
    },
  },
  null,
  2,
);
const codexBlock = JSON.stringify(
  {
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: `node "${abs}/.codex/hooks/session-start.mjs"`, timeout: 60 }] },
      ],
    },
  },
  null,
  2,
);
const indent = (s) => s.split('\n').map((l) => `    ${l}`).join('\n');

stdout.write(`
Done. Your brain is live in this folder.

Commit the personalization yourself, with explicit paths — nothing here commits
for you, and nothing ever stages the whole tree:

    git add core/USER.md core/IDENTITY.md
    git commit -m "setup: personalize brain"

Next, optional but recommended — GLOBAL MODE
--------------------------------------------
By default the hook fires only inside this folder, and only in Claude Code.
Global mode makes the brain load in *every* session on this machine, which is
the way this system is meant to run: it grows from everything you work on.

There is exactly one hook per runtime: SessionStart. Nothing commits at Stop,
SessionEnd or PreCompact — commits are made by the task that wrote the files.

Claude Code — merge into ~/.claude/settings.json (append to any existing
"hooks" arrays, never replace them), then empty the "hooks" block in this
repo's .claude/settings.json, or the hook fires twice inside the vault:

${indent(claudeBlock)}

Codex — merge into ~/.codex/hooks.json the same way, then re-trust the changed
hook definition in Codex. Do not also add it to a project-level
.codex/hooks.json: Codex adds the layers together, so it would fire twice.

${indent(codexBlock)}

The scripts resolve the brain root themselves (their own location, or BRAIN_DIR
if you set it), so they are correct from any working directory.

Trade-off, stated plainly: every session on the machine then pays a small
\`git pull\` at start (skipped whenever the vault has uncommitted changes).

Check the wiring any time with:  node scripts/brain-doctor.mjs

Now open this folder as an Obsidian vault (optional), start \`claude\` or
\`codex\` in it, and say hello — AGENTS.md and core/ load automatically.
`);

rl.close();
