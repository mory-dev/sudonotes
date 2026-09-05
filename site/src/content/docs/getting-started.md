---
title: Getting started
description: Create or open a vault, write your first prompt and idea, connect them, and find them again in about five minutes.
section: start
order: 10
status: shipped
appliesTo: desktop
lastReviewed: "2026-09-06"
sources:
  - app/src/components/Welcome.tsx
  - app/src/components/Sidebar.tsx
  - app/src/store.ts
related:
  - core-workflow
  - vault-format
  - blackhole
  - shortcuts
searchTerms:
  - install
  - first vault
  - first note
  - quick start
---

## Before you begin

Install the [desktop app](/download). sudonotes stores notes in a folder you choose, called a
**vault**. There is no account to create and no import step before you can write.

You can start with a new folder, an empty existing folder, or a folder that already contains
sudonotes Markdown under `prompts/` and `ideas/`.

## 1. Choose a vault

On first launch, confirm the suggested folder or choose **Browse…** and select another location.
The message below the path tells you what will happen:

- **This folder will be created** means the path does not exist yet.
- **Existing folder** means sudonotes will add its note folders without removing other files.
- **Existing vault** shows how many notes were found.

Choose **Create vault** or **Open vault**. sudonotes creates this small structure when needed:

```text
<vault>/
├── prompts/
├── ideas/
└── .sudonotes/
    ├── index.db
    ├── settings.json
    └── blackhole.md
```

Your notes are the Markdown files under `prompts/` and `ideas/`. `.sudonotes/` holds a rebuildable
search index, a vault preference, and the optional [Blackhole](/docs/blackhole) dump. The dump is
created on first save; it is not a note.

## 2. Create a prompt

1. In the **Prompts** section of the sidebar, use the add button.
2. Give the note a title such as `Review a pull request`.
3. Write the reusable instruction in the editor.
4. Optionally add `{{placeholders}}`, tags, a target model, or `[[links]]` to other notes.

sudonotes saves after you pause. <kbd>Ctrl</kbd> + <kbd>S</kbd> on Windows/Linux or
<kbd>Cmd</kbd> + <kbd>S</kbd> on macOS flushes a pending save immediately.

## 3. Capture the idea behind it

Create a note in the **Ideas** section and write why the prompt exists, what it should improve, or
what project might use it. Blank lines divide an idea into **bubbles**. A bubble can be reordered,
copied, cut, deleted, or assigned its own model.

Connect the two notes by writing the prompt title inside double brackets:

```markdown
This project needs a repeatable review pass. See [[Review a pull request]].
```

Hold <kbd>Ctrl</kbd> or <kbd>Cmd</kbd> and click the rendered link to open it. The target note lists
the idea under **Linked from**.

## 4. Find the note again

Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd>, type part of the title or body, move with the
arrow keys, and press <kbd>Enter</kbd>. Search covers prompts and ideas, not the Blackhole dump.

To find text only inside the note already open, use <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> +
<kbd>Shift</kbd> + <kbd>F</kbd>. This is intentionally different from vault-wide search.

## What success looks like

The sidebar contains one prompt and one idea, search opens either note, and the vault contains two
ordinary Markdown files. Close and reopen the app: the same vault and notes should return.

> **Next:** Read [the core workflow](/docs/core-workflow) for an everyday capture-and-reuse loop, or
> [link the idea to a project](/docs/project-linking) so it is available beside the code.
