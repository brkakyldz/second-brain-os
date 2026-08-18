// Shared helpers for the write-path hooks (Stop / SessionEnd / PreCompact).
// Fail-open by design (ADR 0004): every code path must exit 0. Nothing in
// here throws past its caller — callers still wrap in try/catch as a backstop.

import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
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

export function logLine(repoRoot, label, line) {
  try {
    const logDir = path.join(repoRoot, '_brain', 'logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, '.automation.log');
    appendFileSync(logPath, `[${timestamp()}] ${label}: ${line}\n`, 'utf8');
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
    }).trim();
    return path.isAbsolute(out) ? out : path.join(repoRoot, out);
  } catch {
    return null;
  }
}

// Guards, in order: rebase/merge in progress, or unmerged paths present.
// Returns { blocked: boolean, reason: string|null }.
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

function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
// Line-count budgets for the always-loaded core files (ADR 0003). Never
// truncates — only warns loudly so the model/user runs /curator.

const DEFAULT_BUDGETS = {
  'MEMORY.md': 100,
  'USER.md': 40,
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

function countBudgetLines(text) {
  return stripHtmlComments(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '').length;
}

// Checks _brain/MEMORY.md and _brain/USER.md against their line budgets.
// Returns an array of { file, count, limit } for files currently over
// budget. Never mutates anything — pure check.
export function checkBudgets(repoRoot, logTag) {
  const overBudget = [];
  for (const name of Object.keys(DEFAULT_BUDGETS)) {
    const fullPath = path.join(repoRoot, '_brain', name);
    const content = readFileSafe(fullPath);
    if (content === null) continue;
    const limit = budgetLimitFor(name);
    const count = countBudgetLines(content);
    if (count > limit) {
      overBudget.push({ file: name, count, limit });
      logLine(repoRoot, logTag, `budget exceeded: ${name} (${count}/${limit} lines)`);
    }
  }
  return overBudget;
}

// Stages everything, scans for secrets, commits if there is something
// staged, checks size budgets, and best-effort pushes. Returns a result
// object describing what happened, including any warning messages meant
// for the hook's stdout systemMessage.
export function checkpointCommit(repoRoot, { eventLabel, sessionId, pushTimeoutMs, logTag }) {
  const messages = [];

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
    });
  } catch (err) {
    logLine(repoRoot, logTag, `git add -A failed: ${summarizeError(err)}`);
    return { committed: false, reason: 'add-failed', messages };
  }

  const secretResult = scanStagedForSecrets(repoRoot, logTag);
  for (const file of secretResult.offendingFiles) {
    messages.push(`⚠ possible secret in ${file} — left uncommitted, review it`);
  }

  let hasStaged = true;
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: 'utf8',
    });
    // Exit 0 from `git diff --cached --quiet` means nothing staged.
    hasStaged = false;
  } catch (err) {
    // Non-zero exit means there IS a staged diff — this is the expected
    // "we have something to commit" path, not a real error.
    if (typeof err.status !== 'number' || err.status !== 1) {
      logLine(repoRoot, logTag, `git diff --cached --quiet check failed: ${summarizeError(err)}`);
      return { committed: false, reason: 'diff-check-failed', messages };
    }
  }

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
      });
      logLine(repoRoot, logTag, `committed (${eventLabel})`);
    } catch (err) {
      logLine(repoRoot, logTag, `git commit failed: ${summarizeError(err)}`);
      return { committed: false, reason: 'commit-failed', messages };
    }

    try {
      execFileSync('git', ['push'], {
        cwd: repoRoot,
        timeout: pushTimeoutMs,
        encoding: 'utf8',
      });
      logLine(repoRoot, logTag, 'push ok');
      result = { committed: true, pushed: true, messages };
    } catch (err) {
      logLine(repoRoot, logTag, `push failed (commit is safe locally): ${summarizeError(err)}`);
      result = { committed: true, pushed: false, messages };
    }
  }

  // Budget guard: always re-checked after the commit attempt (whether or
  // not this run had anything to commit) so a file edited outside the hook
  // still gets flagged. Never blocks; commit above has already happened.
  const overBudget = checkBudgets(repoRoot, logTag);
  for (const b of overBudget) {
    messages.push(
      `⚠ ${b.file} over budget (${b.count}/${b.limit} lines) — run /curator to consolidate`
    );
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
