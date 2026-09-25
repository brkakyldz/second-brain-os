#!/usr/bin/env node
// Tests for scripts/project-doctor.mjs (ADR 0045).
//
// Every test builds its own fixture vault, repos and home folders under the
// system temp directory. The doctor and the git helper below both run with
// HOME / USERPROFILE / CLAUDE_CONFIG_DIR / CODEX_HOME pointed at a fixture
// home and the system git config switched off, so no assertion ever depends on
// the real home folder or the machine's git settings.
//
// Run: node scripts/tests/project-doctor.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const doctor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'project-doctor.mjs');

const fixtureHome = mkdtempSync(path.join(os.tmpdir(), 'project-doctor-home-'));
after(() => rmSync(fixtureHome, { recursive: true, force: true }));
const baseEnv = {
  ...process.env,
  HOME: fixtureHome,
  USERPROFILE: fixtureHome,
  CLAUDE_CONFIG_DIR: path.join(fixtureHome, '.claude'),
  CODEX_HOME: path.join(fixtureHome, '.codex'),
  GIT_CONFIG_NOSYSTEM: '1',
};
delete baseEnv.BRAIN_DIR;
delete baseEnv.BRAIN_KIT_DIR;

function command(exe, args, env = baseEnv) {
  const result = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, env });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function git(repo, ...args) {
  const result = command('git', ['--no-optional-locks', '-C', repo, ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function put(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
function scan(vault, ...args) {
  return scanWithEnv(vault, {}, ...args);
}
function scanWithEnv(vault, overrides, ...args) {
  const result = command(process.execPath, [doctor, '--json', ...args], { ...baseEnv, ...overrides, BRAIN_DIR: vault });
  assert.ok(result.stdout, result.stderr);
  return { code: result.status, data: JSON.parse(result.stdout) };
}
function init(repo) {
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Doctor Test');
  git(repo, 'config', 'user.email', 'doctor@example.invalid');
}
function card(vault, id, fields = {}) {
  put(path.join(vault, 'notes', `${id}.md`), `---\ntype: project\nstatus: ${fields.status || 'active'}\n${fields.repo === undefined ? '' : `repo: ${fields.repo.replaceAll('\\', '/')}\n`}${fields.extra || ''}---\n`);
}
function dirLink(target, link) {
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
function tmp(prefix, t) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('cards, git history, dirty memory, stale state, interrupted runs, worktrees and log IDs', (t) => {
  const root = tmp('project-doctor-', t);
  const vault = path.join(root, 'vault');
  const repo = path.join(root, 'project');
  const worktree = path.join(root, 'leftover');
  init(repo);
  put(path.join(repo, 'src', 'app.js'), 'first\n');
  git(repo, 'add', 'src/app.js');
  git(repo, 'commit', '-qm', 'base code');
  const base = git(repo, 'rev-parse', 'HEAD');
  put(path.join(repo, 'docs', 'CURRENT_STATE.md'), `---\nas_of: ${base}\nactive_run: docs/runs/missing.md\n---\n# State\n`);
  git(repo, 'add', 'docs/CURRENT_STATE.md');
  git(repo, 'commit', '-qm', 'state');
  put(path.join(repo, 'src', 'app.js'), 'second\n');
  git(repo, 'add', 'src/app.js');
  git(repo, 'commit', '-qm', 'new code');
  git(repo, 'worktree', 'add', '-q', '-b', 'leftover', worktree, 'HEAD');
  put(path.join(repo, 'docs', 'draft.md'), '# Untracked memory\n');
  put(path.join(repo, 'src', 'app.js'), 'dirty code\n');

  put(path.join(vault, 'notes', 'test-project.md'), `---\ntype: project\nproject_id: test-project\nrepo: ${repo.replaceAll('\\', '/')}\nstate_file: docs/CURRENT_STATE.md\nproject_aliases: [old-project]\nstatus: active\n---\n`);
  put(path.join(vault, 'notes', 'missing-project.md'), `---\ntype: project\nproject_id: missing-project\nrepo: ${path.join(root, 'absent').replaceAll('\\', '/')}\n---\n`);
  put(path.join(vault, 'logs', '2026-09-25_1200.md'), '---\nproject: unknown-new\n---\n');
  put(path.join(vault, 'logs', '2026-09-24_1200.md'), '---\nproject: unknown-old\n---\n');
  put(path.join(vault, 'logs', '2026-09-25_1201-slugged.md'), '---\nproject: old-project\n---\n');
  const { code, data } = scan(vault);
  assert.equal(code, 0);
  const item = data.projects.find((p) => p.id === 'test-project');
  const reasons = item.findings.map((f) => f.reason);
  assert.equal(item.state.measuredAgainst, 'HEAD');
  assert.ok(reasons.some((s) => s.includes('no off-machine copy')));
  assert.ok(reasons.some((s) => s.includes('docs/draft.md')));
  assert.ok(reasons.some((s) => s.includes('other dirty files: 1')));
  assert.ok(reasons.some((s) => s.includes('state is 1 code commits behind')));
  assert.ok(reasons.some((s) => s.includes('interrupted or still in progress')));
  assert.ok(reasons.some((s) => s.includes('leftover worktree')));
  assert.ok(data.projects.find((p) => p.id === 'missing-project').findings.some((f) => f.reason === 'repo path missing'));
  assert.ok(data.vault.some((f) => f.level === 'FLAG' && f.reason.includes('unknown-new')));
  assert.ok(data.vault.some((f) => f.reason.includes('1 legacy log project id')));
  assert.ok(!data.vault.some((f) => f.reason.includes('old-project')));
  assert.equal(scan(vault, '--strict').code, 1);
});

test('--since moves the legacy cutoff; a malformed date is refused', (t) => {
  const root = tmp('project-doctor-since-', t);
  put(path.join(root, 'logs', '2026-10-01_0900.md'), '---\nproject: no-card\n---\n');
  const flagged = (data) => data.vault.some((f) => f.level === 'FLAG' && f.reason.includes('no-card'));
  assert.equal(flagged(scan(root).data), true, 'after the default cutoff it is a FLAG');
  const later = scan(root, '--since', '2026-10-02').data;
  assert.equal(flagged(later), false);
  assert.ok(later.vault.some((f) => f.reason.includes('1 legacy log project id') && f.reason.includes('2026-10-02')));
  const bad = command(process.execPath, [doctor, '--since', '10/02/2026'], { ...baseEnv, BRAIN_DIR: root });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /YYYY-MM-DD/);
});

test('--repo checks a repo without a card', (t) => {
  const root = tmp('project-doctor-extra-', t);
  const repo = path.join(root, 'plain');
  mkdirSync(repo);
  const { data } = scan(root, '--repo', repo);
  assert.equal(data.summary.projects, 1);
  assert.ok(data.projects[0].findings.some((f) => f.reason.includes('project memory has no history')));
});

test('remote: none on the card is a warning, not a flag', (t) => {
  const root = tmp('project-doctor-remote-', t);
  const repo = path.join(root, 'repo');
  init(repo);
  put(path.join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', 'README.md'); git(repo, 'commit', '-qm', 'base');
  card(root, 'local-only', { repo, extra: 'remote: none\n' });
  const findings = scan(root).data.projects[0].findings;
  assert.ok(findings.some((f) => f.level === 'WARN' && f.reason.includes('card says none by design')));
  assert.ok(!findings.some((f) => f.reason.includes('no off-machine copy')));
});

test('untrusted as_of is informational and cannot write through git', (t) => {
  const root = tmp('project-doctor-option-', t);
  const repo = path.join(root, 'repo');
  init(repo);
  put(path.join(repo, 'docs', 'CURRENT_STATE.md'), '---\nas_of: --output=PWNED\nactive_run: none\n---\n# State\n');
  git(repo, 'add', 'docs/CURRENT_STATE.md');
  git(repo, 'commit', '-qm', 'state');
  card(root, 'repo', { repo });
  const result = scan(root);
  assert.ok(result.data.projects[0].findings.some((f) => f.reason.includes('invalid as_of')));
  assert.equal(existsSync(path.join(repo, 'PWNED..HEAD')), false);
  assert.equal(existsSync(path.join(repo, 'PWNED')), false);
});

test('freshness uses committed STATE edit, exact exemptions, Unicode paths, and STATE branch', (t) => {
  const root = tmp('project-doctor-fresh-', t);
  const repo = path.join(root, 'repo');
  init(repo);
  put(path.join(repo, 'src', 'app.js'), 'base\n');
  git(repo, 'add', 'src/app.js'); git(repo, 'commit', '-qm', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  put(path.join(repo, 'docs', 'CURRENT_STATE.md'), `---\r\nas_of: ${base}\r\nbranch: release\r\nactive_run: none\r\n---\r\n# State\r\n`);
  git(repo, 'add', 'docs/CURRENT_STATE.md'); git(repo, 'commit', '-qm', 'state');
  git(repo, 'branch', 'release');
  git(repo, 'checkout', '-q', 'release');
  put(path.join(repo, 'docs', 'runs', 'çalışma.md'), '---\nstatus: DONE\n---\n');
  git(repo, 'add', 'docs/runs/çalışma.md'); git(repo, 'commit', '-qm', 'run only');
  put(path.join(repo, 'docs', 'WORKLOG.md'), '# Worklog\n');
  git(repo, 'add', 'docs/WORKLOG.md'); git(repo, 'commit', '-qm', 'worklog only');
  put(path.join(repo, 'docs', 'CURRENT_STATE.md.bak'), 'backup\n');
  git(repo, 'add', 'docs/CURRENT_STATE.md.bak'); git(repo, 'commit', '-qm', 'backup');
  git(repo, 'checkout', '-q', 'main');
  card(root, 'repo', { repo });
  const item = scan(root).data.projects[0];
  assert.equal(item.state.measuredAgainst, 'release');
  assert.equal(item.state.as_of, base);
  assert.ok(item.findings.some((f) => f.reason.includes('state is 1 code commits behind (release)')));
});

test('uncommitted STATE warns; nested directories are not repos', (t) => {
  const root = tmp('project-doctor-nested-', t);
  const repo = path.join(root, 'repo');
  init(repo);
  put(path.join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', 'README.md'); git(repo, 'commit', '-qm', 'base');
  put(path.join(repo, 'docs', 'CURRENT_STATE.md'), '---\nas_of: abcd\n---\n# State\n');
  const nested = path.join(repo, 'nested');
  mkdirSync(nested);
  card(root, 'repo', { repo });
  card(root, 'nested', { repo: nested });
  const data = scan(root).data;
  assert.ok(data.projects.find((p) => p.id === 'repo').findings.some((f) => f.reason === 'STATE never committed'));
  assert.ok(data.projects.find((p) => p.id === 'nested').findings.some((f) => f.reason.includes('not a git repo (inside')));
});

test('CRLF focus, archived and repo-less cards, aliases in both list styles, and shared repos', (t) => {
  const root = tmp('project-doctor-cards-', t);
  const repo = path.join(root, 'repo');
  init(repo);
  put(path.join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', 'README.md'); git(repo, 'commit', '-qm', 'base');
  card(root, 'one', { repo });
  card(root, 'two', { repo, extra: 'project_aliases:\n  - block-alias\n' });
  card(root, 'paused', { status: 'paused' });
  put(path.join(root, 'archive', 'closed.md'), '---\ntype: project\nstatus: done\nproject_aliases: [old-closed]\nrepo: none\n---\n');
  put(path.join(root, 'core', 'USER.md'), '# User\r\n\r\n## Current focus\r\n- [[paused]] and [[closed]]\r\n\r\n## Other\r\n');
  put(path.join(root, 'logs', '2026-09-25_0100.md'), '---\nproject: old-closed\n---\n');
  put(path.join(root, 'logs', '2026-09-26_0100-block.md'), '---\nproject: block-alias\n---\n');
  const data = scan(root).data;
  assert.equal(data.summary.projects, 1);
  assert.deepEqual(data.projects[0].ids, ['one', 'two']);
  assert.ok(data.vault.some((f) => f.reason === 'Current focus links to paused project: paused'));
  assert.ok(data.vault.some((f) => f.reason === 'Current focus links to done project: closed'));
  assert.ok(!data.vault.some((f) => f.reason.includes('unresolved log')));
});

test('status examples and comments are skipped; ~/.agents skill drift is found', (t) => {
  const root = tmp('project-doctor-skills-', t);
  const vault = path.join(root, 'vault');
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  init(repo);
  put(path.join(repo, 'README.md'), '# Repo\n\n```yaml\nstatus: example\n```\n<!--\n```\nstatus: comment\n-->\nstatus: live\n');
  put(path.join(repo, 'docs', 'CURRENT_STATE.md.bak.md'), 'status: backup claim\n');
  put(path.join(repo, 'docs', 'meta.md'), '---\nstatus: accepted\n---\n# Metadata\n');
  git(repo, 'add', 'README.md', 'docs/CURRENT_STATE.md.bak.md', 'docs/meta.md'); git(repo, 'commit', '-qm', 'readme');
  card(vault, 'repo', { repo });
  put(path.join(vault, '.agents', 'skills', 'same', 'SKILL.md'), 'vault copy\n');
  put(path.join(home, '.agents', 'skills', 'same', 'SKILL.md'), 'home copy\n');
  const data = scanWithEnv(vault, { USERPROFILE: home, HOME: home }).data;
  const reasons = data.projects[0].findings.map((f) => f.reason);
  assert.ok(reasons.some((s) => s.includes('README.md:10')));
  assert.ok(reasons.some((s) => s.includes('docs/CURRENT_STATE.md.bak.md:1')));
  assert.ok(!reasons.some((s) => s.includes('README.md:4') || s.includes('README.md:8')));
  assert.ok(!reasons.some((s) => s.includes('docs/meta.md')));
  assert.ok(data.vault.some((f) => f.reason.includes('skill copy drift same')));
});

test('skill drift covers an optional kit and both runtime homes; user-level links are skipped', (t) => {
  const root = tmp('project-doctor-kit-', t);
  const vault = path.join(root, 'vault');
  const kit = path.join(root, 'kit');
  const claudeHome = path.join(root, 'claude-home');
  const codexHome = path.join(root, 'codex-home');
  put(path.join(vault, '.agents', 'skills', 'alpha', 'SKILL.md'), 'vault alpha\n');
  put(path.join(kit, 'skills', 'alpha', 'SKILL.md'), 'kit alpha\n');
  put(path.join(vault, '.agents', 'skills', 'beta', 'SKILL.md'), 'vault beta\n');
  put(path.join(codexHome, 'skills', 'beta', 'SKILL.md'), 'codex beta\n');
  put(path.join(vault, '.agents', 'skills', 'gamma', 'SKILL.md'), 'same gamma\n');
  put(path.join(claudeHome, 'skills', 'gamma', 'SKILL.md'), 'same gamma\n');
  put(path.join(vault, '.agents', 'skills', 'delta', 'SKILL.md'), 'vault delta\n');
  put(path.join(root, 'elsewhere', 'delta', 'SKILL.md'), 'linked delta\n');
  dirLink(path.join(root, 'elsewhere', 'delta'), path.join(claudeHome, 'skills', 'delta'));
  const homes = { CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: codexHome };
  const drift = (data, name) => data.vault.some((f) => f.reason.startsWith(`skill copy drift ${name}:`));

  const plain = scanWithEnv(vault, homes).data;
  assert.equal(drift(plain, 'alpha'), false, 'the kit is not scanned unless named');
  assert.equal(drift(plain, 'beta'), true, 'CODEX_HOME skills are scanned');
  assert.equal(drift(plain, 'gamma'), false, 'identical copies are not drift');
  assert.equal(drift(plain, 'delta'), false, 'a user-level link is skipped');

  assert.equal(drift(scanWithEnv(vault, homes, '--kit', kit).data, 'alpha'), true);
  assert.equal(drift(scanWithEnv(vault, { ...homes, BRAIN_KIT_DIR: path.join(kit, 'skills') }).data, 'alpha'), true);
  const missing = scanWithEnv(vault, homes, '--kit', path.join(root, 'no-such-kit')).data;
  assert.ok(missing.vault.some((f) => f.level === 'WARN' && f.reason.startsWith('skills kit not found')));
});

test('a worktree merged into master is leftover even when main exists', (t) => {
  const root = tmp('project-doctor-merged-', t);
  const repo = path.join(root, 'repo');
  const worktree = path.join(root, 'worktree');
  init(repo);
  put(path.join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', 'README.md'); git(repo, 'commit', '-qm', 'base');
  git(repo, 'worktree', 'add', '-q', '-b', 'side', worktree, 'HEAD');
  put(path.join(worktree, 'side.txt'), 'side\n');
  git(worktree, 'add', 'side.txt'); git(worktree, 'commit', '-qm', 'side');
  git(repo, 'branch', 'master', git(worktree, 'rev-parse', 'HEAD'));
  card(root, 'repo', { repo });
  assert.ok(scan(root).data.projects[0].findings.some((f) => f.reason.includes('leftover worktree')));
});
