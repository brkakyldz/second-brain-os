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
  backupNotice,
  emitNotices,
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

// Runs `git pull --rebase` on a clean tree under the shared brain lock. Never
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

// Tracked, uncommitted changes belong to a live task — possibly in the other
// runtime (ADR 0044). `--autostash` used to lift them off the disk for the
// pull and put them back; when the put-back failed they were stranded in a
// stash while their owner kept working (2026-09-22). So a dirty tree skips the
// pull outright: a stale session start is cheap, another task's files are not.
function trackedChanges(repoRoot) {
  try {
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return 'unknown';
  }
}

function pullUnderLock(repoRoot) {
  const dirty = trackedChanges(repoRoot);
  if (dirty) {
    const count = dirty === 'unknown' ? '?' : dirty.split(/\r?\n/).length;
    logLine(repoRoot, `pull skipped: ${count} tracked path(s) uncommitted — a live task owns them`);
    return { ok: false, skipped: true, warning: null };
  }
  try {
    execFileSync('git', ['pull', '--rebase'], {
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

// The HTML comments at the head of MEMORY.md and USER.md are instructions to
// whoever *writes* those files — budgets, what does not belong there, which
// ADR decided it. They are not facts about the owner or the world, the budget
// counter already excludes them (`countBudgetChars`), and injecting them spent
// ~600 bytes of a payload measured against a threshold that turns Tier 0 off.
// Stripped here so what is counted and what is delivered are the same text.
function stripWriterComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function normalizeForCompare(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function section(text, { label = 'section', optional = false } = {}) {
  return { text, label, optional };
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
  // Sections carry a label and whether they may be dropped when the payload
  // is over the limit. Core content (Tier-0 files, the standing rules a
  // global-mode session needs) is never optional.
  sections.push(section(header, { label: 'header' }));

  if (isOutsideVault) {
    sections.push(
      section(
      [
        '### Global brain mode — standing rules',
        `You are working outside the brain vault. The brain lives at ${repoRoot}.`,
        'When substantial learnings, decisions, or durable facts emerge in this session,',
        `append a session-log entry to ${path.join(repoRoot, 'logs', 'YYYY-MM-DD_HHMM.md')}`,
        '(taxonomy: decision|bugfix|feature|discovery|preference|change, and name the',
        'project it came from). Do not write a log for ordinary conversation, questions,',
        'brainstorming, status checks or planning-only work.',
        `Update ${path.join(repoRoot, 'core', 'MEMORY.md')} if a durable`,
        'fact emerged (one line, 4000-char budget, pointer style). Never write brain content',
        "into the current project's repo, and never commit the current project's files",
        'into the brain. Brain commits are task-owned: stage only the brain files you wrote.',
      ].join('\n'),
      { label: 'global-brain-rules' }
      )
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
    sections.push(section(`### ${name}${meter}\n${stripWriterComments(content).trim()}`));
  }

  if (!isOutsideVault) {
    sections.push(
      section(
        `### OPEN_QUESTIONS.md\nNot inlined — read ${path.join(repoRoot, 'core', 'OPEN_QUESTIONS.md')} before planning vault work.`,
        { label: 'open-questions-pointer' }
      )
    );
  }

  // The only thing a session start volunteers now: whether the vault's work
  // is actually backed up. The maintenance due line that stood here — curator
  // 14d ago, audit never run — was removed on 2026-09-06 along with the passes
  // that fed it: it measured staleness against a schedule nothing runs, and a
  // reminder to run a pass is not a finding. Backup failures are priority 0 in
  // the shared daily notice budget, because they are the one thing no later
  // session can recover.
  const backup = emitNotices(repoRoot, [backupNotice(repoRoot)], { logTag: 'SessionStart' });
  for (const line of backup) {
    sections.push(section(`### Backup\n${line}`, { label: 'backup-notice', optional: true }));
    logLine(repoRoot, `backup notice shown: ${line}`);
  }

  return fitPayload(repoRoot, sections);
}

// Above roughly 10KB the harness is believed to persist hook output to a side
// file and inject only a preview, which would silently un-load Tier 0. That
// number is a **hypothesis** from the 2026-09-06 audit, not a documented
// product guarantee — so this measures the whole serialized hook output, JSON
// envelope included, logs the figure on every run so the real threshold can be
// observed rather than assumed, and never truncates anything silently.
//
// Over the limit, optional sections are dropped whole, newest first: a backup
// notice or a status banner loses its space before a Tier-0 file does. If only
// core content is left it is delivered oversized and loudly logged — half a
// MEMORY.md is worse than a payload the harness may or may not shorten.
const PAYLOAD_SOFT_LIMIT_BYTES = 9500;

function serializedSize(payload) {
  const envelope = {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: payload },
  };
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
}

function fitPayload(repoRoot, sections) {
  const kept = [...sections];
  const join = () => kept.map((x) => x.text).join(String.fromCharCode(10, 10));
  let size = serializedSize(join());
  const dropped = [];

  while (size > PAYLOAD_SOFT_LIMIT_BYTES && kept.some((x) => x.optional)) {
    let idx = -1;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].optional) {
        idx = i;
        break;
      }
    }
    dropped.push(kept[idx].label);
    kept.splice(idx, 1);
    size = serializedSize(join());
  }

  logLine(repoRoot, `context payload ${size}B serialized (soft limit ${PAYLOAD_SOFT_LIMIT_BYTES}B, a hypothesis)`);
  if (dropped.length > 0) {
    logLine(repoRoot, `payload over the limit — dropped optional section(s): ${dropped.join(', ')}`, 'warn');
  }
  if (size > PAYLOAD_SOFT_LIMIT_BYTES) {
    logLine(
      repoRoot,
      `context payload ${size}B is over the limit with only core content left — consolidate core/ rather than leaving it to the harness to decide what arrives`,
      'warn'
    );
  }
  return join();
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

// The flush sweep that used to live here was removed with the flush mechanism
// itself (ADR 0038). SessionStart now pulls, injects
// Tier 0, and stops — nothing is spawned, and stdin is read only to satisfy
// the hook protocol.
async function main() {
  await readStdin();
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
