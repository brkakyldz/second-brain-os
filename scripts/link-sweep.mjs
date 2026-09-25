#!/usr/bin/env node
// link-sweep.mjs — B2: broken-wikilink / orphan-note / dangling-pointer
// sweep, run by hand or from a /curator session. Node stdlib only, no
// dependencies.
//
// Scans every vault-content .md file (excluding runtime/config/resource trees)
// for:
//   1. Broken [[wikilinks]] — target not found by filename or alias.
//   2. Orphan notes — no inbound AND no outbound resolved wikilinks, further
//      excluding logs/, archive/, raw/, core/, docs/, scripts/ and the repo
//      docs from being reported (episodic, evidence, always-loaded or
//      documentation — not part of the linked graph).
//   3. Dangling pointer lines in core/MEMORY.md (a "-> [[...]]" pointer
//      whose target does not exist).
//   4. Duplicate basenames — two files sharing a name anywhere in the tree.
//      Wikilinks resolve by basename, so a collision makes [[foo]] ambiguous
//      and it fails silently. `notes/` is flat, but `raw/`, `archive/` and
//      any folder you add can still collide with it.
//   5. Notes missing from INDEX.md — a git-blind twin of the index-coverage
//      check (ADR 0038).
//
// Writes a report to logs/YYYY-MM-DD_link-sweep.md and a one-line summary to
// stdout. `--help` prints the usage and writes nothing.
//
// Kill criterion: orphan count flat for a month (scripts/README.md).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: node scripts/link-sweep.mjs [--help]

Scans the vault for broken [[wikilinks]], orphan notes, dangling MEMORY.md
pointers, duplicate basenames and notes missing from INDEX.md. Writes the
report to logs/YYYY-MM-DD_link-sweep.md (re-running the same day overwrites
it) and prints a one-line summary. The vault is BRAIN_DIR if set, else the
folder above this script. Takes no other arguments.
`;
{
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (args.length) {
    process.stderr.write(`Unknown argument: ${args.join(' ')}\n\n${USAGE}`);
    process.exit(2);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same precedence as every other script: BRAIN_DIR env → the script's own
// location (scripts/ sits directly under the vault root).
const REPO_ROOT = process.env.BRAIN_DIR?.trim() || path.resolve(__dirname, '..');

// Directories not walked at all — not link sources, not link targets.
const EXCLUDE_FROM_SCAN = new Set([
  '.git',
  '.claude',
  '.codex',
  '.agents',
  '.obsidian',
]);

// Walked and indexed as link *targets*, but never scanned as link *sources*.
// `archive/` used to sit in EXCLUDE_FROM_SCAN, which conflated the two: an
// archived note stopped being a resolvable destination, so every link into it
// was reported broken. That is precisely the promise AGENTS.md makes and this
// sweep exists to verify — "a link never breaks because a thought grew up" —
// and it made B2's report almost entirely false positives (54 of 54 on
// 2026-08-27). Archived notes are still not scanned for broken links of their
// own: they are a record of what was believed then, not a live surface.
// `raw/` joins archive/ for the same reason from the other direction: a
// clipped article is a legitimate link *destination* (its note points back at
// it) but it is not vault prose, so scanning it for broken links would report
// on text the vault never wrote and must never edit (ADR 0035).
const TARGET_ONLY_DIRS = new Set(['archive', 'raw']);

// Additional directories excluded only from *orphan reporting* (still
// scanned and still part of the link graph — other notes may legitimately
// link into/out of them).
// `core/` is here because its files are Tier 0 — loaded into every session
// whether or not anything links to them. An always-loaded file reported as an
// unreachable one is a false positive by definition, and this report dies from
// false positives long before it dies from missed orphans.
// `docs/` and the root repo docs are documentation *about* the vault rather
// than pages in it; they are read from the repo, not reached by wikilink.
const EXCLUDE_FROM_ORPHAN_REPORT = ['logs', 'archive', 'raw', 'core', 'docs', 'scripts'];
const ORPHAN_EXEMPT_FILES = new Set(['README.md', 'SETUP.md', 'AGENTS.md', 'CLAUDE.md']);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

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
      if (EXCLUDE_FROM_SCAN.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

const allFiles = [];
walk(REPO_ROOT, allFiles);

// --- Minimal frontmatter parsing (flat YAML: scalars + simple lists) -------

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { frontmatter: {}, body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: content };
  const fmBlock = content.slice(3, end).trim();
  const bodyStart = content.indexOf('\n', end + 1);
  const body = bodyStart === -1 ? '' : content.slice(bodyStart + 1);

  const fm = {};
  let currentKey = null;
  for (const line of fmBlock.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s*(.+)$/);
    if (listItem && currentKey) {
      fm[currentKey] = fm[currentKey] || [];
      fm[currentKey].push(listItem[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === '') {
        fm[currentKey] = fm[currentKey] || [];
      } else if (val.startsWith('[') && val.endsWith(']')) {
        fm[currentKey] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else {
        fm[currentKey] = val.replace(/^["']|["']$/g, '');
      }
    }
  }
  return { frontmatter: fm, body };
}

// [[target]], [[target|alias text]], [[target#heading]] — capture target only.
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

// Strip fenced code blocks, inline code spans, and HTML comments before
// looking for wikilinks: this vault's own docs (AGENTS.md, OPEN_QUESTIONS.md,
// this repo's scripts/README.md, MEMORY.md's format comment) illustrate the
// `[[wikilink]]` syntax itself inside backticks/comments — those are prose
// examples, not real links, and would otherwise show up as false "broken
// wikilink" noise.
function stripNonContent(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function extractLinkTargets(text) {
  const targets = [];
  let m;
  const cleaned = stripNonContent(text);
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(cleaned)) !== null) {
    targets.push(m[1].trim());
  }
  return targets;
}

// --- Build resolution index -------------------------------------------------

const notes = [];
const byRelPathNoExt = new Map(); // lowercase rel path w/o .md -> relPath
const byBasename = new Map(); // lowercase basename w/o .md -> [relPath, ...]
const byAlias = new Map(); // lowercase alias -> [relPath, ...]

for (const full of allFiles) {
  const relPath = toPosix(path.relative(REPO_ROOT, full));
  let content;
  try {
    content = readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  const { frontmatter } = parseFrontmatter(content);
  const linkTargets = extractLinkTargets(content);
  // Target-only files are indexed below but contribute no links of their own.
  const topDir = relPath.split('/')[0];
  notes.push({
    relPath,
    frontmatter,
    linkTargets: TARGET_ONLY_DIRS.has(topDir) ? [] : linkTargets,
    targetOnly: TARGET_ONLY_DIRS.has(topDir),
  });

  const noExt = relPath.replace(/\.md$/i, '');
  byRelPathNoExt.set(noExt.toLowerCase(), relPath);

  const base = path.posix.basename(noExt).toLowerCase();
  if (!byBasename.has(base)) byBasename.set(base, []);
  byBasename.get(base).push(relPath);

  const aliases = frontmatter.aliases || frontmatter.alias;
  if (aliases) {
    const list = Array.isArray(aliases) ? aliases : [aliases];
    for (const a of list) {
      const key = String(a).toLowerCase();
      if (!byAlias.has(key)) byAlias.set(key, []);
      byAlias.get(key).push(relPath);
    }
  }
}

function resolveTarget(rawTarget) {
  let t = rawTarget.trim().replace(/\\/g, '/');
  t = t.replace(/\.md$/i, '');
  let tLower = t.toLowerCase();
  tLower = tLower.replace(/^\.?\//, '');

  if (byRelPathNoExt.has(tLower)) return [byRelPathNoExt.get(tLower)];

  const baseKey = path.posix.basename(tLower);
  if (byBasename.has(baseKey)) return byBasename.get(baseKey);

  if (byAlias.has(tLower)) return byAlias.get(tLower);

  return null;
}

// --- 1. Broken wikilinks -----------------------------------------------------

const brokenLinks = [];
for (const note of notes) {
  for (const target of note.linkTargets) {
    if (resolveTarget(target) === null) {
      brokenLinks.push({ source: note.relPath, target });
    }
  }
}

// --- 2. Orphan notes: build a resolved-link graph, then report --------------

const outboundResolved = new Map();
const inboundResolved = new Map();
for (const note of notes) outboundResolved.set(note.relPath, new Set());

for (const note of notes) {
  for (const target of note.linkTargets) {
    const resolved = resolveTarget(target);
    if (!resolved) continue;
    for (const r of resolved) {
      if (r === note.relPath) continue; // self-links don't count
      outboundResolved.get(note.relPath).add(r);
      if (!inboundResolved.has(r)) inboundResolved.set(r, new Set());
      inboundResolved.get(r).add(note.relPath);
    }
  }
}

function isExcludedFromOrphanReport(relPath) {
  if (ORPHAN_EXEMPT_FILES.has(relPath)) return true;
  return EXCLUDE_FROM_ORPHAN_REPORT.some(
    (prefix) => relPath === prefix || relPath.startsWith(prefix + '/')
  );
}

const orphans = [];
for (const note of notes) {
  if (isExcludedFromOrphanReport(note.relPath)) continue;
  const outCount = (outboundResolved.get(note.relPath) || new Set()).size;
  const inCount = (inboundResolved.get(note.relPath) || new Set()).size;
  if (outCount === 0 && inCount === 0) orphans.push(note.relPath);
}

// --- 3. Dangling pointers in core/MEMORY.md --------------------------------

const memoryPath = path.join(REPO_ROOT, 'core', 'MEMORY.md');
const danglingPointers = [];
if (existsSync(memoryPath)) {
  const memContent = readFileSync(memoryPath, 'utf8');
  // Strip the whole file first (its format comment at the top is multi-line
  // and spans several raw lines), then re-split so line lookup below still
  // reports the original line text for anything genuinely dangling.
  const strippedWhole = stripNonContent(memContent);
  const strippedLines = strippedWhole.split(/\r?\n/);
  const rawLines = memContent.split(/\r?\n/);
  for (let i = 0; i < strippedLines.length; i++) {
    WIKILINK_RE.lastIndex = 0;
    let m;
    while ((m = WIKILINK_RE.exec(strippedLines[i])) !== null) {
      const target = m[1].trim();
      if (resolveTarget(target) === null) {
        danglingPointers.push({ line: (rawLines[i] || strippedLines[i]).trim(), target });
      }
    }
  }
}

// --- 5. INDEX.md coverage ----------------------------------------------
// The `index-coverage` check in checks.mjs answers the same question, but only
// for the files changed in the working tree: a note that was already
// committed is never looked at again. In the reference instance a note sat
// uncatalogued for two days that way (found 2026-09-06). This sweep takes no
// view of git at all: it compares every file in notes/ against the table, so a
// gap of any age shows up.

const indexPath = path.join(REPO_ROOT, 'INDEX.md');
const uncatalogued = [];
if (existsSync(indexPath)) {
  const indexText = readFileSync(indexPath, 'utf8');
  for (const note of notes) {
    if (!note.relPath.startsWith('notes/')) continue;
    if (note.relPath.slice('notes/'.length).includes('/')) continue; // notes/ is flat
    const name = path.basename(note.relPath, '.md');
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The explicit terminator is what keeps `lesson-...-style` from matching
    // a row for `lesson-...-style-2`.
    if (!new RegExp(`\\[\\[${escaped}(?:[#|]|\\]\\])`).test(indexText)) {
      uncatalogued.push(note.relPath);
    }
  }
  uncatalogued.sort();
}

// --- Report -------------------------------------------------------------------

function fmtDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const today = fmtDate(new Date());
const lines = [];
lines.push(`# Link Sweep — ${today}`);
lines.push('');
lines.push(
  `Generated by \`scripts/link-sweep.mjs\` (B2). Scanned ${notes.length} vault-content markdown file(s); runtime/config/resource trees are excluded.`
);
lines.push('');
// --- 4. Duplicate basenames --------------------------------------------------
// [[wikilinks]] resolve by filename, so two files with the same basename make
// every link to that name ambiguous — and nothing errors, the link just picks
// one. Report them; the fix is always to rename one file.
// `README.md` is a folder convention, one per directory, and nobody writes
// `[[readme]]`. Reporting it every run would be a permanent false positive,
// and a section that is always noisy stops being read (AGENTS.md, notification
// budget).
const DUPLICATE_BASENAME_EXEMPT = new Set(['readme']);
const duplicateBasenames = [];
for (const [base, paths] of byBasename) {
  if (DUPLICATE_BASENAME_EXEMPT.has(base)) continue;
  if (paths.length > 1) duplicateBasenames.push({ base, paths: [...paths].sort() });
}
duplicateBasenames.sort((a, b) => a.base.localeCompare(b.base));

lines.push('## Summary');
lines.push('');
lines.push(`- Broken wikilinks: ${brokenLinks.length}`);
lines.push(`- Orphan notes: ${orphans.length}`);
lines.push(`- Dangling MEMORY.md pointers: ${danglingPointers.length}`);
lines.push(`- Duplicate basenames: ${duplicateBasenames.length}`);
lines.push(
  `- Notes missing from INDEX.md: ${existsSync(indexPath) ? uncatalogued.length : 'unknown (no INDEX.md)'}`
);
lines.push('');

lines.push('## Duplicate basenames');
lines.push('');
lines.push(
  '(Two files sharing a filename — `[[name]]` cannot resolve to both and fails silently. Rename one.)'
);
lines.push('');
if (duplicateBasenames.length === 0) {
  lines.push('None found.');
} else {
  for (const d of duplicateBasenames) {
    lines.push(`- \`[[${d.base}]]\` → ${d.paths.map((x) => `\`${x}\``).join(', ')}`);
  }
}
lines.push('');

lines.push('## Broken wikilinks');
lines.push('');
if (brokenLinks.length === 0) {
  lines.push('None found.');
} else {
  for (const b of brokenLinks) {
    lines.push(`- \`${b.source}\` → \`[[${b.target}]]\` (target not found)`);
  }
}
lines.push('');

lines.push('## Orphan notes');
lines.push('');
lines.push(
  '(no inbound and no outbound resolved wikilinks; excludes episodic, archived, source, always-loaded and documentation files)'
);
lines.push('');
if (orphans.length === 0) {
  lines.push('None found.');
} else {
  for (const o of orphans) {
    lines.push(`- \`${o}\``);
  }
}
lines.push('');

lines.push('## Dangling MEMORY.md pointers');
lines.push('');
if (danglingPointers.length === 0) {
  lines.push('None found.');
} else {
  for (const d of danglingPointers) {
    lines.push(`- \`${d.line}\` → target \`${d.target}\` not found`);
  }
}
lines.push('');

lines.push('## Notes missing from INDEX.md');
lines.push('');
lines.push(
  'A warning, not a gate: nothing blocks a commit over it. A note with no row here is a page the catalog cannot find, which is the whole cost.'
);
lines.push('');
if (!existsSync(indexPath)) {
  lines.push('No `INDEX.md` — coverage unknown, not zero.');
} else if (uncatalogued.length === 0) {
  lines.push('None — every note in `notes/` has a row.');
} else {
  for (const rel of uncatalogued) lines.push(`- \`${rel}\``);
}
lines.push('');

const logDir = path.join(REPO_ROOT, 'logs');
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const reportPath = path.join(logDir, `${today}_link-sweep.md`);
writeFileSync(reportPath, lines.join('\n'), 'utf8');

console.log(
  `link-sweep: scanned ${notes.length} file(s); ${brokenLinks.length} broken link(s), ${orphans.length} orphan(s), ${danglingPointers.length} dangling MEMORY.md pointer(s), ${duplicateBasenames.length} duplicate basename(s), ${uncatalogued.length} note(s) missing from INDEX.md.`
);
console.log(`link-sweep: report written to ${toPosix(path.relative(REPO_ROOT, reportPath))}`);

// The maintenance stamp that stood here went with the session-start due line
// on 2026-09-06: nothing reads "when did the link sweep last run" any more,
// and the dated report this run just wrote is the record either way.
