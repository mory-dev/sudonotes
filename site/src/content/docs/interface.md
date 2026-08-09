---
title: Interface tour
description: Learn what the sidebar, editor, right panel, collection view, search palettes, and settings each control.
section: start
order: 20
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/App.tsx
  - app/src/components/Sidebar.tsx
  - app/src/components/RightPanel.tsx
  - app/src/components/Settings.tsx
related:
  - getting-started
  - search-and-navigation
  - settings
searchTerms:
  - user interface
  - sidebar
  - right panel
  - editor
---

## The working area

sudonotes keeps the capture loop in one window: choose a note on the left, write in the center, and
use context about the note on the right.

### Sidebar

The sidebar separates **Prompts** and **Ideas**. Each section can create a note and shows both
top-level notes and collections. Select a row to open it. Dragging reorders items within the list;
press <kbd>Esc</kbd> to cancel a drag.

A linked idea shows the project icon when one can be found. An unlinked idea uses a quiet placeholder
so project drafts remain visually distinct.

### Editor and collection view

A normal note opens in the Markdown editor. Links and placeholders receive lightweight formatting,
but the saved text remains ordinary Markdown.

A prompt collection opens as cards instead. The header can add a prompt or copy the full chain.
Double-click a card to edit its title, body, tags, and model. Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> +
<kbd>Enter</kbd> to save the card or <kbd>Esc</kbd> to cancel.

### Right panel

The upper half lists **Linked from** backlinks. The lower half changes with the active note:

- **Project** appears for ideas and controls the `IDEAS.md` mirror.
- **Variables** appears when a prompt contains `{{placeholders}}`.
- **Details** shows type, collection, tags, model, dates, and the file path.
- **Review this note** appears when AI assistance is enabled.

For an idea, the model row follows the bubble under the pointer or caret, so a model assignment can
belong to one bubble rather than the whole idea.

## Palettes and dialogs

Vault search, note linking, model selection, and tag suggestions use compact pickers. They share the
same keyboard model: arrow keys move, <kbd>Enter</kbd> chooses, and <kbd>Esc</kbd> closes.

Confirmation dialogs protect operations such as deleting notes or replacing an existing
`IDEAS.md`. A destructive choice is named explicitly; clicking outside does not silently accept it.

## Settings

Open Settings from the window controls. It contains:

- the per-vault AI assistance switch and its privacy explanation;
- automatic backup status, the backup directory, **Back up now**, and **Restore a backup…**;
- the installed app version.

Settings closes with its close button, by clicking outside, or with <kbd>Esc</kbd>.

## Notices, errors, and saves

Short notices confirm successful work such as linking a project or writing a backup. Errors stay
visible long enough to read and do not replace the Markdown note with a partial result.

Saving is automatic. sudonotes also flushes an in-flight edit when the window closes. If another
program changes a file while that same note has unsaved edits, the open buffer is left alone rather
than being overwritten.

## Scale the interface

Use <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>+</kbd> or <kbd>-</kbd> to adjust the entire interface.
<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>0</kbd> returns to 100%. The choice persists between sessions.
