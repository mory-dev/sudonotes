---
title: Ideas and bubbles
description: Capture ideas as flexible Markdown, work with movable bubbles, assign models, and connect an idea to prompts or a project.
section: write
order: 20
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/components/Editor.tsx
  - app/src/components/RightPanel.tsx
  - app/src/components/ProjectLink.tsx
related:
  - project-linking
  - ideas-md-for-llms
  - links-and-backlinks
searchTerms:
  - brainstorm
  - bubble
  - reorder idea
---

## What an idea is

An idea is context that is still becoming useful: a product problem, experiment, design constraint,
research note, or implementation direction. It receives the same Markdown storage, search, tags,
links, and backlinks as a prompt.

Ideas also have two specialized behaviors: blank-line-separated bubbles and project linking.

## Work with bubbles

Separate thoughts with a blank line. Each non-blank block (including headings, subheadings, lists, and paragraphs) forms a cohesive bubble in the editor:

```markdown
Offline alert queue
Store sensor alerts while the network is unavailable.

Preserve the original timestamp and retry in order.

Keep the queue bounded and make overflow visible.
```

In the sidebar, each idea displays its total bubble count dynamically color-coded with a heat palette (transitioning from amber to hot crimson relative to other ideas in your vault).

Move the pointer over a bubble to reveal its controls. You can:

- drag the grip to reorder it;
- copy only that bubble;
- cut it to the clipboard;
- delete it;
- choose the model most suited to that part of the idea.

Press <kbd>Esc</kbd> to cancel a bubble drag. <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>A</kbd> first
selects the bubble at the caret when the editor can identify one, allowing a focused copy or edit.

## Connect the idea

Link to prompts or other ideas with `[[Note title]]`. The target’s backlink list preserves where the
idea came from even after the two notes move apart in the sidebar.

For software work, use the **Project** panel. sudonotes mirrors the complete note to `IDEAS.md` in
the selected project root. The vault note remains canonical and searchable.

## Write for later use

A useful idea answers four questions:

1. What is the problem or opportunity?
2. What context or evidence matters?
3. Which constraints must survive implementation?
4. What observable result would count as done?

That structure helps your future self and gives a local LLM enough context to propose grounded work
instead of guessing from a title.
