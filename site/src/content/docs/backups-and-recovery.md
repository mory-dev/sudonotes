---
title: Backups and recovery
description: Locate automatic .bak snapshots, create one now, restore safely into an empty folder, or recover manually with any ZIP tool.
section: data
order: 20
status: shipped
appliesTo: desktop
lastReviewed: "2026-08-16"
sources:
  - app/src-tauri/src/backup.rs
  - app/src/components/Settings.tsx
  - app/src-tauri/src/lib.rs
related:
  - vault-format
  - settings
  - troubleshooting
searchTerms:
  - .bak
  - recover deleted notes
  - restore backup
  - backup folder
  - zip
  - restore picker
---

sudonotes writes compressed snapshots outside the vault. Recovery always creates a separate vault;
it never merges into or overwrites the folder you still have.

## How automatic backups work

Backups are enabled by default. When a vault opens, sudonotes creates a snapshot if the newest one
is at least six hours old. It keeps the newest 20 archives and rotates only files it created with
the recognized backup name.

Archives look like:

```text
sudonotes-vault-20260809-034512.bak
```

Each `.bak` is an ordinary deflated ZIP containing:

```text
prompts/**/*.md
ideas/**/*.md
README.txt
```

The search index and settings are intentionally excluded because they are not needed to recover
notes. If one source note cannot be read during a snapshot, the backup continues with the readable
notes; check the reported note count after a manual run.

## Find the backup folder

Settings displays the exact directory for the current installation. The normal locations are:

| Platform | Backup directory |
| --- | --- |
| Windows | `%APPDATA%\com.sudonotes.app\backups\` |
| macOS | `~/Library/Application Support/com.sudonotes.app/backups/` |
| Linux | `~/.local/share/com.sudonotes.app/backups/` |

The app-data convention can vary with packaging or environment variables, so prefer the path shown
in Settings when it differs from the table.

## Create a backup now

1. Open Settings.
2. Under **Backups**, make sure a vault is open.
3. Choose **Back up now**.
4. Confirm the notice shows the expected number of notes and a non-zero archive size.

Manual backup works even when automatic snapshots are switched off. The temporary archive uses a
`.partial` name and is renamed only when ZIP writing finishes, so a crash does not leave a partial
file that looks restorable.

## Restore with sudonotes

<div class="callout warning">
  <strong class="callout-title">Choose a new empty destination.</strong>
  Do not select the current vault. The restore command refuses a folder containing even one entry,
  specifically to prevent a recovery from overwriting surviving notes.
</div>

1. Open Settings and choose **Restore a backup…**.
2. Select a `.bak` or `.zip` archive — the picker opens in the configured backups folder, where
   the archives live.
3. Select an empty folder, or create a new folder for the recovered vault.
4. Wait for the restored-note count.
5. Choose **Open it** when asked, or inspect the folder first and open it later.
6. Search for several known notes and compare important content with the old vault before changing
   or deleting anything else.

The restore skips the archive’s `README.txt` and writes only safe relative paths. Absolute paths and
entries that try to escape the destination are ignored.

## Restore manually as ZIP

Use this path if the app will not start or you need to inspect an archive before opening it.

1. Copy the `.bak` so the original remains unchanged.
2. Rename the copy from `.bak` to `.zip`.
3. Create a new empty folder.
4. Extract the ZIP into that folder—not over the old vault.
5. Confirm that `prompts/` and `ideas/` contain the expected Markdown.
6. Open the folder as a vault in sudonotes.

Windows Explorer, Finder, and ordinary ZIP tools can read the archive after the rename. Nothing in
`README.txt` is required by the app.

## Verify a recovery

Do not stop at “the archive extracted.” Verify:

- the restored count is plausible;
- important prompt and idea files open as text;
- collections still contain their child subdirectories;
- vault search rebuilds and finds a known phrase;
- linked ideas retain their project field, while understanding that the old project path may need
  to be changed on another machine.

Keep the original archive until this check is complete.

## Common restore errors

### The destination is not empty

Choose or create another folder. Do not remove the guard by extracting over the existing vault.

### “That file is not a backup archive”

The file is not a readable ZIP or is incomplete. Try another snapshot, compare file sizes, and look
for a newer `.bak`. A `.partial` file is not a completed backup.

### The restored vault has fewer notes than expected

Compare the archive’s file list with the manual backup notice. A source note that was unreadable
during creation is skipped so it cannot invalidate every other note. Check an earlier or later
snapshot and recover any missing Markdown separately.

### Permission or path error

Restore somewhere writable, such as a new folder in Documents, before moving the verified vault to
its final location.

## What these snapshots do not protect against

The 20 snapshots are local to the same device. They help with an accidentally deleted vault, bad
edit, or damaged sync copy, but not with disk loss, theft, or loss of the whole user profile. Keep a
separate off-device or versioned backup of important vaults. Never expose private note archives in a
public repository.
