#!/usr/bin/env node
// project-doctor.mjs — read-only view of project memory across every repo a
// project card names (ADR 0045: execution state lives in the project repo,
// the vault keeps thin cards and short logs). It never repairs, stages,
// commits or writes anything, and every git call runs with
// --no-optional-locks so it never contends with a session committing in the
// same repo.
//
// Per repo (a `type: project` card in notes/ or archive/ with a `repo:`):
// git present, a remote present (`remote: none` on the card downgrades that to
// a warning), dirty or untracked project memory, unpushed commits,
// docs/CURRENT_STATE.md freshness, an interrupted `active_run`, leftover
// worktrees, and "status:" lines outside the state file. Vault-wide: log
// `project:` ids that resolve to no card, USER.md focus pointing at a paused or
// done card, and drifted copies of one skill across every skills folder that
// exists.
//
// The failure that demanded it, in the reference instance: a survey of its
// project repos found project memory untracked in several of them, one
// project that was never a git repo, one with no remote while an automation
// ran from its uncommitted code, and merged worktrees piling up — none of it
// visible from the vault. Kill criterion: if three consecutive runs report the
// same FLAGs and none gets fixed, the report is noise — cut it to the checks
// that did get acted on.
//
// Paths are derived, never hard-coded: the vault is this script's own
// location (or BRAIN_DIR, which the tests use for fixture vaults); the
// user-level skills folders follow CLAUDE_CONFIG_DIR / CODEX_HOME / the home
// directory; a separate skills kit is scanned only when named with --kit or
// BRAIN_KIT_DIR.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vault = process.env.BRAIN_DIR?.trim() || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const strict = args.includes('--strict');
const extraRepos = [];
const kits = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo' && args[i + 1]) extraRepos.push(args[++i]);
  else if (args[i] === '--kit' && args[i + 1]) kits.push(args[++i]);
}
if (process.env.BRAIN_KIT_DIR?.trim()) kits.push(process.env.BRAIN_KIT_DIR.trim());
if (args.includes('--help') || args.includes('-h')) {
  console.log([
    'Usage: node scripts/project-doctor.mjs [--repo PATH ...] [--kit DIR ...] [--json] [--strict]',
    '',
    'Read-only report over every repo a project card names (type: project + repo:).',
    '--repo PATH  also check a repo that has no card yet',
    '--kit DIR    also scan a separate skills kit for drifted copies (DIR/skills',
    '             if it exists, else DIR itself); BRAIN_KIT_DIR does the same',
    '--strict     exit 1 when any FLAG is reported; warnings do not fail it',
  ].join('\n'));
  process.exit(0);
}

// The date ADR 0045 came into force. A log older than this predates project
// cards, so an id that resolves to nothing is legacy, not a mistake.
const CONTRACT_DATE = '2026-09-25';
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

function read(file) {
  try { return readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
}
function list(dir) {
  try { return readdirSync(dir); } catch { return []; }
}
// Flat frontmatter: `key: value`, plus block lists (`key:` then `  - item`),
// the shape Obsidian's property editor writes.
function fm(text) {
  const match = text?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const fields = {};
  let last = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && last && (fields[last] === '' || Array.isArray(fields[last]))) {
      fields[last] = [...(Array.isArray(fields[last]) ? fields[last] : []), item[1].trim().replace(/^['"](.*)['"]$/, '$1')];
      continue;
    }
    const pair = line.match(/^([\w-]+):\s*(.*)$/);
    if (pair) {
      last = pair[1];
      fields[pair[1]] = pair[2].trim().replace(/^['"](.*)['"]$/, '$1');
    }
  }
  return fields;
}
function array(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value || value === '[]') return [];
  if (value.startsWith('[') && value.endsWith(']'))
    return value.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return [value];
}
function scalar(value) {
  return typeof value === 'string' ? value : '';
}
function git(repo, ...command) {
  const result = spawnSync('git', ['--no-optional-locks', '-C', repo, '-c', 'core.quotePath=false', ...command], {
    encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}
// Values read from a STATE file are data, never options: a sha must look like
// one, and every ref handed to git sits behind --end-of-options.
const SHA = /^[0-9a-f]{4,40}$/i;
function cleanSha(value) { return typeof value === 'string' && SHA.test(value.trim()) ? value.trim() : null; }
function add(target, level, reason) { target.push({ level, reason }); }
function key(file) {
  let p;
  try { p = realpathSync(file); } catch { p = path.resolve(file); }
  return caseInsensitive ? p.toLowerCase() : p;
}
function memoryPath(p) {
  const name = p.replaceAll('\\', '/');
  return /^(AGENTS\.md|CLAUDE\.md|README[^/]*|(?:docs|plans|reports|decisions)\/|\.agents\/skills\/)/i.test(name)
    || /(^|\/)ADR[^/]*$/i.test(name) || /(^|\/)[^/]*-plan[^/]*\.md$/i.test(name);
}
function statusPaths(repo) {
  const out = git(repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
  if (out === null) return null;
  const records = out.split('\0');
  const paths = [];
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    if (!row) continue;
    const xy = row.slice(0, 2);
    paths.push({ path: row.slice(3), untracked: xy === '??' });
    if (xy.includes('R') || xy.includes('C')) i++; // -z gives destination then source
  }
  return paths;
}
function branchHeads(repo) {
  return new Map((git(repo, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads') || '')
    .trim().split('\n').map((line) => line.match(/^(.+) ([0-9a-f]{40})$/i)).filter(Boolean)
    .map((match) => [match[1], match[2]]));
}

function project(card) {
  const findings = [];
  const repo = path.resolve(card.repo);
  const item = { id: card.ids.join(', '), ids: card.ids, repo, findings };
  if (!existsSync(repo)) { add(findings, 'FLAG', 'repo path missing'); return item; }
  const toplevel = git(repo, 'rev-parse', '--show-toplevel')?.trim();
  if (!toplevel) {
    add(findings, 'FLAG', 'project memory has no history (not a git repo)');
    return item;
  }
  if (key(toplevel) !== key(repo)) {
    add(findings, 'FLAG', `not a git repo (inside ${toplevel})`);
    return item;
  }
  const remotes = git(repo, 'remote');
  if (remotes === null) add(findings, 'WARN', 'cannot read remotes');
  // A card that says `remote: none` made that choice on purpose (data that
  // must stay local, say); it is still a single-copy risk, so it warns.
  else if (!remotes.trim()) {
    if (scalar(card.remote).trim().toLowerCase() === 'none') add(findings, 'WARN', 'no remote (card says none by design) - the only copy is this disk');
    else add(findings, 'FLAG', 'no off-machine copy (no remote)');
  }

  const dirty = statusPaths(repo);
  if (dirty === null) add(findings, 'WARN', 'cannot read working tree status');
  else {
    const memory = dirty.filter((p) => memoryPath(p.path));
    const other = dirty.length - memory.length;
    if (memory.length) add(findings, 'FLAG', `dirty project memory: ${memory.length} path(s) (${memory.filter((p) => p.untracked).length} untracked, ${memory.filter((p) => !p.untracked).length} tracked): ${memory.slice(0, 10).map((p) => p.path).join(', ')}`);
    if (other) add(findings, 'WARN', `other dirty files: ${other} (${dirty.filter((p) => p.untracked && !memoryPath(p.path)).length} untracked)`);
  }
  const upstream = git(repo, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '--end-of-options', '@{upstream}');
  if (upstream === null) add(findings, 'WARN', 'no upstream');
  else {
    const ahead = git(repo, 'rev-list', '--count', '--end-of-options', '@{upstream}..HEAD');
    if (ahead === null) add(findings, 'WARN', 'cannot count commits ahead of upstream');
    else if (Number(ahead.trim()) > 0) add(findings, 'WARN', `${ahead.trim()} commit(s) ahead of upstream`);
  }

  const stateFile = scalar(card.state_file);
  const named = stateFile && stateFile !== 'none' ? stateFile.replaceAll('\\', '/') : null;
  const fallback = 'docs/CURRENT_STATE.md';
  const state = named && existsSync(path.join(repo, named)) ? named
    : existsSync(path.join(repo, fallback)) ? fallback : null;
  if (named && !existsSync(path.join(repo, named))) add(findings, 'WARN', `state_file missing: ${named}`);
  if (!state) add(findings, 'WARN', 'no living state file');
  else {
    const content = read(path.join(repo, state));
    if (content !== null) {
      const fields = fm(content);
      const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
      if (body.replace(/\n$/, '').split('\n').length > 80) add(findings, 'WARN', 'STATE body exceeds 80 lines');
      const asOf = scalar(fields.as_of);
      if (!asOf) add(findings, 'WARN', 'STATE has no as_of commit');
      else if (!cleanSha(asOf)) add(findings, 'WARN', `STATE has invalid as_of: ${asOf}`);
      const localBranches = branchHeads(repo);
      const branch = scalar(fields.branch);
      const namedBranch = branch && localBranches.has(branch) ? branch : null;
      const head = cleanSha(git(repo, 'rev-parse', '--verify', '--end-of-options', 'HEAD')?.trim());
      const target = namedBranch ? localBranches.get(namedBranch) : head;
      item.state = { as_of: asOf || null, measuredAgainst: namedBranch || 'HEAD' };
      if (target) {
        // Fresh = no commit after the latest STATE commit touches anything
        // but STATE, the worklog and run reports. as_of is information only.
        const lastState = git(repo, 'log', '-1', '--format=%H', '--end-of-options', target, '--', 'docs/CURRENT_STATE.md')?.trim();
        if (!cleanSha(lastState)) add(findings, 'WARN', 'STATE never committed');
        else {
          const log = git(repo, 'log', '--format=COMMIT:%H', '--name-only', '--end-of-options', `${lastState}..${target}`);
          if (log === null) add(findings, 'WARN', 'cannot read commits after STATE');
          else {
            let stale = 0;
            let touchedCode = false;
            for (const line of log.split('\n')) {
              if (line.startsWith('COMMIT:')) { if (touchedCode) stale++; touchedCode = false; }
              else if (line && line !== 'docs/CURRENT_STATE.md' && line !== 'docs/WORKLOG.md' && !line.startsWith('docs/runs/')) touchedCode = true;
            }
            if (touchedCode) stale++;
            if (stale) add(findings, 'WARN', `state is ${stale} code commits behind (${item.state.measuredAgainst})`);
          }
        }
      } else add(findings, 'WARN', 'cannot resolve branch for STATE freshness');
      const activeRun = scalar(fields.active_run);
      if (activeRun && activeRun !== 'none') {
        const report = read(path.join(repo, activeRun));
        if (!report || !fm(report).status) add(findings, 'FLAG', `interrupted or still in progress: ${activeRun} missing or without status`);
      }
    }
  }

  const worktrees = git(repo, 'worktree', 'list', '--porcelain');
  if (worktrees !== null) {
    const base = key(repo);
    const heads = branchHeads(repo);
    const current = git(repo, 'symbolic-ref', '--quiet', '--short', 'HEAD')?.trim();
    const targets = [...new Set(['main', 'master', current].map((name) => heads.get(name)).filter(Boolean))];
    for (const block of worktrees.trim().split(/\r?\n\r?\n/)) {
      const wt = block.match(/^worktree (.+)$/m)?.[1];
      if (!wt || key(wt) === base) continue;
      const changes = statusPaths(wt);
      if (changes === null) add(findings, 'WARN', `cannot read worktree: ${wt}`);
      else if (changes.length) add(findings, 'WARN', `dirty worktree: ${wt} (${changes.length} path(s))`);
      else {
        const head = cleanSha(git(wt, 'rev-parse', '--verify', '--end-of-options', 'HEAD')?.trim());
        const merged = head && targets.some((target) => git(repo, 'merge-base', '--is-ancestor', '--end-of-options', head, target) !== null);
        if (merged) add(findings, 'WARN', `leftover worktree: ${wt} (clean and merged)`);
        else add(findings, 'WARN', `unmerged worktree: ${wt} (clean)`);
      }
    }
  }

  // Status belongs to STATE alone. A "status:" line anywhere else in tracked
  // Markdown is a second, staler copy — except frontmatter (ADR and run-report
  // metadata), fenced examples and HTML comments.
  const files = git(repo, 'ls-files', '-z', '--', '*.md');
  if (files !== null) {
    const claims = [];
    for (const file of files.split('\0').filter(Boolean)) {
      const rel = file.replaceAll('\\', '/');
      if (/^(docs\/(?:CURRENT_STATE\.md|WORKLOG\.md)$|docs\/(?:runs|decisions)\/|CHANGELOG)/i.test(rel)) continue;
      const source = read(path.join(repo, file));
      if (source === null) continue;
      let front = false;
      let fence = null;
      let comment = false;
      source.split('\n').forEach((raw, index) => {
        let line = raw;
        if (index === 0 && line === '---') { front = true; return; }
        if (front && line === '---') { front = false; return; }
        if (front) return;
        if (fence) {
          const closing = line.match(/^\s*(`{3,}|~{3,})/);
          if (closing && closing[1][0] === fence) fence = null;
          return;
        }
        if (comment) {
          const end = line.indexOf('-->');
          if (end < 0) return;
          line = line.slice(end + 3);
          comment = false;
        }
        while (line.includes('<!--')) {
          const start = line.indexOf('<!--');
          const end = line.indexOf('-->', start + 4);
          if (end < 0) { line = line.slice(0, start); comment = true; break; }
          line = line.slice(0, start) + line.slice(end + 3);
        }
        const marker = line.match(/^\s*(`{3,}|~{3,})/);
        if (marker) { fence = marker[1][0]; return; }
        if (/^\s*(\*\*)?status(\*\*)?\s*:/i.test(line)) claims.push(`${rel}:${index + 1}`);
      });
    }
    if (claims.length) add(findings, 'WARN', `docs claim status outside STATE: ${claims.slice(0, 5).join(', ')}`);
  }
  return item;
}

function markdownFiles(dir) {
  return list(dir).flatMap((name) => {
    const file = path.join(dir, name);
    try { return statSync(file).isDirectory() ? markdownFiles(file) : name.endsWith('.md') ? [file] : []; }
    catch { return []; }
  });
}
const cards = [...markdownFiles(path.join(vault, 'notes')), ...markdownFiles(path.join(vault, 'archive'))].flatMap((file) => {
  const fields = fm(read(file));
  return fields.type === 'project' ? [{ ...fields, project_id: path.basename(file, '.md'), project_aliases: array(fields.project_aliases) }] : [];
});
const cardIds = new Set(cards.flatMap((card) => [card.project_id, ...card.project_aliases]));
const index = new Map(cards.flatMap((card) => [card.project_id, ...card.project_aliases].map((id) => [id, card])));
const repos = new Map();
for (const card of cards.filter((card) => scalar(card.repo) && scalar(card.repo).toLowerCase() !== 'none')) {
  const id = key(card.repo);
  if (!repos.has(id)) repos.set(id, { repo: card.repo, ids: [], state_file: card.state_file, remote: card.remote });
  const group = repos.get(id);
  group.ids.push(card.project_id);
  if ((!scalar(group.state_file) || group.state_file === 'none') && scalar(card.state_file)) group.state_file = card.state_file;
}
for (const repo of extraRepos) {
  const id = key(repo);
  if (!repos.has(id)) repos.set(id, { repo, ids: [path.basename(path.resolve(repo))] });
}
const projects = [...repos.values()].map(project).sort((a, b) =>
  b.findings.filter((f) => f.level === 'FLAG').length - a.findings.filter((f) => f.level === 'FLAG').length
  || b.findings.length - a.findings.length || a.id.localeCompare(b.id));
const vaultFindings = [];
const legacy = new Set();
for (const name of list(path.join(vault, 'logs')).filter((n) => /^\d{4}-\d\d-\d\d.*\.md$/.test(n))) {
  const id = scalar(fm(read(path.join(vault, 'logs', name))).project);
  if (!id || cardIds.has(id)) continue;
  if (name.slice(0, 10) >= CONTRACT_DATE) add(vaultFindings, 'FLAG', `unresolved log project: ${name} (${id})`);
  else legacy.add(id);
}
if (legacy.size) add(vaultFindings, 'WARN', `${legacy.size} legacy log project id(s) do not resolve`);
const focus = (read(path.join(vault, 'core', 'USER.md')) || '').split(/^## /m)
  .find((section) => section.startsWith('Current focus\n'))?.split(/^<!--/m)[0] || '';
for (const match of focus.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)) {
  const card = index.get(match[1]);
  if (card && ['done', 'paused'].includes(card.status)) add(vaultFindings, 'WARN', `Current focus links to ${card.status} project: ${card.project_id}`);
}

// One skill, several copies: every skills folder that exists is scanned and
// copies of the same name are compared by content. A link is skipped in the
// user-level folders — it points at a copy that is already scanned where it
// really lives (a vault linked by `install.mjs --link-global-skills`, say).
const copies = new Map();
function collect(dir, onlyReal = false) {
  for (const name of list(dir)) {
    const child = path.join(dir, name);
    try {
      if (onlyReal && lstatSync(child).isSymbolicLink()) continue;
      if (!statSync(child).isDirectory()) continue;
      const file = path.join(child, 'SKILL.md');
      if (!existsSync(file)) continue;
      const real = key(file);
      const bucket = copies.get(name) || new Map();
      if (!bucket.has(real)) bucket.set(real, { file, hash: createHash('sha256').update(readFileSync(file)).digest('hex') });
      copies.set(name, bucket);
    } catch { /* unreadable skill: fail open */ }
  }
}
for (const kit of kits) {
  const dir = existsSync(path.join(kit, 'skills')) ? path.join(kit, 'skills') : kit;
  if (!existsSync(dir)) add(vaultFindings, 'WARN', `skills kit not found: ${kit}`);
  else collect(dir);
}
collect(path.join(vault, '.agents', 'skills'));
for (const card of repos.values()) collect(path.join(card.repo, '.agents', 'skills'));
const home = os.homedir();
collect(path.join(home, '.agents', 'skills'), true);
collect(path.join(process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, '.claude'), 'skills'), true);
collect(path.join(process.env.CODEX_HOME?.trim() || path.join(home, '.codex'), 'skills'), true);
for (const [name, bucket] of copies) {
  const unique = [...bucket.values()];
  if (new Set(unique.map((entry) => entry.hash)).size > 1)
    add(vaultFindings, 'FLAG', `skill copy drift ${name}: ${unique.map((entry) => entry.file).join(', ')}`);
}
const all = [...projects.flatMap((p) => p.findings), ...vaultFindings];
const summary = { projects: projects.length, flags: all.filter((f) => f.level === 'FLAG').length, warns: all.filter((f) => f.level === 'WARN').length };
if (json) console.log(JSON.stringify({ projects, vault: vaultFindings, summary }, null, 2));
else {
  console.log('# Project doctor');
  for (const item of projects) {
    console.log(`\n${item.id} (${item.repo})`);
    if (item.state) console.log(`  state as_of: ${item.state.as_of || 'missing'} (informational); freshness branch: ${item.state.measuredAgainst}`);
    for (const finding of item.findings) console.log(`  ${finding.level} ${finding.reason}`);
    if (!item.findings.length) console.log('  OK');
  }
  console.log('\nVault');
  for (const finding of vaultFindings) console.log(`  ${finding.level} ${finding.reason}`);
  if (!vaultFindings.length) console.log('  OK');
  console.log(`\nprojects:${summary.projects} flags:${summary.flags} warns:${summary.warns}`);
  console.log('Read-only: nothing was repaired, staged or committed.');
}
if (strict && summary.flags) process.exitCode = 1;
