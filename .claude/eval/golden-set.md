# Retrieval golden set

`query → expected note` pairs, re-run by `node scripts/retrieval-eval.mjs`.
This is the vault's only falsifiable answer to "is lexical search still
enough?" — without it, that answer is a belief, not a measurement.

**How to use it.** Add a row whenever a real lookup teaches you a query shape
worth defending, especially right after fixing a miss with an `aliases:` entry:
the row is what stops the fix from silently regressing. Never edit a row to
make the eval pass — a failing row is the finding. If the vault's content
legitimately moved, change `expected`; if the query is no longer meaningful,
delete the row and say so in the session log.

Write queries the way you would really type them — your own language, your own
jargon, including the half-remembered wording. A golden set written in the
vault's vocabulary tests nothing: it can only confirm that the words you filed
a note under match the words you filed it under.

Only `notes/` and `core/` are searched — the tiers retrieval is *for*. `logs/`
and `archive/` are episodic and deliberately out of scope.

| id | query | expected |
|---|---|---|
| G-01 | how does a note graduate from seedling to evergreen | notes/lifecycle-policy.md |
| G-02 | when is an agent allowed to delete something | notes/lifecycle-policy.md |
