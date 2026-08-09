---
title: Frequently asked questions
description: Short answers about accounts, Markdown ownership, autosave, sync, backups, AI, IDEAS.md, models, and the planned browser app.
section: reference
order: 40
status: shipped
appliesTo: all
lastReviewed: "2026-08-09"
sources:
  - README.md
  - app/src-tauri/src/lib.rs
  - site/src/pages/roadmap.astro
related:
  - getting-started
  - privacy
  - web-vs-desktop
searchTerms:
  - questions
  - account
  - sync
  - offline
---

## Do I need an account?

No. A vault is a local folder. Optional AI assistance uses a random per-install token for rate
limiting, not a user account.

## Can I read the notes without sudonotes?

Yes. They are Markdown with a small frontmatter header under `prompts/` and `ideas/`.

## Does it save automatically?

Yes. Saves are queued after edits and flushed on close. <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd>
forces a pending save immediately.

## Does sudonotes sync devices?

No. You may place the vault in a synced folder, but the current app does not merge simultaneous
edits. Let one device finish syncing before editing on another.

## Where are backups?

Outside the vault in the app data directory. Settings shows the exact path. A `.bak` is a ZIP and
can be restored into a new empty folder.

## Does local-first mean no network?

Core editing and storage are local. AI assistance sends the current note when enabled and invoked;
the model catalog and update checker make metadata-only requests. See [Privacy](/docs/privacy).

## Do I need my own AI API key?

No. The optional sudonotes service holds the provider key. Turning AI assistance off leaves all core
note features available.

## Does choosing a model run the prompt?

No. It records intent and lets review consider model metadata. Copy the prompt into the tool where
you intend to run it.

## What is IDEAS.md?

It is the uppercase project-root mirror created when you link a vault idea to a project. The vault
note is canonical; the mirror makes context available beside the code and is normally gitignored.

## Will a coding agent automatically implement IDEAS.md?

No. A local agent can read the file only with project access, and the file grants no authority by
itself. Give an explicit, bounded handoff.

## Is there a browser app?

Not yet. The current product is the desktop app. Browser behavior described in the docs is visibly
marked planned.

## Can I delete `.sudonotes/`?

Yes, while the app is closed, if you accept that search rebuilds and the vault AI preference resets
to on. Your note content is elsewhere, but making a backup first is still sensible.
