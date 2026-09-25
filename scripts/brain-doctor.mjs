#!/usr/bin/env node
// brain-doctor.mjs — read-only operational diagnosis for the brain path of
// both runtimes, Claude Code and Codex (ADR 0044). It composes existing
// evidence; it never repairs, stages, commits, writes a report, or updates a
// sidecar.
//
// The failure that demanded it, in the reference instance: after a runtime
// migration, Tier-0 delivery was configured but unverified, a retired
// whole-tree commit hook was still wired at user level, and the facts sat in
// separate audits with no one command that could tell "configured" from
// "observed". Kill criterion: if two runtime investigations in a row still have
// to open the underlying files because this table cannot localize the fault,
// remove it rather than grow it into a dashboard.

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { budgetUsage } from '../.claude/hooks/lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.BRAIN_DIR?.trim() || path.resolve(scriptDir, '..');
const strict = process.argv.includes('--strict');
const jsonMode = process.argv.includes('--json');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    'Usage: node scripts/brain-doctor.mjs [--json] [--strict] [--help]',
    '',
    'Read-only checks: Claude Code and Codex hook topology (exactly one',
    'SessionStart per runtime, no retired git-writing hook), the .claude/skills',
    'link, Tier-0 budgets, recent SessionStart evidence, recall resource paths,',
    'retrieval score, top-level entries against the folder map, and Git',
    'delivery state.',
    '--strict exits 1 when any check fails; warnings do not fail it.',
  ].join('\n'));
  process.exit(0);
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Missing is not broken: a machine that never wired global mode has no
// user-level file at all. Only a file that exists and does not parse is bad.
function readJson(file) {
  const text = readText(file);
  if (text === null) return { missing: true, data: null };
  try {
    return { missing: false, data: JSON.parse(text) };
  } catch {
    return { missing: false, data: null, invalid: true };
  }
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function add(results, area, status, detail) {
  results.push({ area, status, detail });
}

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
function norm(p) {
  const s = String(p).replaceAll('\\', '/').replace(/\/+$/, '');
  return caseInsensitive ? s.toLowerCase() : s;
}

function commandHooks(config, event) {
  const groups = config?.hooks?.[event];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []))
    .filter((hook) => hook?.type === 'command' && typeof hook.command === 'string');
}

function allCommandHooks(config) {
  return Object.keys(config?.hooks || {}).flatMap((event) =>
    commandHooks(config, event).map((hook) => ({ event, command: hook.command })));
}

const vaultNeedle = norm(repoRoot);
// v1.0 wired these; v1.1 deleted them. A user-level entry left behind runs a
// file that no longer exists — or, worse, an old copy that ran `git add -A`.
const RETIRED_HOOKS = /(checkpoint|session-end|flush|reuse-telemetry|maintenance-stamp)\.mjs/i;

const results = [];

// --- Claude Code: exactly one SessionStart, in project scope or global mode.
const claudeRoot = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
const claudeUserPath = path.join(claudeRoot, 'settings.json');
const claudeProjectPath = path.join(repoRoot, '.claude', 'settings.json');
const claudeUser = readJson(claudeUserPath);
const claudeProject = readJson(claudeProjectPath);
const isVaultClaudeStart = (cmd, scope) => {
  const c = norm(cmd);
  if (!c.includes('.claude/hooks/session-start.mjs')) return false;
  return scope === 'project' ? true : c.includes(vaultNeedle);
};
const claudeStarts = [
  ...commandHooks(claudeUser.data, 'SessionStart').filter((h) => isVaultClaudeStart(h.command, 'user')).map(() => 'global'),
  ...commandHooks(claudeProject.data, 'SessionStart').filter((h) => isVaultClaudeStart(h.command, 'project')).map(() => 'project'),
];
const claudeRetired = [
  ...allCommandHooks(claudeUser.data).filter((h) => RETIRED_HOOKS.test(h.command) && norm(h.command).includes(vaultNeedle)).map((h) => `user ${h.event}`),
  ...allCommandHooks(claudeProject.data).filter((h) => RETIRED_HOOKS.test(h.command)).map((h) => `project ${h.event}`),
];
if (claudeUser.invalid || claudeProject.invalid) {
  add(results, 'Claude hooks', 'FAIL', `unparseable settings: ${[claudeUser.invalid && claudeUserPath, claudeProject.invalid && claudeProjectPath].filter(Boolean).join(', ')}`);
} else if (claudeRetired.length > 0) {
  add(results, 'Claude hooks', 'FAIL', `retired v1.0 hook still wired (${claudeRetired.join(', ')}) — remove it; only SessionStart remains`);
} else if (claudeStarts.length > 1) {
  add(results, 'Claude hooks', 'FAIL', `${claudeStarts.length} vault SessionStart handlers (${claudeStarts.join(' + ')}) — it fires twice; keep one`);
} else if (claudeStarts.length === 0) {
  add(results, 'Claude hooks', 'WARN', 'no vault SessionStart wired for Claude Code (fine if you only use Codex)');
} else {
  add(results, 'Claude hooks', 'PASS', `exactly one vault SessionStart (${claudeStarts[0] === 'global' ? 'global mode' : 'project scope'}); no git-writing hook`);
}

// --- Codex: one user-level SessionStart through the adapter, no project copy.
const codexRoot = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
const codexUserPath = path.join(codexRoot, 'hooks.json');
const codexProjectPath = path.join(repoRoot, '.codex', 'hooks.json');
const codexUser = readJson(codexUserPath);
const codexProject = readJson(codexProjectPath);
const adapter = path.join(repoRoot, '.codex', 'hooks', 'session-start.mjs');
const adapterNeedle = norm(adapter);
const codexGlobalStarts = commandHooks(codexUser.data, 'SessionStart').filter((h) => norm(h.command).includes(adapterNeedle));
const codexProjectStarts = commandHooks(codexProject.data, 'SessionStart').filter((h) => norm(h.command).includes('session-start'));
const codexRetired = [
  ...allCommandHooks(codexUser.data).filter((h) => RETIRED_HOOKS.test(h.command) && norm(h.command).includes(vaultNeedle)).map((h) => `user ${h.event}`),
  ...allCommandHooks(codexProject.data).filter((h) => RETIRED_HOOKS.test(h.command)).map((h) => `project ${h.event}`),
];
if (codexUser.invalid || codexProject.invalid) {
  add(results, 'Codex hooks', 'FAIL', `unparseable hooks file: ${[codexUser.invalid && codexUserPath, codexProject.invalid && codexProjectPath].filter(Boolean).join(', ')}`);
} else if (!existsSync(adapter)) {
  add(results, 'Codex hooks', 'FAIL', `adapter missing: ${adapter}`);
} else if (codexRetired.length > 0) {
  add(results, 'Codex hooks', 'FAIL', `retired hook still wired (${codexRetired.join(', ')}) — remove it`);
} else if (codexGlobalStarts.length + codexProjectStarts.length > 1) {
  add(results, 'Codex hooks', 'FAIL', `${codexGlobalStarts.length} global and ${codexProjectStarts.length} project brain SessionStart handler(s) — Codex adds the layers, so it fires twice`);
} else if (codexGlobalStarts.length === 0 && codexProjectStarts.length === 0) {
  add(results, 'Codex hooks', 'WARN', codexUser.missing
    ? `no ${codexUserPath} (fine if you do not use Codex)`
    : 'no brain SessionStart wired for Codex (fine if you do not use Codex)');
} else {
  add(results, 'Codex hooks', 'PASS', 'exactly one brain SessionStart through the adapter');
}

// --- One skills copy: .claude/skills must be a link to .agents/skills.
const skillsTarget = path.join(repoRoot, '.agents', 'skills');
const skillsLink = path.join(repoRoot, '.claude', 'skills');
let linkStat = null;
try {
  linkStat = lstatSync(skillsLink);
} catch {
  linkStat = null;
}
if (!existsSync(skillsTarget)) {
  add(results, 'Skills link', 'FAIL', 'missing .agents/skills/ — the one skills copy');
} else if (!linkStat) {
  add(results, 'Skills link', 'FAIL', '.claude/skills missing — Claude Code sees no vault skills; run `node install.mjs --link-skills`');
} else if (!linkStat.isSymbolicLink()) {
  add(results, 'Skills link', 'FAIL', '.claude/skills is a real directory, not a link — a copy drifts; move it aside and run `node install.mjs --link-skills`');
} else {
  let real = null;
  try {
    real = realpathSync(skillsLink);
  } catch {
    real = null;
  }
  if (real && norm(real) === norm(realpathSync(skillsTarget))) {
    add(results, 'Skills link', 'PASS', '.claude/skills resolves to .agents/skills');
  } else {
    add(results, 'Skills link', 'FAIL', `.claude/skills points at ${real ?? 'nothing (broken link)'} — run \`node install.mjs --link-skills\``);
  }
}

// Tier-0 delivery can fail silently once the payload grows; budgets are the
// earliest deterministic signal available without starting a fresh session.
const budgets = budgetUsage(repoRoot);
const over = budgets.filter((row) => row.count > row.limit);
if (budgets.length === 0) {
  add(results, 'Tier-0 budgets', 'FAIL', 'no budgeted core files found');
} else if (over.length > 0) {
  add(results, 'Tier-0 budgets', 'FAIL', over.map((row) => `${row.file} ${row.count}/${row.limit}`).join(', '));
} else {
  add(results, 'Tier-0 budgets', 'PASS', budgets.map((row) => `${row.file} ${row.count}/${row.limit}`).join(', '));
}

function latestAutomationEvidence(logText) {
  if (!logText) return null;
  let latest = null;
  for (const line of logText.split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)\] SessionStart: context payload (\d+)B/);
    if (!match) continue;
    const at = new Date(match[1]);
    if (!Number.isNaN(at.getTime())) latest = { at, bytes: Number(match[2]) };
  }
  return latest;
}

const evidence = latestAutomationEvidence(readText(path.join(repoRoot, 'logs', '.automation.log')));
if (!evidence) {
  add(results, 'SessionStart evidence', 'FAIL', 'no recorded context payload — the hook has never run here (is core/.vault-active present?)');
} else {
  const ageDays = Math.floor((Date.now() - evidence.at.getTime()) / 86400000);
  add(
    results,
    'SessionStart evidence',
    ageDays > 7 ? 'WARN' : 'PASS',
    `${evidence.at.toISOString()} · ${evidence.bytes}B · ${ageDays}d old`
  );
}

const recallSkillPath = path.join(repoRoot, '.agents', 'skills', 'recall', 'SKILL.md');
const recallText = readText(recallSkillPath);
const recallResources = [
  path.join(repoRoot, '.claude', 'hooks', 'append-signal.mjs'),
  path.join(repoRoot, '.claude', 'eval', 'golden-set.md'),
];
if (!recallText) {
  add(results, 'Recall contract', 'FAIL', `missing ${recallSkillPath}`);
} else if (recallResources.some((file) => !existsSync(file))) {
  add(results, 'Recall contract', 'FAIL', 'the signal logger or the golden set is missing');
} else if (!recallText.includes('scripts/retrieval-eval.mjs --query')) {
  add(results, 'Recall contract', 'WARN', 'ranked lookup is not wired into the skill');
} else {
  add(results, 'Recall contract', 'PASS', 'logger, golden set, and ranked lookup resolve');
}

function parseRecallScores(text) {
  for (const line of text?.split(/\r?\n/) || []) {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 3 || !cells.every((cell) => /^\d+% \(\d+\/\d+\)$/.test(cell))) continue;
    return { at1: cells[0], at3: cells[1], at5: cells[2] };
  }
  return null;
}

const retrieval = run(process.execPath, [path.join(repoRoot, 'scripts', 'retrieval-eval.mjs')]);
const scores = retrieval.status === 0 ? parseRecallScores(retrieval.stdout) : null;
if (!scores) {
  const blocked = retrieval.error?.code === 'EPERM';
  add(results, 'Retrieval eval', blocked ? 'WARN' : 'FAIL', blocked ? 'subprocess blocked by current sandbox' : retrieval.stderr?.trim() || retrieval.error?.message || 'score output unavailable');
} else {
  add(results, 'Retrieval eval', 'PASS', `frequency-free · @1 ${scores.at1} · @3 ${scores.at3} · @5 ${scores.at5}`);
}

// The folder map in AGENTS.md is prose, and prose did not stop sessions in the
// reference instance from inventing new top-level folders for project output.
// This list mirrors that map; a new top-level entry must be argued into
// AGENTS.md first, then added here.
const ROOT_ALLOWED = new Set([
  // vault content, one folder per lifecycle
  'core', 'notes', 'logs', 'raw', 'archive',
  // root documents
  'AGENTS.md', 'CLAUDE.md', 'INDEX.md', 'PROPOSALS.md', 'README.md', 'SETUP.md',
  'LICENSE', 'install.mjs', 'docs',
  // machinery and tool state
  '.agents', '.claude', '.codex', 'scripts', '.obsidian', '.trash', '.git',
  '.gitattributes', '.gitignore', '.pre-commit-config.yaml',
  // OS clutter, already gitignored
  'desktop.ini', 'Thumbs.db', '.DS_Store',
]);
let rootEntries = null;
try {
  rootEntries = readdirSync(repoRoot);
} catch {
  add(results, 'Vault root', 'FAIL', `cannot list ${repoRoot}`);
}
if (rootEntries) {
  const stray = rootEntries.filter((name) => !ROOT_ALLOWED.has(name)).sort();
  add(
    results,
    'Vault root',
    stray.length ? 'WARN' : 'PASS',
    stray.length
      ? `not in the AGENTS.md folder map: ${stray.join(', ')} — project output belongs in its own repo`
      : 'only folder-map entries at the top level'
  );
}

const status = run('git', ['status', '--short']);
const ahead = run('git', ['rev-list', '--count', '@{upstream}..HEAD']);
if (status.status !== 0 || ahead.status !== 0) {
  const blocked = status.error?.code === 'EPERM' || ahead.error?.code === 'EPERM';
  add(results, 'Git delivery', blocked ? 'WARN' : 'FAIL', blocked ? 'git subprocess blocked by current sandbox' : 'cannot read worktree or upstream state (no upstream branch?)');
} else {
  const dirty = status.stdout.split(/\r?\n/).filter(Boolean).length;
  const aheadCount = Number.parseInt(ahead.stdout.trim(), 10) || 0;
  add(
    results,
    'Git delivery',
    dirty || aheadCount ? 'WARN' : 'PASS',
    `${dirty} dirty path(s), ${aheadCount} unpushed commit(s)`
  );
}

const summary = {
  pass: results.filter((row) => row.status === 'PASS').length,
  warn: results.filter((row) => row.status === 'WARN').length,
  fail: results.filter((row) => row.status === 'FAIL').length,
};

if (jsonMode) {
  console.log(JSON.stringify({ repoRoot, summary, results }, null, 2));
} else {
  console.log('# Brain doctor\n');
  console.log('| Area | Status | Detail |');
  console.log('|---|---|---|');
  for (const row of results) {
    console.log(`| ${row.area} | **${row.status}** | ${row.detail.replaceAll('|', '\\|')} |`);
  }
  console.log(`\nSummary: ${summary.pass} pass, ${summary.warn} warning, ${summary.fail} failure.`);
  console.log('Read-only: no repair or write was attempted.');
}

if (strict && summary.fail > 0) process.exitCode = 1;
