<!--
  TEMPLATE SEED. The rows below are placeholder examples showing the shape of
  this file — replace them with your own open questions (or delete them and
  start empty). This file works best after a few real ones accumulate; give
  it ~10 minutes when you set up your vault.

  This is a ROUTING TABLE, not a to-do list. Rows are questions the vault is
  listening for answers to; /triage checks every capture against them and
  links what answers, refines, or contradicts a row. Nothing here has an
  owner or a due date — a row that stops mattering becomes `abandoned`, it is
  never deleted, because knowing what you stopped asking is itself worth
  keeping.
-->

# Open Questions

**Fields.** `status`: `open` (listening) / `answered` (closed, with the note
that closed it in `related`) / `abandoned` (deliberately dropped, kept for the
record). `project`: which project the question belongs to, or `—` for
vault-wide. `related`: `[[wikilinks]]` to the notes that bear on it.

**How rows change.** Only `/triage` and you touch this file. A capture that
answers a row flips it to `answered` and links the answering note both ways. A
capture that merely refines or contradicts a row adds a link and leaves the
status `open`. New durable questions get a new row rather than being buried in
a note nobody reads again.

## Example Project

| ID | Question | status | project | related |
|---|---|---|---|---|
| Q-01 | What's the target launch date? | open | Example Project | — |
| Q-02 | Which metric decides if the pilot succeeded? | open | Example Project | — |

## General

| ID | Question | status | project | related |
|---|---|---|---|---|
