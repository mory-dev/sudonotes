---
title: Prompts
description: Create reusable prompts, copy them cleanly, add variables, tags, model targets, links, and collections.
section: write
order: 10
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/components/Editor.tsx
  - app/src/components/RightPanel.tsx
  - app/src/components/PromptCards.tsx
related:
  - placeholders
  - collections
  - tags-and-models
searchTerms:
  - prompt library
  - reusable prompt
  - copy prompt
---

## Create a prompt

Use the add button in the sidebar’s **Prompts** section. A good title describes the job rather than
the current input: `Review a pull request` will stay useful longer than `Review PR 284`.

Write the instruction as ordinary Markdown. Saving is automatic; use <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>
+ <kbd>S</kbd> when you need the current buffer on disk immediately.

## Make it reusable

Put changing values inside `{{double braces}}`:

```markdown
Review the {{language}} changes for {{risk}}.
Return findings with file and line references.
```

The Variables panel turns each distinct name into a field. **Copy filled** writes the completed
prompt to the clipboard without rewriting the note. Empty fields remain visible as placeholders.

Use `[[links]]` to preserve the reason, rubric, or companion prompts:

```markdown
Follow [[Review standards]] and format the answer for [[Team handoff]].
```

## Add retrieval details

Tags provide broad categories and become clickable search queries. A model assignment records which
model the prompt targets; it does not run the prompt. The Details panel also shows the underlying
file path and dates.

When AI assistance is enabled, a sufficiently changed note can receive tags automatically. Manual
tags are kept, and a stale tag response is not applied over a note that changed while the request
was running.

## Copy and use

Copy a standalone prompt from its controls. For a prompt with variables, prefer **Copy filled** so
the source remains a template. A collection card has its own copy button, and the collection header
can **Copy all** in order.

## Rename or delete

Renaming updates the Markdown filename. Before renaming a heavily linked prompt, inspect **Linked
from**: wiki links match the title, so other notes may need to follow the new name.

Deleting a note removes its Markdown file. Confirm only after checking backlinks and, for a child
prompt, the collection that owns it. Backups provide a recovery path, but are not an undo button for
the current editing session.
