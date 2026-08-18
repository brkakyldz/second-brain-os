#!/usr/bin/env node
// SessionStart hook: pull latest vault state, then inject Tier-0 context.
// Fail-open by design (ADR 0004): every code path must exit 0.

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HEADER = '## Second Brain — session context (auto-injected)';

function getRepoRoot() {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && fromEnv.trim() !== '') {
    return fromEnv;
  }
  // script lives at <repoRoot>/.claude/hooks/session-start.mjs
  return path.resolve(__dirname, '../..');
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

function timestamp() {
  return new Date().toISOString();
}

function logLine(repoRoot, line) {
  try {
    const logDir = path.join(repoRoot, '_brain', 'logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, '.automation.log');
    appendFileSync(logPath, `[${timestamp()}] SessionStart: ${line}\n`, 'utf8');
  } catch {
    // Logging must never throw or block the hook.
  }
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
    }).trim();
    return path.isAbsolute(out) ? out : path.join(repoRoot, out);
  } catch {
    return null;
  }
}

// Runs `git pull --rebase --autostash`. Never throws. Returns
// { ok: boolean, warning: string|null }. On failure, checks for a
// stuck/conflicted rebase and aborts it so the tree is never left mid-rebase.
function runGitPull(repoRoot) {
  try {
    execFileSync('git', ['pull', '--rebase', '--autostash'], {
      cwd: repoRoot,
      timeout: 25000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    logLine(repoRoot, 'pull ok');
    return { ok: true, warning: null };
  } catch (err) {
    const reason = summarizeError(err);
    logLine(repoRoot, `pull failed: ${reason}`);

    try {
      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: repoRoot,
        timeout: 10000,
        encoding: 'utf8',
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
          });
          logLine(repoRoot, 'conflict detected — rebase aborted, tree restored');
        } catch (abortErr) {
          logLine(repoRoot, `rebase --abort failed: ${summarizeError(abortErr)}`);
        }
      }
    } catch (statusErr) {
      logLine(repoRoot, `git status check failed: ${summarizeError(statusErr)}`);
    }

    return { ok: false, warning: reason };
  }
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function findLatestSessionLog(logsDir) {
  try {
    const entries = readdirSync(logsDir);
    const pattern = /^\d{4}-\d{2}-\d{2}_\d{4}\.md$/;
    const matches = entries.filter((f) => pattern.test(f));
    if (matches.length === 0) return null;
    matches.sort();
    matches.reverse();
    return matches[0];
  } catch {
    return null;
  }
}

function buildContext(repoRoot, pullResult) {
  const sections = [];

  let header = HEADER;
  if (!pullResult.ok) {
    header += `\n⚠ git pull failed (${pullResult.warning}) — working from local state`;
  }
  sections.push(header);

  const coreFiles = ['IDENTITY.md', 'USER.md', 'MEMORY.md'];
  for (const name of coreFiles) {
    const content = readFileSafe(path.join(repoRoot, '_brain', name));
    if (content !== null) {
      sections.push(`### ${name}\n${content.trimEnd()}`);
    }
  }

  const logsDir = path.join(repoRoot, '_brain', 'logs');
  const latestLog = findLatestSessionLog(logsDir);
  if (latestLog) {
    const content = readFileSafe(path.join(logsDir, latestLog));
    if (content !== null) {
      const tailLines = content.split('\n').slice(-40).join('\n').trimEnd();
      sections.push(`### Last session log (tail): ${latestLog}\n${tailLines}`);
    }
  }

  return sections.join('\n\n');
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

async function main() {
  await readStdin();
  const repoRoot = getRepoRoot();
  logLine(repoRoot, 'run started');

  const pullResult = runGitPull(repoRoot);
  const context = buildContext(repoRoot, pullResult);

  emit(context);
  process.exit(0);
}

main().catch((err) => {
  try {
    const repoRoot = getRepoRoot();
    logLine(repoRoot, `unexpected error: ${err && err.stack ? err.stack.split('\n')[0] : String(err)}`);
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
