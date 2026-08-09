---
title: Links and backlinks
description: Connect prompts and ideas with wiki links, aliases, keyboard wrapping, missing targets, and the Linked from panel.
section: write
order: 50
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/components/Editor.tsx
  - app/src/components/RightPanel.tsx
  - app/src/components/NotePicker.tsx
related:
  - ideas
  - search-and-navigation
  - note-format
searchTerms:
  - wiki link
  - backlink
  - linked from
  - alias
---

## Link to a note

Write a title inside double square brackets:

```markdown
Use the rubric in [[Review standards]].
```

The brackets become visually quiet while reading and return when the caret enters the link. Hold
<kbd>Ctrl</kbd> or <kbd>Cmd</kbd> and click it to open the target.

To display different words, separate the target and label with a pipe:

```markdown
Follow [[Review standards|the team rubric]].
```

The target is still `Review standards`; the sentence displays “the team rubric.”

## Create a link from a selection

Select text and press <kbd>[</kbd>. The editor wraps one bracket level per press, so pressing it
twice produces a wiki link. <kbd>Backspace</kbd> peels one wrapping level at a time when the editor
recognizes that selection.

The context menu also offers linking actions for selected text. Its note picker filters the loaded
vault immediately; use the arrow keys and <kbd>Enter</kbd> to choose a target.

## Follow a missing target

If no note has the linked title, following the link offers to create it. Confirm the intended note
type and title rather than changing the link silently.

## Read backlinks

The **Linked from** panel lists every note that points to the open one. This is the fastest way to
answer “why does this exist?” and the place to inspect before a rename or delete.

Backlinks are derived from the current Markdown and search index. If an externally edited link has
not appeared, reopen the vault or allow the file watcher to refresh the index.

## Rename with care

Wiki links match titles. Renaming a note changes its own title and filename, but text written in
other notes may still use the old title. Review **Linked from**, rename, then update those source
notes so they continue to resolve.
