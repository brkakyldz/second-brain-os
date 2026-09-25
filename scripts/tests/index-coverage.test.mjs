#!/usr/bin/env node
// Coverage for the INDEX.md catalog checks (ADR 0038).
//
// Two instruments answer the same question and are both tested here:
//   - the `index-coverage` check in .claude/hooks/checks.mjs, which sees the
//     changed files of the working tree only — fast, and blind to a note that
//     was already committed;
//   - the sweep in scripts/link-sweep.mjs, which compares every file in notes/
//     against the table and takes no view of git at all.
//
// The near-miss case matters: `lesson-2026-08-26-style` is a prefix of
// `lesson-2026-08-26-style-2`, so a bare substring test would call the second
// one catalogued when only the first has a row.
//
// Run: node scripts/tests/index-coverage.test.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS } from '../../.claude/hooks/checks.mjs';

// The script under test is this repo's own copy, found from this file's
// location — never from a machine path.
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
let failures = 0;
const check = (name, condition, detail) => {
  results.push({ name, ok: !!condition, detail });
  if (!condition) failures += 1;
};

const indexCoverage = CHECKS.find((c) => c.id === 'index-coverage');

const INDEX_TABLE = [
  '# Index',
  '',
  '| Page | What it is | Status |',
  '|---|---|---|',
  '| [[catalogued-note]] | a note with a row | active |',
  '| [[lesson-2026-08-26-style]] | the shorter name only | seedling |',
  '',
].join('\n');

const root = mkdtempSync(path.join(os.tmpdir(), 'brain-index-'));
const work = path.join(root, 'work');
mkdirSync(path.join(work, 'notes'), { recursive: true });
writeFileSync(path.join(work, 'INDEX.md'), INDEX_TABLE);

// --- the working-tree check ---------------------------------------------
{
  const findings = indexCoverage.run({
    repoRoot: work,
    changedFiles: [
      'notes/catalogued-note.md',
      'notes/uncatalogued-note.md',
      'notes/lesson-2026-08-26-style-2.md',
      'core/MEMORY.md',
      'logs/2026-09-06_0001.md',
    ],
  });
  const flagged = findings.map((f) => f.file).sort();

  check(
    'a note with no row is flagged',
    flagged.includes('notes/uncatalogued-note.md'),
    JSON.stringify(flagged)
  );
  check(
    'a note with a row is not flagged',
    !flagged.includes('notes/catalogued-note.md'),
    JSON.stringify(flagged)
  );
  check(
    'a name whose prefix is catalogued is still flagged',
    flagged.includes('notes/lesson-2026-08-26-style-2.md'),
    JSON.stringify(flagged)
  );
  check(
    'only notes/ is examined',
    !flagged.some((f) => f.startsWith('core/') || f.startsWith('logs/')),
    JSON.stringify(flagged)
  );
  check('every finding says why', findings.every((f) => f.detail === 'missing-from-index'));
}

// --- the sweep, which sees notes nobody is committing right now ----------
{
  const git = (cwd, args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 20000, windowsHide: true }).trim();

  mkdirSync(path.join(work, 'scripts'), { recursive: true });
  cpSync(path.join(SCRIPTS_DIR, 'link-sweep.mjs'), path.join(work, 'scripts', 'link-sweep.mjs'));
  writeFileSync(path.join(work, 'notes', 'catalogued-note.md'), '# Catalogued\n\n[[README]]\n');
  writeFileSync(path.join(work, 'notes', 'uncatalogued-note.md'), '# Uncatalogued\n\n[[README]]\n');
  writeFileSync(path.join(work, 'README.md'), '# readme\n');
  // Committed and clean: exactly the state the working-tree check cannot see.
  git(work, ['init', '-q']);
  git(work, ['config', 'user.email', 'test@example.invalid']);
  git(work, ['config', 'user.name', 'Index Test']);
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'everything committed']);

  execFileSync(process.execPath, [path.join(work, 'scripts', 'link-sweep.mjs')], {
    cwd: work,
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}_link-sweep.md`;
  const report = readFileSync(path.join(work, 'logs', name), 'utf8');

  check(
    'the sweep finds a gap in already-committed notes',
    /- `notes\/uncatalogued-note\.md`/.test(report),
    report.slice(report.indexOf('## Notes missing'), report.indexOf('## Notes missing') + 300)
  );
  check(
    'the sweep does not flag a catalogued note',
    !/- `notes\/catalogued-note\.md`/.test(report)
  );
  check('the sweep counts the gap in its summary', /missing from INDEX\.md: 1/.test(report));
}

try {
  rmSync(root, { recursive: true, force: true });
} catch {
  // a leaked temp dir is not worth failing a test run over
}

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` — ${r.detail}`}`);
}
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures === 0 ? 0 : 1);
