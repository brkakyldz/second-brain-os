#!/usr/bin/env node
// Compiled lesson-checks (ADR 0019 / ADR 0022). The TRACE move:
// a mechanically checkable rule lives here as code, not as prose the model
// may skip. Warn-first, never blocking, fail-open like everything else here.
//
// Until v1.1 these ran from the Stop checkpoint on every turn. That hook was
// retired with the whole-tree commit it guarded (ADR 0042, 0044), so nothing
// runs them automatically any more. They run when someone runs them — by
// hand, from a task before its own commit, or from a git pre-commit hook —
// through the command line at the bottom of this file:
//
//   node .claude/hooks/checks.mjs [--staged | --all] [--record] [--help]
//
// It prints every finding and exits 1 when there is one. It is read-only
// unless `--record` is given. Also importing this file:
// `scripts/tests/index-coverage.test.mjs`, and `scripts/vault-metrics.mjs`,
// which counts recorded fires. `scripts/link-sweep.mjs` carries a git-blind
// twin of the index-coverage check.
//
// Each check is individually deletable (ADR 0019: a check that
// false-positives twice gets deleted, back to prose). With `--record`, a fire
// is written once per (check, file, detail) per month to the Signal Ledger;
// repeat fires within the month are not written again, so a stuck violation
// cannot flood the ledger.
//
// The seed checks compile conventions already standing in AGENTS.md
// (ADR 0022): they are corroborated-by-adoption, not derived from lessons.
// The third seed check, `inbox-48h`, was deleted with `inbox/` itself on
// 2026-08-31 (ADR 0034) — a check enforcing a rule that no longer exists.
// A check born from a corroborated lesson is added by hand when the owner
// decides it should be — the /flywheel pass that used to propose them was
// retired with proposal production (ADR 0038).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendSignal,
  signalsPath,
  logLine,
  readFileSafe,
  summarizeError,
  getRepoRoot,
  thisDir,
} from './lib.mjs';

const ALLOWED_TYPES = new Set([
  'project', 'knowledge', 'memory', 'playbook', 'log', 'decision',
]);

// --- helpers ------------------------------------------------------------

function normalizeRel(p) {
  return p.replace(/\\/g, '/');
}

// Changed-but-not-deleted files from `git status --porcelain`. Working-tree
// status (not the index) is the honest "what did this session touch" list:
// checks run before anything is staged.
function getChangedFiles(repoRoot, logTag) {
  try {
    // -uall: without it, untracked directories collapse to one "?? dir/" line
    // and the files inside them are invisible to the checks.
    const out = execFileSync('git', ['status', '--porcelain', '-uall'], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    });
    const files = [];
    for (const line of out.split('\n')) {
      if (line.trim() === '') continue;
      const xy = line.slice(0, 2);
      if (xy.includes('D')) continue; // deleted — nothing to scan
      let p = line.slice(3).trim();
      const arrow = p.indexOf(' -> ');
      if (arrow !== -1) p = p.slice(arrow + 4); // rename: take the new path
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      files.push(normalizeRel(p));
    }
    return files;
  } catch (err) {
    logLine(repoRoot, logTag, `git status for checks failed: ${summarizeError(err)}`);
    return [];
  }
}

// Strip fenced code blocks and inline code so quoted examples never trip
// the wikilink check.
function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

// --- the checks ---------------------------------------------------------
// Contract: { id, added, source, scope, run(ctx) }, ctx being
// { repoRoot, changedFiles, sessionId, transcriptPath, ledgerText }. scope
// `changed` looks at the files it is handed — the working tree's changed
// files unless the caller chose another set — and `session` at the session
// as a whole (both are handed changedFiles).
// → findings [{ file, detail, message? }] where `detail` is a STABLE slug (it
// is the ledger dedup key — never put a timestamp, count, or free text in it)
// and `message` optionally replaces the default one-line warning.

const wikilinkShortForm = {
  id: 'wikilink-short-form',
  added: '2026-08-25',
  source: 'AGENTS.md § Note conventions (seed, ADR 0022)',
  scope: 'changed',
  run({ repoRoot, changedFiles }) {
    const findings = [];
    const scanRoots = ['notes/', 'core/'];
    for (const rel of changedFiles) {
      if (!rel.endsWith('.md')) continue;
      if (!scanRoots.some((r) => rel.startsWith(r))) continue;
      const text = readFileSafe(path.join(repoRoot, rel));
      if (text === null) continue;
      const clean = stripCode(text);
      const linkRe = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
      let m;
      while ((m = linkRe.exec(clean)) !== null) {
        if (m[1].includes('/')) {
          findings.push({ file: rel, detail: 'path-form-wikilink' });
          break; // one finding per file is enough
        }
      }
    }
    return findings;
  },
};

const noteConventions = {
  id: 'note-conventions',
  added: '2026-08-25',
  source: 'AGENTS.md § Note conventions (seed, ADR 0022)',
  scope: 'changed',
  run({ repoRoot, changedFiles }) {
    const findings = [];
    for (const rel of changedFiles) {
      if (!rel.startsWith('notes/') || !rel.endsWith('.md')) continue;
      if (rel.slice('notes/'.length).includes('/')) continue; // notes/ is flat; subdirs are another problem
      const base = path.basename(rel);
      if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(base)) {
        findings.push({ file: rel, detail: 'filename-not-kebab-case' });
      }
      const text = readFileSafe(path.join(repoRoot, rel));
      if (text === null) continue;
      const fm = parseFrontmatter(text);
      if (!fm) {
        findings.push({ file: rel, detail: 'missing-frontmatter' });
        continue;
      }
      if (!fm.type || !ALLOWED_TYPES.has(fm.type)) {
        findings.push({ file: rel, detail: 'frontmatter-type-invalid' });
      }
      if (!fm.created || !/^\d{4}-\d{2}-\d{2}$/.test(fm.created)) {
        findings.push({ file: rel, detail: 'frontmatter-created-invalid' });
      }
    }
    return findings;
  },
};

// The 'uncaptured-correction' check lived here, with the transcript readers it
// needed: it scanned the owner's own messages for correction phrases and, finding
// one, told the agent to run /lesson. Removed 2026-09-06 (ADR 0038) — it is
// a nag about a discipline, not a finding about the work, and
// it fired six times in four days without a single lesson resulting. /lesson
// stays exactly as it was: something the owner asks for.
//
// Its check-fire ledger lines stay in logs/signals/ as history.

// --- index-coverage -----------------------------------------------------

// A catalog nobody is forced to update is a catalog that silently rots, and
// the corroborated 2026-09-02 lesson is that the prose instruction to update
// it loses to the in-the-moment default while the work still looks finished.
// So: the instrument. A note that changed this session and is not linked from
// INDEX.md fires here (ADR 0035).
//
// Canary: a new `notes/zzz-canary.md` absent from INDEX.md must fire
// `missing-from-index`; the same note with a `[[zzz-canary]]` row added must
// not. Near-miss it must NOT fire on: a note whose name is a prefix of an
// indexed one (`lesson-2026-08-26-style` vs `lesson-2026-08-26-style-2`) —
// hence the explicit `]`/`|`/`#` terminator instead of a bare substring test.
const indexCoverage = {
  id: 'index-coverage',
  added: '2026-09-02',
  source: 'ADR 0035 (INDEX.md is the page catalog)',
  scope: 'changed',
  run({ repoRoot, changedFiles }) {
    const indexText = readFileSafe(path.join(repoRoot, 'INDEX.md'));
    if (indexText === null) return []; // no catalog — fail open (ADR 0004)
    const findings = [];
    for (const rel of changedFiles) {
      if (!rel.startsWith('notes/') || !rel.endsWith('.md')) continue;
      if (rel.slice('notes/'.length).includes('/')) continue; // notes/ is flat
      const name = path.basename(rel, '.md');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\[\\[${escaped}(?:[#|]|\\]\\])`).test(indexText)) {
        findings.push({ file: rel, detail: 'missing-from-index' });
      }
    }
    return findings;
  },
};

export const CHECKS = [
  wikilinkShortForm,
  noteConventions,
  indexCoverage,
];

// --- runner -------------------------------------------------------------

// Dedup key exactly as it appears in a ledger line's payload segment.
function fireKey(checkId, finding) {
  return `check:${checkId} | file:${finding.file} | ${finding.detail}`;
}

function readLedger(repoRoot) {
  try {
    const ledgerFile = signalsPath(repoRoot);
    return existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : '';
  } catch {
    return '';
  }
}

// Runs every check over `changedFiles` (default: the working tree's changed
// files) and returns every finding, recorded before or not, plus the checks
// that crashed. Writes nothing but a crash line in the automation log.
export function collectFindings(repoRoot, { changedFiles, sessionId, logTag, transcriptPath, ledgerText } = {}) {
  const findings = [];
  const errors = [];
  let files = Array.isArray(changedFiles) ? changedFiles.map(normalizeRel) : null; // lazily, once
  const ledger = ledgerText ?? readLedger(repoRoot);
  for (const check of CHECKS) {
    try {
      if ((check.scope === 'changed' || check.scope === 'session') && files === null) {
        files = getChangedFiles(repoRoot, logTag);
      }
      const found =
        check.run({
          repoRoot,
          changedFiles: files || [],
          sessionId,
          transcriptPath,
          ledgerText: ledger,
        }) || [];
      for (const f of found) findings.push({ check: check.id, ...f });
    } catch (err) {
      errors.push({ check: check.id, error: summarizeError(err) });
      logLine(repoRoot, logTag, `check ${check.id} crashed (skipped): ${summarizeError(err)}`);
    }
  }
  return { findings, errors };
}

// Runs every check; records NEW fires (not yet in this month's ledger) as
// `check-fire` signal lines and returns warning messages for them only.
// Never throws; a broken check is logged and skipped.
export function runChecks(repoRoot, { sessionId, logTag, transcriptPath, changedFiles } = {}) {
  const messages = [];
  const fired = [];
  let ledgerText = readLedger(repoRoot);
  const { findings } = collectFindings(repoRoot, { changedFiles, sessionId, logTag, transcriptPath, ledgerText });
  for (const f of findings) {
    const key = fireKey(f.check, f);
    if (ledgerText.includes(key)) continue; // already recorded this month
    const ok = appendSignal(repoRoot, {
      type: 'check-fire',
      payload: [`check:${f.check}`, `file:${f.file}`, f.detail],
      sessionId,
      logTag,
    });
    if (ok) {
      ledgerText += `${key}\n`; // dedup within this run too
      fired.push(f);
      messages.push({
        key,
        priority: 2,
        text: f.message || `⚠ check ${f.check}: ${f.file} — ${f.detail}`,
      });
      logLine(repoRoot, logTag, `check-fire ${f.check}: ${f.file} (${f.detail})`);
    }
  }
  return { messages, fired };
}

// --- command line -------------------------------------------------------
// A task runs this before its own commit, or a git pre-commit hook runs
// `--staged`. Exit 0: no findings. Exit 1: findings (or a crashed check).
// Exit 2: bad arguments or no git work tree. Only `--record` writes, and only
// check-fire lines to this month's logs/signals/ file — which is how
// `scripts/vault-metrics.mjs` gets fires to count.

const USAGE = `Usage: node .claude/hooks/checks.mjs [--staged | --all] [--record] [--help]

Runs the compiled checks and prints every finding. Read-only unless --record
is given. Checks: ${CHECKS.map((c) => c.id).join(', ')}.

  (default)  the files changed in the working tree, untracked ones included
  --staged   the files staged for the next commit (their working-tree copy is read)
  --all      every tracked and untracked, not ignored, file
  --record   also append new fires to logs/signals/YYYY-MM.md, once per
             check, file and finding per month, so vault-metrics can count them

Exit status: 0 no findings, 1 findings, 2 usage error.
`;

function gitList(repoRoot, args) {
  const out = execFileSync('git', args, {
    cwd: repoRoot,
    timeout: 20000,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean).map(normalizeRel);
}

function filesFor(repoRoot, mode, logTag) {
  if (mode === 'staged') return gitList(repoRoot, ['diff', '--cached', '--name-only', '--diff-filter=d', '-z']);
  if (mode === 'all') {
    const all = gitList(repoRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    return [...new Set(all)].filter((rel) => existsSync(path.join(repoRoot, rel)));
  }
  return getChangedFiles(repoRoot, logTag);
}

function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    const a = realpathSync.native(process.argv[1]);
    const b = realpathSync.native(fileURLToPath(import.meta.url));
    return process.platform === 'win32' || process.platform === 'darwin'
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;
  } catch {
    return false;
  }
}

function main(argv) {
  const known = new Set(['--staged', '--all', '--record', '--help', '-h']);
  const unknown = argv.filter((a) => !known.has(a));
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (unknown.length || (argv.includes('--staged') && argv.includes('--all'))) {
    process.stderr.write(`${unknown.length ? `Unknown argument: ${unknown.join(' ')}` : '--staged and --all exclude each other'}\n\n${USAGE}`);
    return 2;
  }
  const mode = argv.includes('--staged') ? 'staged' : argv.includes('--all') ? 'all' : 'working';
  const logTag = 'checks';
  const repoRoot = getRepoRoot(thisDir(import.meta.url));

  let files;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot, stdio: 'ignore', windowsHide: true });
    files = filesFor(repoRoot, mode, logTag);
  } catch (err) {
    process.stderr.write(`checks: ${repoRoot} is not a usable git work tree (${summarizeError(err)})\n`);
    return 2;
  }

  const { findings, errors } = collectFindings(repoRoot, { changedFiles: files, logTag });
  const label = { working: 'changed in the working tree', staged: 'staged', all: 'in the repository' }[mode];
  process.stdout.write(`checks: ${files.length} file(s) ${label}; ${findings.length} finding(s)\n`);
  for (const f of findings) process.stdout.write(`  ${f.check}  ${f.file} — ${f.detail}\n`);
  for (const e of errors) process.stderr.write(`  check ${e.check} crashed: ${e.error}\n`);

  if (argv.includes('--record') && findings.length) {
    const { fired } = runChecks(repoRoot, { changedFiles: files, logTag });
    process.stdout.write(`checks: recorded ${fired.length} new fire(s) in ${path.relative(repoRoot, signalsPath(repoRoot)).replace(/\\/g, '/')}\n`);
  }
  return findings.length || errors.length ? 1 : 0;
}

if (isMainModule()) process.exitCode = main(process.argv.slice(2));
