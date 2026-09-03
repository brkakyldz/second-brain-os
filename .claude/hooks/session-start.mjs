#!/usr/bin/env node
// SessionStart hook: pull latest vault state, then inject Tier-0 context.
// Fail-open by design (ADR 0004): every code path must exit 0.

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  budgetUsage,
  enterBrainLock,
  exitBrainLock,
  isVaultActive,
  logLine as libLogLine,
  spawnFlush,
  pendingFlushSessions,
  maintenanceDueLine,
  FLUSH_MIN_TURNS,
} from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HEADER = '## Second Brain — session context (auto-injected)';

// Brain-root resolution precedence (ADR 0008): BRAIN_DIR env → script's own
// location → CLAUDE_PROJECT_DIR. Scripts always live at
// <vault>/.claude/hooks/session-start.mjs, so script-location is always the
// vault root — this makes the same script correct when invoked from any cwd
// by user-level hooks (global mode) as well as from inside the vault itself.
function getRepoRoot() {
  const fromBrainDir = process.env.BRAIN_DIR;
  if (fromBrainDir && fromBrainDir.trim() !== '') {
    return fromBrainDir;
  }
  // script lives at <repoRoot>/.claude/hooks/session-start.mjs
  return path.resolve(__dirname, '../..');
}

// The session's own project dir — the cwd Claude Code is actually working
// in for this session. Distinct from the brain root above: when running in
// global mode this will differ from the brain root for every project except
// the vault itself.
function getProjectDir() {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv;
  }
  return process.cwd();
}

// Read stdin without ever hanging: SessionStart hooks may receive a small
// JSON payload on stdin, or nothing at all (manual invocation, empty pipe).
function readStdin(timeoutMs = 200) {
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
        // Interactive terminal with no piped input — nothing to read.
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

// Delegates to lib's writer so this hook gets the same log rotation and
// severity levels as the rest — it used to hand-roll an identical append and
// so was the one path that could grow .automation.log without bound.
function logLine(repoRoot, line, level) {
  libLogLine(repoRoot, 'SessionStart', line, level);
}

function summarizeError(err) {
  if (!err) return 'unknown error';
  if (err.killed || err.signal) {
    return `git command killed/timed out (${err.signal || 'timeout'})`;
  }
  const stderr = err.stderr ? String(err.stderr).trim() : '';
  const stdout = err.stdout ? String(err.stdout).trim() : '';
  const msg = stderr || stdout || err.message || 'unknown error';
  return msg.split('\n')[0].slice(0, 200);
}

function getGitDir(repoRoot) {
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

// Runs `git pull --rebase --autostash` under the shared brain lock. Never
// throws. Returns { ok, skipped, warning }. On failure, checks for a
// stuck/conflicted rebase and aborts it so the tree is never left mid-rebase.
//
// The lock matters here: every Claude Code session on this machine runs this
// hook against the one vault repo, and two concurrent pulls both write
// .git/FETCH_HEAD, leaving it with several for-merge entries - which is what
// "fatal: Cannot rebase onto multiple branches" actually is. A skipped pull is
// harmless: the job holding the lock is pulling the same repo right now.
function runGitPull(repoRoot) {
  if (!enterBrainLock(repoRoot, 'SessionStart', 'SessionStart')) {
    return { ok: false, skipped: true, warning: null };
  }
  try {
    return pullUnderLock(repoRoot);
  } finally {
    exitBrainLock(repoRoot);
  }
}

function pullUnderLock(repoRoot) {
  try {
    execFileSync('git', ['pull', '--rebase', '--autostash'], {
      cwd: repoRoot,
      timeout: 25000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
    });
    logLine(repoRoot, 'pull ok');
    return { ok: true, skipped: false, warning: null };
  } catch (err) {
    const reason = summarizeError(err);
    logLine(repoRoot, `pull failed: ${reason}`);

    try {
      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: repoRoot,
        timeout: 10000,
        encoding: 'utf8',
        windowsHide: true,
      });
      const hasConflictMarkerStatus = /^(UU|AA|DD|AU|UA|UD|DU) /m.test(status);
      const gitDir = getGitDir(repoRoot);
      const rebaseInProgress =
        gitDir &&
        (existsSync(path.join(gitDir, 'rebase-merge')) ||
          existsSync(path.join(gitDir, 'rebase-apply')));

      if (hasConflictMarkerStatus || rebaseInProgress) {
        try {
          execFileSync('git', ['rebase', '--abort'], {
            cwd: repoRoot,
            timeout: 10000,
            encoding: 'utf8',
            windowsHide: true,
          });
          logLine(repoRoot, 'conflict detected — rebase aborted, tree restored');
        } catch (abortErr) {
          logLine(repoRoot, `rebase --abort failed: ${summarizeError(abortErr)}`);
        }
      }
    } catch (statusErr) {
      logLine(repoRoot, `git status check failed: ${summarizeError(statusErr)}`);
    }

    return { ok: false, skipped: false, warning: reason };
  }
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function normalizeForCompare(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function buildContext(repoRoot, pullResult, projectDir) {
  const sections = [];
  const isOutsideVault = normalizeForCompare(projectDir) !== normalizeForCompare(repoRoot);

  let header = HEADER;
  if (isOutsideVault) {
    header += `\nCurrent project: ${projectDir}`;
  }
  // A skipped pull is not a failure worth a banner - the lock holder is
  // pulling the same repo. Only a real failure gets surfaced to the model.
  if (!pullResult.ok && !pullResult.skipped) {
    header += `\n⚠ git pull failed (${pullResult.warning}) — working from local state`;
  }
  sections.push(header);

  if (isOutsideVault) {
    sections.push(
      [
        '### Global brain mode — standing rules',
        `You are working outside the brain vault. The brain lives at ${repoRoot}.`,
        'When substantial learnings, decisions, or durable facts emerge in this session,',
        `append a session-log entry to ${path.join(repoRoot, 'logs', 'YYYY-MM-DD_HHMM.md')}`,
        '(taxonomy: decision|bugfix|feature|discovery|preference|change, and name the',
        `project it came from) and update ${path.join(repoRoot, 'core', 'MEMORY.md')} if a durable`,
        'fact emerged (one line, 4000-char budget, pointer style). Never write brain content',
        "into the current project's repo, and never commit the current project's files",
        'into the brain.',
      ].join('\n')
    );
  }

  // Payload budget: the harness persists hook output above ~10KB to a side
  // file and injects only a ~2KB preview — an oversized payload silently
  // un-loads Tier 0. Outside the vault only USER + MEMORY are inlined
  // (IDENTITY and OPEN_QUESTIONS are vault-internal); inside, OPEN_QUESTIONS
  // is a pointer and the log tail is dropped to stay under the threshold.
  const coreFiles = isOutsideVault
    ? ['USER.md', 'MEMORY.md']
    : ['IDENTITY.md', 'USER.md', 'MEMORY.md'];
  // Each budgeted file is headed by its own usage, so the agent knows how much
  // room it has left *before* it writes (ADR 0030). The session-end warning
  // arrives after the damage; this arrives before it. Fail-open (ADR 0004):
  // a meter that cannot be computed costs a label, never the payload.
  let usage = [];
  try {
    usage = budgetUsage(repoRoot);
  } catch {
    usage = [];
  }
  for (const name of coreFiles) {
    const content = readFileSafe(path.join(repoRoot, 'core', name));
    if (content === null) continue;
    const b = usage.find((u) => u.file === name);
    const over = b && b.count > b.limit;
    const meter = b
      ? ` — ${b.count}/${b.limit} chars (${b.pct}%)` +
        (over ? ' ⚠ OVER BUDGET, consolidate before adding' : '')
      : '';
    sections.push(`### ${name}${meter}\n${content.trimEnd()}`);
  }

  if (!isOutsideVault) {
    sections.push(
      `### OPEN_QUESTIONS.md\nNot inlined — read ${path.join(repoRoot, 'core', 'OPEN_QUESTIONS.md')} before planning vault work.`
    );
  }

  // The replacement for the retired scheduled jobs (ADR 0033). One line, at
  // most once a day, and nothing at all when nothing is due — a line that
  // always appears stops being read. Shown in every project, not only the
  // vault: unattended maintenance is gone, so the only moment left to notice
  // is whichever session the owner happens to open.
  const due = maintenanceDueLine(repoRoot);
  if (due) {
    sections.push(
      `### Maintenance
${due}
Run the matching pass when convenient — nothing is scheduled any more.`
    );
    logLine(repoRoot, `maintenance due line shown: ${due}`);
  }

  const payload = sections.join('\n\n');
  if (Buffer.byteLength(payload, 'utf8') > 9500) {
    logLine(
      repoRoot,
      `context payload ${Buffer.byteLength(payload, 'utf8')}B nears the ~10KB persisted-output threshold — trim core/ before Tier 0 stops loading`,
      'warn'
    );
  }
  return payload;
}

function emit(additionalContext) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

// Catch-up for the flush mechanism. The SessionEnd spawn is the fast path but
// not a guaranteed one — it fires while the process is being torn down, so a
// child that has not got going yet can die with its parent. Here there is no
// such race, and a session that slipped through is at most one session late.
//
// Bounded to two calls: the point is that nothing is lost, not that a backlog
// is cleared in one morning, and each call costs a Haiku summarization.
const SWEEP_MAX = 2;
const SWEEP_MIN_TURNS = FLUSH_MIN_TURNS;
const SWEEP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function sweepPendingFlushes(repoRoot, currentSid) {
  try {
    const now = Date.now();
    const due = pendingFlushSessions(repoRoot, { excludeSid: currentSid })
      .filter((s) => s.turns >= SWEEP_MIN_TURNS && now - s.startedAt.getTime() <= SWEEP_MAX_AGE_MS)
      .slice(0, SWEEP_MAX);
    for (const s of due) {
      spawnFlush(repoRoot, { sessionId: s.sid, logTag: 'SessionStart' });
    }
  } catch (err) {
    // A sweep that fails must never cost the user their session start.
    libLogLine(repoRoot, 'SessionStart', `flush sweep failed: ${err && err.message}`, 'WARN');
  }
}

async function main() {
  const raw = await readStdin();
  let currentSid = null;
  try {
    currentSid = (JSON.parse(raw || '{}') || {}).session_id || null;
  } catch {
    // no session id — the sweep just cannot exclude the current session
  }
  const repoRoot = getRepoRoot();
  const projectDir = getProjectDir();
  logLine(repoRoot, 'run started');

  if (!isVaultActive(repoRoot)) {
    logLine(repoRoot, 'no core/.vault-active marker — inert, no pull and no context injected');
    process.exit(0);
  }

  const pullResult = runGitPull(repoRoot);
  const context = buildContext(repoRoot, pullResult, projectDir);

  emit(context);
  sweepPendingFlushes(repoRoot, currentSid);
  process.exit(0);
}

main().catch((err) => {
  try {
    const repoRoot = getRepoRoot();
    logLine(
      repoRoot,
      `unexpected error: ${err && err.stack ? err.stack.split('\n')[0] : String(err)}`,
      'ERROR'
    );
  } catch {
    // ignore — logging must never throw
  }
  try {
    emit(`${HEADER}\n⚠ hook encountered an unexpected error — proceeding without full context.`);
  } catch {
    // last resort: still exit 0
  }
  process.exit(0);
});
