---
title: Web versus desktop
description: Understand what exists today, what the planned browser app may do, and which local filesystem behaviors remain desktop-only.
section: reference
order: 50
status: planned
appliesTo: planned-web
lastReviewed: "2026-08-09"
sources:
  - webapp/public/index.html
  - core/src/lib.rs
  - site/src/pages/roadmap.astro
related:
  - vault-format
  - external-editing-and-sync
searchTerms:
  - browser app
  - web app
  - File System Access API
---

<div class="callout warning">
  <strong class="callout-title">The browser app does not exist yet.</strong>
  Today sudonotes is the desktop app. This page records the intended boundary so planned behavior is
  not mistaken for a shipped feature.
</div>

## Two planned modes

The browser experience is expected to distinguish clearly between:

| Planned mode | What it means | Same files as desktop? |
| --- | --- | --- |
| Connect a vault | A compatible browser receives permission to read and write the chosen local folder | Yes |
| Import a copy | Notes are copied into browser-managed storage and later exported deliberately | No |

Folder access depends on browser and operating-system capabilities. Import/export is the fallback
where a live folder permission is unavailable. Exact support must be retested when the browser app
ships.

## Desktop-only responsibilities

The desktop app is expected to keep behaviors that require broad native filesystem access:

- writing `IDEAS.md` into an arbitrary project and editing `.gitignore`;
- watching a vault continuously for external edits;
- maintaining the SQLite search index in `.sudonotes/index.db`;
- using native window, installer, update, and absolute-path behavior;
- creating and restoring app-data `.bak` snapshots.

A browser implementation should not imply it can do these things merely because it can import
Markdown.

## Shared note rules

The `core/` Rust crate defines parsing, serialization, filename slugs, links, and prompt splitting.
It can compile to WebAssembly so a future browser build can call the same rules instead of
reimplementing them in JavaScript.

That matters when desktop and browser touch the same folder: even a small disagreement about quoting,
filenames, or frontmatter could cause them to rewrite each other’s files.

## Conflict safety before launch

A connected browser should fingerprint a note when opening it and check again before writing. If the
file changed, it must offer a clear reload, keep-mine, or save-copy path rather than silently
overwriting another editor.

Until that work ships and this page changes to **Available now**, do not rely on the placeholder
`webapp/` surface for vault access.
