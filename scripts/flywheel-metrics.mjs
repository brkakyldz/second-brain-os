#!/usr/bin/env node
// flywheel-metrics.mjs — deterministic metrics for the v3 flywheel's
// "measure" step (ADR 0019): same-mistake recurrence + 30-day rule survival,
// read straight out of the Signal Ledger and git. No probe packs, no LLM —
// this script only counts and dates things. Prints a Markdown report to
// stdout; run it ad hoc or from the monthly audit pass.
//
// Node stdlib only, no dependencies. Never crashes on a missing/short vault:
// every reader below degrades to an empty section rather than throwing.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS } from '../.claude/hooks/checks.mjs';
import { appendSignal, readAccessSidecar, resetAccessSidecar } from '../.claude/hooks/lib.mjs';

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
      'Usage: node scripts/flywheel-metrics.mjs [--rollup] [--help]',
      '',
      'Prints a Markdown report (to stdout) covering:',
      '  - check fires by month, per compiled lesson-check',
      '  - prune candidates (checks that never fire)',
      '  - correction recurrence, grouped by class',
      '  - note re-use (Q-14), from the telemetry sidecar + past rollups',
      '  - retrieval failures by cause (Q-12 evidence)',
      '  - proposal acceptance rate by feature (the master metric)',
      '  - lesson survival (notes with origin: lesson) and check survival',
      '',
      '--rollup  additionally folds the reuse sidecar into ONE durable',
      '          `retrieval-rollup` ledger line and empties the buffer.',
      '          Runs from the SessionEnd hook once the weekly window has',
      '          elapsed — never run it ad hoc, or the window boundaries',
      '          stop meaning anything.',
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

// --- Section 2: prune candidates ----------------------------------------
// Zero fires across the two most recent month files. Only reported when
// there's enough signal to trust a zero: either ≥2 month files exist, or the
// check has simply been around long enough (>60 days since `added`) that a
// single quiet month is already suspicious.

function pruneCandidatesSection() {
  const lines = ['## Prune candidates', ''];
  const recentMonths = months.slice(-2);
  const hasTwoMonths = months.length >= 2;
  const candidates = [];

  for (const check of CHECKS) {
    const byMonth = fireCounts.get(check.id) || new Map();
    const recentFires = recentMonths.reduce((sum, m) => sum + (byMonth.get(m) || 0), 0);
    if (recentFires !== 0) continue;

    const addedDate = parseDateOnly(check.added);
    const oldEnough = addedDate ? daysBetween(addedDate) > 60 : false;
    if (!hasTwoMonths && !oldEnough) continue; // not enough signal yet either way

    candidates.push(`${check.id} — 0 fires in 2 cycles (added ${check.added})`);
  }

  if (candidates.length === 0) {
    lines.push('none');
  } else {
    for (const c of candidates) lines.push(`- ${c}`);
  }
  lines.push('');
  return lines;
}

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

// --- Section 4: note re-use (Q-14) --------------------------------------
// Two sources, deliberately: the durable `retrieval-rollup` ledger lines
// (weekly, git-tracked, the record) and the live sidecar buffer (this week so
// far, machine-local, disposable). Reporting them separately keeps the
// distinction honest — the buffer is not evidence until it has been rolled up.

function parseTopField(v) {
  // 'note-a.md(3),note-b.md(2)' -> [['note-a.md', 3], ...]
  if (!v) return [];
  return v
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(/^(.*?)\((\d+)\)$/);
      return m ? [m[1], Number(m[2])] : [chunk, 0];
    });
}

function sidecarTotals() {
  const data = readAccessSidecar(REPO_ROOT);
  const entries = Object.entries(data.notes || {}).map(([file, e]) => [file, Number(e.count || 0)]);
  const reuses = entries.reduce((sum, [, c]) => sum + c, 0);
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { since: data.since, notes: entries.length, reuses, top: entries };
}

function noteReuseSection() {
  const lines = ['## Note re-use (Q-14)', ''];
  const rollups = allEvents.filter((e) => e.type === 'retrieval-rollup');

  if (rollups.length === 0) {
    lines.push('No `retrieval-rollup` lines yet — `--rollup` runs from the SessionEnd hook weekly, not ad hoc.', '');
  } else {
    // month -> { notes, reuses, top }
    const byMonth = new Map();
    for (const e of rollups) {
      if (!byMonth.has(e.month)) byMonth.set(e.month, { reuses: 0, notes: 0, top: new Map() });
      const entry = byMonth.get(e.month);
      entry.reuses += Number(fieldValue(e.fields, 'reuses:') || 0);
      entry.notes = Math.max(entry.notes, Number(fieldValue(e.fields, 'notes:') || 0));
      for (const [file, count] of parseTopField(fieldValue(e.fields, 'top:'))) {
        entry.top.set(file, (entry.top.get(file) || 0) + count);
      }
    }
    const header = ['month', 'distinct notes re-used', 'reuse events', 'most re-used'];
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`|${header.map(() => '---').join('|')}|`);
    for (const month of [...byMonth.keys()].sort()) {
      const entry = byMonth.get(month);
      const top = [...entry.top.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([f, c]) => `${f} (${c})`)
        .join(', ');
      lines.push(`| ${[month, entry.notes, entry.reuses, top || '—'].join(' | ')} |`);
    }
    lines.push('');
    const latestMonth = [...byMonth.keys()].sort().pop();
    if (byMonth.get(latestMonth).reuses === 0) {
      lines.push('**Zero re-use this month — the write-only-graveyard signal (Q-14).**', '');
    }
  }

  const buf = sidecarTotals();
  lines.push(
    `Unrolled buffer (not yet durable): ${buf.notes} note(s), ${buf.reuses} reuse event(s)` +
      `${buf.since ? `, window opened ${buf.since}` : ''}.`
  );
  if (buf.top.length > 0) {
    lines.push('', ...buf.top.slice(0, 5).map(([f, c]) => `- ${f} — ${c}`));
  }
  lines.push('');
  return lines;
}

// --- Section 4b: retrieval failures by cause (A3 / Q-12) ----------------
// Q-12 asks whether a repeating *query shape* defeats grep. Only one cause
// answers it: `paraphrase-miss`. The rest argue for aliases, notes, or
// nothing at all — so an uncaused line is counted separately and loudly,
// because it is evidence that cannot be used.

const PARAPHRASE_THRESHOLD = 5;

function retrievalFailureSection() {
  const lines = ['## Retrieval failures by cause (Q-12)', ''];
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

// --- Section 5: proposal acceptance rate (the master metric) -------------
// CLAUDE.md calls acceptance rate the master metric; until this section
// existed it was a logging convention nobody computed. A rate that is never
// computed can neither kill nor keep a suggestion feature.

const DECISION_WINDOW_DAYS = 30;

function passCommits(sinceDays) {
  // Proposal-emitting passes announce themselves in the commit subject
  // (`curator: …`, `flywheel: …`). Used only to detect the convention dying:
  // a pass that proposed and was never answered leaves no ledger trace at all.
  try {
    const out = execFileSync(
      'git',
      ['log', `--since=${sinceDays} days ago`, '--date=short', '--pretty=%ad %s'],
      { cwd: REPO_ROOT, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d{4}-\d{2}-\d{2}\s+(curator|flywheel):/.test(l));
  } catch {
    return []; // no git, no repo, no problem — this section degrades quietly
  }
}

function acceptanceSection() {
  const lines = ['## Proposal acceptance (master metric)', ''];
  const decisions = allEvents.filter((e) => e.type === 'acceptance' || e.type === 'rejection');

  if (decisions.length === 0) {
    lines.push('No `acceptance`/`rejection` lines logged yet.', '');
  } else {
    // feature -> tallies
    const byFeature = new Map();
    for (const e of decisions) {
      const feature = fieldValue(e.fields, 'feature:') || 'unattributed';
      if (!byFeature.has(feature)) {
        byFeature.set(feature, {
          accepted: 0,
          rejected: 0,
          recent: 0,
          recentAccepted: 0,
          last: e.timestampDate,
        });
      }
      const entry = byFeature.get(feature);
      const recent = daysBetween(e.timestampDate) <= DECISION_WINDOW_DAYS;
      if (e.type === 'acceptance') {
        entry.accepted += 1;
        if (recent) entry.recentAccepted += 1;
      } else {
        entry.rejected += 1;
      }
      if (recent) entry.recent += 1;
      if (e.timestampDate > entry.last) entry.last = e.timestampDate;
    }

    const header = [
      'feature',
      'accepted',
      'rejected',
      'rate',
      `last ${DECISION_WINDOW_DAYS}d`,
      'last decision',
    ];
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`|${header.map(() => '---').join('|')}|`);
    for (const feature of [...byFeature.keys()].sort()) {
      const e = byFeature.get(feature);
      const total = e.accepted + e.rejected;
      const rate = total === 0 ? '—' : `${Math.round((e.accepted / total) * 100)}%`;
      const recentRate =
        e.recent === 0 ? '—' : `${Math.round((e.recentAccepted / e.recent) * 100)}% of ${e.recent}`;
      lines.push(
        `| ${[feature, e.accepted, e.rejected, rate, recentRate, e.last.toISOString().slice(0, 10)].join(' | ')} |`
      );
    }
    lines.push('');
  }

  // The silent-death check: passes ran, nobody logged a decision.
  const passes = passCommits(DECISION_WINDOW_DAYS);
  const recentDecisions = decisions.filter(
    (e) => daysBetween(e.timestampDate) <= DECISION_WINDOW_DAYS
  );
  if (passes.length > 0 && recentDecisions.length === 0) {
    lines.push(
      `**Convention warning:** ${passes.length} proposing pass(es) in the last ` +
        `${DECISION_WINDOW_DAYS} days and zero acceptance/rejection lines — either the ` +
        'proposals went unreviewed (Q-13 backlog) or the logging step is being skipped.',
      ''
    );
  }
  return lines;
}

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

// --- Rollup mode (A1-R) --------------------------------------------------
// Folds the week's sidecar buffer into exactly one durable ledger line, then
// empties the buffer. Hundreds of reads become one tracked line — which is
// what keeps the reuse metric from turning the ledger into a read log.

function runRollup() {
  const buf = sidecarTotals();
  if (buf.reuses === 0) return '_rollup: buffer empty, no line written._';
  const top = buf.top
    .slice(0, 10)
    .map(([f, c]) => `${f.replace(/^notes[/]/, '')}(${c})`)
    .join(',');
  const ok = appendSignal(REPO_ROOT, {
    type: 'retrieval-rollup',
    payload: [
      `window:${buf.since || 'unknown'}..${new Date().toISOString().slice(0, 16)}Z`,
      `notes:${buf.notes}`,
      `reuses:${buf.reuses}`,
      `top:${top}`,
    ],
    logTag: 'FlywheelMetrics',
  });
  if (!ok) return '_rollup: ledger write failed — buffer kept for the next run._';
  resetAccessSidecar(REPO_ROOT, 'FlywheelMetrics');
  return `_rollup: wrote 1 retrieval-rollup line (${buf.notes} notes, ${buf.reuses} reuses) and cleared the buffer._`;
}

const rollupNote = process.argv.includes('--rollup') ? runRollup() : null;

const report = [
  '# Flywheel metrics',
  '',
  ...(rollupNote ? [rollupNote, ''] : []),
  ...checkFiresSection(),
  ...pruneCandidatesSection(),
  ...correctionRecurrenceSection(),
  ...noteReuseSection(),
  ...retrievalFailureSection(),
  ...acceptanceSection(),
  ...lessonSurvivalSection(),
  'Generated by scripts/flywheel-metrics.mjs — deterministic, no LLM.',
];

console.log(report.join('\n'));
