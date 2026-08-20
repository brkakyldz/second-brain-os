#!/usr/bin/env node
// Interactive setup for a personalized Second Brain OS clone.
// Node >= 18, no dependencies. Safe to re-run (idempotent): re-prompts and
// overwrites only the USER.md sections and IDENTITY.md line this script owns.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout, exit } from 'node:process';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CWD = process.cwd();
const USER_MD = path.join(CWD, '_brain', 'USER.md');
const IDENTITY_MD = path.join(CWD, '_brain', 'IDENTITY.md');
const VAULT_MARKER = path.join(CWD, '_brain', '.vault-active');

function banner() {
  console.log('');
  console.log('  Second Brain OS — setup');
  console.log('  ------------------------');
  console.log('  Personalizes this clone: fills in _brain/USER.md (and');
  console.log('  _brain/IDENTITY.md if you pick a non-English language),');
  console.log('  enables git rerere, and makes one setup commit.');
  console.log('');
}

function isGitClone() {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: CWD,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

async function prompt(rl, question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer === '' ? (defaultValue || '') : answer;
}

// Node's readline/promises has a documented quirk with piped (non-TTY)
// stdin: when several lines are already buffered, only the line consumed by
// the FIRST `rl.question()` call is captured — later `'line'` events fire
// before the next question's listener attaches and are silently dropped.
// So for non-interactive stdin (tests, scripted runs) we read all of stdin
// eagerly up front and consume it line-by-line instead of calling
// `rl.question()` repeatedly. Interactive TTY sessions still use
// `rl.question()` as normal.
async function collectAnswers() {
  const questions = [
    ['Your name', undefined],
    ['Your role (one line)', undefined],
    ['Location / timezone (e.g. "UTC" or "City, Country (GMT+X)")', undefined],
    ['Preferred conversation language', 'English'],
    ['Communication style (one line)', 'concise'],
  ];

  let values;
  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      values = [];
      for (const [question, defaultValue] of questions) {
        values.push(await prompt(rl, question, defaultValue));
      }
    } finally {
      rl.close();
    }
  } else {
    let raw = '';
    try {
      raw = readFileSync(0, 'utf8');
    } catch {
      raw = '';
    }
    const lines = raw.split(/\r?\n/);
    let idx = 0;
    values = questions.map(([question, defaultValue]) => {
      const line = idx < lines.length ? lines[idx++].trim() : '';
      const value = line === '' ? (defaultValue || '') : line;
      const suffix = defaultValue ? ` [${defaultValue}]` : '';
      console.log(`${question}${suffix}: ${value}`);
      return value;
    });
  }

  const [name, role, location, language, style] = values;
  return { name, role, location, language, style };
}

// Replaces the body of a "## Header" section (up to the next "## " header
// or EOF) with newBody. If the header isn't found, appends header+body.
function replaceSection(content, header, newBody) {
  const headerLine = `## ${header}`;
  // The header-line group consumes ONLY the header's own line ending
  // ([ \t]*\r?\n) — not a greedy \s*, which would also swallow the blank
  // separator line and bleed into the next header's text before the lazy
  // body group and its lookahead ever get a chance to run. The lookahead's
  // end-of-input branch uses (?![\s\S]) rather than bare `$`: with the `m`
  // flag (needed for `^` to match each header line), `$` matches before
  // ANY `\n`, not just at the true end of the string — which made the lazy
  // body group stop at the very first blank line instead of scanning all
  // the way to the next real header, breaking idempotent re-runs.
  const re = new RegExp(`(^## ${header}[ \\t]*\\r?\\n)([\\s\\S]*?)(?=\\r?\\n## |(?![\\s\\S]))`, 'm');
  const replacement = `$1\n${newBody.trim()}\n`;
  if (re.test(content)) {
    return content.replace(re, replacement);
  }
  const sep = content.endsWith('\n') ? '' : '\n';
  return `${content}${sep}\n${headerLine}\n\n${newBody.trim()}\n`;
}

function writeUserMd(answers) {
  if (!existsSync(USER_MD)) {
    console.log(`  (skip) ${USER_MD} not found — is this a Second Brain OS clone?`);
    return false;
  }
  // Normalize CRLF -> LF before regex work: a Windows checkout of a
  // `text=auto` repo may have CRLF line endings, which break the LF-only
  // patterns below (and their `^`/`$`/`\n` boundaries). Written back as LF;
  // git's own attributes normalize it again on commit/checkout as needed.
  let content = readFileSync(USER_MD, 'utf8').replace(/\r\n/g, '\n');

  content = replaceSection(content, 'Name', `${answers.name}. Address as "${answers.name}".`);
  content = replaceSection(content, 'Role', answers.role);
  content = replaceSection(content, 'Location / Timezone', answers.location);

  const styleLines = [
    `- Converses in **${answers.language}**; vault content is always written in **English**.`,
    `- ${answers.style}`,
  ].join('\n');
  content = replaceSection(content, 'Communication style', styleLines);

  writeFileSync(USER_MD, content, 'utf8');
  return true;
}

// Swaps the language-example line in IDENTITY.md for a live instruction when
// a non-English language was chosen; restores the commented example when
// English is chosen (so re-running with a different answer stays correct).
function writeIdentityMd(answers) {
  if (!existsSync(IDENTITY_MD)) return false;
  // See the CRLF note in writeUserMd() above — same normalization needed here.
  let content = readFileSync(IDENTITY_MD, 'utf8').replace(/\r\n/g, '\n');

  const markerRe = /^(<!-- e\.g\.: Converse with me in.*-->|- \*\*Converse with me in.*\*\*)$/m;
  if (!markerRe.test(content)) return false;

  const isEnglish = answers.language.trim().toLowerCase() === 'english';
  const line = isEnglish
    ? '<!-- e.g.: Converse with me in <language>; vault content stays in English -->'
    : `- **Converse with me in ${answers.language}; vault content stays in English, always.**`;

  content = content.replace(markerRe, line);
  writeFileSync(IDENTITY_MD, content, 'utf8');
  return true;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: CWD,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

// The hooks refuse to touch a directory that has no activation marker, so
// this is the step that turns a clone into a live vault. Written last-ish,
// and never rewritten on a re-run — the file's date is a real record.
function writeVaultMarker() {
  if (existsSync(VAULT_MARKER)) return false;
  const body = [
    'This file marks this directory as a live Second Brain vault.',
    '',
    'The hooks in .claude/hooks/ do nothing without it: no pull, no',
    'checkpoint commit, no push, no Tier-0 context injection. That is what',
    'keeps the public template repo — and a clone that has not been set up',
    'yet — from committing and pushing itself.',
    '',
    'Commit it. It belongs to your vault, never to the template.',
    '',
    `Activated: ${new Date().toISOString().slice(0, 10)}`,
    '',
  ].join('\n');
  writeFileSync(VAULT_MARKER, body, 'utf8');
  return true;
}

function enableRerere() {
  try {
    run('git', ['config', 'rerere.enabled', 'true']);
    console.log('  git rerere enabled.');
  } catch (err) {
    console.log('  (warn) could not enable git rerere:', err.message.split('\n')[0]);
  }
}

function getOrigin() {
  try {
    return run('git', ['remote', 'get-url', 'origin']).trim();
  } catch {
    return null;
  }
}

// Best-effort: warn loudly if `gh` reports the origin repo as public. Skips
// silently if `gh` isn't installed, isn't authenticated, or errors out.
function warnIfPublic() {
  try {
    const visibility = run('gh', ['repo', 'view', '--json', 'visibility', '-q', '.visibility']).trim();
    if (visibility.toUpperCase() === 'PUBLIC') {
      console.log('');
      console.log('  ################################################################');
      console.log('  # WARNING: this repo\'s GitHub origin is PUBLIC.               #');
      console.log('  # Your personal brain should never be public. Make it private #');
      console.log('  # now: gh repo edit --visibility private                      #');
      console.log('  ################################################################');
      console.log('');
    }
  } catch {
    // gh absent, unauthenticated, or no such repo — skip silently.
  }
}

function commitAndPush(origin) {
  try {
    run('git', ['add', '-A']);
  } catch (err) {
    console.log('  (warn) git add failed:', err.message.split('\n')[0]);
    return;
  }

  let hasStaged = true;
  try {
    run('git', ['diff', '--cached', '--quiet']);
    hasStaged = false;
  } catch (err) {
    if (typeof err.status !== 'number' || err.status !== 1) {
      console.log('  (warn) git diff check failed:', err.message.split('\n')[0]);
      return;
    }
  }

  if (!hasStaged) {
    console.log('  Nothing changed — skipping commit.');
    return;
  }

  try {
    run('git', ['commit', '-m', 'setup: personalize brain']);
    console.log('  Committed: setup: personalize brain');
  } catch (err) {
    console.log('  (warn) git commit failed:', err.message.split('\n')[0]);
    return;
  }

  if (origin) {
    try {
      run('git', ['push']);
      console.log('  Pushed to origin.');
    } catch (err) {
      console.log('  (warn) push failed (commit is safe locally):', err.message.split('\n')[0]);
    }
  }
}

function nextSteps() {
  console.log('');
  console.log('  Done. Next steps:');
  console.log('    1. Open this folder as a vault in Obsidian (optional).');
  console.log('    2. In this folder, run: claude');
  console.log('    3. Say hello — Claude Code already knows who you are.');
  console.log('');
  console.log('  Re-run `node install.mjs` any time to update your answers.');
  console.log('');
}

async function main() {
  banner();

  if (!isGitClone()) {
    console.log('  This does not look like a git clone.');
    console.log('  Use this template on GitHub (choose Private), clone it, then run');
    console.log('  `node install.mjs` again from inside the clone.');
    console.log('');
    exit(0);
    return;
  }

  const answers = await collectAnswers();

  const wroteUser = writeUserMd(answers);
  if (wroteUser) console.log(`  Updated ${path.relative(CWD, USER_MD)}`);

  const wroteIdentity = writeIdentityMd(answers);
  if (wroteIdentity) console.log(`  Updated ${path.relative(CWD, IDENTITY_MD)}`);

  if (writeVaultMarker()) {
    console.log(`  Created ${path.relative(CWD, VAULT_MARKER)} — hooks are now live.`);
  }

  enableRerere();

  const origin = getOrigin();
  if (origin) warnIfPublic();

  commitAndPush(origin);
  nextSteps();
  exit(0);
}

main().catch((err) => {
  console.error('  install.mjs failed:', err && err.stack ? err.stack : String(err));
  exit(1);
});
