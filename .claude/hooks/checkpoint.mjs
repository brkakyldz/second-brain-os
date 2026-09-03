#!/usr/bin/env node
// Stop / PreCompact hook: checkpoint-commit the vault so at most one turn's
// work is ever at risk. Fail-open by design (ADR 0004): every code path
// must exit 0. Never blocks a session.

import {
  thisDir,
  getRepoRoot,
  readStdin,
  parseHookInput,
  logLine,
  checkpointCommit,
  isVaultActive,
  recordSessionTrace,
} from './lib.mjs';
import { runChecks } from './checks.mjs';

const __dirname = thisDir(import.meta.url);
const LOG_TAG = 'Checkpoint';

function eventLabelFor(hookEventName) {
  if (hookEventName === 'PreCompact') return 'precompact';
  return 'stop';
}

function emit(messages) {
  if (!messages || messages.length === 0) return;
  const output = { systemMessage: messages.join('\n') };
  process.stdout.write(JSON.stringify(output));
}

async function main() {
  const raw = await readStdin();
  const input = parseHookInput(raw);
  const repoRoot = getRepoRoot(__dirname);
  const eventLabel = eventLabelFor(input.hook_event_name);

  logLine(repoRoot, LOG_TAG, `run started (event=${input.hook_event_name || 'unknown'})`);

  if (!isVaultActive(repoRoot)) {
    logLine(repoRoot, LOG_TAG, 'no core/.vault-active marker — inert, nothing done');
    process.exit(0);
  }

  // Deterministic session trace (ADR 0020): written before the commit so it
  // rides along in the same checkpoint. Stop counts a turn; PreCompact only
  // makes sure the line exists.
  recordSessionTrace(repoRoot, {
    sessionId: input.session_id,
    projectDir: input.cwd,
    mode: eventLabel === 'stop' ? 'increment' : 'touch',
    logTag: LOG_TAG,
  });

  // Compiled lesson-checks (ADR 0019/0022): run before the commit so any
  // new check-fire ledger lines ride along in the same checkpoint. Warn-only
  // — findings become systemMessage lines, never a block.
  let checkMessages = [];
  try {
    const checkResult = runChecks(repoRoot, { sessionId: input.session_id, logTag: LOG_TAG });
    checkMessages = checkResult.messages || [];
  } catch (err) {
    logLine(
      repoRoot,
      LOG_TAG,
      `runChecks failed (ignored): ${err && err.message ? err.message : err}`,
      'WARN'
    );
  }

  const result = checkpointCommit(repoRoot, {
    eventLabel,
    sessionId: input.session_id,
    pushTimeoutMs: 20000,
    logTag: LOG_TAG,
  });

  emit([...checkMessages, ...((result && result.messages) || [])]);

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
