# Signal ledger — conventions

One append-only file per month, `logs/signals/YYYY-MM.md`. This is the single
place every detector writes and every audit reads. Plain Markdown, so `rg` is
the whole query engine.

## Line format

```
- <ISO-UTC timestamp, minute precision> | <type> | <payload…> | sid:<session id>
```

Example:

```
- 2026-08-25T13:02Z | retrieval-failure | query:"vault lifecycle" | cause:wrong-term | sid:abc-123
- 2026-08-26T09:40Z | correction | class:wrong-procedure | note:lesson-2026-08-26-wrong-procedure.md | "no — the other order" | sid:def-456
```

Timestamps are UTC and end in `Z` — unlike the local-time filenames in
`logs/`, a ledger line has to be comparable across machines.

## Types

| type | written by | means |
|---|---|---|
| `correction` | `/lesson` skill | the owner corrected the agent; payload is verbatim |
| `retrieval-failure` | `/recall`, on a failed lookup | the vault had it and search missed it; carries `cause:` |
| `acceptance` / `rejection` | agent, by hand, for a decision worth recording | a suggestion was taken or refused |
| `check-fire` | `.claude/hooks/checks.mjs`, when a caller runs the checks | an enforced rule caught a repeat attempt |
| `retrieval-rollup` — **historical** | the retired reuse telemetry (ADR 0039) | one week of note re-use; nothing writes it since v1.1 |
| `session-digest` — **historical** | the retired flush mechanism (ADR 0038) | one line per flushed session; nothing writes it since v1.1 |

The two historical types stay listed in `SIGNAL_TYPES` so that a ledger
carried over from v1.0 stays valid content rather than becoming unparseable
history.

## Rules

- **Append-only.** Never rewrite a past line — a correction is a *newer* line.
- **One line per event**, no wrapping. Merge conflicts are avoided by
  `merge=union` in `.gitattributes`.
- **Monthly files bound growth.** Old months distill into the audit and archive
  like any other episodic content — never deleted.
- **`check-fire` lines are deduplicated** — one line per (check, file, detail)
  per month file, so a stuck violation cannot flood the ledger.
- **Skills write lines via the CLI, never by hand-formatting:**
  `node .claude/hooks/append-signal.mjs <type> <field>... [--sid <id>]`.

## Required payload fields

- **`retrieval-failure`** carries `cause:` — one of `paraphrase-miss`,
  `wrong-term`, `typo`, `not-exists` (`/recall` defines them). Without it the
  line cannot argue for anything, and `scripts/vault-metrics.mjs` counts it as
  `uncaused`. Only a cluster of `paraphrase-miss` reopens the
  lexical-only-retrieval decision (`docs/DECISIONS.md`, 0018).
- **`acceptance` / `rejection`** carry `feature:` — which suggestion feature
  was judged (`curator-merge`, `link-suggestion`, …) — plus `ref:`. These used
  to be swept out of `PROPOSALS.md` by a script and scored as an acceptance
  rate; both went with proposal production (ADR 0038). The hand-written line
  survives for a decision worth recording and feeds nothing that scores it:

  ```
  node .claude/hooks/append-signal.mjs acceptance feature:link-suggestion ref:"[[x]] <-> [[y]]"
  ```
