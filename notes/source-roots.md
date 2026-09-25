---
type: knowledge
created: 2026-09-03
tags: [sources, registry]
status: seedling
aliases: [registered roots, external sources, source registry]
related: ["[[lifecycle-policy]]"]
---

# Source roots

**Top line.** Working directories the vault may read from but never copies:
project repos, design folders, anything with a home of its own. `raw/` holds
documents that had nowhere else to live; this file points at the ones that did.

The immutability contract is identical to `raw/README.md` — read, cite, link;
never edit, never tidy, never move. Only the location differs. Two correct
copies of the same bytes is the failure this table exists to prevent.

## Registry

| Root | What it is | Read for | Notes it feeds |
|---|---|---|---|
| _(none yet)_ | | | |

## Adding a row

A project repo that has a project card (`type: project` with `repo:`) is
already registered by its card; add it here only when the vault reads it for
something beyond that project.

Register a root when you find yourself about to copy a folder into `raw/`, or
when the agent has read from it more than once. A row costs nothing; a
duplicated corpus costs you the ability to say which copy is true.

Say what the root is *for* in the "Read for" column — "the CSS conventions",
"past client proposals" — not just what it contains. The column is the whole
reason a future session opens the right root instead of grepping all of them.
