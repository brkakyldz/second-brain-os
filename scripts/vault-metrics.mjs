#!/usr/bin/env node
// vault-metrics.mjs — deterministic counts read straight out of the Signal
// Ledger and notes/. No probe packs, no LLM: this script
// counts and dates things and draws no conclusions from them. Prints a
// Markdown report to stdout; run it ad hoc or from the audit pass.
//
// Named flywheel-metrics.mjs until 2026-09-06, when the flywheel pass and the
// two sections that scored suggestions (prune candidates, proposal acceptance)
// were retired. What is left is instrumentation, not a verdict.
//
// Node stdlib only, no dependencies. Never crashes on a missing/short vault:
// every reader below degrades to an empty section rather than throwing.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS } from '../.claude/hooks/checks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same precedence as lib.mjs's getRepoRoot: BRAIN_DIR env → script's own
// location. scripts/ sits directly under the repo root, so one `..` gets
// there — this makes the script correct regardless of invocation cwd.
function getRepoRoot() {
  const fromBrainDir = process.env.BRAIN_DIR;
  if (fromBrainDir && fromBrainDir.trim() !== '') return fromBrainDir;
  return path.resolve(__dirname, '..');
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/vault-metrics.mjs [--help]',
      '',
      'Prints a Markdown report (to stdout) covering:',
      '  - check fires by month, per compiled lesson-check',
      '  - correction recurrence, grouped by class',
      '  - retrieval failures by cause (the ADR 0018 revisit trigger)',
      '  - lesson survival (notes with origin: lesson) and check survival',
      '',
      'Reads logs/signals/*.md and notes/*.md. Missing files/dirs simply',
      'produce empty sections — this never fails the run.',
    ].join('\n')
  );
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const REPO_ROOT = getRepoRoot();

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function daysBetween(fromDate, toDate = new Date()) {
  const ms = toDate.getTime() - fromDate.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function parseDateOnly(s) {
  // 'YYYY-MM-DD' → UTC midnight Date, or null if malformed.
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- 1. Read the Signal Ledger -----------------------------------------
// One event per matching line: { month, timestampDate, type, fields }.
// Any line that doesn't look like `- <ISO ts> | <type> | ...` is skipped —
// the ledger is hand-append-friendly Markdown, not a strict format.

function listSignalMonths(signalsDir) {
  if (!existsSync(signalsDir)) return [];
  let entries;
  try {
    entries = readdirSync(signalsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^\d{4}-\d{2}\.md$/.test(name))
    .map((name) => name.slice(0, 7)) // 'YYYY-MM'
    .sort();
}

const LINE_RE = /^-\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)\s*\|\s*([A-Za-z0-9_-]+)\s*\|\s*(.*)$/;

function parseLedgerFile(filePath, month) {
  const text = readFileSafe(filePath);
  if (text === null) return [];
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    const timestampDate = new Date(m[1]);
    if (Number.isNaN(timestampDate.getTime())) continue;
    const type = m[2];
    const fields = m[3].split('|').map((s) => s.trim()).filter((s) => s !== '');
    events.push({ month, timestampDate, type, fields });
  }
  return events;
}

const signalsDir = path.join(REPO_ROOT, 'logs', 'signals');
const months = listSignalMonths(signalsDir);
let allEvents = [];
for (const month of months) {
  allEvents = allEvents.concat(parseLedgerFile(path.join(signalsDir, `${month}.md`), month));
}

// --- Section 1: check fires ---------------------------------------------

function fieldValue(fields, prefix) {
  const f = fields.find((x) => x.startsWith(prefix));
  return f ? f.slice(prefix.length) : null;
}

const checkFireEvents = allEvents.filter((e) => e.type === 'check-fire');

// checkId -> month -> count
const fireCounts = new Map();
for (const check of CHECKS) fireCounts.set(check.id, new Map());
for (const e of checkFireEvents) {
  const checkId = fieldValue(e.fields, 'check:');
  if (!checkId || !fireCounts.has(checkId)) continue; // not one of the known checks
  const byMonth = fireCounts.get(checkId);
  byMonth.set(e.month, (byMonth.get(e.month) || 0) + 1);
}

function checkFiresSection() {
  const lines = ['## Check fires', ''];
  if (CHECKS.length === 0) {
    lines.push('No checks registered.', '');
    return lines;
  }
  const header = ['check', ...months, 'total'];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);
  for (const check of CHECKS) {
    const byMonth = fireCounts.get(check.id) || new Map();
    let total = 0;
    const cells = months.map((m) => {
      const c = byMonth.get(m) || 0;
      total += c;
      return String(c);
    });
    lines.push(`| ${[check.id, ...cells, String(total)].join(' | ')} |`);
  }
  lines.push('');
  return lines;
}

// Section 2 was "prune candidates": every check with zero fires in two cycles.
// Removed 2026-09-06 — a firing count cannot tell "nothing to catch" from
// "cannot catch", so deleting a check on silence deletes exactly the blind
// ones. A check is retired by reading it, not by counting it.

// --- Section 3: correction recurrence -----------------------------------

function correctionRecurrenceSection() {
  const lines = ['## Correction recurrence', ''];
  const correctionEvents = allEvents.filter((e) => e.type === 'correction');

  // class -> { count, first: Date, last: Date }
  const byClass = new Map();
  for (const e of correctionEvents) {
    const cls = fieldValue(e.fields, 'class:') || 'unclassified';
    if (!byClass.has(cls)) {
      byClass.set(cls, { count: 0, first: e.timestampDate, last: e.timestampDate });
    }
    const entry = byClass.get(cls);
    entry.count += 1;
    if (e.timestampDate < entry.first) entry.first = e.timestampDate;
    if (e.timestampDate > entry.last) entry.last = e.timestampDate;
  }

  if (byClass.size === 0) {
    lines.push('none', '');
    return lines;
  }

  const header = ['class', 'count', 'first seen', 'last seen', 'status'];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);

  const classes = [...byClass.keys()].sort((a, b) => {
    if (a === 'unclassified') return 1;
    if (b === 'unclassified') return -1;
    return a.localeCompare(b);
  });

  for (const cls of classes) {
    const entry = byClass.get(cls);
    let status = 'waiting';
    if (entry.count >= 2) {
      status = 'corroborated';
    } else if (entry.count === 1 && daysBetween(entry.first) > 90) {
      status = 'expire-candidate';
    }
    const firstSeen = entry.first.toISOString().slice(0, 10);
    const lastSeen = entry.last.toISOString().slice(0, 10);
    lines.push(`| ${[cls, entry.count, firstSeen, lastSeen, status].join(' | ')} |`);
  }
  lines.push('');
  return lines;
}

// Section 4 counted tool accesses per file, from the telemetry sidecar and its
// weekly rollups. Removed 2026-09-06 with the telemetry itself (ADR 0039): it
// measured that a file was opened, never that opening it helped, and the one
// question it was built for ("is this a write-only graveyard?") was answered
// in 2026-08. The
// `retrieval-rollup` lines already in the ledger stay as history.

// --- Section 4b: retrieval failures by cause (A3) ------------------------
// The open question is whether a repeating *query shape* defeats grep
// (ADR 0018). Only one cause
// answers it: `paraphrase-miss`. The rest argue for aliases, notes, or
// nothing at all — so an uncaused line is counted separately and loudly,
// because it is evidence that cannot be used.

const PARAPHRASE_THRESHOLD = 5;

function retrievalFailureSection() {
  const lines = ['## Retrieval failures by cause', ''];
  const failures = allEvents.filter((e) => e.type === 'retrieval-failure');

  if (failures.length === 0) {
    lines.push('none logged', '');
    return lines;
  }

  const byCause = new Map();
  for (const e of failures) {
    const cause = fieldValue(e.fields, 'cause:') || 'uncaused';
    if (!byCause.has(cause)) byCause.set(cause, { count: 0, last: e.timestampDate });
    const entry = byCause.get(cause);
    entry.count += 1;
    if (e.timestampDate > entry.last) entry.last = e.timestampDate;
  }

  const header = ['cause', 'count', 'last seen'];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '---').join('|')}|`);
  for (const cause of [...byCause.keys()].sort()) {
    const e = byCause.get(cause);
    lines.push(`| ${[cause, e.count, e.last.toISOString().slice(0, 10)].join(' | ')} |`);
  }
  lines.push('');

  const paraphrase = byCause.get('paraphrase-miss');
  if (paraphrase && paraphrase.count >= PARAPHRASE_THRESHOLD) {
    lines.push(
      `**${paraphrase.count} paraphrase-miss lines — the pre-agreed trigger to reopen ADR 0018** ` +
        '(lexical-only retrieval). Read the queries before deciding anything.',
      ''
    );
  }
  const uncaused = byCause.get('uncaused');
  if (uncaused) {
    lines.push(
      `${uncaused.count} retrieval-failure line(s) carry no \`cause:\` — unusable as evidence. ` +
        'See `/recall` for the four causes.',
      ''
    );
  }
  return lines;
}

// Section 5 was the proposal acceptance rate, which the constitution called the
// master metric. Removed 2026-09-06 with proposal production itself: with no
// pass emitting rows there is no rate, and a suggestion feature that is never
// suggested cannot be scored.

// --- Section 6: lesson survival -----------------------------------------

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

function lessonNotes(notesDir) {
  if (!existsSync(notesDir)) return [];
  let entries;
  try {
    entries = readdirSync(notesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const lessons = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue; // top-level only
    const text = readFileSafe(path.join(notesDir, entry.name));
    if (text === null) continue;
    const fm = parseFrontmatter(text);
    if (!fm || fm.origin !== 'lesson') continue;
    lessons.push({ file: entry.name, created: fm.created || null });
  }
  return lessons;
}

function lessonSurvivalSection() {
  const lines = ['## Lesson survival', ''];
  const lessons = lessonNotes(path.join(REPO_ROOT, 'notes'));

  if (lessons.length === 0) {
    lines.push('No lesson-origin notes found.');
  } else {
    for (const l of lessons) {
      const createdDate = parseDateOnly(l.created);
      if (!createdDate) {
        lines.push(`- ${l.file} — created unknown, age unknown, survived-30d: unknown`);
        continue;
      }
      const age = daysBetween(createdDate);
      lines.push(`- ${l.file} — created ${l.created}, age ${age}d, survived-30d: ${age >= 30 ? 'yes' : 'no'}`);
    }
  }
  lines.push('');

  lines.push('Checks:', '');
  if (CHECKS.length === 0) {
    lines.push('- none registered');
  } else {
    for (const check of CHECKS) {
      const addedDate = parseDateOnly(check.added);
      const age = addedDate ? daysBetween(addedDate) : null;
      lines.push(
        `- ${check.id} — added ${check.added}, age ${age === null ? 'unknown' : `${age}d`} (alive)`
      );
    }
  }
  lines.push('');
  return lines;
}

// --- Assemble -------------------------------------------------------------

// The `--rollup` mode folded the access buffer into one ledger line. It went
// with the buffer (ADR 0039).

const report = [
  '# Vault metrics',
  '',
  ...checkFiresSection(),
  ...correctionRecurrenceSection(),
  ...retrievalFailureSection(),
  ...lessonSurvivalSection(),
  'Generated by scripts/vault-metrics.mjs — deterministic, no LLM.',
];

console.log(report.join('\n'));
