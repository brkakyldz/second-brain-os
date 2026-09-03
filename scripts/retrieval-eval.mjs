#!/usr/bin/env node
// retrieval-eval.mjs — recall@k over `.claude/eval/golden-set.md` (A3).
//
// The vault's most consequential frozen decision is "lexical search only"
// (ADR 0018). This script is what makes that decision falsifiable instead of
// ideological: a fixed set of `query → expected note` pairs, re-run monthly,
// reported as recall@1/@3/@5. A drop is evidence; an argument is not.
//
// The ranker deliberately mimics what the `/recall` skill actually does —
// case-folded substring matching of query terms over `notes/` and `core/`,
// scored by how many distinct terms a file matches. Anything cleverer would
// measure a retrieval path the agent doesn't use.
//
// Node stdlib only. Never throws: a missing golden set or empty vault prints
// an empty report and exits 0.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getRepoRoot() {
  const fromBrainDir = process.env.BRAIN_DIR;
  if (fromBrainDir && fromBrainDir.trim() !== '') return fromBrainDir;
  return path.resolve(__dirname, '..');
}

const REPO_ROOT = getRepoRoot();
const SEARCH_DIRS = ['notes', 'core'];
const KS = [1, 3, 5];

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    [
      'Usage: node scripts/retrieval-eval.mjs [--verbose] [--help]',
      '',
      'Re-runs the query → note pairs in .claude/eval/golden-set.md against',
      'notes/ and core/, and prints recall@1/@3/@5 plus every miss.',
      '',
      '--verbose  also print the top hits for each query, not just misses.',
      '',
      'Monthly cadence (the structural audit). Exits 0 always — a failing row',
      'is a finding to read, not a build to break.',
    ].join('\n')
  );
  process.exit(0);
}

const VERBOSE = process.argv.includes('--verbose');

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// --- The golden set -------------------------------------------------------
// Table rows only: `| id | query | expected |`. The header, the separator and
// all the prose around them are skipped, so the file stays readable.

function loadGoldenSet() {
  const file = path.join(REPO_ROOT, '.claude', 'eval', 'golden-set.md');
  const text = readFileSafe(file);
  if (text === null) return { file, rows: [] };
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const [id, query, expected] = cells;
    if (!/^G-\d+$/.test(id)) continue; // header + separator fall out here
    if (query === '' || expected === '') continue;
    rows.push({ id, query, expected: expected.replace(/\\/g, '/') });
  }
  return { file, rows };
}

// --- The corpus -----------------------------------------------------------

function listMarkdown(dir) {
  const abs = path.join(REPO_ROOT, dir);
  if (!existsSync(abs)) return [];
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => `${dir}/${e.name}`);
}

function loadCorpus() {
  const docs = [];
  for (const dir of SEARCH_DIRS) {
    for (const rel of listMarkdown(dir)) {
      const text = readFileSafe(path.join(REPO_ROOT, rel));
      if (text === null) continue;
      // The filename is part of what grep-with-your-eyes matches on, and
      // wikilinks are filenames — so it counts as searchable text.
      docs.push({ rel, haystack: `${rel}\n${text}`.toLowerCase() });
    }
  }
  return docs;
}

// --- Ranking --------------------------------------------------------------

// Short function words carry no retrieval signal in either language and would
// otherwise let every long note match every query.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'how', 'what', 'why', 'who', 'does',
  'did', 'do', 'is', 'in', 'on', 'of', 'to', 'a', 'an', 'it', 'its', 'that',
  'this', 'with', 'from', 'i', 'we', 'my', 'our', 'you', 'your', 'still', 'get',
  've', 'ile', 'için', 'icin', 'ne', 'mi', 'mı', 'nasıl', 'nasil', 'bir', 'bu',
]);

function terms(query) {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  )];
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function rank(query, docs) {
  const ts = terms(query);
  const scored = [];
  for (const doc of docs) {
    let distinct = 0;
    let total = 0;
    for (const t of ts) {
      const c = countOccurrences(doc.haystack, t);
      if (c > 0) {
        distinct += 1;
        total += c;
      }
    }
    if (distinct === 0) continue;
    scored.push({ rel: doc.rel, distinct, total });
  }
  // Distinct terms first (breadth beats repetition — a note that mentions
  // every term once is a better answer than one that repeats a single term),
  // then raw frequency, then path for a stable, reproducible order.
  scored.sort(
    (a, b) => b.distinct - a.distinct || b.total - a.total || a.rel.localeCompare(b.rel)
  );
  return scored;
}

// --- Run ------------------------------------------------------------------

const { file: goldenFile, rows } = loadGoldenSet();
const docs = loadCorpus();
const out = ['# Retrieval eval', ''];

if (rows.length === 0) {
  out.push(`No golden-set rows found in \`${path.relative(REPO_ROOT, goldenFile).replace(/\\/g, '/')}\`.`, '');
} else if (docs.length === 0) {
  out.push('No searchable documents under `notes/` or `core/`.', '');
} else {
  const hitsAt = new Map(KS.map((k) => [k, 0]));
  const misses = [];
  const details = [];

  for (const row of rows) {
    const ranked = rank(row.query, docs);
    const position = ranked.findIndex((r) => r.rel === row.expected);
    for (const k of KS) {
      if (position !== -1 && position < k) hitsAt.set(k, hitsAt.get(k) + 1);
    }
    const top = ranked.slice(0, 3).map((r) => `${r.rel}(${r.distinct}/${r.total})`).join(', ');
    if (position === -1 || position >= Math.max(...KS)) {
      misses.push({ ...row, position, top: top || '—' });
    }
    details.push(
      `- ${row.id} — \`${row.query}\` → ${row.expected} @ ${position === -1 ? 'miss' : position + 1}${
        top ? ` · top: ${top}` : ''
      }`
    );
  }

  out.push(`${rows.length} queries over ${docs.length} documents (\`notes/\` + \`core/\`).`, '');
  const header = KS.map((k) => `recall@${k}`);
  out.push(`| ${header.join(' | ')} |`);
  out.push(`|${header.map(() => '---').join('|')}|`);
  out.push(
    `| ${KS.map((k) => `${Math.round((hitsAt.get(k) / rows.length) * 100)}% (${hitsAt.get(k)}/${rows.length})`).join(' | ')} |`
  );
  out.push('');

  out.push('## Misses', '');
  if (misses.length === 0) {
    out.push('none', '');
  } else {
    for (const m of misses) {
      out.push(
        `- **${m.id}** \`${m.query}\` — expected \`${m.expected}\`, ` +
          `${m.position === -1 ? 'not matched at all' : `ranked ${m.position + 1}`}. Top: ${m.top}`
      );
    }
    out.push(
      '',
      'A miss is a finding, not a failure: fix it with an `aliases:` entry or a',
      'clearer note title, and log a `retrieval-failure` line with the `cause:`',
      'that applies (`/recall`). A cluster of `paraphrase-miss` causes is the',
      'only evidence that reopens ADR 0018.',
      ''
    );
  }

  if (VERBOSE) {
    out.push('## All queries', '', ...details, '');
  }
}

out.push('Generated by scripts/retrieval-eval.mjs — deterministic, no LLM.');
console.log(out.join('\n'));
