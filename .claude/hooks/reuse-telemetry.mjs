#!/usr/bin/env node
// reuse-telemetry.mjs — PostToolUse hook behind the vault's health metric:
// "which notes were actually re-used this month?" (Q-14, lifecycle-policy §10).
//
// Reuse can only be observed *after* a tool runs — a pre-hook cannot log a
// result it has not seen — so this is PostToolUse on Read / Grep / Glob. Every
// vault note touched by one of those tools is counted once per session in the
// gitignored `.claude/.access.json` sidecar (ADR 0011 permits derived, rebuild-
// tolerant instrumentation; ADR 0024 for this design). The weekly rollup in
// `scripts/flywheel-metrics.mjs --rollup` turns a week of that buffer into one
// durable `retrieval-rollup` ledger line — hundreds of events, one tracked line.
//
// Hot-path contract (ADR 0024): no git, no lock, no vault scan, no network.
// Fail-open like every hook here (ADR 0004): any failure exits 0 silently.

import {
  thisDir,
  getRepoRoot,
  readStdin,
  parseHookInput,
  isVaultActive,
  recordNoteAccess,
  ACCESS_MAX_PATHS_PER_CALL,
} from './lib.mjs';

const LOG_TAG = 'ReuseTelemetry';
const TOOLS = new Set(['Read', 'Grep', 'Glob']);

// Pull every plausible file path out of a tool call. `Read` states its target
// in the input; `Grep`/`Glob` only reveal what was actually touched in their
// output, which may be an array of paths or `rg`-style `path:line:text` lines.
function collectPaths(toolName, input, response) {
  const out = [];
  const push = (v) => {
    if (typeof v === 'string' && v.trim() !== '' && out.length < ACCESS_MAX_PATHS_PER_CALL * 5) {
      out.push(v.trim());
    }
  };

  if (toolName === 'Read') {
    push(input && input.file_path);
    return out;
  }

  // Grep/Glob: the input `path` is a search root, not a hit — deliberately
  // ignored, or every grep over the vault would count core/ as re-used.
  const walk = (v, depth) => {
    if (depth > 3 || out.length >= ACCESS_MAX_PATHS_PER_CALL * 5) return;
    if (typeof v === 'string') {
      for (const line of v.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        // `path:line:content` (content mode) or a bare path (files mode).
        const m = trimmed.match(/^(.*?\.md)(?::\d+)?(?::|$)/);
        if (m) push(m[1]);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (v && typeof v === 'object') {
      for (const key of ['filenames', 'files', 'paths', 'content', 'output', 'result', 'stdout']) {
        if (key in v) walk(v[key], depth + 1);
      }
    }
  };
  walk(response, 0);
  return out;
}

async function main() {
  const repoRoot = getRepoRoot(thisDir(import.meta.url));
  if (!isVaultActive(repoRoot)) return; // ADR 0014: inert without the marker

  const payload = parseHookInput(await readStdin());
  if (!payload) return;

  const toolName = payload.tool_name || payload.toolName;
  if (!TOOLS.has(toolName)) return;

  const files = collectPaths(toolName, payload.tool_input || {}, payload.tool_response);
  if (files.length === 0) return;

  recordNoteAccess(repoRoot, {
    files,
    sessionId: payload.session_id || payload.sessionId || null,
    logTag: LOG_TAG,
  });
}

try {
  await main();
} catch {
  // Fail open, and silently: this runs on every tool call in every project.
}
process.exit(0);
