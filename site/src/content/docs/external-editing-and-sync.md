---
title: External editing and synced folders
description: Edit vault Markdown in another tool, understand file watching, and reduce conflicts when Git or a sync service also touches the files.
section: data
order: 30
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src-tauri/src/watcher.rs
  - app/src/store.ts
  - app/src-tauri/src/vault.rs
related:
  - vault-format
  - backups-and-recovery
  - troubleshooting
searchTerms:
  - VS Code
  - Obsidian
  - Dropbox
  - git
  - sync conflict
---

## Edit with another application

Open any note under `prompts/` or `ideas/` in VS Code, vim, Obsidian, Notepad, or another Markdown
editor. Save the file and the vault watcher refreshes the list and search index.

If the same note is open in sudonotes with no pending edit, its body reloads. If sudonotes has an
unsaved buffer for that note, it leaves the buffer alone rather than clobbering what you typed.

## Add existing Markdown

Place `.md` files under the correct content root. Files without frontmatter use their filename as a
title and receive the normal header on the first sudonotes write. Keep collection children in a
subdirectory next to their parent file.

Do not put arbitrary Markdown under `.sudonotes/`; that directory is for app-owned cache and
settings data.

## Use Git

A vault can be a repository, part of a repository, or ignored by one. Git gives useful history for
plain Markdown, but sudonotes does not run commits or resolve merge conflicts.

- Commit only content you intend to share.
- Review frontmatter for absolute project paths and private metadata.
- Do not commit `.sudonotes/index.db`.
- A linked project’s `IDEAS.md` is gitignored by default because it can contain private working
  context.

Resolve a conflict in a text editor while sudonotes is closed or the affected note is not dirty,
then reopen the vault and verify links and search.

## Use Dropbox, iCloud, OneDrive, or another sync folder

The files are compatible with ordinary folder sync, but current sudonotes does not implement a
merge protocol. Avoid editing the same note on two devices at once.

A safe pattern is:

1. finish and flush the note on device A;
2. wait for the sync client to finish;
3. open or rescan the vault on device B;
4. edit there;
5. verify conflict-copy files instead of assuming the newest timestamp is correct.

Automatic `.bak` snapshots live outside the vault, so a synced vault does not automatically sync
its sudonotes backups. That separation protects against some sync deletions but means you need a
separate off-device backup plan.

## Avoid simultaneous writers

The app currently detects external changes but does not offer a three-way merge or a reload/keep
mine/save-copy choice. If another tool changed the file while sudonotes has unsaved content, copy
both versions to safe filenames and merge them deliberately.
