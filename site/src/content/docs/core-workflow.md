---
title: Core workflow
description: Use a simple capture, organize, connect, retrieve, and reuse loop for prompts and project ideas.
section: start
order: 30
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/store.ts
  - app/src/components/Editor.tsx
  - app/src/components/PromptCards.tsx
related:
  - prompts
  - ideas
  - search-and-navigation
searchTerms:
  - usage
  - workflow
  - organize prompts
---

## 1. Capture without sorting first

Create the note in the section that matches what you have:

- a **prompt** is text you intend to run or reuse;
- an **idea** is context, a possibility, a problem, or a plan still taking shape.

Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>N</kbd> to create another note of the type currently in
view. A title and useful body matter more than choosing every tag immediately.

## 2. Add the smallest useful structure

Use tags for broad retrieval, a model when the note is model-specific, and `{{placeholders}}` for
values that change each time. Blank lines turn an idea into movable bubbles.

When several prompts form a sequence, put them in a collection. Pasting a multi-step prompt into a
collection produces a preview; edit the proposed titles, remove incorrect sections, and confirm
only when the split is right.

## 3. Connect the reason to the reusable work

Write `[[Prompt title]]` in the idea that motivated a prompt. The prompt’s **Linked from** panel then
preserves the reason it exists.

For software work, link the idea to the project. sudonotes keeps the vault note canonical and
refreshes a local `IDEAS.md` mirror beside the code. A local coding agent can read that file when it
has access to the project folder.

## 4. Retrieve by memory fragment

Open vault-wide search with <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd>. Search titles, body text,
tags, or a project-related phrase; title matches rank strongly. Click a tag in the Details panel to
start from that tag.

Use links and backlinks when you remember the relationship instead of a word in the note.

## 5. Reuse without damaging the source

Copy a prompt directly, fill its variables and use **Copy filled**, or copy a whole collection. The
stored template is not rewritten when placeholder values are filled.

For ideas, copy a single bubble from its hover controls or hand the linked `IDEAS.md` to a local
agent with an explicit request. The idea remains in the vault and continues to receive normal
backups.

## A healthy vault

A healthy vault is not perfectly categorized. It has enough titles, tags, links, and project
connections that a useful note can be found from more than one direction. Because the notes stay as
Markdown, you can refine that structure in sudonotes or another editor at any time.
