---
name: recall
description: Four-layer lexical retrieval over the vault — search conventions plus a logged retrieval-failure signal when the vault misses.
---

# Recall

No search index — grep + wikilinks, by design (ADR 0018). Four layers, each
tried before escalating.

## Layers

1. **Tier 0 — what is actually in context.** Inside the vault: `IDENTITY.md`,
   `USER.md`, `MEMORY.md`, injected by the SessionStart hook. In any other
   project: `USER.md` and `MEMORY.md` only. `core/OPEN_QUESTIONS.md` is
   **never inlined** — the hook injects a pointer to it, so reading it is a
   tool call like any other file. Check what is in context first; open the
   questions ledger when the query is about live questions or vault planning.

2. **Rank `notes/` + `core/` first**, then use `rg` over `logs/`. Run
   `node scripts/retrieval-eval.mjs --query "<the user's query>"`; it ranks by
   unique normalized query-token overlap, so a long report does not win merely
   by repeating a term. Open only the two or three plausible hits. If the
   ranked lookup returns nothing useful, search titles, `aliases:`, `tags:` and
   body text with `rg`. If the owner converses with you in a language other
   than the one the vault is written in, try the query in **both** — a
   lexical index only matches the token it was given.

3. **Wikilink/backlink hops (1–2)** from any hit — `rg` for `[[hit-name]]`
   across the vault to find what links to or from it.

4. **Frontmatter filters** — narrow by `type:`, `status:`, `created:` to cut
   noise once you have candidates.

## On a miss

- **The vault had it and search missed it** (later confirmed in-vault, or a
  query that clearly should have hit): log it **with a cause** —
  ```
  node .claude/hooks/append-signal.mjs retrieval-failure query:"<the query>" cause:paraphrase-miss
  ```
  This ledger is the *only* thing that can ever justify a search index (ADR
  0018) — log every real miss, not just the memorable ones.

  `cause:` is what makes the ledger decidable. Exactly one of:

  | cause | means | what it argues for |
  |---|---|---|
  | `paraphrase-miss` | the note says the same thing in different words — no shared term to grep for | **the only cause that argues for semantic search** |
  | `wrong-term` | the vault uses a term the query didn't (jargon, EN/TR split) | an `aliases:` entry |
  | `typo` | the query or the note was misspelled | nothing — noise |
  | `not-exists` | the vault genuinely never had it | a note worth writing, not a search problem |

  The lexical-only decision reopens on a *cluster of `paraphrase-miss`
  lines*, nothing else. An
  uncaused `retrieval-failure` line is unusable evidence — it can be read as
  arguing for anything, which means it argues for nothing.

- **Vocabulary-shaped miss** (the note existed under a different term than the
  query used): add the missed term to that note's `aliases:` frontmatter.
  `notes/` isn't protected, so this direct edit is allowed — just mention it
  in one line to the owner ("added alias X to notes/Y.md").

## Golden set

`.claude/eval/golden-set.md` holds `query → expected note` pairs;
`node scripts/retrieval-eval.mjs` re-runs them and reports recall@k. Add a row
whenever a real lookup teaches you a query shape worth defending — especially
right after a miss you just fixed with an alias, so the fix stays fixed.
