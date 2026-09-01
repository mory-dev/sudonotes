---
title: Settings reference
description: Control the per-vault AI boundary, automatic snapshots, manual backup and restore, update checks, and find the installed app version.
section: reference
order: 20
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-16"
sources:
  - app/src/components/Settings.tsx
  - app/src-tauri/src/ai.rs
  - app/src-tauri/src/backup.rs
  - app/src-tauri/src/github.rs
related:
  - privacy
  - backups-and-recovery
  - github-issues
  - interface
searchTerms:
  - preferences
  - turn off AI
  - backup switch
  - check for updates
  - version
---

Open Settings from the cog in the app chrome. Press <kbd>Esc</kbd>, use the close button, or click
outside to close it.

## AI assistance

The switch answers whether content from the current vault may be sent for automatic tags, some
generated titles, and on-demand note review.

- Default: on.
- Scope: current vault.
- Stored in: `<vault>/.sudonotes/settings.json`.
- Credentials: none are stored in the vault; the provider key lives on the sudonotes API.

Turning the switch off does not affect storage, search, manual tags, models, links, placeholders,
backups, or project mirroring.

## GitHub

Connects an account so idea bubbles can become GitHub issues. See
[GitHub issues from bubbles](/docs/github-issues) for the whole workflow.

- **Connect GitHub** starts the device flow: a short code is copied for you and github.com opens to
  accept it.
- **Choose repositories…** opens GitHub to grant access. Access is per account, so a personal
  account and an organization each need their own grant.
- **Delete a bubble when its issue closes** is off by default. A closed issue always dims its
  bubble; this removes it as well.

Linked issues refresh on their own — on opening the vault, on returning to the app, and on a
five-minute backstop — so there is nothing to press.

The sign-in belongs to the installation and is kept in the operating system’s credential store —
never in the vault. The auto-delete preference belongs to the vault, in
`<vault>/.sudonotes/github.json`.

## Backups

**Snapshot this vault automatically** controls due-on-open snapshots. Unlike the AI preference, the
backup switch is stored in the app’s backup directory and applies to the installation.

Settings shows:

- when and how large the latest recognized archive is;
- the exact archive directory;
- **Back up now** for the open vault;
- **Restore a backup…** for `.bak` or `.zip` files.

A manual backup requires an open vault. Restore can be selected from Settings and always asks for a
separate empty destination.

## Updates

**Check for updates** asks the release feed and reports whether the installed version is current.
When a new version is available the button becomes **Download and install**; the app restarts into
the new version after applying it. Updates are separate from the automatic installer, so this check
is never more than a manual nudge.

## About

The About section reports the installed package version. Include it when reporting a behavior that
may have changed between releases.

## Interface scale

Scale is controlled by keyboard rather than this dialog:

- <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>+</kbd> increases it;
- <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>-</kbd> decreases it;
- <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>0</kbd> resets to 100%.

Scale is local UI state and does not change Markdown.
