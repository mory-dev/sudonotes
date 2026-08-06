//! Watches the vault for changes made outside the app.
//!
//! Markdown files are the source of truth, so an app that ignored external
//! edits would happily overwrite them. The watcher reindexes whatever changed
//! and tells the frontend to refresh.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};

use crate::index::file_mtime;
use crate::note::Note;
use crate::vault::{is_markdown, title_from_path};
use crate::AppState;

const DEBOUNCE: Duration = Duration::from_millis(300);
pub const CHANGE_EVENT: &str = "vault-changed";

/// Start watching `root`. The returned watcher stops when it is dropped, so the
/// caller keeps it alive for as long as the vault is open.
pub fn spawn(app: tauri::AppHandle, root: PathBuf) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = tx.send(event);
    })?;
    watcher.watch(&root, RecursiveMode::Recursive)?;

    std::thread::spawn(move || {
        let mut batch: HashSet<PathBuf> = HashSet::new();

        loop {
            // Block until something happens, then keep draining for a short
            // window so that a burst of events becomes one reindex.
            match rx.recv() {
                Ok(Ok(event)) => batch.extend(event.paths),
                Ok(Err(_)) => continue,
                Err(_) => return,
            }

            let deadline = Instant::now() + DEBOUNCE;
            while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
                match rx.recv_timeout(remaining) {
                    Ok(Ok(event)) => batch.extend(event.paths),
                    Ok(Err(_)) => continue,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }

            if reindex(&app, &batch) {
                let _ = app.emit(CHANGE_EVENT, ());
            }
            batch.clear();
        }
    });

    Ok(watcher)
}

/// Reindex the changed paths. Returns whether anything in the index moved.
fn reindex(app: &tauri::AppHandle, paths: &HashSet<PathBuf>) -> bool {
    let state = app.state::<AppState>();
    let Ok(mut guard) = state.open.lock() else {
        return false;
    };
    let Some(open) = guard.as_mut() else {
        return false;
    };

    let mut changed = false;
    for path in paths {
        if !is_markdown(path) {
            continue;
        }
        // Ignores anything outside prompts/ and ideas/, including .sudonotes/.
        let Some(note_type) = open.vault.type_of(path) else {
            continue;
        };

        if path.is_file() {
            let Ok(content) = std::fs::read_to_string(path) else {
                continue;
            };
            let note = Note::parse(&content, &title_from_path(path));
            if open
                .index
                .upsert(note_type, path, &note, file_mtime(path))
                .is_ok()
            {
                changed = true;
            }
        } else if open.index.remove_path(path).is_ok() {
            changed = true;
        }
    }

    changed
}
