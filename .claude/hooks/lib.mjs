// Shared helpers for the SessionStart hook and the scripts under scripts/.
// Since v1.1 no hook writes to git: commits are task-owned (ADR 0042, 0044).
// Fail-open by design (ADR 0004): every code path must exit 0. Nothing in
// here throws past its caller — callers still wrap in try/catch as a backstop.

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  renameSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function thisDir(importMetaUrl) {
  return path.dirname(fileURLToPath(importMetaUrl));
}

// Brain-root resolution precedence (ADR 0008): BRAIN_DIR env → script's own
// location → CLAUDE_PROJECT_DIR. Scripts always live at
// <vault>/.claude/hooks/<name>.mjs, so script-location is always the vault
// root — this makes the same scripts correct when invoked from any cwd by
// user-level hooks (global mode) as well as from inside the vault itself.
export function getRepoRoot(hookDir) {
  const fromBrainDir = process.env.BRAIN_DIR;
  if (fromBrainDir && fromBrainDir.trim() !== '') {
    return fromBrainDir;
  }
  if (hookDir) {
    // script lives at <repoRoot>/.claude/hooks/<name>.mjs
    return path.resolve(hookDir, '../..');
  }
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv;
  }
  return process.cwd();
}

// Read stdin without ever hanging: the hook may receive a small JSON payload
// on stdin, or nothing at all (manual invocation, empty pipe).
export function readStdin(timeoutMs = 200) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(data);
    };
    try {
      if (process.stdin.isTTY) {
        finish();
        return;
      }
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
      const t = setTimeout(finish, timeoutMs);
      if (typeof t.unref === 'function') t.unref();
      process.stdin.resume();
    } catch {
      finish();
    }
  });
}

export function parseHookInput(raw) {
  if (!raw || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function timestamp() {
  return new Date().toISOString();
}

// The automation log is unbounded otherwise: it is appended to by every hook
// of every session on the machine. One generation of history is enough — the
// Signal Ledger, not this file, is the durable record.
const AUTOMATION_LOG_MAX_BYTES = 512 * 1024;

// Best-effort single-generation rotation. Race-tolerant: two processes may
// both decide to rotate, and the loser's rename either overwrites an
// already-rotated .1 or fails on a file another process just moved — both
// are harmless, so every failure path is swallowed.
function rotateIfOversized(logPath) {
  try {
    let stat;
    try {
      stat = statSync(logPath);
    } catch {
      return; // not there yet — nothing to rotate
    }
    if (!stat.isFile() || stat.size <= AUTOMATION_LOG_MAX_BYTES) return;
    const rotated = `${logPath}.1`;
    try {
      renameSync(logPath, rotated); // replaces any previous .1 on POSIX
    } catch {
      // Windows rename onto an existing file fails: drop the old .1 and retry.
      try {
        unlinkSync(rotated);
        renameSync(logPath, rotated);
      } catch {
        // another process rotated first, or the file is locked — leave it be
      }
    }
  } catch {
    // Rotation is a nicety; it must never break logging.
  }
}

// `level` is optional. Info lines keep the original prefix-free format so
// existing log tooling keeps parsing; 'WARN' / 'ERROR' add a severity token
// after the label: `[ISO] Label: ERROR: msg`.
export function logLine(repoRoot, label, line, level) {
  try {
    const logDir = path.join(repoRoot, 'logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, '.automation.log');
    rotateIfOversized(logPath);
    const severity = level && String(level).trim() !== '' ? `${String(level).trim()}: ` : '';
    appendFileSync(logPath, `[${timestamp()}] ${label}: ${severity}${line}\n`, 'utf8');
  } catch {
    // Logging must never throw or block the hook.
  }
}

export function summarizeError(err) {
  if (!err) return 'unknown error';
  if (err.killed || err.signal) {
    return `command killed/timed out (${err.signal || 'timeout'})`;
  }
  const stderr = err.stderr ? String(err.stderr).trim() : '';
  const stdout = err.stdout ? String(err.stdout).trim() : '';
  const msg = stderr || stdout || err.message || 'unknown error';
  return msg.split('\n')[0].slice(0, 200);
}

export function getGitDir(repoRoot) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return path.isAbsolute(out) ? out : path.join(repoRoot, out);
  } catch {
    return null;
  }
}

// The vault activation gate (ADR 0014). Every hook is inert without the
// core/.vault-active marker: no pull, no Tier-0 injection. It is what keeps
// the public template — and a clone that has not been set up yet — from
// acting on its own (it used to guard a committing, pushing checkpoint too). Documented
// since 2026-08-18 but never implemented until 2026-08-22.
export function isVaultActive(repoRoot) {
  try {
    return existsSync(path.join(repoRoot, 'core', '.vault-active'));
  } catch {
    return false;
  }
}

// --- Shared lock --------------------------------------------------------
// Same on-disk protocol as the retired PowerShell side (archive/lock.ps1,
// unscheduled 2026-08-30, ADR 0033) — kept because two agent sessions, in
// either runtime, can still run concurrently:
// scripts/.brain.lock holds a single line "<PID> <ISO-8601 UTC> <owner>".
// A lock whose PID is dead, or that is older than 2h, is stale and gets
// broken by the next acquirer.
//
// Why it is still needed: every session on the machine runs SessionStart
// against the one vault repo, in Claude Code and in Codex, and two `git pull`
// runs racing on .git/FETCH_HEAD produce "Cannot rebase onto multiple
// branches". Signal-ledger appends take the same lock.
//
// Contention policy is skip, never wait: a missed pull is harmless (we work
// from local state). Blocking would stall the session, which ADR 0004 forbids.

const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

export function brainLockPath(repoRoot) {
  return path.join(repoRoot, 'scripts', '.brain.lock');
}

function readLock(lockPath) {
  try {
    const raw = readFileSync(lockPath, 'utf8').trim();
    if (raw === '') return null;
    const parts = raw.split(/\s+/);
    if (parts.length < 2) return null;
    const pid = Number(parts[0]);
    const ts = Date.parse(parts[1]);
    if (!Number.isFinite(pid) || Number.isNaN(ts)) return null;
    return { pid, ts, owner: parts[2] || 'unknown' };
  } catch {
    return null;
  }
}

function isLockStale(lockPath) {
  if (!existsSync(lockPath)) return true;
  const held = readLock(lockPath);
  if (!held) return true; // empty or malformed — treat as stale
  if (Date.now() - held.ts >= LOCK_STALE_MS) return true;
  try {
    process.kill(held.pid, 0); // signal 0 = liveness probe, works on Windows
    return false;
  } catch {
    return true; // owner is gone
  }
}

// Tries to take the lock. Returns true if acquired, false if a live job holds
// it (caller must skip its run). Never throws.
export function enterBrainLock(repoRoot, owner, logTag) {
  const lockPath = brainLockPath(repoRoot);
  try {
    const dir = path.dirname(lockPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (existsSync(lockPath)) {
      if (!isLockStale(lockPath)) {
        const held = readLock(lockPath);
        if (logTag) {
          logLine(
            repoRoot,
            logTag,
            `lock held by ${held ? `${held.owner} (pid ${held.pid})` : 'another job'} — skipping this run`,
            'WARN'
          );
        }
        return false;
      }
      try {
        unlinkSync(lockPath); // break the stale lock
      } catch {
        // someone else may have just broken it — the wx write below decides
      }
    }

    // 'wx' fails if the file exists, so the create itself is the race winner.
    // This is stronger than archive/lock.ps1's write-then-reread, and
    // compatible: the
    // file format is identical.
    writeFileSync(lockPath, `${process.pid} ${new Date().toISOString()} ${owner}`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch {
    if (logTag) logLine(repoRoot, logTag, 'lock contended — skipping this run', 'WARN');
    return false;
  }
}

// --- Reentrancy + bounded retry ----------------------------------------
// The lock file records the holder's pid, which is what makes reentrancy
// decidable: if THIS process already wrote it, the critical section is
// already ours and a nested acquire must neither re-take it (impossible —
// 'wx' would fail) nor release it on the way out (that would unlock the
// outer section early). Needed because appendSignal now locks, and it is
// reachable from inside code that already holds the lock.
export function ownsBrainLock(repoRoot) {
  try {
    const lockPath = brainLockPath(repoRoot);
    if (!existsSync(lockPath)) return false;
    const held = readLock(lockPath);
    return !!(held && held.pid === process.pid);
  } catch {
    return false;
  }
}

// Synchronous sleep: the hook path is entirely sync (execFileSync all the way
// down), so there is no event loop to yield to between retries.
function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* busy-wait fallback if SharedArrayBuffer is unavailable */
    }
  }
}

// Reentrancy-aware acquire with an optional bounded retry. Returns a handle
// { ok, reentrant } — always pass it to releaseBrainLock, which is a no-op
// for a reentrant (already-owned) acquire.
//
// Retry budget must stay small: hooks have a 30s timeout and ADR 0004 forbids
// stalling a session. The default is still a single attempt (skip-not-wait);
// only callers that cannot be retried later — a signal append has no later
// run to pick it up — ask for more.
export function acquireBrainLock(repoRoot, owner, logTag, { attempts = 1, delayMs = 300 } = {}) {
  if (ownsBrainLock(repoRoot)) return { ok: true, reentrant: true };
  const tries = Number.isFinite(attempts) && attempts > 0 ? Math.min(attempts, 10) : 1;
  for (let i = 0; i < tries; i++) {
    if (i > 0) sleepSync(delayMs);
    // Only the final attempt logs, so a retry loop does not triple the noise.
    const isLast = i === tries - 1;
    if (enterBrainLock(repoRoot, owner, isLast ? logTag : null)) {
      return { ok: true, reentrant: false };
    }
  }
  return { ok: false, reentrant: false };
}

export function releaseBrainLock(repoRoot, handle) {
  if (handle && handle.ok && !handle.reentrant) exitBrainLock(repoRoot);
}

// Releases the lock, but only if we still own it: a job that broke our lock
// as stale has taken over and must not have it pulled out from under it.
export function exitBrainLock(repoRoot) {
  const lockPath = brainLockPath(repoRoot);
  try {
    if (!existsSync(lockPath)) return;
    const held = readLock(lockPath);
    if (held && held.pid === process.pid) unlinkSync(lockPath);
  } catch {
    // best-effort; a stuck lock self-heals after 2h
  }
}

// --- Secret guard -----------------------------------------------------
// Written for the retired checkpoint commit, which ran it on every Stop. Since
// commits became task-owned (ADR 0042, 0044) nothing calls it automatically;
// it is kept as reusable code. The scan that actually runs, once installed, is
// gitleaks via `.pre-commit-config.yaml`. Never blocks and never deletes
// content: offending files are reset out of the index (working tree untouched)
// so the commit proceeds without them.

const SECRET_PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'API key', re: /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i },
  { name: 'private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Slack token', re: /xox[baprs]-/ },
  { name: 'bearer token', re: /bearer\s+[A-Za-z0-9\-_.=]{30,}/i },
  { name: 'password literal', re: /password\s*[:=]\s*['"][^'"]{8,}['"]/i },
];

const MAX_SCAN_BYTES = 1024 * 1024; // 1MB

function getStagedFiles(repoRoot) {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    });
    return out.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  } catch {
    return [];
  }
}

// Cheap binary sniff: a NUL byte in the first few KB means "not text".
function looksLikeText(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return false;
  }
  return true;
}

// Scans staged files for secret-shaped content. Resets any offending files
// out of the index (leaving the working tree untouched) so the rest of the
// commit can proceed. Returns { offendingFiles: string[], findings: [...] }.
export function scanStagedForSecrets(repoRoot, logTag) {
  const staged = getStagedFiles(repoRoot);
  const offendingFiles = [];
  const findings = [];

  for (const relPath of staged) {
    const fullPath = path.join(repoRoot, relPath);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue; // deleted / renamed away — nothing to scan
    }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue;

    let buf;
    try {
      buf = readFileSync(fullPath);
    } catch {
      continue;
    }
    if (!looksLikeText(buf)) continue;

    const content = buf.toString('utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(content)) {
        findings.push({ file: relPath, pattern: pattern.name });
        if (!offendingFiles.includes(relPath)) offendingFiles.push(relPath);
        break; // one hit is enough to flag the file
      }
    }
  }

  if (offendingFiles.length > 0) {
    try {
      execFileSync('git', ['reset', '--', ...offendingFiles], {
        cwd: repoRoot,
        timeout: 10000,
        encoding: 'utf8',
      windowsHide: true,
      });
    } catch (err) {
      logLine(repoRoot, logTag, `git reset of offending files failed: ${summarizeError(err)}`);
    }
    for (const f of findings) {
      logLine(repoRoot, logTag, `possible secret (${f.pattern}) in ${f.file} — left uncommitted`);
    }
  }

  return { offendingFiles, findings };
}

// --- Budget guard -------------------------------------------------------
// Character budgets for the always-loaded core files (ADR 0003, unit changed
// to characters by ADR 0030). Lines were a bad proxy: ours run 40-78 chars, so
// a 100-line cap meant anywhere from 4k to 7.8k characters. Never truncates —
// only warns, loudly and early, so the model/user runs /curator.

const DEFAULT_BUDGETS = {
  'MEMORY.md': 4000,
  'USER.md': 2000,
};

function budgetLimitFor(name) {
  if (name === 'MEMORY.md') {
    const v = Number(process.env.BRAIN_MEMORY_BUDGET);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_BUDGETS['MEMORY.md'];
  }
  if (name === 'USER.md') {
    const v = Number(process.env.BRAIN_USER_BUDGET);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_BUDGETS['USER.md'];
  }
  return DEFAULT_BUDGETS[name];
}

function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

// HTML comments are the file's own instructions to the writer, not stored
// facts, so they are excluded — the same exclusion the line count made.
function countBudgetChars(text) {
  return stripHtmlComments(text).trim().length;
}

// Usage for every budgeted core file, over budget or not: the session-start
// header renders this so the agent sees its remaining room *before* it writes,
// which is the whole point of the change (ADR 0030). Pure read.
export function budgetUsage(repoRoot) {
  const rows = [];
  for (const name of Object.keys(DEFAULT_BUDGETS)) {
    const content = readFileSafe(path.join(repoRoot, 'core', name));
    if (content === null) continue;
    const limit = budgetLimitFor(name);
    const count = countBudgetChars(content);
    rows.push({ file: name, count, limit, pct: Math.round((count / limit) * 100) });
  }
  return rows;
}

// --- delivery state -----------------------------------------------------
// "Is anything on this branch still only on this machine?" — asked separately
// from "did this invocation create a commit", because the two come apart. The
// push debounce commits without pushing, so a session can end perfectly clean
// while a real backlog sits on disk (observed 2026-09-05: the 20:58Z commit
// was still local when the 21:05Z SessionEnd ran and found nothing to stage).
//
// ok:false means the question could not be answered — no upstream, detached
// HEAD, git missing, remote unreachable. That is *unknown*, never "in sync":
// callers must not read a failure here as proof the work is backed up.
function unpushedCommits(repoRoot) {
  try {
    const out = execFileSync('git', ['rev-list', '--count', '@{upstream}..HEAD'], {
      cwd: repoRoot,
      timeout: 10000,
      // stderr piped, not inherited: outside a repo (or with no upstream) git
      // writes straight to the session's stderr otherwise.
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const count = Number(out);
    if (!Number.isFinite(count)) return { ok: false, reason: `unreadable rev-list output: ${out.slice(0, 60)}` };
    return { ok: true, count };
  } catch (err) {
    return { ok: false, reason: summarizeError(err) };
  }
}

// Commit date of the OLDEST commit the remote has not seen.
//
// `git log --reverse --format=%cI -1 @{upstream}..HEAD` does not answer this,
// which is the bug this replaces: git applies the -1 limit while walking the
// history newest-first and reverses only what survived, so it returns the
// NEWEST unpushed commit. Every new checkpoint therefore reset the reported
// backlog age to zero, and a week-old unpushed commit read as "0d" forever.
// Take the whole list and read its last line instead.
function oldestUnpushedISO(repoRoot) {
  try {
    const out = execFileSync('git', ['log', '--format=%cI', '@{upstream}..HEAD'], {
      cwd: repoRoot,
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    if (out === '') return null;
    const lines = out.split(/\r?\n/).filter((l) => l.trim() !== '');
    return lines.length > 0 ? lines[lines.length - 1].trim() : null;
  } catch {
    return null;
  }
}

// The checkpoint commit that lived here (`git add -A` + commit + push on every
// Stop/SessionEnd) was retired with ADR 0042/0044: with two runtimes able to
// work in one checkout, a whole-tree commit takes another task's half-written
// files with it. The pre-removal file is in this repo's `v1.0` tag. Commits
// are task-owned now; the secret guard above is kept for reuse.

export function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// --- Signal Ledger (ADR 0020) -----------------------------------------
// One append-only, typed event stream per month: logs/signals/YYYY-MM.md.
// Every detector writes here, every audit reads here. Plain Markdown, one
// line per event, so `rg` is the whole query engine. Fail-open like the rest
// of this file: a ledger write must never break a session.

export const SIGNAL_TYPES = [
  // 'session' was retired in ADR 0032, and its sidecar replacement went with
  // the flush mechanism in 2026-09. Nothing counts turns any more.
  'correction',
  'retrieval-failure',
  'acceptance',
  'rejection',
  'check-fire',
  'retrieval-rollup',
  // Historical: one line per session the retired flush mechanism handled.
  // Nothing writes this any more; the type stays listed so the existing lines
  // remain valid ledger content rather than becoming unparseable history.
  'session-digest',
];

// One line per event is the ledger's only structural invariant, so no field
// may carry a newline, a tab, or the `|` separator into it.
function sanitizeField(v) {
  return String(v).replace(/[\r\n\t|]+/g, ' ').trim();
}

function signalStamp(d) {
  // minute precision, UTC, unambiguous: 2026-08-25T12:19Z
  return `${d.toISOString().slice(0, 16)}Z`;
}

export function signalsPath(repoRoot, d = new Date()) {
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return path.join(repoRoot, 'logs', 'signals', `${month}.md`);
}

function signalsHeader(d) {
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return [
    '---',
    'type: log',
    `created: ${d.toISOString().slice(0, 10)}`,
    'tags: [signals, ledger]',
    'status: active',
    '---',
    '',
    `# Signal ledger — ${month}`,
    '',
    'Append-only typed event stream (ADR 0020). One line per event:',
    '`- <ISO-UTC timestamp> | <type> | <payload…> | sid:<session id>`',
    '',
    `Types: ${SIGNAL_TYPES.join(' | ')}. Never rewrite a past line —`,
    'a correction is a newer line. See `logs/signals/README.md`.',
    '',
  ].join('\n');
}

function ensureSignalsFile(repoRoot, d) {
  const file = signalsPath(repoRoot, d);
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, signalsHeader(d), 'utf8');
  return file;
}

// Appends one typed line. `payload` is a string or an array of `k:v` fields.
//
// Serialized on the brain lock. It was added when the retired session trace
// did a read-modify-write of this same file and could erase a line appended
// between its read and its write; the lock stays because two concurrent
// sessions can still append at once. Reentrant, because appendSignal is
// reachable from callers that may already hold the lock (checks.mjs →
// runChecks, when a caller runs the checks under the lock).
//
// Contention policy differs from the rest of the file on purpose: a signal
// has no later run to pick it up, so a short retry is tried and, failing
// that, the line is appended unlocked — degrading to today's behaviour
// rather than dropping the event.
export function appendSignal(repoRoot, { type, payload, sessionId, logTag, when }) {
  let handle = null;
  try {
    handle = acquireBrainLock(repoRoot, `${logTag || 'signal'}-append`, null, {
      attempts: 3,
      delayMs: 100,
    });
    if (!handle.ok && logTag) {
      logLine(repoRoot, logTag, 'signal append could not take the brain lock — appending unlocked', 'WARN');
    }
    const d = when instanceof Date ? when : new Date();
    const file = ensureSignalsFile(repoRoot, d);
    const fields = Array.isArray(payload) ? payload : [payload];
    const parts = [signalStamp(d), sanitizeField(type), ...fields.filter(Boolean).map(sanitizeField)];
    if (sessionId) parts.push(`sid:${sanitizeField(sessionId)}`);
    appendFileSync(file, `- ${parts.join(' | ')}\n`, 'utf8');
    return true;
  } catch (err) {
    if (logTag) logLine(repoRoot, logTag, `signal write failed: ${summarizeError(err)}`, 'WARN');
    return false;
  } finally {
    releaseBrainLock(repoRoot, handle);
  }
}

// The session-trace sidecar (ADR 0032) was removed with the flush mechanism
// it existed for (ADR 0038). Its readers were flush.mjs
// and the SessionStart sweep, both gone; `.claude/.sessions.json` is
// gitignored machine state, so nothing tracked depends on it. Sessions that
// were already digested keep their `session-digest` ledger lines as history.

// The reuse-telemetry sidecar and its weekly rollup stood here (ADR 0011,
// 0024, 0032). Removed by ADR 0039: a held-out benefit check answered its
// question with real tasks, not access counts, so the telemetry informed no
// decision in the trial it was kept for, and the write-only-graveyard question
// it was built to answer had already been settled. Any `retrieval-rollup`
// ledger lines it wrote stay in `logs/signals/` as history.

// tmp + rename: a crash mid-write leaves the previous file intact instead of
// a half-JSON one every later read would discard. On Windows the rename can
// still be refused while another process holds the target open — drop the temp
// when that happens rather than leaving it behind. A stale
// `.<pid>.tmp` sitting in `.claude/` was how that failure mode stayed
// invisible for two days (ADR 0032). Its first caller was the access sidecar,
// retired 2026-09-06; the maintenance sidecar still writes through it.
function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), 'utf8');
  try {
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore — the throw below is the signal that matters
    }
    throw err;
  }
}

// --- Session-start notices (ADR 0033, 0038) ------------------------------
// Scheduled maintenance was retired on 2026-08-30: the trigger is the owner
// opening a session. A "pass X is overdue" due line stood here until
// 2026-09-06 and went with the passes that fed it — nothing is scheduled, so
// nothing is late, and a reminder to run a pass is not a finding. What is left
// is one shared daily notice budget and the one notice a session start still
// volunteers: commits that never left this machine.
//
// Everything here is local: the pull that precedes it has already refreshed
// the remote ref, so nothing in this path touches the network.
const MAINTENANCE_SIDECAR_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNPUSHED_DUE_MS = 24 * 60 * 60 * 1000; // below this it is just live work

// Hard cap from AGENTS.md: three proactive items per local day, counted across
// every surface. Before 2026-09-06 that was two independent once-a-day gates
// (the due line, the budget warning) plus an ungated stream of check fires,
// which is three surfaces each promising the same cap and none of them
// counting the others.
const NOTICE_DAILY_CAP = 3;

export function maintenanceSidecarPath(repoRoot) {
  return path.join(repoRoot, '.claude', '.maintenance.json');
}

// v1 held `ran` stamps for the maintenance passes plus two "shown today"
// flags. The stamps went with the due line they fed (2026-09-06): reminding
// the owner that a pass is 14 days old is manufacturing maintenance work, which is
// the thing this cleanup removes. An old v1 file is read for nothing but its
// notice state and is rewritten in v2 shape on the next write.
function readMaintenanceSidecar(repoRoot) {
  const empty = {
    version: MAINTENANCE_SIDECAR_VERSION,
    notices: { day: null, count: 0, keys: [] },
  };
  try {
    const text = readFileSafe(maintenanceSidecarPath(repoRoot));
    if (text === null) return empty;
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return empty;
    const n = data.notices;
    if (!n || typeof n !== 'object') return empty;
    return {
      version: MAINTENANCE_SIDECAR_VERSION,
      notices: {
        day: n.day || null,
        count: Number.isFinite(Number(n.count)) ? Number(n.count) : 0,
        keys: Array.isArray(n.keys) ? n.keys.map(String) : [],
      },
    };
  } catch {
    // A truncated sidecar costs one over-eager notice, never a session.
    return empty;
  }
}

// The calendar day in local time — the unit the notice budget counts in.
function localDay(now) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// The one gate every proactive hook message passes through.
//
// `candidates` are `{ key, text, priority }`; lower priority is more
// important, and backup failures are priority 0 so that a day whose budget is
// otherwise full still delivers "your commits never left this machine".
// A key already shown today is dropped rather than re-counted, so a warning
// that persists across forty Stops costs one item, not forty — and the count
// lives in the sidecar, so opening a second session does not reset it.
//
// Everything refused is written to `logs/.automation.log`: suppressed is not
// the same as unrecorded, and the diagnostics are where a requested inspection
// looks.
export function emitNotices(repoRoot, candidates, { now = new Date(), record = true, logTag } = {}) {
  const list = (candidates || []).filter((c) => c && c.text);
  if (list.length === 0) return [];
  try {
    const data = readMaintenanceSidecar(repoRoot);
    const today = localDay(now);
    if (data.notices.day !== today) {
      data.notices = { day: today, count: 0, keys: [] };
    }

    const ordered = list
      .map((c, idx) => ({ ...c, idx, priority: Number.isFinite(c.priority) ? c.priority : 5 }))
      .sort((a, b) => a.priority - b.priority || a.idx - b.idx);

    const allowed = [];
    const suppressed = [];
    for (const c of ordered) {
      const key = String(c.key || c.text).slice(0, 200);
      if (data.notices.keys.includes(key)) {
        suppressed.push(`${key} (already shown today)`);
        continue;
      }
      if (data.notices.count >= NOTICE_DAILY_CAP) {
        suppressed.push(`${key} (daily cap of ${NOTICE_DAILY_CAP} reached)`);
        continue;
      }
      data.notices.count += 1;
      data.notices.keys.push(key);
      allowed.push(c);
    }

    if (record && allowed.length > 0) {
      try {
        writeJsonAtomic(maintenanceSidecarPath(repoRoot), data);
      } catch {
        // Failing to record costs a repeated notice, never a broken session.
      }
    }
    for (const line of suppressed) {
      if (logTag) logLine(repoRoot, logTag, `notice suppressed: ${line}`);
    }
    // Back into the caller's original order, so a hook's own sequence reads
    // the way it was written.
    return allowed.sort((a, b) => a.idx - b.idx).map((c) => c.text);
  } catch {
    // Cannot tell — deliver rather than swallow, but never more than the cap.
    return list.slice(0, NOTICE_DAILY_CAP).map((c) => c.text);
  }
}

// The backup half of retired B1, minus the network call. B1 asked whether the
// remote was reachable; the pull that runs just before this already answered
// that. What is left — and what actually breaks silently — is commits that
// never left this machine.
function unpushedBacklog(repoRoot, now) {
  const backlog = unpushedCommits(repoRoot);
  // "Cannot tell" is not "in sync". No upstream, a broken git, a detached
  // HEAD — each means the vault's backup state is unverified, and silence
  // there is exactly how a machine-only vault would go unnoticed.
  if (!backlog.ok) return 'backup state unverified (no upstream or git error)';
  if (backlog.count === 0) return null;

  const oldest = oldestUnpushedISO(repoRoot);
  const oldestMs = oldest ? Date.parse(oldest) : NaN;
  if (!Number.isFinite(oldestMs)) return `${backlog.count} commit(s) unpushed, age unknown`;

  const ageMs = now.getTime() - oldestMs;
  if (ageMs < UNPUSHED_DUE_MS) return null; // below a day it is just live work
  return `${backlog.count} commit(s) unpushed for ${Math.floor(ageMs / DAY_MS)}d`;
}

// The only thing left that a session start volunteers: whether the vault's
// work is actually backed up. The maintenance due line that used to live here
// — "curator 14d ago", "audit never run" — was removed on 2026-09-06 with the
// passes that fed it. It reported staleness against a schedule nothing runs,
// and a reminder to run a pass is not a finding.
export function backupNotice(repoRoot, { now = new Date() } = {}) {
  try {
    const line = unpushedBacklog(repoRoot, now);
    if (!line) return null;
    return { key: 'backup', priority: 0, text: `Backup: ${line}` };
  } catch {
    return null;
  }
}
