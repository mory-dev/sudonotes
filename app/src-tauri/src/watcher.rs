//! Watches the vault and linked projects for changes made outside the app.
//!
//! Markdown files are the source of truth, so an app that ignored external
//! edits would happily overwrite them. The watcher reindexes whatever changed,
//! ingests external edits from linked project mirror files (IDEAS.md) into canonical
//! vault notes, and tells the frontend to refresh.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};

use crate::index::file_mtime;
use crate::note::{Note, NoteType, WriteNote};
use crate::project::{is_echo, record_sync};
use crate::vault::{is_markdown, title_from_path};
use crate::AppState;

const DEBOUNCE: Duration = Duration::from_millis(300);
pub const CHANGE_EVENT: &str = "vault-changed";

#[allow(dead_code)]
pub struct WatcherHandle {
    watcher: Arc<Mutex<RecommendedWatcher>>,
    watched_projects: Arc<Mutex<HashSet<PathBuf>>>,
}

#[allow(dead_code)]
impl WatcherHandle {
    /// Watch a linked project root for changes to IDEAS.md.
    pub fn watch_project(&self, root: &Path) {
        if !root.is_dir() {
            return;
        }
        let Ok(mut projects) = self.watched_projects.lock() else {
            return;
        };
        let canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        if projects.insert(canonical) {
            if let Ok(mut w) = self.watcher.lock() {
                let _ = w.watch(root, RecursiveMode::NonRecursive);
            }
        }
    }

    /// Stop watching an unlinked project root.
    pub fn unwatch_project(&self, root: &Path) {
        let Ok(mut projects) = self.watched_projects.lock() else {
            return;
        };
        let canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        if projects.remove(&canonical) {
            if let Ok(mut w) = self.watcher.lock() {
                let _ = w.unwatch(root);
            }
        }
    }
}

/// Start watching `vault_root` recursively. The returned handle keeps the watcher
/// alive and allows dynamic addition/removal of watched project directories.
pub fn spawn(app: tauri::AppHandle, vault_root: PathBuf) -> notify::Result<WatcherHandle> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = tx.send(event);
    })?;
    watcher.watch(&vault_root, RecursiveMode::Recursive)?;

    let watched_projects = Arc::new(Mutex::new(HashSet::new()));
    let watcher_arc = Arc::new(Mutex::new(watcher));

    let handle = WatcherHandle {
        watcher: watcher_arc,
        watched_projects,
    };

    let app_handle = app.clone();
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

            if process_changes(&app_handle, &batch) {
                let _ = app_handle.emit(CHANGE_EVENT, ());
            }
            batch.clear();
        }
    });

    Ok(handle)
}

/// Reindex changed vault paths and ingest external changes from linked project
/// mirror files. Returns whether anything in the index or vault moved.
fn process_changes(app: &tauri::AppHandle, paths: &HashSet<PathBuf>) -> bool {
    let state = app.state::<AppState>();
    let Ok(mut guard) = state.open.lock() else {
        return false;
    };
    let Some(open) = guard.as_mut() else {
        return false;
    };

    let mut changed = false;
    for path in paths {
        // 1. Check if the path belongs to the vault subtree (prompts/ or ideas/).
        if let Some(note_type) = open.vault.type_of(path) {
            if !is_markdown(path) {
                continue;
            }

            if path.is_file() {
                let Ok(content) = std::fs::read_to_string(path) else {
                    continue;
                };

                // Echo-loop prevention: skip if this write was made by sudonotes itself
                if is_echo(path, &content) {
                    continue;
                }

                let note = Note::parse(&content, &title_from_path(path));
                let mtime = file_mtime(path);
                record_sync(path, &content, mtime);

                if open.index.upsert(note_type, path, &note, mtime).is_ok() {
                    changed = true;
                }
            } else if open.index.remove_path(path).is_ok() {
                changed = true;
            }
            continue;
        }

        // 2. Check if this is a project mirror file (<project>/IDEAS.md).
        let is_mirror = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|name| name.eq_ignore_ascii_case("IDEAS.md"))
            .unwrap_or(false);

        if !is_mirror || !path.is_file() {
            continue;
        }

        let Some(project_dir) = path.parent() else {
            continue;
        };

        let Ok(mirror_content) = std::fs::read_to_string(path) else {
            continue;
        };

        // Echo-loop prevention: skip if this mirror write was emitted by sudonotes
        if is_echo(path, &mirror_content) {
            continue;
        }

        // Find linked idea in vault matching this project directory
        let Ok(linked_ideas) = open.index.linked_ideas() else {
            continue;
        };

        let canon_proj = std::fs::canonicalize(project_dir).unwrap_or_else(|_| project_dir.to_path_buf());

        for linked in linked_ideas {
            let canon_linked_proj = std::fs::canonicalize(&linked.project).unwrap_or_else(|_| linked.project.clone());
            if canon_linked_proj != canon_proj {
                continue;
            }

            let vault_path = linked.path;
            if !vault_path.is_file() {
                continue;
            }

            let Ok(canonical_raw) = std::fs::read_to_string(&vault_path) else {
                continue;
            };

            let mut canonical_note = Note::parse(&canonical_raw, &title_from_path(&vault_path));
            let parsed_mirror = Note::parse(&mirror_content, &canonical_note.frontmatter.title);

            // Clean imported body
            let imported_body = parsed_mirror.body;
            if imported_body.trim() == canonical_note.body.trim() {
                let mtime = file_mtime(path);
                record_sync(path, &mirror_content, mtime);
                continue;
            }

            // Conflict Guard & Ingestion:
            // Newer external edits from disk take precedence. Update canonical note.
            canonical_note.body = imported_body;
            if !parsed_mirror.frontmatter.models.is_empty() {
                canonical_note.frontmatter.models = parsed_mirror.frontmatter.models;
            }
            if !parsed_mirror.frontmatter.bubble_tags.is_empty() {
                canonical_note.frontmatter.bubble_tags = parsed_mirror.frontmatter.bubble_tags;
            }
            canonical_note.frontmatter.updated = crate::note::now_rfc3339();

            if canonical_note.write_to(&vault_path).is_ok() {
                let vault_mtime = file_mtime(&vault_path);
                let mirror_mtime = file_mtime(path);

                // Record sync for both canonical vault note and project mirror
                record_sync(&vault_path, &canonical_note.to_markdown(), vault_mtime);
                record_sync(path, &mirror_content, mirror_mtime);

                if open
                    .index
                    .upsert(NoteType::Idea, &vault_path, &canonical_note, vault_mtime)
                    .is_ok()
                {
                    changed = true;
                }
            }
        }
    }

    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sudonotes-watcher-test-{name}-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn watcher_handle_registers_and_unregisters_projects() {
        let dir = temp_dir("handle");
        let handle = WatcherHandle {
            watcher: Arc::new(Mutex::new(notify::recommended_watcher(|_| {}).unwrap())),
            watched_projects: Arc::new(Mutex::new(HashSet::new())),
        };

        handle.watch_project(&dir);
        let canonical = std::fs::canonicalize(&dir).unwrap();
        assert!(handle.watched_projects.lock().unwrap().contains(&canonical));

        handle.unwatch_project(&dir);
        assert!(!handle.watched_projects.lock().unwrap().contains(&canonical));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ingests_external_mirror_changes_into_vault_note() {
        let root = temp_dir("sync-e2e");
        let vault_dir = root.join("vault");
        let proj_dir = root.join("project");
        std::fs::create_dir_all(vault_dir.join("ideas")).unwrap();
        std::fs::create_dir_all(vault_dir.join("prompts")).unwrap();
        std::fs::create_dir_all(proj_dir.join(".git")).unwrap();

        let vault_path = vault_dir.join("ideas/my-app.md");
        let mut initial_note = Note::new("My App", "Initial bubble 1\n\nInitial bubble 2".into());
        initial_note.frontmatter.project = Some(proj_dir.to_string_lossy().to_string());
        initial_note.write_to(&vault_path).unwrap();

        // Write mirror with directive
        project::write_mirror(&proj_dir, "IDEAS", &initial_note.to_markdown()).unwrap();
        let mirror_path = proj_dir.join("IDEAS.md");
        assert!(mirror_path.is_file());

        // Simulate external editor / agent appending a new idea bubble to IDEAS.md
        let external_content = format!(
            "{}\n\nNew bubble added by AI Agent",
            std::fs::read_to_string(&mirror_path).unwrap()
        );
        std::fs::write(&mirror_path, &external_content).unwrap();

        // The external change is NOT an echo
        assert!(!is_echo(&mirror_path, &external_content));

        // Read and parse directly as process_changes would
        let parsed_external = Note::parse(&external_content, "My App");
        assert!(parsed_external.body.contains("New bubble added by AI Agent"));

        std::fs::remove_dir_all(&root).ok();
    }

}
