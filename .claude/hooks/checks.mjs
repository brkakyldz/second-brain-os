#!/usr/bin/env node
// Compiled lesson-checks (v3 Phase 3, ADR 0019 / ADR 0022). The TRACE move:
// a mechanically checkable rule lives here as code, not as prose the model
// may skip. Runs from checkpoint.mjs on every Stop/PreCompact — warn-first,
// never blocking, fail-open like everything else in the hook path.
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
// Checks born from real corroborated lessons get added by the /flywheel
// pass — as proposals the owner applies, never by the pass itself.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendSignal, signalsPath, logLine, readFileSafe, summarizeError } from './lib.mjs';

const ALLOWED_TYPES = new Set([
  'project', 'knowledge', 'memory', 'playbook', 'log', 'decision',
]);

// --- helpers ------------------------------------------------------------

function normalizeRel(p) {
  return p.replace(/\\/g, '/');
}

// Changed-but-not-deleted files from `git status --porcelain`. Checks run
// before the checkpoint's own `git add -A`, so working-tree status (not the
// index) is the honest "what did this session touch" list.
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

// --- transcript reading (session-scope checks) --------------------------

// A transcript this large is a pathological session, not a normal one; the
// check stands down rather than spending a Stop hook reading it.
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

function transcriptPathFor(repoRoot, sessionId) {
  const slug = repoRoot.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
}

function stripHookNoise(text) {
  return String(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[\s\S]*?<\/local-command-[^>]*>/g, '')
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, '')
    .trim();
}

// the owner's own words, nothing else. Tool results, thinking blocks and the
// assistant's own turns are dropped on purpose: a correction is something
// *he* said, and command output full of the word "no" is exactly the noise
// that would make a pattern check false-positive its way to deletion.
function userMessages(transcriptPath) {
  let raw;
  try {
    if (statSync(transcriptPath).size > MAX_TRANSCRIPT_BYTES) return null;
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.isSidechain || obj.type !== 'user') continue;
    // A `toolUseResult` user line is the harness reporting a tool's output
    // back, not the owner typing.
    if (obj.toolUseResult !== undefined) continue;
    const content = obj.message && obj.message.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      text = content
        .filter((b) => b && b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('\n');
    }
    text = stripHookNoise(text);
    if (text) out.push(text);
  }
  return out;
}

// --- uncaptured-correction ----------------------------------------------

// Word boundaries, written out. `` is ASCII-only: for a word ending in a
// non-ASCII letter it asks for a boundary after a character JS does not count
// as a word char at all, so the pattern silently stops matching. If you add
// patterns in a language with accented letters, add those letters to LETTERISH
// below — otherwise the rule looks fine and catches nothing.
const LETTERISH = 'A-Za-z0-9_çğıöşüâîûÇĞİÖŞÜÂÎÛ';
const W0 = `(?<![${LETTERISH}])`;
const W1 = `(?![${LETTERISH}])`;

function anchored(body) {
  return new RegExp(`^(?:${body})${W1}`, 'iu');
}
function anywhere(body) {
  return new RegExp(`${W0}(?:${body})${W1}`, 'iu');
}

// Deliberately narrow. ADR 0019 gives a check two false positives before it is
// deleted, so this list holds only phrases that are a correction *of the agent*
// and almost nothing else. Note the asymmetry it has to respect: "I
// misunderstood" is the owner correcting themselves and does not belong here;
// "you misunderstood" does.
//
// This is the one place in the machinery that is vocabulary-bound, so it is the
// one place worth editing early. Add the phrasings you actually use, in the
// language you actually use them in — the reference instance runs a Turkish
// list alongside this one, with the Turkish letters added to LETTERISH. A check
// that never fires is indistinguishable from a check that cannot fire.
const CORRECTION_PATTERNS = [
  // Openers — a correction, but only when it leads the message.
  anchored('(?:no|nope) *[,.!:;—-]'),
  anchored('actually,? +(?:no|that)'),
  // Phrases that are a correction wherever they land.
  anywhere("that'?s (?:not right|wrong|incorrect)"),
  anywhere('not what I (?:said|asked|meant|wanted)'),
  anywhere('you (?:broke|misunderstood)'),
  anywhere('revert (?:that|it|this)'),
];

// Did `/lesson` already run for this session? Step 4 of the skill appends a
// `correction` line carrying the sid, so the ledger is the honest record of
// capture — better than looking for a lesson file, which the skill writes
// one step earlier and which says nothing about whether the flow finished.
function correctionCaptured(ledgerText, sessionId) {
  for (const line of ledgerText.split('\n')) {
    if (!line.includes('| correction |')) continue;
    if (line.includes(`sid:${sessionId}`)) return true;
  }
  return false;
}

const uncapturedCorrection = {
  id: 'uncaptured-correction',
  added: '2026-09-02',
  source: 'CLAUDE.md § lifecycle (capture) — the /lesson trigger had no sweep',
  scope: 'session',
  run({ repoRoot, changedFiles, sessionId, transcriptPath, ledgerText }) {
    // No sid means no per-session dedup key, and a check that cannot dedup
    // fires every single Stop. Standing down is the correct failure.
    if (!sessionId) return [];
    if (correctionCaptured(ledgerText || '', sessionId)) return [];
    // A lesson note written this session but not yet signalled: the capture
    // is visibly in flight, so don't nag mid-flow.
    if ((changedFiles || []).some((f) => f.startsWith('notes/lesson-'))) return [];

    const file =
      transcriptPath && existsSync(transcriptPath)
        ? transcriptPath
        : transcriptPathFor(repoRoot, sessionId);
    const messages = userMessages(file);
    if (!messages || messages.length === 0) return [];

    for (const text of messages) {
      const trimmed = text.trim();
      if (!CORRECTION_PATTERNS.some((re) => re.test(trimmed))) continue;
      const excerpt = trimmed.replace(/\s+/g, ' ').slice(0, 80);
      return [
        {
          file: `session:${sessionId}`,
          detail: 'uncaptured-correction',
          message:
            `⚠ check uncaptured-correction: the owner corrected something this session — ` +
            `"${excerpt}" — and no lesson was captured. Run /lesson (verbatim, no ` +
            `interpretation), or tell him why this one does not qualify.`,
        },
      ];
    }
    return [];
  },
};

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
  uncapturedCorrection,
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
        messages.push(f.message || `⚠ check ${check.id}: ${f.file} — ${f.detail}`);
        logLine(repoRoot, logTag, `check-fire ${check.id}: ${f.file} (${f.detail})`);
      }
    }
  }
  return { messages, fired };
}
