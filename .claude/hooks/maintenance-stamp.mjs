#!/usr/bin/env node
// Tiny CLI so a maintenance pass can record that it finished (ADR 0033).
// The session-start due check reads these stamps; without one, a pass that
// leaves no trace on the tree — /curator is the case that matters — looks like
// it has never run.
//
// Standalone tool, not a hook: bad usage is a real error here, so this exits
// non-zero on it, the same contract append-signal.mjs follows.
//
// Usage: node .claude/hooks/maintenance-stamp.mjs <job>
//   job: curator | link-sweep | flywheel

import {
  thisDir,
  getRepoRoot,
  stampMaintenance,
  maintenanceSidecarPath,
  MAINTENANCE_JOBS,
} from './lib.mjs';

const job = process.argv[2];

if (!job || !MAINTENANCE_JOBS.includes(job)) {
  process.stderr.write(
    [
      'Usage: node .claude/hooks/maintenance-stamp.mjs <job>',
      `Valid jobs: ${MAINTENANCE_JOBS.join(', ')}`,
      '',
    ].join('\n')
  );
  process.exit(1);
}

const repoRoot = getRepoRoot(thisDir(import.meta.url));
const result = stampMaintenance(repoRoot, job, 'MaintenanceStamp');

if (!result.written) {
  process.stderr.write(`maintenance-stamp: write failed (${result.reason}) — see logs/.automation.log\n`);
  process.exit(1);
}

process.stdout.write(`${job} ${result.at} -> ${maintenanceSidecarPath(repoRoot)}\n`);
