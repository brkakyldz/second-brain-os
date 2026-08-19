#!/usr/bin/env node
// daily3-resurface.mjs — B6: daily-3 resurfacing. Node stdlib only.
//
// Picks 3 notes from knowledge/, _brain/memory/, and projects/ by weighted
// random selection:
//   weight = days-since-last_surfaced (or file mtime as fallback)
//          + link-sparsity bonus (higher for notes with fewer links)
//          + jitter
// excluding any candidate modified in the last 7 days. Appends a
// "## Resurfaced" section with the 3 picks (as wikilinks) to today's daily
// note (daily/YYYY-MM-DD.md, created from _brain/templates/daily.md if
// missing), then sets/updates `last_surfaced: YYYY-MM-DD` in each picked
// note's frontmatter without disturbing any other frontmatter key.
//
// --dry-run: computes and prints the picks (with weight breakdown) but
// writes nothing.
//
// Respects scripts/.brain.lock (same protocol as lock.ps1: "<PID> <ISO
// timestamp> <owner>", stale after 2h) since this script writes to the vault.
//
// Kill criterion (per the Phase B plan): resurfaced notes ignored for 2+ weeks.

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

const CANDIDATE_DIRS = ['knowledge', path.join('_brain', 'memory'), 'projects'];
const EXCLUDE_DIRS_FROM_INDEX = new Set(['.git', '.claude', '.obsidian', 'archive']);
const RECENT_DAYS_EXCLUDE = 7;
const SPARSITY_WEIGHT = 5;
const JITTER_MAX = 3;
const PICK_COUNT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// --- Shared lock (same protocol as scripts/lock.ps1) ------------------------

const LOCK_PATH = path.join(__dirname, '.brain.lock');
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

function isLockStale() {
  if (!existsSync(LOCK_PATH)) return true;
  try {
    const raw = readFileSync(LOCK_PATH, 'utf8').trim();
    if (!raw) return true;
    const parts = raw.split(/\s+/);
    if (parts.length < 2) return true;
    const pid = Number(parts[0]);
    const ts = Date.parse(parts[1]);
    if (!Number.isFinite(pid) || Number.isNaN(ts)) return true;
    if (Date.now() - ts >= LOCK_STALE_MS) return true;
    try {
      process.kill(pid, 0); // throws if pid doesn't exist (Windows: still works for liveness check)
      return false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

function enterLock(owner) {
  if (existsSync(LOCK_PATH) && !isLockStale()) return false;
  const line = `${process.pid} ${new Date().toISOString()} ${owner}`;
  try {
    writeFileSync(LOCK_PATH, line, 'utf8');
  } catch {
    return false;
  }
  return true;
}

function exitLock() {
  try {
    if (!existsSync(LOCK_PATH)) return;
    const raw = readFileSync(LOCK_PATH, 'utf8').trim();
    if (raw.startsWith(`${process.pid} `)) {
      unlinkSync(LOCK_PATH);
    }
  } catch {
    // best-effort; a stuck lock self-heals after 2h
  }
}

// --- Walk + minimal frontmatter/link parsing (self-contained, mirrors the
// same lightweight approach as scripts/link-sweep.mjs) ----------------------

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS_FROM_INDEX.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const fmBlock = content.slice(3, end).trim();
  const fm = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
function extractLinkTargets(text) {
  const targets = [];
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(text)) !== null) targets.push(m[1].trim());
  return targets;
}

const allFiles = [];
walk(REPO_ROOT, allFiles);

const fileRecords = [];
const byRelNoExt = new Map();
const byBasename = new Map();

for (const full of allFiles) {
  const relPath = toPosix(path.relative(REPO_ROOT, full));
  let content;
  try {
    content = readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  const frontmatter = parseFrontmatter(content);
  const mtime = statSync(full).mtime;
  const relNoExt = relPath.replace(/\.md$/i, '');
  const rec = { full, relPath, relNoExt, content, frontmatter, mtime };
  fileRecords.push(rec);
  byRelNoExt.set(relNoExt.toLowerCase(), rec);
  const base = path.posix.basename(relNoExt).toLowerCase();
  if (!byBasename.has(base)) byBasename.set(base, []);
  byBasename.get(base).push(rec);
}

function resolveTarget(rawTarget) {
  let t = rawTarget.trim().replace(/\\/g, '/').replace(/\.md$/i, '');
  const tLower = t.toLowerCase().replace(/^\.?\//, '');
  if (byRelNoExt.has(tLower)) return [byRelNoExt.get(tLower)];
  const baseKey = path.posix.basename(tLower);
  if (byBasename.has(baseKey)) return byBasename.get(baseKey);
  return [];
}

// link "count" per note = resolved outbound + resolved inbound (both sides
// incremented per edge so a link always affects the sparsity bonus of both
// endpoints, same as an undirected connectivity measure).
const linkCount = new Map();
for (const rec of fileRecords) linkCount.set(rec.relPath, 0);
for (const rec of fileRecords) {
  for (const target of extractLinkTargets(rec.content)) {
    for (const other of resolveTarget(target)) {
      if (other.relPath === rec.relPath) continue;
      linkCount.set(rec.relPath, (linkCount.get(rec.relPath) || 0) + 1);
      linkCount.set(other.relPath, (linkCount.get(other.relPath) || 0) + 1);
    }
  }
}

// --- Candidate pool -----------------------------------------------------

const now = Date.now();
const recentCutoff = now - RECENT_DAYS_EXCLUDE * DAY_MS;

const candidateFullPaths = new Set();
for (const dir of CANDIDATE_DIRS) {
  const files = [];
  walk(path.join(REPO_ROOT, dir), files);
  for (const f of files) candidateFullPaths.add(f);
}

const candidates = fileRecords.filter(
  (rec) => candidateFullPaths.has(rec.full) && rec.mtime.getTime() < recentCutoff
);

function daysSinceLastSurfaced(rec) {
  const val = rec.frontmatter.last_surfaced;
  if (val) {
    const parsed = new Date(`${val}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return Math.max(0, (now - parsed.getTime()) / DAY_MS);
    }
  }
  return Math.max(0, (now - rec.mtime.getTime()) / DAY_MS);
}

const weighted = candidates.map((rec) => {
  const age = daysSinceLastSurfaced(rec);
  const links = linkCount.get(rec.relPath) || 0;
  const sparsityBonus = SPARSITY_WEIGHT / (1 + links);
  const jitter = Math.random() * JITTER_MAX;
  const weight = age + sparsityBonus + jitter;
  return { rec, age, links, sparsityBonus, jitter, weight };
});

function weightedPickWithoutReplacement(items, n) {
  const pool = items.slice();
  const picks = [];
  while (pool.length > 0 && picks.length < n) {
    const total = pool.reduce((s, it) => s + Math.max(it.weight, 0.0001), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= Math.max(pool[idx].weight, 0.0001);
      if (r <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    picks.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picks;
}

const picks = weightedPickWithoutReplacement(weighted, PICK_COUNT);

function fmtDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const today = fmtDate(new Date());

if (picks.length === 0) {
  console.log(
    `daily3-resurface: no eligible candidates (pool of ${candidates.length}, ${fileRecords.length} vault files scanned) — everything under knowledge/, _brain/memory/, projects/ was modified in the last ${RECENT_DAYS_EXCLUDE} days, or those folders are empty.`
  );
  process.exit(0);
}

console.log(
  `daily3-resurface: candidate pool ${candidates.length} note(s) (of ${fileRecords.length} vault files scanned); picked ${picks.length}:`
);
for (const p of picks) {
  console.log(
    `  - ${p.rec.relPath}  weight=${p.weight.toFixed(2)} (age=${p.age.toFixed(1)}d, links=${p.links}, sparsity_bonus=${p.sparsityBonus.toFixed(2)}, jitter=${p.jitter.toFixed(2)})`
  );
}

if (DRY_RUN) {
  console.log('daily3-resurface: --dry-run — no files written, no lock taken.');
  process.exit(0);
}

if (!enterLock('daily3-resurface')) {
  console.log('daily3-resurface: another brain job holds scripts/.brain.lock — skipping this run.');
  process.exit(0);
}

try {
  // --- Write/update today's daily note -----------------------------------

  const dailyDir = path.join(REPO_ROOT, 'daily');
  if (!existsSync(dailyDir)) mkdirSync(dailyDir, { recursive: true });
  const dailyPath = path.join(dailyDir, `${today}.md`);

  let dailyContent;
  if (existsSync(dailyPath)) {
    dailyContent = readFileSync(dailyPath, 'utf8');
  } else {
    const templatePath = path.join(REPO_ROOT, '_brain', 'templates', 'daily.md');
    const template = existsSync(templatePath)
      ? readFileSync(templatePath, 'utf8')
      : '---\ntype: daily\ncreated: YYYY-MM-DD\ntags: []\nrelated: []\n---\n\n# YYYY-MM-DD\n\n## Notes\n\n## Tasks\n\n## Links\n';
    dailyContent = template.split('YYYY-MM-DD').join(today);
  }

  if (dailyContent.includes('## Resurfaced')) {
    console.log(
      `daily3-resurface: ${toPosix(path.relative(REPO_ROOT, dailyPath))} already has a "## Resurfaced" section — not appending a duplicate.`
    );
  } else {
    const linkLines = picks.map((p) => `- [[${p.rec.relNoExt}]]`).join('\n');
    const section = `\n## Resurfaced\n\n${linkLines}\n`;
    dailyContent = dailyContent.replace(/\s*$/, '\n') + section;
    writeFileSync(dailyPath, dailyContent, 'utf8');
    console.log(
      `daily3-resurface: appended Resurfaced section to ${toPosix(path.relative(REPO_ROOT, dailyPath))}`
    );
  }

  // --- Update last_surfaced frontmatter on each picked note ----------------

  function setLastSurfaced(fullPath, dateStr) {
    const content = readFileSync(fullPath, 'utf8');
    if (!content.startsWith('---')) return false;
    const end = content.indexOf('\n---', 3);
    if (end === -1) return false;
    const fmPart = content.slice(0, end); // includes leading '---', no trailing newline
    const rest = content.slice(end); // starts with '\n---...'
    const lines = fmPart.split(/\r?\n/);
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^last_surfaced:\s*/.test(lines[i])) {
        lines[i] = `last_surfaced: ${dateStr}`;
        found = true;
        break;
      }
    }
    if (!found) lines.push(`last_surfaced: ${dateStr}`);
    writeFileSync(fullPath, lines.join('\n') + rest, 'utf8');
    return true;
  }

  for (const p of picks) {
    const ok = setLastSurfaced(p.rec.full, today);
    console.log(
      `daily3-resurface: ${ok ? 'updated' : 'could not update (no frontmatter block found)'} last_surfaced on ${p.rec.relPath}`
    );
  }
} finally {
  exitLock();
}
