---
title: Blackhole
description: Use the single scratch dump for thoughts that are not a prompt or an idea yet — one file, no filing, no project link.
section: write
order: 25
status: shipped
appliesTo: desktop
lastReviewed: "2026-09-06"
sources:
  - app/src/components/Sidebar.tsx
  - app/src/components/BlackholeEditor.tsx
  - app/src/store.ts
  - app/src-tauri/src/vault.rs
related:
  - ideas
  - vault-format
  - search-and-navigation
  - backups-and-recovery
searchTerms:
  - scratch
  - dump
  - inbox
  - general notes
  - unfiled
  - blackhole.md
---

Blackhole is one page at the top of the sidebar. It is not a third note type, not a collection, and
not a list of unfiled ideas. Click the header and type. That is the whole surface.

Use it for thoughts that do not belong to a project yet — or never will. When something in the dump
deserves a real home, copy it into a new idea or prompt. There is no promote or split action.

## Open the dump

The **Blackhole** row sits above Prompts and Ideas. It has no count, no add button, and no nested
list. Selecting it opens a wide Markdown editor: a fixed title, a save state, and no right panel.

An empty dump shows a short landing the first time you open it. Click the page or **Start dumping**
to begin. If the file already has text, you go straight to the editor.

<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>N</kbd> while the dump is open still creates a prompt or idea
and leaves Blackhole. It does not create a second dump.

## What it is not

- Not a note. Vault scan only walks `prompts/` and `ideas/`.
- Not linked to a project and not mirrored to `IDEAS.md`.
- Not tagged, reviewed, or turned into GitHub issues.
- Not renameable or deletable in the app. Clear it by deleting the text.

## Where it lives

The dump is one plain Markdown file with no frontmatter:

```text
<vault>/.sudonotes/blackhole.md
```

A missing file is an empty dump. The first save creates it. You can open that file in any editor;
sudonotes does not index it as a note, so it will not appear in the Prompts or Ideas lists.

`.sudonotes/` also holds the search cache and per-vault settings. Deleting the whole folder removes
the dump along with those. To reset search only, remove `index.db` and leave `blackhole.md` alone.

## Find text in the dump

Vault search (<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd>) covers prompts and ideas. The dump is
not in that index.

To find a phrase inside Blackhole, open it and use <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> +
<kbd>Shift</kbd> + <kbd>F</kbd> — the same in-file find as a note.

## Backups

Automatic `.bak` snapshots currently archive `prompts/` and `ideas/` only. The dump is not in those
archives. Copy `.sudonotes/blackhole.md` with the vault, or keep it in your own backup, if the scratch
page matters.

## When to use an idea instead

If the thought belongs to a project, needs bubbles, tags, links, or a GitHub issue, create an
[idea](/docs/ideas). Unlinked ideas already exist for work that is not attached to a repo yet.
Blackhole is only for the text you do not want to file.
