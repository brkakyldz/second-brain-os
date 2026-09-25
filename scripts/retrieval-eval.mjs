#!/usr/bin/env node
// retrieval-eval.mjs — ranked lexical lookup plus recall@k over the frozen
// `.claude/eval/golden-set.md` (A3).
//
// The vault's most consequential frozen decision is "lexical search only"
// (ADR 0018). This script is what makes that decision falsifiable instead of
// ideological: a fixed set of `query → expected note` pairs, reported as
// recall@1/@3/@5. A drop is evidence; an argument is not.
//
// **What it does not measure.** Not memory quality, and not whether a session
// answered anything correctly — only whether a simulated lexical ranker puts
// the expected file near the top. Two consequences worth knowing before
// reading any number it prints:
//
//   - Recall falls as the vault grows even when nothing degrades: more notes
//     means more files matching the same terms. In the reference instance the
//     corpus went from 14 documents to 33 in twelve days and recall@3 moved
//     79% -> 73%. That is competition, not rot.
//   - A miss is fixed with an `aliases:` line or a clearer title — but never
//     before the query has been scored. Tuning the vault to a query you have
//     already read is how a benchmark stops measuring anything.
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
      'Usage: node scripts/retrieval-eval.mjs [--verbose] [--ranker legacy|frequency-free|compare] [--help]',
      '       node scripts/retrieval-eval.mjs --query "terms" [--limit N] [--ranker legacy|frequency-free]',
      '',
      'Re-runs the query → note pairs in .claude/eval/golden-set.md against',
      'notes/ and core/, and prints recall@1/@3/@5 plus every miss.',
      '',
      '--verbose  also print the top hits for each query, not just misses.',
      '--ranker   legacy preserves the previous scorer; frequency-free uses',
      '           unique normalized token overlap; compare prints both and',
      '           the pre-registered promotion gate.',
      '--query    return ranked notes/core candidates instead of running the',
      '           frozen evaluation. The default ranker is frequency-free.',
      '',
      'Monthly cadence (the structural audit). Exits 0 always — a failing row',
      'is a finding to read, not a build to break.',
    ].join('\n')
  );
  process.exit(0);
}

const VERBOSE = process.argv.includes('--verbose');
const queryArg = process.argv.find((arg) => arg.startsWith('--query='));
const queryIndex = process.argv.indexOf('--query');
const QUERY = queryArg
  ? queryArg.slice('--query='.length)
  : queryIndex !== -1
    ? process.argv[queryIndex + 1]
    : null;
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limitIndex = process.argv.indexOf('--limit');
const LIMIT_TEXT = limitArg
  ? limitArg.slice('--limit='.length)
  : limitIndex !== -1
    ? process.argv[limitIndex + 1]
    : '10';
const LIMIT = Number.parseInt(LIMIT_TEXT, 10);
const rankerArg = process.argv.find((arg) => arg.startsWith('--ranker='));
const rankerIndex = process.argv.indexOf('--ranker');
const RANKER = rankerArg
  ? rankerArg.slice('--ranker='.length)
  : rankerIndex !== -1
    ? process.argv[rankerIndex + 1]
    : 'frequency-free';

if (!['legacy', 'frequency-free', 'compare'].includes(RANKER)) {
  console.error(`Unknown ranker: ${RANKER}`);
  process.exit(2);
}
if (QUERY !== null && (QUERY.trim() === '' || !Number.isInteger(LIMIT) || LIMIT < 1 || LIMIT > 100)) {
  console.error('Query must be non-empty and limit must be an integer from 1 to 100.');
  process.exit(2);
}
if (QUERY !== null && RANKER === 'compare') {
  console.error('Query mode accepts legacy or frequency-free, not compare.');
  process.exit(2);
}

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

// Case- and accent-folding. The Turkish locale plus the dotless-i fold makes
// I/İ/ı/i all compare equal — harmless for English, and it is what an
// agglutinative, dotted-i language needs; the NFKD strip then removes every
// other diacritic. If your queries are in another language with its own case
// rules, this is the one function to adapt.
function normalizeText(text) {
  return String(text)
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '');
}

function loadCorpus() {
  const docs = [];
  for (const dir of SEARCH_DIRS) {
    for (const rel of listMarkdown(dir)) {
      const text = readFileSafe(path.join(REPO_ROOT, rel));
      if (text === null) continue;
      // The filename is part of what grep-with-your-eyes matches on, and
      // wikilinks are filenames — so it counts as searchable text.
      const source = `${rel}\n${text}`;
      docs.push({
        rel,
        haystack: source.toLowerCase(),
        normalizedTokens: new Set(normalizeText(source).match(/[a-z0-9]+/g) || []),
      });
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

function legacyTerms(query) {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  )];
}

const NORMALIZED_STOPWORDS = new Set(
  [...STOPWORDS].flatMap((word) => normalizeText(word).match(/[a-z0-9]+/g) || [])
);

function normalizedTerms(query) {
  return [...new Set(normalizeText(query).match(/[a-z0-9]+/g) || [])]
    .filter((term) => term.length >= 3 && !NORMALIZED_STOPWORDS.has(term));
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

function rank(query, docs, ranker = 'legacy') {
  if (ranker === 'frequency-free') {
    const ts = normalizedTerms(query);
    const scored = [];
    for (const doc of docs) {
      const distinct = ts.reduce(
        (count, term) => count + (doc.normalizedTokens.has(term) ? 1 : 0),
        0
      );
      if (distinct > 0) scored.push({ rel: doc.rel, distinct, total: distinct });
    }
    scored.sort((a, b) => b.distinct - a.distinct || a.rel.localeCompare(b.rel));
    return scored;
  }

  const ts = legacyTerms(query);
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

function evaluate(rows, docs, ranker) {
  const hitsAt = new Map(KS.map((k) => [k, 0]));
  const misses = [];
  const details = [];
  const positions = new Map();

  for (const row of rows) {
    const ranked = rank(row.query, docs, ranker);
    const position = ranked.findIndex((result) => result.rel === row.expected);
    positions.set(row.id, position);
    for (const k of KS) {
      if (position !== -1 && position < k) hitsAt.set(k, hitsAt.get(k) + 1);
    }
    const top = ranked.slice(0, 3).map((result) => `${result.rel}(${result.distinct}/${result.total})`).join(', ');
    if (position === -1 || position >= Math.max(...KS)) {
      misses.push({ ...row, position, top: top || '—' });
    }
    details.push(
      `- ${row.id} — \`${row.query}\` → ${row.expected} @ ${position === -1 ? 'miss' : position + 1}${
        top ? ` · top: ${top}` : ''
      }`
    );
  }

  return { ranker, hitsAt, misses, details, positions };
}

function scoreCell(result, k, total) {
  const hits = result.hitsAt.get(k);
  return `${Math.round((hits / total) * 100)}% (${hits}/${total})`;
}

// --- Run ------------------------------------------------------------------

const { file: goldenFile, rows } = loadGoldenSet();
const docs = loadCorpus();
const out = ['# Retrieval eval', ''];

if (QUERY !== null) {
  const ranked = rank(QUERY, docs, RANKER).slice(0, LIMIT);
  console.log(`# Retrieval search\n\nQuery: \`${QUERY}\`  \nRanker: \`${RANKER}\`\n`);
  if (ranked.length === 0) {
    console.log('No matching documents.');
  } else {
    for (const [index, result] of ranked.entries()) {
      console.log(`${index + 1}. \`${result.rel}\` — ${result.distinct} distinct query token(s)`);
    }
  }
  process.exit(0);
}

if (rows.length === 0) {
  out.push(`No golden-set rows found in \`${path.relative(REPO_ROOT, goldenFile).replace(/\\/g, '/')}\`.`, '');
} else if (docs.length === 0) {
  out.push('No searchable documents under `notes/` or `core/`.', '');
} else {
  out.push(`${rows.length} queries over ${docs.length} documents (\`notes/\` + \`core/\`).`, '');
  const selectedRanker = RANKER === 'compare' ? 'legacy' : RANKER;
  const selected = evaluate(rows, docs, selectedRanker);

  if (RANKER === 'compare') {
    const candidate = evaluate(rows, docs, 'frequency-free');
    const header = ['ranker', ...KS.map((k) => `recall@${k}`)];
    out.push('## Ranker comparison', '');
    out.push(`| ${header.join(' | ')} |`);
    out.push(`|${header.map(() => '---').join('|')}|`);
    for (const result of [selected, candidate]) {
      out.push(`| ${[result.ranker, ...KS.map((k) => scoreCell(result, k, rows.length))].join(' | ')} |`);
    }
    out.push('');
    const notWorse = KS.every((k) => candidate.hitsAt.get(k) >= selected.hitsAt.get(k));
    const better = KS.some((k) => candidate.hitsAt.get(k) > selected.hitsAt.get(k));
    out.push(
      `Promotion gate: **${notWorse && better ? 'PASS' : 'FAIL'}** — candidate must be non-negative at every k and improve at least one.`,
      ''
    );
    if (VERBOSE) {
      out.push('## Changed ranks', '');
      for (const row of rows) {
        const before = selected.positions.get(row.id);
        const after = candidate.positions.get(row.id);
        if (before === after) continue;
        out.push(`- ${row.id}: ${before === -1 ? 'miss' : before + 1} → ${after === -1 ? 'miss' : after + 1}`);
      }
      out.push('');
    }
  } else {
    const header = KS.map((k) => `recall@${k}`);
    out.push(`Ranker: \`${selectedRanker}\`.`, '');
    out.push(`| ${header.join(' | ')} |`);
    out.push(`|${header.map(() => '---').join('|')}|`);
    out.push(`| ${KS.map((k) => scoreCell(selected, k, rows.length)).join(' | ')} |`, '');
  }

  out.push('## Misses', '');
  if (selected.misses.length === 0) {
    out.push('none', '');
  } else {
    for (const m of selected.misses) {
      out.push(
        `- **${m.id}** \`${m.query}\` — expected \`${m.expected}\`, ` +
          `${m.position === -1 ? 'not matched at all' : `ranked ${m.position + 1}`}. Top: ${m.top}`
      );
    }
    out.push(
      '',
      'A miss is a finding, not a failure: fix it with an `aliases:` entry or a',
      'clearer note title — after scoring, never before — and log a',
      '`retrieval-failure` line with the `cause:` that applies (`/recall`). A',
      'cluster of `paraphrase-miss` causes is the only evidence that reopens',
      'ADR 0018.',
      '',
      'These numbers rank files with a simulated lexical scorer. They say nothing',
      'about whether a session answered a question correctly, and they drift down',
      'as the corpus grows, because more notes match the same terms.',
      ''
    );
  }

  if (VERBOSE) {
    out.push(`## All queries — ${selected.ranker}`, '', ...selected.details, '');
  }
}

out.push('Generated by scripts/retrieval-eval.mjs — deterministic, no LLM.');
console.log(out.join('\n'));
