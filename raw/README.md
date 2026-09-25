# raw/ — the source store

Immutable source documents. Articles, papers, transcripts, exports, images,
data files. **You put things here; the agent reads them and never writes
them.**

This is the one place in the vault where verbatim external content is allowed
to live. That is the whole point: `notes/` forbids verbatim material, so
without a legal home for a quoted paragraph it either gets paraphrased into a
note (losing the fidelity that made it worth keeping) or is lost.

## The contract

- **Immutable.** The agent may read a file here, cite it, and link to it. It
  never edits, renames, moves, deletes, reformats or "cleans up" a file in
  `raw/`. A source is what it said on the day it arrived.
- **One exception to the no-write rule:** the agent may fetch a source into
  `raw/` when you ask for that specific fetch. Never on its own initiative,
  never as a side effect of another task.
- **Nothing here is memory.** Files in `raw/` are evidence, not claims the
  vault makes. Nothing here is loaded at session start, promoted to
  `MEMORY.md`, or treated as true because it is present. Facts derived from it
  carry a `source:` marker and go through the corroboration gate like any other
  untrusted external content (`AGENTS.md` § Memory rules).
- **Full is healthy.** This is a corpus, not a queue. It is never emptied and a
  file is never deleted after being read — the note links back to it forever.

## Naming

Flat, no subfolders: `YYYY-MM-DD_<slug>.<ext>`, where the date is when the
source *arrived*, not when it was published. Companion images for an ingested
article take the same stem plus an index:

```
raw/2026-09-02_llm-wiki-pattern.md
raw/2026-09-02_llm-wiki-pattern_01.png
raw/2026-09-04_attention-is-all-you-need.pdf
```

Filenames are vault-unique, which is what keeps `[[wikilinks]]` short
everywhere else.

## What does not belong here

- **Anything over ~5 MB.** It stays where it is on disk and gets a pointer row
  in [[source-roots]] instead. This folder is tracked in git.
- **A working directory that already exists.** Project repos, a design folder,
  anything with its own home is *registered*, never copied — two correct copies
  of the same bytes is exactly what the verbatim rule prevents.
- **Your own writing.** A source is something you read, not something you
  wrote.
- **Anything the agent produced.** An agent's own output is not a source;
  treating it as one is self-corroboration, which the vault vetoes.

## How a source gets read

`/ingest <file>` — reads it, talks it through with you, writes or merges the
distilled note in `notes/`, updates `INDEX.md`, appends a log entry. A file
sitting here that has never been ingested appears in no index and no note; that
is the visible symptom of this folder rotting into a graveyard, and three weeks
of it is the signal to remove the inlet rather than keep feeding it.
