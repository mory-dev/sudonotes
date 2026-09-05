---
title: Troubleshooting
description: Diagnose vault opening, stale search, external edits, project mirrors, backup failures, restore errors, model catalogs, and AI review safely.
section: reference
order: 30
status: shipped
appliesTo: desktop
lastReviewed: "2026-09-06"
sources:
  - app/src/store.ts
  - app/src-tauri/src/lib.rs
  - app/src-tauri/src/backup.rs
  - app/src-tauri/src/project.rs
related:
  - backups-and-recovery
  - external-editing-and-sync
  - privacy
searchTerms:
  - broken
  - error
  - missing note
  - stale index
  - cannot restore
---

## Start safely

Before changing files by hand, flush the open note and make a manual backup if the vault can still be
opened. Never test recovery by extracting over the current vault.

Record the app version, operating system, vault path, exact error, and whether another editor or sync
client is active. Do not include private note bodies in a public issue unless they are necessary and
sanitized.

## A vault will not open

Confirm that the path is a directory you can read and write. A new path can be created; an existing
file cannot act as a vault.

If the folder opens in a file manager, check for `prompts/` and `ideas/`. Do not create or delete
files blindly. Copy the folder first when filesystem damage is possible.

## Search is empty or stale

1. Save the open note.
2. Reopen the vault so it synchronizes the index from disk.
3. If the problem remains, close the app.
4. Remove only `<vault>/.sudonotes/index.db`.
5. Reopen and search for a known phrase.

The database is a cache. Removing note Markdown is not part of this repair. Leave
`.sudonotes/blackhole.md` in place; that file is the scratch dump, not the index.

## An external edit does not appear

If the note has a dirty buffer in sudonotes, the app deliberately does not replace it. Copy either
version to a safe file, flush or discard the intended buffer, and reopen the note.

For sync folders, wait until the sync client is idle and check for conflict-copy files. Current
sudonotes does not merge simultaneous edits.

## A wiki link does not open

Check the target spelling and title case. An alias belongs after a pipe: `[[Exact title|label]]`.
Use **Linked from** before renaming the target, and update source notes that still name the old title.

## IDEAS.md is not updating

- Read the Project card: a missing folder is marked.
- Confirm the selected path is the project root and remains writable.
- Use **Change** if the folder moved.
- Check whether another program is locking or replacing `IDEAS.md`.
- Save the vault idea and compare its `updated` value with the mirror.

The vault save is canonical and may succeed even when a later best-effort mirror write cannot.
Repair the path; do not copy an older mirror over the newer vault note.

## Project linking reports a conflict

An `IDEAS.md` already exists. **Use the existing file** imports its body; **Replace it with this
note** overwrites it; **Cancel** changes nothing. Open or copy the existing file before choosing when
its contents are unfamiliar.

## A backup is not created

Check that a vault is open, the backup switch is on for automatic runs, and the directory shown in
Settings is writable. Automatic creation may correctly skip because the newest archive is under six
hours old; **Back up now** should still run.

Compare the reported note count with the vault. Unreadable individual notes are skipped instead of
failing every other note.

## Restore refuses the destination

The destination contains something. Choose a new empty folder. The guard is a safety feature, not a
condition to work around.

If the archive is rejected, try another `.bak`, inspect a copied archive as `.zip`, and ignore any
`.partial` file. Keep the original backup unchanged.

## Models do not load

The app uses a cached public catalog for up to 24 hours. Check network access to `models.dev`, then
retry later. Existing model IDs remain in Markdown even if the catalog is temporarily unavailable.

## AI review or tags fail

Verify AI assistance is enabled for the vault and the network is available. Rate or daily capacity
limits can also refuse a request. Editing and local storage continue normally; automatic
classification may fall back to local keywords, while an on-demand review can be retried later.

## Report a reproducible issue

Open a [GitHub issue](https://github.com/mory-dev/sudonotes/issues) with:

- app version and operating system;
- shortest steps that reproduce the problem;
- expected and actual result;
- whether it also happens in a new throwaway vault;
- sanitized logs or example Markdown only when relevant.
