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
// It also covers the two command lines around them: `checks.mjs` run by hand
// (exit codes, --staged / --all, read-only unless --record) and link-sweep's
// BRAIN_DIR and --help. Every run happens in a throwaway repo under the
// system temp folder, with BRAIN_DIR removed from the child environment so a
// machine that sets it globally never points a test at a real vault.
//
// Run: node scripts/tests/index-coverage.test.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS } from '../../.claude/hooks/checks.mjs';

// The script under test is this repo's own copy, found from this file's
// location — never from a machine path.
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS_DIR = path.resolve(SCRIPTS_DIR, '..', '.claude', 'hooks');

const childEnv = { ...process.env };
delete childEnv.BRAIN_DIR;
const run = (cwd, script, args = [], env = childEnv) =>
  spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8', timeout: 60000, windowsHide: true });

const results = [];
let failures = 0;
const check = (name, condition, detail) => {
  results.push({ name, ok: !!condition, detail });
  if (!condition) failures += 1;
};

const indexCoverage = CHECKS.find((c) => c.id === 'index-coverage');

// link-sweep names its report by the local date.
function sweepReportName() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}_link-sweep.md`;
}

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
  git(work, ['config', 'core.autocrlf', 'false']); // no line-ending chatter from a global setting
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'everything committed']);

  const swept = run(work, path.join(work, 'scripts', 'link-sweep.mjs'));
  check('the sweep exits 0', swept.status === 0, swept.stderr);
  const report = readFileSync(path.join(work, 'logs', sweepReportName()), 'utf8');

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

// --- link-sweep: BRAIN_DIR and --help ------------------------------------
{
  const reportInWork = path.join(work, 'logs', sweepReportName());
  const reportInRepo = path.join(SCRIPTS_DIR, '..', 'logs', sweepReportName());
  const repoBefore = existsSync(reportInRepo) ? readFileSync(reportInRepo, 'utf8') : null;

  rmSync(reportInWork, { force: true });
  const help = run(os.tmpdir(), path.join(SCRIPTS_DIR, 'link-sweep.mjs'), ['--help'], { ...childEnv, BRAIN_DIR: work });
  check('link-sweep --help exits 0', help.status === 0, help.stderr);
  check('link-sweep --help writes no report', !existsSync(reportInWork));

  // This repo's own copy, pointed at the fixture from an unrelated cwd.
  const viaEnv = run(os.tmpdir(), path.join(SCRIPTS_DIR, 'link-sweep.mjs'), [], { ...childEnv, BRAIN_DIR: work });
  check('link-sweep honours BRAIN_DIR', viaEnv.status === 0 && existsSync(reportInWork), viaEnv.stderr || viaEnv.stdout);
  const repoAfter = existsSync(reportInRepo) ? readFileSync(reportInRepo, 'utf8') : null;
  check('link-sweep with BRAIN_DIR leaves its own repo alone', repoAfter === repoBefore);
}

// --- checks.mjs from the command line -------------------------------------
{
  const git = (args) =>
    execFileSync('git', args, { cwd: work, encoding: 'utf8', timeout: 20000, windowsHide: true }).trim();
  const hooks = path.join(work, '.claude', 'hooks');
  mkdirSync(hooks, { recursive: true });
  cpSync(path.join(HOOKS_DIR, 'checks.mjs'), path.join(hooks, 'checks.mjs'));
  cpSync(path.join(HOOKS_DIR, 'lib.mjs'), path.join(hooks, 'lib.mjs'));
  const cli = path.join(hooks, 'checks.mjs');
  const signalsDir = path.join(work, 'logs', 'signals');
  const MISSING = 'index-coverage  notes/uncatalogued-note.md — missing-from-index';

  const help = run(work, cli, ['--help']);
  check('checks --help exits 0 and prints the usage', help.status === 0 && /Usage:/.test(help.stdout), help.stderr);

  const bad = run(work, cli, ['--bogus']);
  check('checks rejects an unknown argument with exit 2', bad.status === 2, `status ${bad.status}`);

  // Every note is committed, so the working tree shows nothing to check.
  const working = run(work, cli);
  check('checks (working tree) is clean when the notes are committed', working.status === 0, working.stdout);

  const all = run(work, cli, ['--all']);
  check('checks --all exits 1 on a finding', all.status === 1, `status ${all.status}: ${all.stdout}${all.stderr}`);
  check('checks --all names the uncatalogued note', all.stdout.includes(MISSING), all.stdout);
  check(
    'checks --all does not flag the catalogued note for the index',
    !all.stdout.includes('index-coverage  notes/catalogued-note.md'),
    all.stdout
  );
  check('checks without --record writes no ledger', !existsSync(signalsDir));

  writeFileSync(path.join(work, 'notes', 'staged-note.md'), '---\ntype: knowledge\ncreated: 2026-01-01\n---\n# Staged\n');
  git(['add', '--', 'notes/staged-note.md']);
  const staged = run(work, cli, ['--staged']);
  check(
    'checks --staged sees only the staged note',
    staged.status === 1 &&
      staged.stdout.includes('index-coverage  notes/staged-note.md — missing-from-index') &&
      !staged.stdout.includes('uncatalogued-note'),
    staged.stdout
  );

  const recorded = run(work, cli, ['--all', '--record']);
  const ledgerFiles = existsSync(signalsDir) ? readdirSync(signalsDir).filter((f) => /^\d{4}-\d{2}\.md$/.test(f)) : [];
  const ledger = ledgerFiles.length ? readFileSync(path.join(signalsDir, ledgerFiles[0]), 'utf8') : '';
  const fireLine = 'check-fire | check:index-coverage | file:notes/uncatalogued-note.md | missing-from-index';
  check('checks --record appends the fire to the ledger', recorded.status === 1 && ledger.includes(fireLine), recorded.stdout + ledger);

  run(work, cli, ['--all', '--record']);
  const again = ledgerFiles.length ? readFileSync(path.join(signalsDir, ledgerFiles[0]), 'utf8') : '';
  check('checks --record does not record the same fire twice in a month', again.split(fireLine).length === 2);
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
