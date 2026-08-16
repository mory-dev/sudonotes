---
title: Collections and prompt splitting
description: Group prompt chains, paste a structured batch, review the detected split, edit cards, reorder steps, and copy the complete sequence.
section: write
order: 30
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-16"
sources:
  - app/src/components/PromptCards.tsx
  - app/src/components/SplitPreview.tsx
  - core/src/split.rs
related:
  - prompts
  - vault-format
  - shortcuts
searchTerms:
  - prompt chain
  - split paste
  - batch prompts
  - child prompt
  - add prompt
---

## Turn a note into a collection

Open a top-level prompt and choose **Add prompt**, or paste a structured batch into its collection
view. The original note becomes the collection header and child prompts live in the matching
subdirectory.

```text
prompts/
├── release-workflow.md
└── release-workflow/
    ├── inspect-changes.md
    ├── draft-changelog.md
    └── verify-package.md
```

The parent body is an index of `[[links]]` to its children. Each child records the parent title and
its position in frontmatter.

## Split a pasted prompt chain

sudonotes recognizes two or more structured sections, including Markdown headings, underlined
headings, and short standalone title lines followed by content. Bullets and ordinary prose are not
treated as section titles.

1. Paste the batch into a collection.
2. Review the detected titles, summaries, and tags.
3. Rename unclear titles or remove sections that should not become prompts.
4. Choose **Create prompts** only when the preview is correct.

Nothing is split on disk before confirmation. **Keep as one note** cancels the split. A paste with
no useful multi-section structure becomes one child prompt instead.

## Use the collection view

The collection page shows every child as a card in order. From the header you can add a prompt or
**Copy all**. The same **Add prompt** button also appears below the cards, so a long collection does
not need scrolling back to the top to grow. A card can be copied directly, double-clicked for
inline editing, or dragged by its index badge to reorder prompts directly on the page.

Hovering over any prompt card updates the right **Details** and **Variables** panels in real time, letting you inspect and adjust tags, model assignments, and placeholder variables with a comfortable hover grace period.

Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> while viewing a collection to search across the prompt cards, highlight matches, and cycle through matching prompts.

While editing a card:

- change its title, body, tags, and target model together;
- press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> to save;
- press <kbd>Esc</kbd> to discard the card edit.

Drag children in the sidebar or directly in the card list to persist a new order. From a child editor, press
<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> to flush the child and return to its collection.

## Rename safely

Renaming the parent moves its collection directory and updates the children’s parent reference.
Renaming a child updates the link in the parent index and all wiki links pointing to it across your vault automatically. External renames are reconciled when the vault opens, but the safest path is to rename through the app while the collection is visible.
