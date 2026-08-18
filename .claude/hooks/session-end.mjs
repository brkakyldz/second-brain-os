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

  const result = checkpointCommit(repoRoot, {
    eventLabel: 'session-end',
    sessionId: input.session_id,
    pushTimeoutMs: 15000,
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
