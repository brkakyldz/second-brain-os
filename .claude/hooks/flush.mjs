#!/usr/bin/env node
// Session flush: reconstruct a session log from the transcript when the agent
// ended a session without writing one.
//
// The session-log rule in CLAUDE.md is a standing instruction, and a standing
// instruction is a discipline: it holds until the one session where the model
// is out of context, or the owner closes the window mid-thought. Then that
// session's meaning is gone — the checkpoint commits saved the files, but
// nothing recorded what was decided or learned. This is the mechanism behind
// the discipline, the same shape as the SubagentStop report reconstruction:
// the agent writing the log is still the standard, this is the safety net.
//
// Invoked detached, never inline:
//   node flush.mjs --sid <session-id> [--transcript <path>]
//
// Fail-open like every hook here (ADR 0004): every path exits 0, and a flush
// that cannot run leaves the vault exactly as it was.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  thisDir,
  getRepoRoot,
  logLine,
  isVaultActive,
  readFileSafe,
  signalsPath,
  appendSignal,
  digestedSessionIds,
  sessionTrace,
  allSessionTraces,
  checkpointCommit,
  summarizeError,
  FLUSH_MIN_TURNS,
} from './lib.mjs';

const __dirname = thisDir(import.meta.url);
const LOG_TAG = 'Flush';

// A session shorter than this said nothing worth a log. beyin.md's equivalent
// gate is 5 prompts; ours counts Stop events, which are coarser. Shared with
// the SessionStart sweep and SessionEnd — see FLUSH_MIN_TURNS in lib.mjs.
const MIN_TURNS = FLUSH_MIN_TURNS;
// Haiku is the right model here: this is compression, not judgment.
const MODEL = 'claude-haiku-4-5-20251001';
const CALL_TIMEOUT_MS = 180000;
const MAX_DIGEST_CHARS = 60000;
const MAX_MESSAGE_CHARS = 1500;
// Clock skew between the ledger's minute-precision stamp and file mtimes.
const MTIME_SLACK_MS = 120000;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--sid') out.sid = argv[++i];
    else if (a === '--transcript') out.transcript = argv[++i];
  }
  return out;
}

// --- one flush per session ---------------------------------------------
// The ledger check below is necessary but not sufficient. On 2026-08-26 three
// flushes of one session ran concurrently: each read the ledger before any of
// them had written, each spent tens of seconds summarizing, and all three
// appended a `session-digest` line for the same sid. A check cannot serialize
// work that outlives the gap between spawns, so the claim is taken up front
// and held for the whole run (ADR 0032).
const FLUSH_CLAIM_TTL_MS = 10 * 60 * 1000;

function claimPath(repoRoot, sid) {
  const safe = String(sid).replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(repoRoot, '.claude', `.flush-${safe}.lock`);
}

function claimFlush(repoRoot, sid) {
  const file = claimPath(repoRoot, sid);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    // A crashed flush must not silence its session for good: a claim older
    // than the TTL is treated as abandoned.
    if (existsSync(file)) {
      if (Date.now() - statSync(file).mtimeMs < FLUSH_CLAIM_TTL_MS) return null;
      try {
        unlinkSync(file);
      } catch {
        return null;
      }
    }
    // 'wx' is the whole mutex: an exclusive create is atomic, so exactly one
    // of N racing flushes gets the file and the rest get EEXIST.
    writeFileSync(file, String(process.pid), { encoding: 'utf8', flag: 'wx' });
    return file;
  } catch {
    return null;
  }
}

function releaseFlush(file) {
  if (!file) return;
  try {
    unlinkSync(file);
  } catch {
    // A claim we cannot remove expires on its own TTL.
  }
}

// --- did the agent already log this session? ---------------------------

// Only bare `YYYY-MM-DD_HHMM.md` files count. The suffixed ones in logs/ are
// machine jobs (link-sweep, system-audit, and this flush), not session logs.
const SESSION_LOG_RE = /^\d{4}-\d{2}-\d{2}_\d{4}\.md$/;

function agentLoggedWithin(repoRoot, fromMs, toMs) {
  const logsDir = path.join(repoRoot, 'logs');
  let entries;
  try {
    entries = readdirSync(logsDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!SESSION_LOG_RE.test(name)) continue;
    try {
      const m = statSync(path.join(logsDir, name)).mtimeMs;
      if (m >= fromMs - MTIME_SLACK_MS && m <= toMs + MTIME_SLACK_MS) return name;
    } catch {
      // unreadable entry — treat as absent
    }
  }
  return null;
}

// --- transcript --------------------------------------------------------

function transcriptPathFor(repoRoot, sid) {
  const slug = repoRoot.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug, `${sid}.jsonl`);
}

function stripNoise(text) {
  return String(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[\s\S]*?<\/local-command-[^>]*>/g, '')
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, '')
    .trim();
}

function textOf(content) {
  if (typeof content === 'string') return stripNoise(content);
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    // Tool calls, tool results and thinking are the session's machinery, not
    // its meaning — and they are the bulk of the bytes.
    if (block && block.type === 'text' && block.text) parts.push(block.text);
  }
  return stripNoise(parts.join('\n'));
}

function clip(s, max) {
  return s.length <= max ? s : `${s.slice(0, max)} […]`;
}

// Renders the conversation as plain speaker-tagged prose. Sidechains are
// subagent turns: they belong to their own reports, not to this log.
function buildDigest(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.isSidechain) continue;
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg) continue;
    const text = textOf(msg.content);
    if (!text) continue;
    out.push(`${obj.type === 'user' ? 'USER' : 'ASSISTANT'}: ${clip(text, MAX_MESSAGE_CHARS)}`);
  }
  if (out.length === 0) return null;

  let digest = out.join('\n\n');
  if (digest.length > MAX_DIGEST_CHARS) {
    // Keep both ends: the opening frames what the session was for, the close
    // holds what it concluded. The middle is the part a summary can afford.
    const head = Math.floor(MAX_DIGEST_CHARS * 0.4);
    const tail = MAX_DIGEST_CHARS - head;
    digest = `${digest.slice(0, head)}\n\n[… middle of session elided …]\n\n${digest.slice(-tail)}`;
  }
  return digest;
}

// --- summarizer --------------------------------------------------------

function buildPrompt(digest) {
  return [
    'You are writing the session log for a personal knowledge vault. The vault is in English.',
    '',
    'Below is a digest of one Claude Code session: what the user and the assistant said,',
    'with tool calls and thinking stripped out.',
    '',
    'Write the BODY of the log entry only. No frontmatter, no title, no preamble, no closing line.',
    '',
    'Format — markdown bullets, each one a tag in backticks, then a bold claim, then the detail:',
    '  - `discovery` — **Short claim in bold.** One or two sentences of detail.',
    '',
    'Allowed tags: decision, bugfix, feature, discovery, preference, change.',
    '',
    'Rules:',
    '- English. At most 8 bullets. There is no minimum: write only the bullets that clear',
    '  the bar. Zero bullets is a normal, expected outcome for a session that was mostly',
    '  conversation. Never pad to reach a count.',
    '- The bar: something was decided, learned, built, fixed, or preferred. A topic that was',
    '  explored, weighed, or explained but left unresolved does not clear it.',
    '- `decision` is only for a choice that was made and acted on. Anything proposed,',
    '  recommended or considered but not carried out is `discovery`, and its detail ends',
    '  with "(proposed, not applied)".',
    '- Never invent a fact that is not in the digest.',
    '- If nothing clears the bar, output exactly NOTHING_DURABLE and nothing else.',
    '',
    'Session digest:',
    '<<<TRANSCRIPT',
    digest,
    'TRANSCRIPT',
  ].join('\n');
}

// The summarizer runs with `--setting-sources project`, which is what keeps
// this from being a fork bomb: the hooks that would fire for this child (and
// spawn another flush) live in user settings, so excluding that source leaves
// the child with no hooks at all. BRAIN_FLUSH is the belt to that suspenders —
// any hook that does load can see it is inside a flush and stay out.
function summarize(repoRoot, digest) {
  try {
    const stdout = execFileSync(
      'claude',
      [
        '-p',
        buildPrompt(digest),
        '--model',
        MODEL,
        '--setting-sources',
        'project',
        '--output-format',
        'text',
      ],
      {
        cwd: os.tmpdir(),
        timeout: CALL_TIMEOUT_MS,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, BRAIN_FLUSH: '1' },
        windowsHide: true,
      }
    );
    return (stdout || '').trim();
  } catch (err) {
    logLine(repoRoot, LOG_TAG, `summarizer failed: ${summarizeError(err)}`, 'WARN');
    return null;
  }
}

// --- validation --------------------------------------------------------

// One bullet per block: a tag from the vault's taxonomy, then a bold claim.
// The separator is optional — early digests wrote the claim straight after the
// tag, and those are well-formed enough to keep.
const BULLET_RE = /^-\s+`(decision|bugfix|feature|discovery|preference|change)`\s*(?:[—–-]\s*)?\*\*.+/;

// A small model writing into an append-only folder gets its output checked
// before it lands: lines that are not bullets in the taxonomy are dropped, and
// a body with nothing left standing is never written. A malformed digest is
// worse than no digest — logs/ is evidence, and evidence is never rewritten.
function validateBody(body) {
  const kept = [];
  let dropped = 0;
  for (const block of body.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (BULLET_RE.test(trimmed)) kept.push(trimmed);
    else dropped += 1;
  }
  return { body: kept.join('\n\n'), kept: kept.length, dropped };
}

// --- output ------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0');
}

// Named and dated for the session it describes, not for the moment the flush
// happened to run — a digest swept up the next morning still files itself
// under the day it belongs to.
function logFileFor(repoRoot, startedAt) {
  const d = startedAt;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  return {
    date,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    file: path.join(repoRoot, 'logs', `${date}_${time}-flush.md`),
  };
}

function renderLog({ date, time }, sid, turns, body) {
  return [
    '---',
    'type: log',
    `created: ${date}`,
    'tags: [session-digest, machine-written]',
    'generated_by: flush',
    `session: ${sid}`,
    '---',
    '',
    `# Session digest — ${date} ${time} (machine-written)`,
    '',
    `> Reconstructed from the transcript because this session (${turns} turns) ended`,
    '> without an agent-written log. A record of what was said, not a curated one:',
    '> treat every line as unverified until a later session confirms it.',
    '',
    body.trim(),
    '',
  ].join('\n');
}

// --- main --------------------------------------------------------------

function recordSkip(repoRoot, sid, reason) {
  appendSignal(repoRoot, {
    type: 'session-digest',
    payload: [`skipped:${reason}`],
    sessionId: sid,
    logTag: LOG_TAG,
  });
}

function main() {
  // A flush spawning a flush would be unbounded. Nothing below runs inside one.
  if (process.env.BRAIN_FLUSH === '1') process.exit(0);

  const args = parseArgs(process.argv);
  const repoRoot = getRepoRoot(__dirname);
  if (!args.sid) {
    logLine(repoRoot, LOG_TAG, 'no --sid — nothing to flush', 'WARN');
    process.exit(0);
  }
  if (!isVaultActive(repoRoot)) process.exit(0);

  if (digestedSessionIds(repoRoot).has(args.sid)) process.exit(0);

  // Taken before any work, released on every exit path below.
  const claim = claimFlush(repoRoot, args.sid);
  if (!claim) {
    logLine(repoRoot, LOG_TAG, `another flush already holds ${args.sid} — standing down`);
    process.exit(0);
  }
  const done = (code) => {
    releaseFlush(claim);
    process.exit(code);
  };

  const sessions = allSessionTraces(repoRoot);
  const self = sessionTrace(repoRoot, args.sid);
  if (!self) {
    // No trace line means the session never completed a turn.
    logLine(repoRoot, LOG_TAG, `no session trace for ${args.sid} — nothing to flush`);
    done(0);
  }
  if (self.turns < MIN_TURNS) {
    // No skip signal on purpose: the sweep filters on turns too, so a short
    // session is never retried, and a ledger line for every two-turn question
    // would bury the lines that mean something.
    logLine(repoRoot, LOG_TAG, `session ${args.sid} had ${self.turns} turns — below threshold`);
    done(0);
  }

  // The window this session could have written a log in: from its own first
  // turn to the start of whichever session opened next. Without the upper
  // bound, a log written days later would look like this session's own.
  const startMs = self.startedAt.getTime();
  const nextStart = sessions
    .map((s) => s.startedAt.getTime())
    .filter((t) => t > startMs)
    .sort((a, b) => a - b)[0];
  const existing = agentLoggedWithin(repoRoot, startMs, nextStart || Date.now());
  if (existing) {
    logLine(repoRoot, LOG_TAG, `agent already logged ${args.sid} in ${existing} — flush skipped`);
    recordSkip(repoRoot, args.sid, 'agent-logged');
    done(0);
  }

  const transcriptPath =
    args.transcript && existsSync(args.transcript)
      ? args.transcript
      : transcriptPathFor(repoRoot, args.sid);
  const digest = buildDigest(transcriptPath);
  if (!digest) {
    logLine(repoRoot, LOG_TAG, `no readable transcript at ${transcriptPath}`, 'WARN');
    recordSkip(repoRoot, args.sid, 'no-transcript');
    done(0);
  }

  logLine(repoRoot, LOG_TAG, `summarizing ${args.sid} (${self.turns} turns, ${digest.length} chars)`);
  const body = summarize(repoRoot, digest);
  if (!body) {
    // Deliberately no skip signal: a failed call should be retried by the next
    // SessionStart sweep, and a signal here would make it look handled.
    done(0);
  }
  // Equality, not a substring match: a bullet that happens to mention the
  // sentinel must not silently discard the whole digest.
  if (/^NOTHING_DURABLE\.?$/.test(body.trim())) {
    logLine(repoRoot, LOG_TAG, `session ${args.sid} produced nothing durable`);
    recordSkip(repoRoot, args.sid, 'nothing-durable');
    done(0);
  }

  const checked = validateBody(body);
  if (checked.dropped > 0) {
    logLine(repoRoot, LOG_TAG, `dropped ${checked.dropped} malformed line(s) from ${args.sid}`, 'WARN');
  }
  if (checked.kept === 0) {
    // Terminal, like nothing-durable: retrying an unusable answer just burns
    // another Haiku call on every sweep for three days.
    logLine(repoRoot, LOG_TAG, `session ${args.sid} summary had no usable bullets`, 'WARN');
    recordSkip(repoRoot, args.sid, 'unusable-output');
    done(0);
  }

  const target = logFileFor(repoRoot, self.startedAt);
  try {
    writeFileSync(target.file, renderLog(target, args.sid, self.turns, checked.body), 'utf8');
  } catch (err) {
    logLine(repoRoot, LOG_TAG, `write failed: ${summarizeError(err)}`, 'ERROR');
    done(0);
  }

  const rel = path.relative(repoRoot, target.file).replace(/\\/g, '/');
  logLine(repoRoot, LOG_TAG, `wrote ${rel}`);
  // Belt and braces: the claim serializes the normal case, this catches the
  // one it cannot — a claim expired by TTL and taken by a second flush while
  // the first was still inside its summarizer call.
  if (digestedSessionIds(repoRoot).has(args.sid)) {
    logLine(repoRoot, LOG_TAG, `digest for ${args.sid} landed while summarizing — skipping the duplicate`, 'WARN');
    done(0);
  }
  appendSignal(repoRoot, {
    type: 'session-digest',
    payload: [`file:${rel}`, `turns:${self.turns}`],
    sessionId: args.sid,
    logTag: LOG_TAG,
  });

  checkpointCommit(repoRoot, {
    eventLabel: 'flush',
    sessionId: args.sid,
    pushTimeoutMs: 15000,
    logTag: LOG_TAG,
  });

  done(0);
}

try {
  main();
} catch (err) {
  try {
    logLine(getRepoRoot(__dirname), LOG_TAG, `unexpected error: ${summarizeError(err)}`, 'ERROR');
  } catch {
    // ignore — logging must never throw
  }
  process.exit(0);
}
