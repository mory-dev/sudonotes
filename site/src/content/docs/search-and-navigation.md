---
title: Search and navigation
description: Search the whole vault, find inside one note, follow links, use tags, and move through result pickers entirely from the keyboard.
section: find
order: 10
status: shipped
appliesTo: desktop
lastReviewed: "2026-09-06"
sources:
  - app/src/components/SearchPalette.tsx
  - app/src/components/Editor.tsx
  - app/src-tauri/src/index.rs
related:
  - shortcuts
  - links-and-backlinks
  - vault-format
  - blackhole
searchTerms:
  - Ctrl F
  - Ctrl K
  - find in note
  - full text search
  - FTS5
---

## Search the entire vault

Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd> or <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> +
<kbd>F</kbd> anywhere in the app. Both open the vault search palette; the webview’s browser-find bar
is deliberately not used.

Type a title, body phrase, tag, or project-related term. Search uses SQLite FTS5 across prompts and
ideas and ranks title matches strongly. The [Blackhole](/docs/blackhole) dump is not in that index.
Results can also show note type, collection, linked-project icon, tags, and selected model when
available.

The query waits briefly while you type, then returns up to 50 results. A slower old request cannot
replace a newer query.

### Navigate results

- <kbd>ArrowDown</kbd> and <kbd>ArrowUp</kbd> move the selection.
- <kbd>Enter</kbd> opens the selected note.
- <kbd>Esc</kbd> or clicking outside closes the palette.

Search is fastest when a note has a concrete title and the body contains the words you would
naturally remember. Tags and links provide alternative paths when exact wording is unknown.

## Start from a tag

Click a tag in Details or on a collection card. The same palette opens with that tag already
entered. This is ordinary full-text search, so a word may also match a title or body; it is not an
exclusive database filter.

## Find inside the open note

Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd>. The find bar searches only the
current editor document — an open note, a prompt collection, or the Blackhole dump — highlights
case-insensitive non-overlapping matches, and shows the current position and total.

- <kbd>Enter</kbd> moves to the next match.
- <kbd>Shift</kbd> + <kbd>Enter</kbd> moves to the previous match.
- <kbd>Esc</kbd> closes find.

Typing a new query moves immediately to its first match. Navigation wraps at the first and last
match.

## Navigate through links and collections

Hold <kbd>Ctrl</kbd> or <kbd>Cmd</kbd> and click a `[[wiki link]]` in the editor. In a rendered
collection card, click the link directly. The target may be a prompt, an idea, or the collection
header.

From a child prompt, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> flushes the save and returns to
the parent collection. Backlinks in **Linked from** travel in the opposite direction.

## If search looks stale

The index is a cache rebuilt when a vault opens and updated on saves and watched external changes.
If a result remains wrong after the file watcher has had time to react:

1. flush the current save;
2. close and reopen the vault;
3. if needed, close the app and remove only `.sudonotes/index.db`;
4. reopen the vault and let the index rebuild from the Markdown.

Removing the index does not remove notes. Do not delete `prompts/` or `ideas/` while diagnosing
search.

<div class="callout">
  <strong class="callout-title">This documentation site has separate search controls.</strong>
  On `sudonotes.com/docs`, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd> searches guides and
  <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> finds within the current guide.
  Native browser <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>F</kbd> remains available.
</div>
