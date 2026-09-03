#!/usr/bin/env node
// proposals.mjs — the mechanical half of PROPOSALS.md (Tier B, B1).
//
// PROPOSALS.md is the vault's single approval surface: every proposing pass
// appends a checkbox row, the owner ticks or strikes it in Obsidian, and this
// script does the bookkeeping no human should have to do — allocate ids,
// turn decided rows into Signal Ledger `acceptance`/`rejection` lines (which
// is what makes the master metric non-voluntary), move them out to a dated
// log, and report the backlog.
//
// Modes:
//   (default)  sweep: decide → signal → archive → rewrite the backlog block
//   --add      append one row and print its allocated id
//   --status   print the backlog numbers only; writes nothing
//   --dry-run  compute and print, write nothing (works with sweep and --add)
//
//   node scripts/proposals.mjs --add --feature curator-merge \
//        --text "merge X into Y · evidence: logs/2026-08-25_1200.md"
//   node scripts/proposals.mjs --add --section review --feature resurface \
//        --text "[[note]] — still true?"
//
// IMPORTANT ordering: the sweep does NOT apply anything. The weekly pass
// reads the accepted rows, applies the safe ones itself, and only then runs
// the sweep — otherwise an accepted row is archived before it was acted on.
// Nothing is lost either way (decided rows land in logs/), but the work is.
//
// Node stdlib + the vault's own lib.mjs. Lock-guarded, fail-open, idempotent.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireBrainLock, releaseBrainLock, appendSignal } from '../.claude/hooks/lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT =
  process.env.BRAIN_DIR && process.env.BRAIN_DIR.trim() !== ''
    ? process.env.BRAIN_DIR
    : path.resolve(__dirname, '..');

const PROPOSALS_PATH = path.join(REPO_ROOT, 'PROPOSALS.md');
const LOGS_DIR = path.join(REPO_ROOT, 'logs');
const LOG_TAG = 'Proposals';
const OPEN_ROW_CAP = 20;
const BACKLOG_WARN_DAYS = 7;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : argv[i + 1] ?? null;
};

const IS_MAIN = (() => {
  try {
    return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (IS_MAIN && (has('--help') || has('-h'))) {
  console.log(
    [
      'Usage:',
      '  node scripts/proposals.mjs [--dry-run]           sweep decided rows',
      '  node scripts/proposals.mjs --status              backlog numbers only',
      '  node scripts/proposals.mjs --add --feature <slug> --text "<row text>"',
      '                              [--section open|review] [--dry-run]',
      '',
      'Marks: [ ] undecided, [x] accept, [-] reject (~~strikethrough~~ also rejects).',
    ].join('\n')
  );
  process.exit(0);
}

const DRY_RUN = has('--dry-run');

// --- Evidence log (Task Scheduler discards stdout) -------------------------

function logAutomation(message) {
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(
      path.join(LOGS_DIR, '.automation.log'),
      `[${new Date().toISOString()}] proposals: ${message}\n`,
      'utf8'
    );
  } catch {
    // logging must never break the run
  }
}

// --- Parsing ---------------------------------------------------------------

const SECTIONS = { open: '## Open', review: '## Review', backlog: '## Backlog' };

// `- [x] P-007 (curator-merge, 2026-08-25) — text`
// The parenthetical accepts trailing fields: the established way to mark a row
// applied is `(feature, 2026-08-25, applied 2026-08-27)`, and a regex that
// demanded exactly two made every such row invisible to the sweep — never
// archived, never turned into an `acceptance` signal. The master metric was
// silently under-counting: P-005, P-006 and P-011 were all accepted and none
// of them reached the ledger. Fixed 2026-08-27.
const ROW_RE =
  /^-\s+\[([ xX\-])\]\s+([A-Z]-\d{3})\s+\(([^,)]+),\s*(\d{4}-\d{2}-\d{2})(?:,\s*[^)]*)?\)\s*(?:—|--|-|:)\s*(.*)$/;

function parseRow(line) {
  const m = line.match(ROW_RE);
  if (!m) return null;
  const [, mark, id, feature, date, text] = m;
  const struck = /^~~.*~~/.test(text.trim());
  let decision = null;
  if (mark === 'x' || mark === 'X') decision = struck ? 'rejection' : 'acceptance';
  else if (mark === '-' || struck) decision = 'rejection';
  return { line, mark, id, feature: feature.trim(), date, text: text.trim(), decision };
}

function readProposals() {
  if (!existsSync(PROPOSALS_PATH)) return null;
  return readFileSync(PROPOSALS_PATH, 'utf8');
}

// Returns the raw lines plus each section's start index and body, so prose
// inside a section survives a rewrite untouched — only rows are ever removed.
function splitSections(content) {
  const lines = content.split(/\r?\n/);
  const idx = {};
  for (const [key, heading] of Object.entries(SECTIONS)) {
    idx[key] = lines.findIndex((l) => l.trim() === heading);
  }
  if (idx.open === -1) return null;
  const bounds = [idx.open, idx.review, idx.backlog].filter((i) => i !== -1).sort((a, b) => a - b);
  const endOf = (start) => {
    const next = bounds.find((b) => b > start);
    return next === undefined ? lines.length : next;
  };
  return {
    lines,
    openStart: idx.open,
    open: lines.slice(idx.open + 1, endOf(idx.open)),
    reviewStart: idx.review,
    review: idx.review === -1 ? null : lines.slice(idx.review + 1, endOf(idx.review)),
    backlogStart: idx.backlog,
    backlog: idx.backlog === -1 ? null : lines.slice(idx.backlog + 1, endOf(idx.backlog)),
  };
}

function daysSince(dateStr) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Ids are unique across the file AND every decided log, so an archived row's
// id is never handed out again — a ledger line has to keep pointing at one
// thing forever.
function nextId(prefix, content) {
  let max = 0;
  // Only ids in row position count — the format example in the file's own
  // prose is documentation, not an allocated id.
  const rowId = new RegExp(`^-\\s+(?:\\[[ xX\\-]\\]\\s+|\\*\\*(?:accepted|rejected)\\*\\*\\s+)(${prefix}-\\d{3})\\b`);
  const scan = (text) => {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(rowId);
      if (m) max = Math.max(max, Number(m[1].slice(prefix.length + 1)));
    }
  };
  scan(content);
  try {
    for (const f of readdirSync(LOGS_DIR)) {
      if (/_proposals\.md$/.test(f)) scan(readFileSync(path.join(LOGS_DIR, f), 'utf8'));
    }
  } catch {
    // no logs dir yet — the file scan is enough
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// --- --add -----------------------------------------------------------------

// Appends one row and returns { ok, id, reason }. Exported so other jobs
// (the resurfacer) append through the same allocator instead of formatting a
// row by hand — one writer of the format, one id space.
export function addProposalRow({ feature, text, section = 'open' }) {
  const f = String(feature || '').trim();
  const t = String(text || '').trim();
  const sec = String(section || 'open').toLowerCase();
  if (!f || !t || !['open', 'review'].includes(sec)) return { ok: false, reason: 'bad-arguments' };
  const content = readProposals();
  if (content === null) return { ok: false, reason: 'no-proposals-file' };
  if (!splitSections(content)) return { ok: false, reason: 'no-open-section' };

  const handle = acquireBrainLock(REPO_ROOT, 'proposals-add', LOG_TAG, { attempts: 3, delayMs: 200 });
  try {
    // Re-read under the lock: another proposer may have taken this id.
    const fresh = readFileSync(PROPOSALS_PATH, 'utf8');
    const parts = splitSections(fresh);
    const id = nextId(sec === 'review' ? 'R' : 'P', fresh);
    const row = `- [ ] ${id} (${f}, ${today()}) — ${t}`;
    const body = sec === 'review' ? parts.review : parts.open;
    if (body === null) return { ok: false, reason: 'no-section' };
    // Drop the "(none yet)" placeholder the moment a real row arrives.
    const cleaned = body.filter((l) => !/^_\(none( yet)?[^)]*\)_$/.test(l.trim()));
    let insertAt = cleaned.length;
    while (insertAt > 0 && cleaned[insertAt - 1].trim() === '') insertAt--;
    // A list has to start after a blank line, or Obsidian renders the first
    // row as part of the section's prose paragraph.
    const prev = insertAt > 0 ? cleaned[insertAt - 1] : '';
    const needsBlank = insertAt > 0 && prev.trim() !== '' && !ROW_RE.test(prev);
    cleaned.splice(insertAt, 0, ...(needsBlank ? ['', row] : [row]));
    const start = sec === 'review' ? parts.reviewStart : parts.openStart;
    const lines = parts.lines.slice();
    lines.splice(start + 1, body.length, ...cleaned);
    writeFileSync(PROPOSALS_PATH, lines.join('\n'), 'utf8');
    logAutomation(`added ${id} (${f}) to ${sec}`);
    return { ok: true, id };
  } finally {
    releaseBrainLock(REPO_ROOT, handle);
  }
}

// How many rows in a section are still unanswered — the resurfacer reads this
// to stop pushing questions nobody is answering.
export function openRowCount(section = 'review') {
  const content = readProposals();
  if (content === null) return 0;
  const parts = splitSections(content);
  if (!parts) return 0;
  const body = section === 'review' ? parts.review : parts.open;
  if (!body) return 0;
  return body.map(parseRow).filter((r) => r && !r.decision).length;
}

function addRowCli() {
  const feature = (val('--feature') || '').trim();
  const text = (val('--text') || '').trim();
  const section = (val('--section') || 'open').toLowerCase();
  if (!feature || !text || !['open', 'review'].includes(section)) {
    console.error('proposals --add: need --feature <slug> --text "<row text>" [--section open|review]');
    process.exit(1);
  }
  if (DRY_RUN) {
    const content = readProposals() || '';
    const id = nextId(section === 'review' ? 'R' : 'P', content);
    console.log(
      `proposals --add --dry-run: would append to ## ${section}:\n- [ ] ${id} (${feature}, ${today()}) — ${text}`
    );
    return;
  }
  const res = addProposalRow({ feature, text, section });
  if (!res.ok) {
    console.error(`proposals --add: ${res.reason}`);
    process.exit(1);
  }
  console.log(res.id);
}

// --- sweep -----------------------------------------------------------------

function backlogBlock(openRows, reviewRows) {
  const all = [...openRows, ...reviewRows];
  const oldest = all.reduce((m, r) => Math.max(m, daysSince(r.date)), 0);
  const lines = [
    '',
    '_(rewritten by each sweep — do not edit by hand.)_',
    '',
    `- open rows: ${openRows.length} · oldest: ${oldest}d · review rows: ${reviewRows.length}`,
  ];
  if (oldest > BACKLOG_WARN_DAYS) {
    lines.push(
      `- ⚠ backlog past ${BACKLOG_WARN_DAYS} days — Q-13's kill signal. Cut the cadence or the scope, don't nag.`
    );
  }
  if (openRows.length > OPEN_ROW_CAP) {
    lines.push(
      `- ⚠ ${openRows.length} open rows (cap ${OPEN_ROW_CAP}) — proposing passes consolidate before adding more.`
    );
  }
  lines.push('');
  return lines;
}

// The no-rows-decided path: refresh the Backlog block alone, leaving every row
// and every line of prose exactly where it was. Returns whether it wrote.
function refreshBacklogOnly(parts, pendingOpen, pendingReview) {
  if (parts.backlogStart === -1) return false;
  const next = backlogBlock(pendingOpen, pendingReview);
  const current = parts.backlog;
  if (current.length === next.length && current.every((l, i) => l === next[i])) return false;

  const handle = acquireBrainLock(REPO_ROOT, 'proposals-backlog', LOG_TAG, { attempts: 3, delayMs: 200 });
  try {
    const lines = parts.lines.slice();
    lines.splice(parts.backlogStart + 1, parts.backlog.length, ...next);
    writeFileSync(PROPOSALS_PATH, lines.join('\n'), 'utf8');
    logAutomation(`backlog refreshed: ${pendingOpen.length} open, 0 decided`);
    return true;
  } finally {
    releaseBrainLock(REPO_ROOT, handle);
  }
}

function sweep({ statusOnly = false } = {}) {
  const content = readProposals();
  if (content === null) {
    console.log('proposals: no PROPOSALS.md — nothing to sweep.');
    return;
  }
  const parts = splitSections(content);
  if (!parts) {
    console.log('proposals: PROPOSALS.md has no "## Open" section — nothing to sweep.');
    return;
  }

  const openRows = parts.open.map(parseRow).filter(Boolean);
  const reviewRows = (parts.review || []).map(parseRow).filter(Boolean);
  const decided = [...openRows, ...reviewRows].filter((r) => r.decision);
  const pendingOpen = openRows.filter((r) => !r.decision);
  const pendingReview = reviewRows.filter((r) => !r.decision);

  console.log(
    `proposals: ${openRows.length} open row(s), ${reviewRows.length} review row(s), ${decided.length} decided.`
  );
  for (const r of decided) {
    console.log(`  ${r.decision === 'acceptance' ? 'accept' : 'reject'}  ${r.id} (${r.feature}) — ${r.text}`);
  }
  for (const line of backlogBlock(pendingOpen, pendingReview)) if (line.trim()) console.log(`  ${line}`);

  if (statusOnly || DRY_RUN) {
    if (DRY_RUN) console.log('proposals: --dry-run — nothing written, no signals logged.');
    return;
  }
  if (decided.length === 0) {
    // The old early return skipped the backlog rewrite entirely on quiet days,
    // which broke the one number that had to stay honest: rows age whether or
    // not anyone answers them, and "backlog past 7 days" — the Q-13 kill
    // signal — is *by definition* the case where nobody decided anything, so
    // it was the reading that could never refresh itself (P-020). Recompute
    // and write only when the block actually differs, which keeps the diff
    // noise the early return was protecting at zero on a genuinely quiet day.
    refreshBacklogOnly(parts, pendingOpen, pendingReview);
    return;
  }

  const handle = acquireBrainLock(REPO_ROOT, 'proposals-sweep', LOG_TAG, { attempts: 3, delayMs: 200 });
  try {
    // 1. One ledger line per decided row — this is what makes acceptance
    //    logging mechanical instead of a convention nobody remembers.
    for (const r of decided) {
      const excerpt = r.text
        .replace(/[|\r\n]/g, ' ')
        .replace(/~~/g, '')
        .replace(/"/g, "'") // the field itself is quoted — don't nest quotes
        .slice(0, 80);
      appendSignal(REPO_ROOT, {
        type: r.decision,
        payload: [`feature:${r.feature}`, `ref:${r.id}`, `text:"${excerpt}"`],
        logTag: LOG_TAG,
      });
    }

    // 2. Archive the decided rows to a dated log (append-only evidence).
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    const logPath = path.join(LOGS_DIR, `${today()}_proposals.md`);
    const header =
      `---\ntype: log\ncreated: ${today()}\ntags: [proposals, acceptance]\nstatus: active\n---\n\n` +
      `# ${today()} — decided proposals\n\n` +
      'Rows swept out of `PROPOSALS.md`. One Signal Ledger line was written per row.\n';
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : header;
    const block = [
      '',
      `## Swept ${new Date().toISOString().slice(0, 16)}Z`,
      '',
      ...decided.map(
        (r) =>
          `- **${r.decision === 'acceptance' ? 'accepted' : 'rejected'}** ${r.id} (${r.feature}, raised ${r.date}) — ${r.text}`
      ),
      '',
    ].join('\n');
    writeFileSync(logPath, log.replace(/\s*$/, '\n') + block, 'utf8');

    // 3. Rewrite PROPOSALS.md: pending rows stay, prose stays, backlog is
    //    recomputed. Only this sweep is allowed to restructure the file.
    const keep = (body, rows) => {
      const decidedLines = new Set(rows.filter((r) => r.decision).map((r) => r.line));
      const out = body.filter((l) => !decidedLines.has(l));
      return out.some((l) => l.trim()) ? out : ['', '_(none yet.)_', ''];
    };
    const lines = parts.lines.slice();
    // Rewrite bottom-up so the earlier section indices stay valid.
    if (parts.backlogStart !== -1) {
      lines.splice(parts.backlogStart + 1, parts.backlog.length, ...backlogBlock(pendingOpen, pendingReview));
    }
    if (parts.reviewStart !== -1) {
      lines.splice(parts.reviewStart + 1, parts.review.length, ...keep(parts.review, reviewRows));
    }
    lines.splice(parts.openStart + 1, parts.open.length, ...keep(parts.open, openRows));
    writeFileSync(PROPOSALS_PATH, lines.join('\n'), 'utf8');

    logAutomation(
      `sweep: ${decided.length} decided (${decided.filter((r) => r.decision === 'acceptance').length} accepted), ${pendingOpen.length} open left`
    );
  } finally {
    releaseBrainLock(REPO_ROOT, handle);
  }
}

if (IS_MAIN) {
  try {
    if (has('--add')) addRowCli();
    else sweep({ statusOnly: has('--status') });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    logAutomation(`ERROR: ${msg}`);
    console.error(`proposals: error: ${msg}`);
    process.exitCode = 1;
  }
}
