# Mobile

Mobile is **read + quick-capture only**, by design (see `docs/ARCHITECTURE.md` §3.4/§6).
Mobile git tooling is the documented weak link of this whole stack, so the default path
avoids it entirely rather than fighting it.

## The default model

1. **Read** your vault on your phone with the GitHub mobile app (browse the repo, open any
   file) or, if you've set up Obsidian Sync/Obsidian Git separately, inside Obsidian itself.
2. **Capture** on the go by creating or editing a file under `inbox/` directly in the GitHub
   app — creating or editing a file through the app's editor is just a commit, so it needs no
   local git tooling at all. Jot the thought down, don't worry about structure or frontmatter.
3. **Triage on desktop.** Next time you're at your desktop, run `/triage`. It reads everything
   in `inbox/`, files each item into the right place (`projects/`, `knowledge/`, `daily/`) with
   correct frontmatter, and empties the inbox. See `.claude/skills/triage/SKILL.md`.

This gets you full read access and frictionless capture from anywhere, with zero risk of a
mobile git tool corrupting your vault's history.

## Advanced: full mobile git (at your own risk)

Some people want their phone to be a full git citizen — pulling, committing, and pushing
directly. This is possible but is the least mature part of the stack. If you go this route,
understand the risks first.

### Android

The Obsidian Git community plugin alone is reported to be flaky on Android. The more robust
path is running native `git` inside **Termux** (install from F-Droid, not the Play Store)
against the vault folder.

**The critical gotcha:** Android's FUSE filesystem layer on shared storage
(`/storage/emulated/0/...`, which is where Obsidian's vault folder normally lives) is known to
corrupt `.git` objects — empty files and "bad object" errors are the typical symptom. This is
widely cited as the number one reason people abandon git-based Obsidian sync on Android.

**The documented workaround** is `git --separate-git-dir`: keep the actual `.git` directory on
Termux's native filesystem (which doesn't go through FUSE), while the working tree stays on
shared storage where Obsidian can see and edit the files. A simpler hybrid some people use
instead: clone once via Termux to get a properly-initialized repo, then let the Obsidian Git
plugin handle day-to-day pull/push against that same clone.

### iOS

**Working Copy** is the standard tool: clone your GitHub repo inside Working Copy, then use its
"Setup Folder Sync" (via the iOS share sheet) to link that clone to your Obsidian vault folder.
Configure a separate config folder for mobile (Obsidian Settings → About → Advanced) so you
don't sync desktop-only plugin configuration to your phone.

Reported caveats: this requires real git familiarity (you will hit conflicts and need to
resolve them), large attachments can destabilize folder sync, and very large vaults are
generally not recommended over this path.

### If you choose the advanced path

- Still **pull before you write** — the single highest-leverage habit for avoiding conflicts
  on a single-user, multi-device vault.
- Never run a second sync mechanism (iCloud, Google Drive, Syncthing) over the same folder as
  git — running two sync mechanisms over one vault is a documented cause of repository
  corruption, independent of the FUSE issue above.
- When a conflict happens, treat it as git asking a question, not as data loss: resolve by
  hand, remove the conflict markers, commit.

The desktop hooks in this template (`SessionStart` pull, `Stop`/`SessionEnd` checkpoint
commits) assume Claude Code is running on a normal desktop filesystem. They are not designed
to run inside Termux or a mobile git client.
