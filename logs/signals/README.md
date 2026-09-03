# Signal ledger — conventions

One append-only file per month, `logs/signals/YYYY-MM.md`. This is the single
place every detector writes and every audit reads . Plain Markdown,
so `rg` is the whole query engine.

## Line format

```
- <ISO-UTC timestamp, minute precision> | <type> | <payload…> | sid:<session id>
```

Example:

```
- 2026-08-25T12:19Z | session | project:/path/to/your-brain | turns:7 | sid:abc-123
- 2026-08-25T13:02Z | retrieval-failure | query:"vault lifecycle" | sid:abc-123
```

Timestamps are UTC and end in `Z` — unlike the local-time filenames in
`logs/`, a ledger line has to be comparable across machines.

## Types

| type | written by | means |
|---|---|---|
| `correction` | `/lesson` skill | the owner corrected the agent; payload is verbatim |
| `retrieval-failure` | agent, on a failed lookup | the vault had it and search missed it; carries `cause:` |
| `acceptance` / `rejection` | agent, per proposal | a suggestion was taken or refused |
| `check-fire` | `.claude/hooks/checks.mjs` (run from the Stop checkpoint) | an enforced rule caught a repeat attempt |
| `retrieval-rollup` | `scripts/flywheel-metrics.mjs --rollup`, weekly | one week of note re-use, folded into a single line |
| `session-digest` | `.claude/hooks/flush.mjs` | one line per flushed session — the digest written, or why the flush stood down |

## Rules

- **Append-only.** Never rewrite a past line — a correction is a *newer* line.
- **One line per event**, no wrapping. Merge conflicts are avoided by
  `merge=union` in `.gitattributes`.
- **Monthly files bound growth.** Old months distill into the monthly audit
  and archive like any other episodic content — never deleted.
- **`check-fire` lines are deduplicated** — one line per (check, file, detail)
  per month file, so a stuck violation cannot flood the ledger.
- **Skills write lines via the CLI, never by hand-formatting:**
  `node .claude/hooks/append-signal.mjs <type> <field>... [--sid <id>]`.

## Required payload fields

Two types are read by a metric, so their payload is not free-form:

- **`retrieval-failure`** carries `cause:` — one of `paraphrase-miss`,
  `wrong-term`, `typo`, `not-exists` (`/recall` defines them). Without it the
  line cannot argue for anything, and `flywheel-metrics.mjs` counts it as
  `uncaused`. Only a cluster of `paraphrase-miss` reopens the
  lexical-only-retrieval decision (`docs/DECISIONS.md`, 0018).
- **`acceptance` / `rejection`** carry `feature:` — which suggestion feature
  was judged (`curator-merge`, `link-suggestion`, `flywheel-check`,
  `resurface`, …) — plus `ref:` pointing at the proposal. These
  are normally written by `scripts/proposals.mjs`, which sweeps the
  `[x]`/`[-]` marks out of `PROPOSALS.md` and adds a truncated `text:"…"`
  excerpt so a line is readable without opening the decided log. The per-feature
  acceptance rate is the master metric (CLAUDE.md); a decision line with no
  `feature:` lands in the `unattributed` row and keeps nothing alive.

## Re-use telemetry is rolled up, never streamed

Note reads are counted in the gitignored `.claude/.access.json` sidecar by the
`PostToolUse` hook (`.claude/hooks/reuse-telemetry.mjs`), deduplicated per
(note, session). The weekly `--rollup` turns that whole buffer into **one**
`retrieval-rollup` line and empties it. The ledger stays an event stream, not
a read log — and losing the sidecar costs at most one week of counts (`docs/DECISIONS.md`).
