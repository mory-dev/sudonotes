---
title: Tags and model assignments
description: Add searchable tags, use automatic classification safely, and record target models for prompts or individual idea bubbles.
section: write
order: 60
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-09"
sources:
  - app/src/components/TagInput.tsx
  - app/src/components/ModelPicker.tsx
  - app/src-tauri/src/ai.rs
related:
  - prompts
  - ideas
  - ai-review
searchTerms:
  - tag
  - model picker
  - automatic tags
  - bubble model
---

## Add and use tags

Tags are short categories stored in note frontmatter. Add them in an editable collection card or
through note metadata. Press <kbd>Enter</kbd> or a comma to commit a tag; with an empty field,
<kbd>Backspace</kbd> removes the last one.

Click a tag in the Details panel or a collection card to open vault search with that tag already
entered.

Prefer a small shared vocabulary such as `testing`, `security`, `docs`, or `workflow` over a new tag
for every note. Full-text search handles exact project names and one-off phrases well.

## Automatic tags

When AI assistance is enabled, a sufficiently changed note can request up to five tags from the
allowed vocabulary. Existing tags are kept, duplicates are removed, and the final list is sorted.

If the proxy cannot answer, sudonotes can fall back to a local keyword pass for that request. A
result is discarded if the title or body changed while it was in flight. Turning AI assistance off
prevents note content from being sent for automatic classification; add tags manually when needed.

## Assign a model

The model picker searches a live catalog and shows provider identity plus available capability
metadata. Choosing a model records the ID in Markdown. It does **not** send the prompt or run it.

For a prompt, the assignment belongs to the whole note. For an idea, move the pointer or caret into
a bubble: the Details panel changes to **Bubble model**, and the assignment is stored against that
bubble’s first line.

## Treat assignments as intent

A stored model is a useful reminder and input to AI review, not a guarantee that the model still has
the same capabilities or availability. Recheck the picker when a prompt depends on a recent model
feature, unusually large context, images, tools, or a specific provider.
