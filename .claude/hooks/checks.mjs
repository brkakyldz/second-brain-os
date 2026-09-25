#!/usr/bin/env node
// Compiled lesson-checks (v3 Phase 3, ADR 0019 / ADR 0022). The TRACE move:
// a mechanically checkable rule lives here as code, not as prose the model
// may skip. Warn-first, never blocking, fail-open like everything else here.
//
// Until v1.1 these ran from the Stop checkpoint on every turn. That hook was
// retired with the whole-tree commit it guarded (ADR 0042, 0044), so nothing
// runs `runChecks` automatically any more: the checks are reusable code that
// a task may call before its own commit. What still reads them today is
// `scripts/tests/index-coverage.test.mjs`, `scripts/vault-metrics.mjs` (fire
// history), and `scripts/link-sweep.mjs`, which carries a git-blind twin of
// the index-coverage check.
//
// Each check is individually deletable (ADR 0019: a check that
// false-positives twice gets deleted, back to prose). A fire is recorded
// once per (check, file, detail) per month in the Signal Ledger; repeat
// fires within the month stay silent so a stuck violation cannot flood
// the ledger or the session banner.
//
// The seed checks compile conventions already standing in CLAUDE.md
// (ADR 0022): they are corroborated-by-adoption, not derived from lessons.
// The third seed check, `inbox-48h`, was deleted with `inbox/` itself on
// 2026-08-31 (ADR 0034) — a check enforcing a rule that no longer exists.
// A check born from a corroborated lesson is added by hand when the owner
// decides it should be — the /flywheel pass that used to propose them was
// retired with proposal production (ADR 0038).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendSignal, signalsPath, logLine, readFileSafe, summarizeError } from './lib.mjs';

const ALLOWED_TYPES = new Set([
  'project', 'knowledge', 'memory', 'playbook', 'log', 'decision',
]);

// --- helpers ------------------------------------------------------------

function normalizeRel(p) {
  return p.replace(/\\/g, '/');
}

// Changed-but-not-deleted files from `git status --porcelain`. Working-tree
// status (not the index) is the honest "what did this session touch" list:
// checks run before anything is staged.
function getChangedFiles(repoRoot, logTag) {
  try {
    // -uall: without it, untracked directories collapse to one "?? dir/" line
    // and the files inside them are invisible to the checks.
    const out = execFileSync('git', ['status', '--porcelain', '-uall'], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    });
    const files = [];
    for (const line of out.split('\n')) {
      if (line.trim() === '') continue;
      const xy = line.slice(0, 2);
      if (xy.includes('D')) continue; // deleted — nothing to scan
      let p = line.slice(3).trim();
      const arrow = p.indexOf(' -> ');
      if (arrow !== -1) p = p.slice(arrow + 4); // rename: take the new path
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      files.push(normalizeRel(p));
    }
    return files;
  } catch (err) {
    logLine(repoRoot, logTag, `git status for checks failed: ${summarizeError(err)}`);
    return [];
  }
}

// Strip fenced code blocks and inline code so quoted examples never trip
// the wikilink check.
function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

// --- the checks ---------------------------------------------------------
// Contract: { id, added, source, scope, run(ctx) }, ctx being
// { repoRoot, changedFiles, sessionId, transcriptPath, ledgerText }. scope
// `changed` looks at the working tree, `session` at the session as a whole
// (both are handed changedFiles).
// → findings [{ file, detail, message? }] where `detail` is a STABLE slug (it
// is the ledger dedup key — never put a timestamp, count, or free text in it)
// and `message` optionally replaces the default one-line warning.

const wikilinkShortForm = {
  id: 'wikilink-short-form',
  added: '2026-08-25',
  source: 'CLAUDE.md § Note conventions (seed, ADR 0022)',
  scope: 'changed',
  run({ repoRoot, changedFiles }) {
    const findings = [];
    const scanRoots = ['notes/', 'core/'];
    for (const rel of changedFiles) {
      if (!rel.endsWith('.md')) continue;
      if (!scanRoots.some((r) => rel.startsWith(r))) continue;
      const text = readFileSafe(path.join(repoRoot, rel));
      if (text === null) continue;
      const clean = stripCode(text);
      const linkRe = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
      let m;
      while ((m = linkRe.exec(clean)) !== null) {
        if (m[1].includes('/')) {
          findings.push({ file: rel, detail: 'path-form-wikilink' });
          break; // one finding per file is enough
        }
      }
    }
    return findings;
  },
};

const noteConventions = {
  id: 'note-conventions',
  added: '2026-08-25',
  source: 'CLAUDE.md § Note conventions (seed, ADR 0022)',
  scope: 'changed',
  run({ repoRoot, changedFiles }) {
    const findings = [];
    for (const rel of changedFiles) {
      if (!rel.startsWith('notes/') || !rel.endsWith('.md')) continue;
      if (rel.slice('notes/'.length).includes('/')) continue; // notes/ is flat; subdirs are another problem
      const base = path.basename(rel);
      if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(base)) {
        findings.push({ file: rel, detail: 'filename-not-kebab-case' });
      }
      const text = readFileSafe(path.join(repoRoot, rel));
      if (text === null) continue;
      const fm = parseFrontmatter(text);
      if (!fm) {
        findings.push({ file: rel, detail: 'missing-frontmatter' });
        continue;
      }
      if (!fm.type || !ALLOWED_TYPES.has(fm.type)) {
        findings.push({ file: rel, detail: 'frontmatter-type-invalid' });
      }
      if (!fm.created || !/^\d{4}-\d{2}-\d{2}$/.test(fm.created)) {
        findings.push({ file: rel, detail: 'frontmatter-created-invalid' });
      }
    }
    return findings;
  },
};

// The 'uncaptured-correction' check lived here, with the transcript readers it
// needed: it scanned the owner's own messages for correction phrases and, finding
// one, told the agent to run /lesson. Removed 2026-09-06 (simplification plan,
// Phase 3) — it is a nag about a discipline, not a finding about the work, and
// it fired six times in four days without a single lesson resulting. /lesson
// stays exactly as it was: something the owner asks for.
//
// Its check-fire ledger lines stay in logs/signals/ as history.

// --- index-coverage -----------------------------------------------------

// A catalog nobody is forced to update is a catalog that silently rots, and
// the corroborated 2026-09-02 lesson is that the prose instruction to update
// it loses to the in-the-moment default while the work still looks finished.
// So: the instrument. A note that changed this session and is not linked from
// INDEX.md fires here (ADR 0035).
//
// Canary (P-029): a new `notes/zzz-canary.md` absent from INDEX.md must fire
// `missing-from-index`; the same note with a `[[zzz-canary]]` row added must
// not. Near-miss it must NOT fire on: a note whose name is a prefix of an
// indexed one (`lesson-2026-08-26-style` vs `lesson-2026-08-26-style-2`) —
// hence the explicit `]`/`|`/`#` terminator instead of a bare substring test.
const indexCoverage = {
  id: 'index-coverage',
  added: '2026-09-02',
  source: 'ADR 0035 (INDEX.md is the page catalog)',
  scope: 'changed',
  run({ repoRoot, changedFiles }) {
    const indexText = readFileSafe(path.join(repoRoot, 'INDEX.md'));
    if (indexText === null) return []; // no catalog — fail open (ADR 0004)
    const findings = [];
    for (const rel of changedFiles) {
      if (!rel.startsWith('notes/') || !rel.endsWith('.md')) continue;
      if (rel.slice('notes/'.length).includes('/')) continue; // notes/ is flat
      const name = path.basename(rel, '.md');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\[\\[${escaped}(?:[#|]|\\]\\])`).test(indexText)) {
        findings.push({ file: rel, detail: 'missing-from-index' });
      }
    }
    return findings;
  },
};

export const CHECKS = [
  wikilinkShortForm,
  noteConventions,
  indexCoverage,
];

// --- runner -------------------------------------------------------------

// Dedup key exactly as it appears in a ledger line's payload segment.
function fireKey(checkId, finding) {
  return `check:${checkId} | file:${finding.file} | ${finding.detail}`;
}

// Runs every check; records NEW fires (not yet in this month's ledger) as
// `check-fire` signal lines and returns warning messages for them only.
// Never throws; a broken check is logged and skipped.
export function runChecks(repoRoot, { sessionId, logTag, transcriptPath } = {}) {
  const messages = [];
  const fired = [];
  let ledgerText = '';
  try {
    const ledgerFile = signalsPath(repoRoot);
    ledgerText = existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : '';
  } catch {
    ledgerText = '';
  }

  let changedFiles = null; // computed lazily, once
  for (const check of CHECKS) {
    let findings = [];
    try {
      if ((check.scope === 'changed' || check.scope === 'session') && changedFiles === null) {
        changedFiles = getChangedFiles(repoRoot, logTag);
      }
      findings =
        check.run({
          repoRoot,
          changedFiles: changedFiles || [],
          sessionId,
          transcriptPath,
          ledgerText,
        }) || [];
    } catch (err) {
      logLine(repoRoot, logTag, `check ${check.id} crashed (skipped): ${summarizeError(err)}`);
      continue;
    }
    for (const f of findings) {
      const key = fireKey(check.id, f);
      if (ledgerText.includes(key)) continue; // already recorded this month
      const ok = appendSignal(repoRoot, {
        type: 'check-fire',
        payload: [`check:${check.id}`, `file:${f.file}`, f.detail],
        sessionId,
        logTag,
      });
      if (ok) {
        ledgerText += `${key}\n`; // dedup within this run too
        fired.push({ check: check.id, ...f });
        messages.push({
          key,
          priority: 2,
          text: f.message || `⚠ check ${check.id}: ${f.file} — ${f.detail}`,
        });
        logLine(repoRoot, logTag, `check-fire ${check.id}: ${f.file} (${f.detail})`);
      }
    }
  }
  return { messages, fired };
}
