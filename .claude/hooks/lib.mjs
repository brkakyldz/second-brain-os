// Shared helpers for the write-path hooks (Stop / SessionEnd / PreCompact).
// Fail-open by design (ADR 0004): every code path must exit 0. Nothing in
// here throws past its caller — callers still wrap in try/catch as a backstop.

import { execFileSync, spawn } from 'node:child_process';
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

// Guards, in order: rebase/merge in progress, or unmerged paths present.
// Returns { blocked: boolean, reason: string|null }.
// The vault activation gate (ADR 0014). Every hook is inert without the
// core/.vault-active marker: no pull, no checkpoint commit, no push, no
// Tier-0 injection. It is what keeps the public template — and a clone that
// has not been set up yet — from committing and pushing itself. Documented
// since 2026-08-18 but never implemented until 2026-08-22.
export function isVaultActive(repoRoot) {
  try {
    return existsSync(path.join(repoRoot, 'core', '.vault-active'));
  } catch {
    return false;
  }
}

export function checkGuards(repoRoot) {
  const gitDir = getGitDir(repoRoot);
  if (gitDir) {
    if (
      existsSync(path.join(gitDir, 'rebase-merge')) ||
      existsSync(path.join(gitDir, 'rebase-apply'))
    ) {
      return { blocked: true, reason: 'rebase in progress' };
    }
    if (existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
      return { blocked: true, reason: 'merge in progress' };
    }
  }

  try {
    const unmerged = execFileSync('git', ['ls-files', '-u'], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    if (unmerged !== '') {
      return { blocked: true, reason: 'unmerged paths present' };
    }
  } catch (err) {
    // If we can't even ask, be conservative and refuse to commit.
    return { blocked: true, reason: `git ls-files -u failed: ${summarizeError(err)}` };
  }

  return { blocked: false, reason: null };
}

// UTC, minute precision, with an explicit Z. The Signal Ledger stamps in UTC
// (signalStamp), so a local-time commit subject made the two records look
// hours apart on any non-UTC machine — 17:21 next to 14:21Z on UTC+3 — and
// made `git log` unorderable against the ledger by eye.
function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

export function buildCommitMessage(eventLabel, sessionId) {
  const stamp = formatTimestamp(new Date());
  const sid = sessionId && String(sessionId).trim() !== '' ? sessionId : 'unknown';
  return [
    `checkpoint(${eventLabel}): ${stamp}`,
    '',
    `Session: ${sid}`,
    '',
    'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>',
  ].join('\n');
}

// --- Shared lock --------------------------------------------------------
// Same on-disk protocol as the retired PowerShell side (archive/lock.ps1,
// unscheduled 2026-08-30, ADR 0033) — kept because two Claude sessions can
// still run concurrently:
// scripts/.brain.lock holds a single line "<PID> <ISO-8601 UTC> <owner>".
// A lock whose PID is dead, or that is older than 2h, is stale and gets
// broken by the next acquirer.
//
// Why the hooks need it: SessionStart/Stop/SessionEnd all run git against the
// one vault repo, and several Claude Code sessions (plus agent worktrees) fire
// them concurrently. Two `git pull` runs racing on .git/FETCH_HEAD produce
// "Cannot rebase onto multiple branches"; two `git add`/`git commit` runs
// racing produce "Unable to create '.git/index.lock'".
//
// Contention policy is skip, never wait: a missed pull is harmless (we work
// from local state) and a missed checkpoint is picked up by the next Stop.
// Blocking would stall the session, which ADR 0004 forbids.

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
// only callers that cannot be retried later — SessionEnd is terminal — ask
// for more.
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
// Run on the staged file list after `git add -A` and before commit. Never
// blocks and never deletes content: offending files are reset out of the
// index (working tree untouched) so the commit proceeds without them.

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

// Checks core/MEMORY.md and core/USER.md against their character budgets.
// Returns an array of { file, count, limit, pct } for files currently over
// budget. Never mutates anything — pure check.
export function checkBudgets(repoRoot, logTag) {
  const overBudget = [];
  for (const b of budgetUsage(repoRoot)) {
    if (b.count > b.limit) {
      overBudget.push(b);
      logLine(repoRoot, logTag, `budget exceeded: ${b.file} (${b.count}/${b.limit} chars)`);
    }
  }
  return overBudget;
}

// The signal ledger is no longer written on every turn (the session trace
// moved to a gitignored sidecar, ADR 0032), so a staged `logs/signals/` diff
// now means a real event landed — a correction, a digest, a rollup. Those are
// worth a commit, which is why the old `skipIfTraceOnly` heuristic is gone
// rather than kept: the churn it papered over no longer exists.

// --- push debounce ------------------------------------------------------
// Every turn used to cost a network push with a 20s timeout. The commit is
// what bounds data loss (ADR 0004); the push only bounds how stale GitHub is,
// and GitHub is sync, not the database (CLAUDE.md § Sync rules). So Stop
// pushes at most once per window; every terminal or rare event still pushes
// immediately. Timestamp lives beside the brain lock and is gitignored.
const DEFAULT_PUSH_DEBOUNCE_MS = 15 * 60 * 1000;
const ALWAYS_PUSH_EVENTS = new Set(['session-end', 'flush', 'precompact']);

function pushStampPath(repoRoot) {
  return path.join(repoRoot, 'scripts', '.last-push');
}

function pushDebounceMs() {
  const v = Number(process.env.BRAIN_PUSH_DEBOUNCE_MS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_PUSH_DEBOUNCE_MS;
}

function shouldPush(repoRoot, eventLabel) {
  if (ALWAYS_PUSH_EVENTS.has(eventLabel)) return true;
  const window = pushDebounceMs();
  if (window === 0) return true;
  const raw = readFileSafe(pushStampPath(repoRoot));
  if (raw === null) return true;
  const last = Date.parse(raw.trim());
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= window;
}

function recordPush(repoRoot) {
  try {
    writeFileSync(pushStampPath(repoRoot), new Date().toISOString(), { encoding: 'utf8' });
  } catch {
    // best effort — a missing stamp just means the next Stop pushes
  }
}

// The git-touching half of a checkpoint. Always called with the shared brain
// lock held (see checkpointCommit) so no other hook or scheduled job can be
// inside `git add`/`git commit` at the same time.
function commitUnderLock(
  repoRoot,
  { eventLabel, sessionId, pushTimeoutMs, logTag },
  messages
) {
  const guard = checkGuards(repoRoot);
  if (guard.blocked) {
    logLine(repoRoot, logTag, `guard tripped (${guard.reason}) — skipping commit`);
    return { committed: false, reason: 'guard', guardReason: guard.reason, messages };
  }

  try {
    execFileSync('git', ['add', '-A'], {
      cwd: repoRoot,
      timeout: 20000,
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (err) {
    logLine(repoRoot, logTag, `git add -A failed: ${summarizeError(err)}`);
    return { committed: false, reason: 'add-failed', messages };
  }

  const secretResult = scanStagedForSecrets(repoRoot, logTag);
  for (const file of secretResult.offendingFiles) {
    messages.push(`⚠ possible secret in ${file} — left uncommitted, review it`);
  }

  let stagedFiles;
  try {
    stagedFiles = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    logLine(repoRoot, logTag, `git diff --cached --name-only failed: ${summarizeError(err)}`);
    return { committed: false, reason: 'diff-check-failed', messages };
  }

  const hasStaged = stagedFiles.length > 0;

  let result;
  if (!hasStaged) {
    logLine(repoRoot, logTag, 'nothing staged — skipping commit');
    result = { committed: false, reason: 'clean', messages };
  } else {
    const message = buildCommitMessage(eventLabel, sessionId);
    try {
      execFileSync('git', ['commit', '-m', message], {
        cwd: repoRoot,
        timeout: 20000,
        encoding: 'utf8',
      windowsHide: true,
      });
      logLine(repoRoot, logTag, `committed (${eventLabel})`);
    } catch (err) {
      logLine(repoRoot, logTag, `git commit failed: ${summarizeError(err)}`);
      return { committed: false, reason: 'commit-failed', messages };
    }

    if (!shouldPush(repoRoot, eventLabel)) {
      logLine(repoRoot, logTag, `push debounced (${eventLabel}) — commit is safe locally`);
      result = { committed: true, pushed: false, pushDeferred: true, messages };
    } else {
      try {
        execFileSync('git', ['push'], {
          cwd: repoRoot,
          timeout: pushTimeoutMs,
          encoding: 'utf8',
          windowsHide: true,
        });
        logLine(repoRoot, logTag, 'push ok');
        recordPush(repoRoot);
        result = { committed: true, pushed: true, messages };
      } catch (err) {
        logLine(repoRoot, logTag, `push failed (commit is safe locally): ${summarizeError(err)}`);
        result = { committed: true, pushed: false, messages };
      }
    }
  }

  return result;
}

// Stages everything, scans for secrets, commits if there is something staged,
// best-effort pushes, and checks size budgets. Returns a result object
// describing what happened, including any warning messages meant for the
// hook's stdout systemMessage.
//
// Serialized on the shared brain lock: concurrent sessions running `git add`
// against one repo collide on .git/index.lock. A run that cannot take the lock
// is skipped rather than queued — the next Stop checkpoint picks the work up,
// and blocking the session is not allowed (ADR 0004).
export function checkpointCommit(
  repoRoot,
  { eventLabel, sessionId, pushTimeoutMs, logTag }
) {
  const messages = [];

  // Reentrant: SessionEnd takes the lock once around trace+commit, so this
  // acquire is frequently a no-op that must not release the outer section.
  const handle = acquireBrainLock(repoRoot, logTag, logTag);
  let result;
  if (!handle.ok) {
    result = { committed: false, reason: 'locked', messages };
  } else {
    try {
      result = commitUnderLock(
        repoRoot,
        { eventLabel, sessionId, pushTimeoutMs, logTag },
        messages
      );
    } finally {
      releaseBrainLock(repoRoot, handle);
    }
  }

  // Budget guard: a pure read, so it runs outside the lock and on every run —
  // whether or not this one had anything to commit, or got the lock at all —
  // so a file edited outside the hook still gets flagged.
  // The .automation.log line is written every run — that is the evidence trail.
  // What the owner *sees* is capped at one a day by budgetNoticeDue, because Stop
  // fires every turn and the file stays over budget until someone consolidates.
  const overBudget = checkBudgets(repoRoot, logTag);
  if (overBudget.length > 0 && budgetNoticeDue(repoRoot)) {
    for (const b of overBudget) {
      messages.push(
        `⚠ ${b.file} over budget (${b.count}/${b.limit} chars) — run /curator to consolidate`
      );
    }
  }

  return result;
}

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
  // 'session' was retired in ADR 0032 — the per-turn trace lives in the
  // gitignored `.claude/.sessions.json` sidecar, not in this ledger.
  'correction',
  'retrieval-failure',
  'acceptance',
  'rejection',
  'check-fire',
  'retrieval-rollup',
  // One line per session the flush mechanism handled — either the digest it
  // wrote or the reason it stood down. Also the flush's idempotency key, which
  // is why it is a ledger type and not a state file: the record and the guard
  // are the same fact.
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
// Serialized on the brain lock. Without it this bare append raced
// recordSessionTrace's read-modify-write of the same file: the trace reads
// the ledger, an appendSignal lands, and the trace's writeFileSync of the
// stale buffer erases the new line. Reentrant, because appendSignal is
// reachable from callers that may already hold the lock (checks.mjs →
// runChecks, invoked from the checkpoint path).
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

// --- Session trace sidecar (ADR 0032, supersedes ADR 0020's ledger line) --
// The trace used to be a `| session |` line in the durable ledger. That made
// every turn a tracked-tree change, so every turn bought a checkpoint commit:
// 61 of 109 ledger lines and 188 of the vault's commits were this one counter
// ticking, which is what stopped `git log` from being readable as the audit
// trail CLAUDE.md promises.
//
// The trace is machine state for the flush mechanism, not evidence. Its only
// two readers — flush.mjs and the SessionStart sweep — consume it within days
// and discard it, so it lives off the tracked tree now. The durable half of
// the record, the `session-digest` line, stays in the ledger: that is what
// makes a flushed session stay flushed even if this file is lost.
const SESSIONS_SIDECAR_VERSION = 1;
const SESSIONS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionsSidecarPath(repoRoot) {
  return path.join(repoRoot, '.claude', '.sessions.json');
}

function readSessionsSidecar(repoRoot) {
  const empty = { version: SESSIONS_SIDECAR_VERSION, sessions: {} };
  try {
    const text = readFileSafe(sessionsSidecarPath(repoRoot));
    if (text === null) return empty;
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.sessions || typeof data.sessions !== 'object') {
      return empty;
    }
    return { version: SESSIONS_SIDECAR_VERSION, sessions: data.sessions };
  } catch {
    // A truncated buffer is not worth failing a turn over: start clean. The
    // cost is at most a few sessions nobody summarizes.
    return empty;
  }
}

// Entries outlive their usefulness the moment the sweep stops considering
// them (3 days), but a month of slack costs a few KB and keeps the file
// debuggable after the fact.
function pruneSessionsSidecar(data, now) {
  const cutoff = now.getTime() - SESSIONS_MAX_AGE_MS;
  for (const [sid, entry] of Object.entries(data.sessions)) {
    const t = Date.parse((entry && (entry.lastAt || entry.startedAt)) || '');
    if (Number.isFinite(t) && t < cutoff) delete data.sessions[sid];
  }
}

// `mode` 'increment' (Stop) counts a turn; 'touch' (SessionEnd / PreCompact)
// only makes sure the entry exists. A session that never did a turn has
// nothing to trace — logged at most once per process so an idle session in an
// unrelated directory cannot spam the automation log either.
//
// No brain lock, by the same argument as the reuse sidecar: this is on the
// per-turn hot path, a lost update costs one turn off a counter, and taking
// the lock here is exactly what SessionEnd kept burning its retry budget on
// ("lock held by SessionStart — skipping this run", 2026-08-27).
let ghostSkipLogged = false;

export function recordSessionTrace(repoRoot, { sessionId, projectDir, mode = 'touch', logTag }) {
  if (!sessionId) {
    if (logTag) logLine(repoRoot, logTag, 'no session id — trace skipped');
    return { written: false, reason: 'no-session-id' };
  }
  try {
    const sid = String(sessionId);
    const now = new Date();
    const data = readSessionsSidecar(repoRoot);
    const entry = data.sessions[sid];

    if (!entry) {
      // Ghost-session gate: no first turn, no entry. Deliberately not gated
      // on cwd — a real turn from any directory still traces (global brain
      // mode); it is emptiness that disqualifies, not location.
      if (mode !== 'increment') {
        if (logTag && !ghostSkipLogged) {
          ghostSkipLogged = true;
          logLine(repoRoot, logTag, 'session trace skipped (turns:0)');
        }
        return { written: false, reason: 'no-turns' };
      }
      data.sessions[sid] = {
        project: sanitizeField(String(projectDir || process.cwd()).replace(/\\/g, '/')),
        turns: 1,
        startedAt: signalStamp(now),
        lastAt: signalStamp(now),
      };
      pruneSessionsSidecar(data, now);
      writeJsonAtomic(sessionsSidecarPath(repoRoot), data);
      if (logTag) logLine(repoRoot, logTag, 'session trace opened (turns:1)');
      return { written: true, turns: 1, opened: true };
    }

    const current = Number(entry.turns || 0);
    // 'touch' still reports the count it found: callers ask how big a session
    // was without wanting to grow it.
    if (mode !== 'increment') return { written: false, reason: 'exists', turns: current };

    entry.turns = current + 1;
    entry.lastAt = signalStamp(now);
    pruneSessionsSidecar(data, now);
    writeJsonAtomic(sessionsSidecarPath(repoRoot), data);
    return { written: true, turns: entry.turns, opened: false };
  } catch (err) {
    if (logTag) logLine(repoRoot, logTag, `session trace failed: ${summarizeError(err)}`, 'WARN');
    return { written: false, reason: 'error' };
  }
}

// Every trace the sidecar still holds, newest first. flush.mjs needs the
// whole set, not just its own: the upper bound of "the window this session
// could have written a log in" is the next session's start.
export function allSessionTraces(repoRoot) {
  try {
    const out = [];
    for (const [sid, entry] of Object.entries(readSessionsSidecar(repoRoot).sessions)) {
      const startedAt = new Date(Date.parse((entry && entry.startedAt) || ''));
      if (Number.isNaN(startedAt.getTime())) continue;
      out.push({ sid, turns: Number(entry.turns || 0), startedAt });
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

// One session's trace, or null when it was never opened.
export function sessionTrace(repoRoot, sessionId) {
  try {
    const entry = readSessionsSidecar(repoRoot).sessions[String(sessionId)];
    if (!entry) return null;
    const startedAt = new Date(Date.parse(entry.startedAt || ''));
    if (Number.isNaN(startedAt.getTime())) return null;
    return { sid: String(sessionId), turns: Number(entry.turns || 0), startedAt };
  } catch {
    return null;
  }
}

// --- Reuse rollup scheduling (ADR 0032) ---------------------------------
// The rollup that folds the reuse buffer into one durable `retrieval-rollup`
// ledger line was wired into exactly one caller: B5, the weekly `claude -p`
// maintenance job. No scheduled task was ever registered, so B5 never ran, so
// in two days the vault recorded 42 reuse events and zero durable lines — the
// only evidence behind Q-14 sat in a gitignored buffer one `git clean` from
// gone.
//
// The rollup is deterministic and takes milliseconds, so it belongs on the
// cheapest reliable trigger there is rather than on the most fragile one.
// Run synchronously and *before* the session-end lock: the new ledger line
// then rides along in the same checkpoint, and the child process is not
// fighting this one for the brain lock.
const ROLLUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function rollupStampPath(repoRoot) {
  return path.join(repoRoot, 'scripts', '.last-rollup');
}

export function runRollupIfDue(repoRoot, logTag) {
  try {
    const script = path.join(repoRoot, 'scripts', 'flywheel-metrics.mjs');
    if (!existsSync(script)) return false;

    // Nothing read, nothing to roll: an empty buffer would only write a line
    // saying so.
    const buffered = readAccessSidecar(repoRoot);
    if (Object.keys(buffered.notes || {}).length === 0) return false;

    const stamp = rollupStampPath(repoRoot);
    if (existsSync(stamp)) {
      const t = Number(readFileSafe(stamp));
      if (Number.isFinite(t) && Date.now() - t < ROLLUP_INTERVAL_MS) return false;
    }
    // Stamped before the run, not after: a rollup that crashes must not turn
    // into a retry on every session end.
    writeFileSync(stamp, String(Date.now()), 'utf8');

    execFileSync(process.execPath, [script, '--rollup'], {
      cwd: repoRoot,
      timeout: 15000,
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'ignore',
    });
    if (logTag) logLine(repoRoot, logTag, 'reuse rollup written (weekly window elapsed)');
    return true;
  } catch (err) {
    if (logTag) logLine(repoRoot, logTag, `reuse rollup failed (non-fatal): ${summarizeError(err)}`, 'WARN');
    return false;
  }
}

// --- Session flush trigger --------------------------------------------

// Turn threshold below which a session is not worth a flush. Shared because
// three call sites must agree on it: flush.mjs refuses to summarize under it,
// the SessionStart sweep will not retry under it, and SessionEnd uses it to
// decide that a trace line nobody will ever read is not worth a commit.
export const FLUSH_MIN_TURNS = 3;

// Launches flush.mjs fully detached. Both callers are on a latency-critical
// path — SessionEnd runs while the process is already exiting, SessionStart
// while the user waits for the prompt — so nothing here may be awaited: the
// child outlives this process, writes its own log, and takes its own lock.
//
// A flush is never spawned from inside a flush: the summarizer child runs with
// BRAIN_FLUSH=1, and flush.mjs refuses to start when it sees it.
export function spawnFlush(repoRoot, { sessionId, transcriptPath, logTag }) {
  if (!sessionId) return false;
  if (process.env.BRAIN_FLUSH === '1') return false;
  try {
    const script = path.join(repoRoot, '.claude', 'hooks', 'flush.mjs');
    if (!existsSync(script)) return false;
    const args = [script, '--sid', String(sessionId)];
    if (transcriptPath) args.push('--transcript', String(transcriptPath));
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    if (logTag) logLine(repoRoot, logTag, `flush spawned for ${sessionId}`);
    return true;
  } catch (err) {
    if (logTag) logLine(repoRoot, logTag, `flush spawn failed: ${summarizeError(err)}`, 'WARN');
    return false;
  }
}

// Every session the flush mechanism already handled — a digest it wrote, or
// the reason it stood down. The ledger is the idempotency key, and it is
// deliberately the durable half of the pair: the candidate list can be lost
// without harm, but "already summarized" must survive, or a wiped sidecar
// would re-flush months of sessions.
export function digestedSessionIds(repoRoot) {
  const seen = new Set();
  try {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    for (const f of [signalsPath(repoRoot, prev), signalsPath(repoRoot, now)]) {
      const text = existsSync(f) ? readFileSafe(f) : null;
      if (!text) continue;
      for (const line of text.split('\n')) {
        if (!line.startsWith('- ') || !line.includes('| session-digest |')) continue;
        const sid = (line.match(/sid:([^\s|]+)/) || [])[1];
        if (sid) seen.add(sid);
      }
    }
  } catch {
    // An unreadable ledger means "nothing handled yet" — the per-session
    // flush claim below is what still stops a double summary.
  }
  return seen;
}

// Sessions the flush mechanism still owes a decision on: they have a trace
// entry in the sidecar, no `session-digest` line in the ledger, and are not
// the session asking. Newest first, because a sweep that can only afford a
// couple of calls should spend them on the sessions most likely to still
// matter.
export function pendingFlushSessions(repoRoot, { excludeSid } = {}) {
  try {
    const done = digestedSessionIds(repoRoot);
    const data = readSessionsSidecar(repoRoot);
    const pending = [];
    for (const [sid, entry] of Object.entries(data.sessions)) {
      if (!entry || sid === excludeSid || done.has(sid)) continue;
      const startedAt = new Date(Date.parse(entry.startedAt || ''));
      if (Number.isNaN(startedAt.getTime())) continue;
      pending.push({ sid, turns: Number(entry.turns || 0), startedAt });
    }
    return pending.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

// --- Reuse telemetry sidecar (A1-R, ADR 0011 §"derived instrumentation") ---
// The hot path of the reuse metric. A PostToolUse hook fires on every Read /
// Grep / Glob in every project (hooks are machine-wide, ADR 0008), so this
// path must never take the brain lock, call git, or scan the vault: it reads
// one small JSON file, maybe writes it back, and exits.
//
// The file is gitignored and rebuild-tolerant by design — the durable record
// is the weekly `retrieval-rollup` ledger line, not this buffer. Losing it
// costs at most one week of counts, which is why no locking is warranted:
// a lost update under concurrency is cheaper than a lock on this path.

const ACCESS_SIDECAR_VERSION = 1;
// Bounds the file: distinct sessions remembered per note, for dedup.
const ACCESS_MAX_SESSIONS_PER_NOTE = 200;
// Bounds a single hook invocation (a Grep can match hundreds of files).
export const ACCESS_MAX_PATHS_PER_CALL = 20;

export function accessSidecarPath(repoRoot) {
  return path.join(repoRoot, '.claude', '.access.json');
}

// 'notes/foo.md' | 'core/MEMORY.md' for a path inside the vault's retrievable
// tiers, null for anything else. Keyed on the *target path*, never on cwd —
// that is what makes a global-mode session in an unrelated project either
// count a real vault read or nothing at all.
export function vaultNoteKey(repoRoot, candidate) {
  try {
    if (!candidate || typeof candidate !== 'string') return null;
    const abs = path.resolve(repoRoot, candidate);
    const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
    if (rel.startsWith('../') || path.isAbsolute(rel)) return null;
    if (!rel.endsWith('.md')) return null;
    // `archive/` counts too (ADR 0032). MEMORY.md's own claim is that the
    // archive holds live evidence — every ADR to consult before an expensive
    // decision lives there — and none of those reads were being measured, so
    // the claim was untestable. `logs/` and the root files stay out: reading
    // an always-loaded file measures the harness, not retrieval.
    if (!/^(notes|core|archive)\//.test(rel)) return null;
    return rel;
  } catch {
    return null;
  }
}

export function readAccessSidecar(repoRoot) {
  const empty = { version: ACCESS_SIDECAR_VERSION, since: null, notes: {} };
  try {
    const text = readFileSafe(accessSidecarPath(repoRoot));
    if (text === null) return empty;
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || typeof data.notes !== 'object' || data.notes === null) {
      return empty;
    }
    return { version: ACCESS_SIDECAR_VERSION, since: data.since || null, notes: data.notes };
  } catch {
    // A truncated or hand-mangled buffer is not an error worth surfacing:
    // start a fresh week rather than fail a tool call.
    return empty;
  }
}

// tmp + rename: a crash mid-write leaves the previous file intact instead of
// a half-JSON one every later read would discard. On Windows the rename can
// still be refused while another process holds the target open — drop the
// temp when that happens rather than leaving it behind. A stale
// `.access.json.<pid>.tmp` sitting in `.claude/` was how that failure mode
// stayed invisible for two days (ADR 0032).
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

function writeAccessSidecar(repoRoot, data) {
  writeJsonAtomic(accessSidecarPath(repoRoot), data);
}

// Counts one (note, session) pair. Repeat reads of the same note within the
// same session are deliberately *not* counted: the metric is "how many
// distinct pieces of work re-used this note", not "how chatty was the agent".
// Returns the number of newly counted notes.
export function recordNoteAccess(repoRoot, { files, sessionId, logTag }) {
  try {
    const sid = sessionId ? String(sessionId) : 'unknown';
    const keys = [];
    for (const f of files || []) {
      const key = vaultNoteKey(repoRoot, f);
      if (key && !keys.includes(key)) keys.push(key);
      if (keys.length >= ACCESS_MAX_PATHS_PER_CALL) break;
    }
    if (keys.length === 0) return 0;

    const data = readAccessSidecar(repoRoot);
    if (!data.since) data.since = signalStamp(new Date());
    let added = 0;
    for (const key of keys) {
      const entry = data.notes[key] || { count: 0, sessions: [], last: null };
      if (!Array.isArray(entry.sessions)) entry.sessions = [];
      if (entry.sessions.includes(sid)) continue; // dedup per (note, session)
      entry.sessions.push(sid);
      if (entry.sessions.length > ACCESS_MAX_SESSIONS_PER_NOTE) {
        entry.sessions = entry.sessions.slice(-ACCESS_MAX_SESSIONS_PER_NOTE);
      }
      entry.count = Number(entry.count || 0) + 1;
      entry.last = signalStamp(new Date());
      data.notes[key] = entry;
      added += 1;
    }
    if (added === 0) return 0;
    writeAccessSidecar(repoRoot, data);
    return added;
  } catch (err) {
    if (logTag) logLine(repoRoot, logTag, `access sidecar write failed: ${summarizeError(err)}`, 'WARN');
    return 0;
  }
}

// Empties the buffer after a rollup has been written to the ledger. The
// `since` stamp of the new window is the moment the old one closed.
export function resetAccessSidecar(repoRoot, logTag) {
  try {
    writeAccessSidecar(repoRoot, {
      version: ACCESS_SIDECAR_VERSION,
      since: signalStamp(new Date()),
      notes: {},
    });
    return true;
  } catch (err) {
    if (logTag) logLine(repoRoot, logTag, `access sidecar reset failed: ${summarizeError(err)}`, 'WARN');
    return false;
  }
}

// --- Maintenance due check (ADR 0033) -----------------------------------
// Scheduled maintenance was retired on 2026-08-30: the trigger is now the owner
// opening a session. This is the replacement — one line at session start,
// pull not push, silent unless something is actually due.
//
// One of the three items needs no stored state at all, and that is deliberate:
// a stamp can only say when a pass last *ran*, while the unpushed commit count
// says whether the work is *outstanding*. State beats schedule wherever the
// state is observable. Only `/curator` is invisible from the tree, so only it
// depends on being stamped.
//
// The fourth item was the `inbox/` backlog. It went with `inbox/` itself on
// 2026-08-31 (ADR 0034): the folder had no producer, so the branch could only
// ever report zero.
//
// Everything here is local: the pull that precedes it has already refreshed
// the remote ref, so nothing in this path touches the network.
const MAINTENANCE_SIDECAR_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAINTENANCE_JOBS = ['curator', 'link-sweep', 'flywheel'];

// Thresholds. Deliberately looser than the schedules they replace (both were
// weekly): a reminder that fires the moment a week elapses is a reminder the owner
// sees most sessions, and a line seen every session stops being read — the
// lesson that killed B6.
const DUE_DAYS = { 'link-sweep': 14, curator: 14 };
const UNPUSHED_DUE_MS = 24 * 60 * 60 * 1000; // below this it is just live work

export function maintenanceSidecarPath(repoRoot) {
  return path.join(repoRoot, '.claude', '.maintenance.json');
}

function readMaintenanceSidecar(repoRoot) {
  const empty = {
    version: MAINTENANCE_SIDECAR_VERSION,
    ran: {},
    shown: null,
    budgetShown: null,
  };
  try {
    const text = readFileSafe(maintenanceSidecarPath(repoRoot));
    if (text === null) return empty;
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.ran || typeof data.ran !== 'object') return empty;
    // Fields are carried through explicitly, so anything omitted here is
    // erased by the next stampMaintenance write.
    return {
      version: MAINTENANCE_SIDECAR_VERSION,
      ran: data.ran,
      shown: data.shown || null,
      budgetShown: data.budgetShown || null,
    };
  } catch {
    // A truncated sidecar costs one over-eager reminder, never a session.
    return empty;
  }
}

// Called by a maintenance pass when it finishes. Losing this file means the
// next session is reminded of something that was already done — the cheapest
// possible failure, which is why it is machine state and not a ledger line.
export function stampMaintenance(repoRoot, job, logTag) {
  try {
    if (!MAINTENANCE_JOBS.includes(job)) return { written: false, reason: 'unknown-job' };
    const data = readMaintenanceSidecar(repoRoot);
    data.ran[job] = signalStamp(new Date());
    writeJsonAtomic(maintenanceSidecarPath(repoRoot), data);
    return { written: true, at: data.ran[job] };
  } catch (err) {
    if (logTag) logLine(repoRoot, logTag, `maintenance stamp failed: ${summarizeError(err)}`, 'WARN');
    return { written: false, reason: 'error' };
  }
}

// The calendar day in local time — the unit every once-a-day notification gate
// in this file counts in.
function localDay(now) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// The over-budget warning is raised from checkpointCommit, which runs on every
// Stop — i.e. every turn. An over-budget file stays over budget until someone
// consolidates it, so ungated that is the same line forty times in an evening,
// and a line seen that often stops being read (the lesson that killed B6). The
// CLAUDE.md cap is three proactive items a day across every surface; this is
// the second of the two gates that keep it, the due line above being the first.
export function budgetNoticeDue(repoRoot, { now = new Date(), record = true } = {}) {
  try {
    const data = readMaintenanceSidecar(repoRoot);
    const today = localDay(now);
    if (data.budgetShown === today) return false;
    if (record) {
      data.budgetShown = today;
      try {
        writeJsonAtomic(maintenanceSidecarPath(repoRoot), data);
      } catch {
        // Failing to record costs a repeated warning, never a broken session.
      }
    }
    return true;
  } catch {
    // Cannot tell — say it rather than swallow a real overflow.
    return true;
  }
}

function daysSince(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

// link-sweep writes a dated report every run, so its last run is readable off
// the tree whether or not anything stamped the sidecar. The newer of the two
// wins; the report is what makes the very first due line honest instead of
// claiming a sweep that has run twenty times has never run.
function lastLinkSweep(repoRoot, stamped) {
  let fromLog = null;
  try {
    for (const name of readdirSync(path.join(repoRoot, 'logs'))) {
      const m = /^(\d{4}-\d{2}-\d{2})_link-sweep\.md$/.exec(name);
      if (m && (fromLog === null || m[1] > fromLog)) fromLog = m[1];
    }
  } catch {
    // no logs/ dir — the stamp is then the only source
  }
  const candidates = [stamped, fromLog ? `${fromLog}T12:00Z` : null].filter(Boolean);
  if (candidates.length === 0) return null;
  return candidates.sort().pop();
}

// The backup half of retired B1, minus the network call. B1 asked whether the
// remote was reachable; the pull that runs just before this already answered
// that. What is left — and what actually breaks silently — is commits that
// never left this machine.
function unpushedBacklog(repoRoot, now) {
  try {
    const git = (args) =>
      execFileSync('git', args, {
        cwd: repoRoot,
        timeout: 10000,
        // stderr piped, not inherited: outside a repo git writes 'fatal: not a
        // git repository' straight to the session's stderr otherwise.
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
    const count = Number(git(['rev-list', '--count', '@{upstream}..HEAD']));
    if (!Number.isFinite(count) || count === 0) return null;
    const oldest = git(['log', '--reverse', '--format=%cI', '-1', '@{upstream}..HEAD']);
    const ageMs = now.getTime() - Date.parse(oldest);
    if (!Number.isFinite(ageMs) || ageMs < UNPUSHED_DUE_MS) return null;
    return `${count} commit(s) unpushed for ${Math.floor(ageMs / DAY_MS)}d`;
  } catch {
    // No upstream, no git, detached HEAD — all mean "cannot tell", not "due".
    return null;
  }
}

// Returns the one due line, or null when nothing is due. Also null when a due
// line was already shown today: the notification budget in CLAUDE.md is three
// items per day across every surface, and this hook fires in every project on
// the machine, not just in the vault.
export function maintenanceDueLine(repoRoot, { now = new Date(), record = true } = {}) {
  try {
    const data = readMaintenanceSidecar(repoRoot);
    const today = localDay(now);
    if (data.shown === today) return null;

    const parts = [];

    const sweepAt = lastLinkSweep(repoRoot, data.ran['link-sweep']);
    const sweepDays = daysSince(sweepAt, now);
    if (sweepDays !== null && sweepDays >= DUE_DAYS['link-sweep']) {
      parts.push(`link sweep ${sweepDays}d ago`);
    }

    const curatorDays = daysSince(data.ran.curator, now);
    if (curatorDays === null) parts.push('curator never run');
    else if (curatorDays >= DUE_DAYS.curator) parts.push(`curator ${curatorDays}d ago`);

    const unpushed = unpushedBacklog(repoRoot, now);
    if (unpushed) parts.push(unpushed);

    if (parts.length === 0) return null;

    if (record) {
      data.shown = today;
      try {
        writeJsonAtomic(maintenanceSidecarPath(repoRoot), data);
      } catch {
        // Failing to record costs a repeated line, never a broken session.
      }
    }
    return `Maintenance due: ${parts.join(' · ')}`;
  } catch {
    return null;
  }
}
