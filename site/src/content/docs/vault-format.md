---
title: Vault format
description: Understand the local folder, Markdown note trees, rebuildable search data, per-vault settings, and what is safe to remove.
section: data
order: 10
status: shipped
appliesTo: desktop
lastReviewed: "2026-09-06"
sources:
  - app/src-tauri/src/vault.rs
  - app/src-tauri/src/note.rs
  - core/src/note.rs
related:
  - note-format
  - blackhole
  - external-editing-and-sync
  - backups-and-recovery
searchTerms:
  - folder structure
  - markdown vault
  - index.db
  - settings.json
---

A vault is a directory you choose. It is not a proprietary database or archive, and the Markdown
does not need sudonotes to be read.

## Directory layout

```text
<vault>/
├── prompts/
│   ├── review-a-pull-request.md
│   ├── release-workflow.md
│   └── release-workflow/
│       └── draft-changelog.md
├── ideas/
│   └── offline-alert-queue.md
└── .sudonotes/
    ├── index.db
    ├── settings.json
    └── blackhole.md
```

`prompts/` and `ideas/` are the content roots. A Markdown file with a same-named subdirectory heads
a collection; the files inside are its children.

`.sudonotes/index.db` is an FTS5 cache rebuilt from the Markdown. `.sudonotes/settings.json` stores
whether AI assistance is enabled for this vault. `.sudonotes/blackhole.md` is the
[Blackhole](/docs/blackhole) scratch dump — plain Markdown, not a note, and not scanned under
`prompts/` or `ideas/`.

## What is load-bearing?

The `.md` files under `prompts/` and `ideas/`, plus `.sudonotes/blackhole.md` if you use the dump.
Everything required to read a note’s title, tags, relationships, models, project link, and body is
in the note files.

It is safe to remove `.sudonotes/index.db` while the app is closed; search rebuilds on the next open.
Removing the whole `.sudonotes/` directory resets the per-vault AI preference to its default of on
and deletes the Blackhole dump. It does not remove prompts or ideas.

<div class="callout warning">
  <strong class="callout-title">Do not treat a safe-to-rebuild cache as a backup.</strong>
  Deleting `prompts/` or `ideas/` deletes the content. Use the backup and recovery guide before
  changing a damaged vault by hand.
</div>

## Notes without frontmatter

You can place an existing Markdown file under `prompts/` or `ideas/`. If it has no sudonotes
frontmatter, the filename supplies the title. The app adds its small header the first time it writes
the note.

Filename slugs are derived from titles, with collision handling so two notes do not silently share a
path. Links resolve against the frontmatter title, not the visible filename alone.

## Data outside the vault

Automatic `.bak` files live in the app data directory outside the vault so they can survive deletion
of the vault folder. The random device token, model catalog cache, updater state, and UI scale also
belong to app/config or browser-local storage rather than note Markdown.

A linked project contains a second file, `IDEAS.md`. That is a mirror; the vault idea remains
canonical.

## Put a vault somewhere useful

A normal local folder, encrypted volume, Git worktree, or synced folder can all hold the Markdown.
sudonotes has no built-in sync or account layer. When another program may edit the same files, read
[external editing and sync](/docs/external-editing-and-sync) before allowing simultaneous writers.
