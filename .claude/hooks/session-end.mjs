#!/usr/bin/env node
// SessionEnd hook: best-effort final flush. Per ADR 0004 this is a bonus,
// not the backbone — the Stop checkpoint already bounds data loss to one
// turn. Kept fast: shorter push timeout than checkpoint.mjs. Fail-open by
// design: every code path must exit 0.

import {
  thisDir,
  getRepoRoot,
  readStdin,
  parseHookInput,
  logLine,
  checkpointCommit,
  isVaultActive,
  recordSessionTrace,
  acquireBrainLock,
  releaseBrainLock,
  spawnFlush,
  runRollupIfDue,
} from './lib.mjs';

const __dirname = thisDir(import.meta.url);
const LOG_TAG = 'SessionEnd';

function emit(messages) {
  if (!messages || messages.length === 0) return;
  const output = { systemMessage: messages.join('\n') };
  process.stdout.write(JSON.stringify(output));
}

async function main() {
  const raw = await readStdin();
  const input = parseHookInput(raw);
  const repoRoot = getRepoRoot(__dirname);

  logLine(repoRoot, LOG_TAG, `run started (event=${input.hook_event_name || 'unknown'})`);

  if (!isVaultActive(repoRoot)) {
    logLine(repoRoot, LOG_TAG, 'no core/.vault-active marker — inert, nothing done');
    process.exit(0);
  }

  // Trace first, and deliberately outside the lock: since ADR 0032 the trace
  // is a gitignored sidecar write that takes no brain lock, so a contended
  // lock can no longer cost this session its turn count. This is what the
  // repeated "lock held by SessionStart — skipping this run" warnings were.
  recordSessionTrace(repoRoot, {
    sessionId: input.session_id,
    projectDir: input.cwd,
    mode: 'touch',
    logTag: LOG_TAG,
  });

  // Also before the lock: the rollup spawns a child that takes the brain lock
  // itself, so holding it here would make the two fight. At most once a week,
  // and only when the buffer has something in it.
  runRollupIfDue(repoRoot, LOG_TAG);

  // SessionEnd is terminal: unlike Stop, there is no later run to pick up what
  // a contended lock skipped, so the commit gets a short bounded retry instead
  // of a plain skip-on-contention acquire. Budget: 2 retries x 300ms, far
  // inside the hook's 30s timeout. A lock we still cannot get just falls
  // through — checkpointCommit then takes its own and may skip, which is the
  // old behaviour. Nothing here blocks the exit.
  const lock = acquireBrainLock(repoRoot, LOG_TAG, LOG_TAG, { attempts: 3, delayMs: 300 });
  if (!lock.ok) {
    logLine(
      repoRoot,
      LOG_TAG,
      'brain lock still held after 3 attempts — the final commit may be skipped',
      'WARN'
    );
  }

  let result;
  try {
    result = checkpointCommit(repoRoot, {
      eventLabel: 'session-end',
      sessionId: input.session_id,
      pushTimeoutMs: 15000,
      logTag: LOG_TAG,
    });
  } finally {
    releaseBrainLock(repoRoot, lock);
  }

  emit(result && result.messages);

  // Last thing, and deliberately outside the lock: the flush child needs the
  // lock itself, and it must not start before the checkpoint above has let go
  // of it. Detached, so the exit does not wait for a summarizer call that
  // takes tens of seconds. If this process is killed before the child gets
  // going, the next SessionStart sweep picks the session back up.
  spawnFlush(repoRoot, {
    sessionId: input.session_id,
    transcriptPath: input.transcript_path,
    logTag: LOG_TAG,
  });

  process.exit(0);
}

main().catch((err) => {
  try {
    const repoRoot = getRepoRoot(__dirname);
    logLine(
      repoRoot,
      LOG_TAG,
      `unexpected error: ${err && err.stack ? err.stack.split('\n')[0] : String(err)}`,
      'ERROR'
    );
  } catch {
    // ignore — logging must never throw
  }
  process.exit(0);
});
