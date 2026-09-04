//! Last-resort snapshots of a note's previous text.
//!
//! A note is the user's only copy. Editing shrinks and grows a body a line at a
//! time, so a save that discards most of one is not typing — it is a
//! replacement, and the only cases that produce one are a deliberate rewrite
//! and a bug. The rewrite is cheap to archive; the bug is unrecoverable without
//! it, so the previous text is kept before the write either way.
//!
//! This module only ever *adds* files under the vault's own `.sudonotes/`
//! folder. It never edits, moves or deletes a note, and the only files it
//! removes are its own older snapshots for the same note.

use std::path::{Path, PathBuf};

use crate::vault::INDEX_DIR;

const VERSIONS_DIR: &str = "versions";

/// Bodies below this are too small for "half of it went" to mean anything —
/// clearing a two-line note is ordinary editing.
const MIN_BODY_BYTES: usize = 200;

/// How much of a body a single save may drop before it is archived first.
const KEEP_RATIO: f64 = 0.5;

/// Snapshots kept per note, newest first. Markdown is tiny; this is generous.
const KEEP_PER_NOTE: usize = 20;

/// Whether replacing `before` with `after` discards enough of the note to be
/// worth keeping the old text.
pub fn is_destructive(before: &str, after: &str) -> bool {
    let before = before.trim();
    if before.len() < MIN_BODY_BYTES {
        return false;
    }
    (after.trim().len() as f64) < (before.len() as f64) * KEEP_RATIO
}

fn versions_dir(vault_root: &Path, id: &str) -> PathBuf {
    vault_root.join(INDEX_DIR).join(VERSIONS_DIR).join(id)
}

/// Archive `raw` — the note's full file contents as they are on disk right now
/// — before it is overwritten. Best effort: failing to keep a snapshot must
/// never be the reason a save fails.
pub fn snapshot(vault_root: &Path, id: &str, raw: &str) {
    let dir = versions_dir(vault_root, id);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    // Sortable and filename-safe, so rotation can order by name alone.
    let stamp = crate::note::now_rfc3339().replace(':', "-");
    let path = dir.join(format!("{stamp}.md"));
    // A second save inside the same second must not clobber the first snapshot.
    let path = if path.exists() {
        dir.join(format!("{stamp}-{}.md", ulid::Ulid::generate()))
    } else {
        path
    };
    if std::fs::write(&path, raw).is_err() {
        return;
    }

    rotate(&dir);
}

/// Keep the newest `KEEP_PER_NOTE` snapshots for one note and drop the rest.
fn rotate(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|ext| ext == "md"))
        .collect();
    if files.len() <= KEEP_PER_NOTE {
        return;
    }
    files.sort();
    let cutoff = files.len() - KEEP_PER_NOTE;
    for path in &files[..cutoff] {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(n: usize) -> String {
        "idea bubble text\n".repeat(n)
    }

    #[test]
    fn ordinary_editing_is_not_destructive() {
        let before = body(30);
        // A few lines removed by hand.
        let after = body(28);
        assert!(!is_destructive(&before, &after));
    }

    #[test]
    fn short_notes_are_never_destructive() {
        assert!(!is_destructive("a short note", ""));
    }

    #[test]
    fn losing_most_of_a_long_note_is_destructive() {
        assert!(is_destructive(&body(75), &body(3)));
    }

    #[test]
    fn snapshot_writes_and_rotates() {
        let root = std::env::temp_dir().join(format!("sudonotes-versions-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(root.join(INDEX_DIR)).unwrap();

        for n in 0..KEEP_PER_NOTE + 5 {
            snapshot(&root, "note-id", &format!("version {n}"));
        }

        let dir = versions_dir(&root, "note-id");
        let kept = std::fs::read_dir(&dir).unwrap().count();
        assert_eq!(kept, KEEP_PER_NOTE);

        std::fs::remove_dir_all(&root).ok();
    }
}
