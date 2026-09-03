#!/usr/bin/env node
// Tiny CLI so skills can write Signal Ledger lines deterministically (ADR
// 0020), instead of composing a `- <fields>` line by hand and risking a typo
// in the type or the separator. Standalone tool, not a hook: bad usage is a
// real error here, so — unlike the hook path — this exits non-zero on it.
//
// Usage: node .claude/hooks/append-signal.mjs <type> <field1> [field2 ...] [--sid <sessionId>]
// See logs/signals/README.md for the ledger format and the type list.

import { thisDir, getRepoRoot, appendSignal, signalsPath, SIGNAL_TYPES } from './lib.mjs';

const LOG_TAG = 'AppendSignal';

function printUsage() {
  process.stderr.write(
    [
      'Usage: node .claude/hooks/append-signal.mjs <type> <field1> [field2 ...] [--sid <sessionId>]',
      `Valid types: ${SIGNAL_TYPES.join(', ')}`,
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let sessionId = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sid') {
      sessionId = args[i + 1] || null;
      i++; // consume the value
      continue;
    }
    rest.push(args[i]);
  }
  return { type: rest[0], fields: rest.slice(1), sessionId };
}

function main() {
  const { type, fields, sessionId } = parseArgs(process.argv);

  if (!type || !SIGNAL_TYPES.includes(type)) {
    printUsage();
    process.exit(1);
  }
  if (fields.length === 0) {
    printUsage();
    process.exit(1);
  }

  const repoRoot = getRepoRoot(thisDir(import.meta.url));
  const ok = appendSignal(repoRoot, { type, payload: fields, sessionId, logTag: LOG_TAG });

  if (!ok) {
    process.stderr.write('append-signal: write failed — see logs/.automation.log\n');
    process.exit(1);
  }

  process.stdout.write(`${signalsPath(repoRoot)}\n`);
}

main();
