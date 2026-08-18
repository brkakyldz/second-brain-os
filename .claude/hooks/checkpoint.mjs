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
} from './lib.mjs';

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

  const result = checkpointCommit(repoRoot, {
    eventLabel,
    sessionId: input.session_id,
    pushTimeoutMs: 20000,
    logTag: LOG_TAG,
  });

  emit(result && result.messages);

  process.exit(0);
}

main().catch((err) => {
  try {
    const repoRoot = getRepoRoot(__dirname);
    logLine(
      repoRoot,
      LOG_TAG,
      `unexpected error: ${err && err.stack ? err.stack.split('\n')[0] : String(err)}`
    );
  } catch {
    // ignore — logging must never throw
  }
  process.exit(0);
});
