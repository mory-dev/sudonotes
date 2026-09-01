mod index;
mod ai;
mod backup;
mod models;
mod note;
mod project;
mod split;
mod vault;
mod watcher;

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, State};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use index::{file_mtime, Index, NoteMeta, SearchBubble, SearchHit};
use note::{filename_for, Note, NoteType, WriteNote};
use vault::{title_from_path, Vault};

struct OpenVault {
    vault: Vault,
    index: Index,
    /// Held only so the watcher keeps running; dropping it stops watching.
    _watcher: Option<watcher::WatcherHandle>,
}

#[derive(Default)]
struct AppState {
    open: Mutex<Option<OpenVault>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteDetail {
    id: String,
    title: String,
    #[serde(rename = "type")]
    note_type: NoteType,
    tags: Vec<String>,
    summary: Option<String>,
    model: Option<String>,
    /// The collection this prompt was split out of.
    collection: Option<String>,
    position: Option<u32>,
    /// Project folder this idea is linked to, if any.
    project: Option<String>,
    /// Whether this idea is currently paused/on hold in the sidebar.
    on_hold: bool,
    /// Per-bubble model assignment for idea notes: bubble first line -> model.
    models: BTreeMap<String, String>,
    /// Per-bubble tags for idea notes: bubble first line -> tags.
    bubble_tags: BTreeMap<String, Vec<String>>,
    created: String,
    updated: String,
    body: String,
    path: String,
}

type Result<T> = std::result::Result<T, String>;

fn note_type_name(note_type: NoteType) -> &'static str {
    match note_type {
        NoteType::Prompt => "prompt",
        NoteType::Idea => "idea",
    }
}

fn ai_input(state: &State<AppState>, id: &str) -> Result<ai::NoteInput> {
    with_vault(state, |open| {
        let path = open
            .index
            .path_of(id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&path)
            .ok_or("note is outside the vault")?;
        let raw = std::fs::read_to_string(&path).map_err(|e| err("could not read note", e))?;
        let note = Note::parse(&raw, &title_from_path(&path));
        Ok(ai::NoteInput {
            title: note.frontmatter.title,
            note_type: note_type_name(note_type).to_string(),
            body: note.body,
            model: note.frontmatter.model,
        })
    })
}

fn err(context: &str, e: impl std::fmt::Display) -> String {
    format!("{context}: {e}")
}

/// Run `f` against the currently open vault.
fn with_vault<T>(state: &State<AppState>, f: impl FnOnce(&mut OpenVault) -> Result<T>) -> Result<T> {
    let mut guard = state.open.lock().map_err(|e| err("vault lock poisoned", e))?;
    let open = guard.as_mut().ok_or("no vault is open")?;
    f(open)
}

fn last_vault_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("last-vault.txt"))
}

#[tauri::command]
fn open_vault(path: String, app: tauri::AppHandle, state: State<AppState>) -> Result<String> {
    let root = PathBuf::from(&path);
    let vault = Vault::open(root).map_err(|e| err("could not create vault directories", e))?;

    let index_path = vault.index_path();
    // A corrupt or unreadable index is never worth failing over â€” it is a cache.
    let mut index = match Index::open(&index_path) {
        Ok(i) => i,
        Err(_) => {
            let _ = std::fs::remove_file(&index_path);
            Index::open(&index_path).map_err(|e| err("could not open search index", e))?
        }
    };
    reconcile_collections(&vault);
    index
        .sync(&vault)
        .map_err(|e| err("could not index vault", e))?;

    let resolved = vault.root.to_string_lossy().to_string();
    if let Some(file) = last_vault_file(&app) {
        if let Some(parent) = file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(file, &resolved);
    }

    // Losing the watcher only costs live refresh, so it must not fail the open.
    let watcher = watcher::spawn(app.clone(), vault.root.clone())
        .map_err(|e| eprintln!("could not watch vault: {e}"))
        .ok();

    // A snapshot on open, at most once every few hours. Off the main path in a
    // thread: the user asked to open a vault, not to wait for an archive, and a
    // backup that fails must never be the reason a vault will not open.
    if let Ok(dir) = backup_dir(&app) {
        let root = vault.root.clone();
        std::thread::spawn(move || match Vault::open(root) {
            Ok(snapshot) => {
                if let Some(info) = backup::create_if_due(&snapshot, &dir) {
                    eprintln!("backed up {} notes to {}", info.notes, info.path);
                }
            }
            Err(e) => eprintln!("could not back up vault: {e}"),
        });
    }

    *state.open.lock().map_err(|e| err("vault lock poisoned", e))? = Some(OpenVault {
        vault,
        index,
        _watcher: watcher,
    });

    Ok(resolved)
}

/// The root of the open vault. AI settings live inside it, so each vault
/// carries its own answer to "may this content leave the machine?".
fn vault_root(state: &State<AppState>) -> Result<PathBuf> {
    with_vault(state, |open| Ok(open.vault.root.clone()))
}

#[tauri::command]
fn get_ai_settings(state: State<AppState>) -> Result<ai::AiSettings> {
    // Before a vault is open there is nothing to read; report the defaults
    // rather than an error, so the setup screen can still show the toggle.
    Ok(match vault_root(&state) {
        Ok(root) => ai::settings(&root),
        Err(_) => ai::AiSettings {
            enabled: true,
            show_bubble_metadata: true,
            configured: true,
        },
    })
}

#[tauri::command]
fn set_ai_settings(state: State<AppState>, enabled: bool) -> Result<ai::AiSettings> {
    ai::save_settings(&vault_root(&state)?, enabled)
}

#[tauri::command]
fn set_bubble_metadata_visible(
    state: State<AppState>,
    visible: bool,
) -> Result<ai::AiSettings> {
    ai::save_bubble_metadata_visibility(&vault_root(&state)?, visible)
}

/// Whether the AI proxy answers its health endpoint, for the status-bar dot.
#[tauri::command]
async fn ai_health() -> bool {
    ai::health().await
}

/// The running app version, e.g. "0.1.1", for the title-bar hover tooltip.
#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn model_catalog(app: tauri::AppHandle, force: bool) -> Result<models::ModelCatalog> {
    models::list(&app, force).await
}

#[tauri::command]
async fn analyze_note(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ai::AnalysisResult> {
    let input = ai_input(&state, &id)?;
    if !ai::settings(&vault_root(&state)?).enabled {
        return Err("AI assistance is turned off for this vault".to_string());
    }
    ai::analyze(&app, &input).await
}

/// A short, LLM-generated title for content about to become a note (a pasted
/// prompt). Empty when no model is configured — the caller falls back to the
/// first line.
#[tauri::command]
async fn suggest_title(
    content: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String> {
    if !ai::settings(&vault_root(&state)?).enabled {
        return Ok(String::new());
    }
    ai::suggest_title(&app, &content).await
}

#[tauri::command]
async fn auto_tag_note(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>> {
    let input = ai_input(&state, &id)?;
    // A vault with AI switched off never sends its notes anywhere, whoever asked.
    let additions = if ai::settings(&vault_root(&state)?).enabled {
        ai::tags(&app, &input)
            .await
            .unwrap_or_else(|_| ai::local_tags(&input))
    } else {
        ai::local_tags(&input)
    };

    with_vault(&state, |open| {
        let path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&path)
            .ok_or("note is outside the vault")?;
        let raw = std::fs::read_to_string(&path).map_err(|e| err("could not read note", e))?;
        let mut note = Note::parse(&raw, &title_from_path(&path));

        // Do not apply a stale AI result over an edit made while the request ran.
        if note.frontmatter.title != input.title || note.body != input.body {
            return Ok(note.frontmatter.tags);
        }

        let before = note.frontmatter.tags.clone();
        for tag in additions {
            if !note.frontmatter.tags.contains(&tag) {
                note.frontmatter.tags.push(tag);
            }
        }
        note.frontmatter.tags.sort();
        if note.frontmatter.tags == before {
            return Ok(note.frontmatter.tags);
        }
        note.frontmatter.updated = note::now_rfc3339();
        note.write_to(&path)
            .map_err(|e| err("could not write tags", e))?;
        sync_mirror(&note);
        open.index
            .upsert(note_type, &path, &note, file_mtime(&path))
            .map_err(|e| err("could not index note", e))?;
        Ok(note.frontmatter.tags)
    })
}

/// A linked idea is always mirrored into its project as IDEAS.md — the
/// project-standard ideas file — whatever the note's own title is.
const MIRROR_STEM: &str = "IDEAS";

/// Push a linked idea's current text into its project root. Best effort: a
/// missing or unwritable project must never block saving the note itself.
fn sync_mirror(note: &Note) {
    let Some(root) = &note.frontmatter.project else {
        return;
    };
    let _ = project::write_mirror(
        std::path::Path::new(root),
        MIRROR_STEM,
        &note.to_markdown(),
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkResult {
    info: project::ProjectInfo,
    /// The project already has the note's mirror file (usually IDEAS.md) and
    /// nothing was written — the UI asks whether to import or replace it.
    conflict: bool,
}

/// Link an idea to a project folder: mirror it into the root and gitignore it.
/// When the project already has the mirror file, a conflict is reported instead
/// of silently overwriting it.
#[tauri::command]
fn link_project(
    id: String,
    path: String,
    force: bool,
    state: State<AppState>,
) -> Result<LinkResult> {
    let root = PathBuf::from(path.trim());
    if !root.is_dir() {
        return Err("that folder does not exist".into());
    }

    with_vault(&state, |open| {
        let note_path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&note_path)
            .ok_or("note is outside the vault")?;
        let content =
            std::fs::read_to_string(&note_path).map_err(|e| err("could not read note", e))?;

        let note = Note::parse(&content, &title_from_path(&note_path));
        let info = project::describe(&root);

        if !force && project::mirror_path(&root, MIRROR_STEM).exists() {
            return Ok(LinkResult { info, conflict: true });
        }

        let mut note = note;
        note.frontmatter.project = Some(root.to_string_lossy().to_string());
        note.frontmatter.updated = note::now_rfc3339();

        // The idea's collection title follows the project's folder name, so the
        // bucket it groups under in the sidebar matches the linked project.
        let folder = root
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty());
        let mut retitled = false;
        if let Some(folder) = folder {
            let old_title = note.frontmatter.title.clone();
            if old_title != folder {
                note.frontmatter.title = folder.clone();
                note.write_to(&note_path)
                    .map_err(|e| err("could not write note", e))?;
                retitle_files(&note_path, &old_title, &folder);
                update_vault_references(&open.vault, &old_title, &folder);
                retitled = true;
            }
        }
        if !retitled {
            note.write_to(&note_path)
                .map_err(|e| err("could not write note", e))?;
        }
        project::write_mirror(&root, MIRROR_STEM, &note.to_markdown())
            .map_err(|e| err("could not write into the project", e))?;

        // A retitle moved the file (and any collection folder), so rebuild from
        // disk rather than patching an entry for a path that no longer exists.
        if retitled {
            open.index
                .sync(&open.vault)
                .map_err(|e| err("could not reindex vault", e))?;
        } else {
            open.index
                .upsert(note_type, &note_path, &note, file_mtime(&note_path))
                .map_err(|e| err("could not index note", e))?;
        }

        Ok(LinkResult { info, conflict: false })
    })
}

/// Take a project's existing IDEAS.md as the baseline for an idea: import its
/// content into the note, then link the project and rewrite the mirror.
#[tauri::command]
fn import_project_idea(
    id: String,
    path: String,
    state: State<AppState>,
) -> Result<project::ProjectInfo> {
    let root = PathBuf::from(path.trim());
    if !root.is_dir() {
        return Err("that folder does not exist".into());
    }

    with_vault(&state, |open| {
        let note_path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&note_path)
            .ok_or("note is outside the vault")?;
        let content =
            std::fs::read_to_string(&note_path).map_err(|e| err("could not read note", e))?;

        let mut note = Note::parse(&content, &title_from_path(&note_path));
        let mirror = project::mirror_path(&root, MIRROR_STEM);

        if mirror.exists() {
            let existing =
                std::fs::read_to_string(&mirror).map_err(|e| err("could not read IDEAS.md", e))?;
            let imported = Note::parse(&existing, MIRROR_STEM);
            note.body = imported.body;
        }

        note.frontmatter.project = Some(root.to_string_lossy().to_string());
        note.frontmatter.updated = note::now_rfc3339();

        // Same retitle as `link_project`: the imported idea's collection title
        // becomes the project's folder name.
        let folder = root
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| !name.is_empty());
        let mut retitled = false;
        if let Some(folder) = folder {
            let old_title = note.frontmatter.title.clone();
            if old_title != folder {
                note.frontmatter.title = folder.clone();
                note.write_to(&note_path)
                    .map_err(|e| err("could not write note", e))?;
                retitle_files(&note_path, &old_title, &folder);
                update_vault_references(&open.vault, &old_title, &folder);
                retitled = true;
            }
        }
        if !retitled {
            note.write_to(&note_path)
                .map_err(|e| err("could not write note", e))?;
        }
        project::write_mirror(&root, MIRROR_STEM, &note.to_markdown())
            .map_err(|e| err("could not write into the project", e))?;

        if retitled {
            open.index
                .sync(&open.vault)
                .map_err(|e| err("could not reindex vault", e))?;
        } else {
            open.index
                .upsert(note_type, &note_path, &note, file_mtime(&note_path))
                .map_err(|e| err("could not index note", e))?;
        }

        Ok(project::describe(&root))
    })
}

/// Unlink an idea, optionally deleting the copy left in the project.
#[tauri::command]
fn unlink_project(id: String, remove_file: bool, state: State<AppState>) -> Result<()> {
    with_vault(&state, |open| {
        let note_path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&note_path)
            .ok_or("note is outside the vault")?;
        let content =
            std::fs::read_to_string(&note_path).map_err(|e| err("could not read note", e))?;

        let mut note = Note::parse(&content, &title_from_path(&note_path));
        if let (true, Some(root)) = (remove_file, note.frontmatter.project.as_ref()) {
            project::remove_mirror(std::path::Path::new(root), MIRROR_STEM);
        }

        note.frontmatter.project = None;
        note.frontmatter.updated = note::now_rfc3339();
        note.write_to(&note_path)
            .map_err(|e| err("could not write note", e))?;

        open.index
            .upsert(note_type, &note_path, &note, file_mtime(&note_path))
            .map_err(|e| err("could not index note", e))
    })
}

/// Name, git status, and favicon for a project folder.
#[tauri::command]
fn project_info(path: String) -> project::ProjectInfo {
    project::describe(std::path::Path::new(path.trim()))
}

/// Move a renamed note's file — and the collection folder it owns — so the
/// vault stays browsable, then re-stamp the children's `source`.
///
/// Best effort throughout: a failed move leaves the old path in place rather
/// than aborting the rename, and the caller reindexes from disk afterwards.
fn retitle_files(old_path: &std::path::Path, old_title: &str, new_title: &str) {
    let Some(parent_dir) = old_path.parent() else {
        return;
    };
    // A child prompt carries its collection's name; its parent note holds the
    // index link that must follow the rename. Read it before the file moves.
    let is_child = std::fs::read_to_string(old_path)
        .map(|raw| Note::parse(&raw, &title_from_path(old_path)).frontmatter.source.is_some())
        .unwrap_or(false);

    let stem = filename_for(new_title);
    let old_dir = old_path.with_extension("");

    let new_path = parent_dir.join(format!("{stem}.md"));
    if new_path != old_path && !new_path.exists() {
        let _ = std::fs::rename(old_path, &new_path);
    }

    let new_dir = parent_dir.join(&stem);
    let children_dir = if old_dir.is_dir() && new_dir != old_dir && !new_dir.exists() {
        match std::fs::rename(&old_dir, &new_dir) {
            Ok(()) => new_dir,
            Err(_) => old_dir,
        }
    } else {
        old_dir
    };

    for path in vault::markdown_files_in(&children_dir) {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let mut child = Note::parse(&raw, &title_from_path(&path));
        if child.frontmatter.source.as_deref() != Some(old_title) {
            continue;
        }
        child.frontmatter.source = Some(new_title.to_string());
        let _ = child.write_to(&path);
    }

    // Keep the parent's index of [[links]] in step: prompts/collection/prompt.md
    // belongs to prompts/collection.md, whose body lists it by title.
    if is_child {
        let parent_path = old_path
            .parent()
            .map(|dir| dir.with_extension("md"))
            .filter(|p| p.is_file());
        if let Some(parent_path) = parent_path {
            if let Ok(raw) = std::fs::read_to_string(&parent_path) {
                let mut parent = Note::parse(&raw, &title_from_path(&parent_path));
                let updated = parent
                    .body
                    .replace(&format!("[[{old_title}]]"), &format!("[[{new_title}]]"));
                if updated != parent.body {
                    parent.body = updated;
                    parent.frontmatter.updated = note::now_rfc3339();
                    let _ = parent.write_to(&parent_path);
                }
            }
        }
    }
}

/// When a note is renamed, update all `[[old_title]]` wiki links pointing to it
/// across all markdown files in the vault to `[[new_title]]`, preserving any custom aliases.
fn update_vault_references(vault: &Vault, old_title: &str, new_title: &str) {
    if old_title.trim().eq_ignore_ascii_case(new_title.trim()) {
        return;
    }
    for (_note_type, path) in vault.scan() {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let mut note = Note::parse(&raw, &title_from_path(&path));
        let (updated_body, changed) = note::replace_links(&note.body, old_title, new_title);
        if changed {
            note.body = updated_body;
            note.frontmatter.updated = note::now_rfc3339();
            let _ = note.write_to(&path);
        }
    }
}

/// Save every editable field of a note at once — used by the inline card
/// editor, which changes title, body, tags and model together.
#[tauri::command]
fn update_note(
    id: String,
    title: String,
    body: String,
    tags: Vec<String>,
    model: Option<String>,
    state: State<AppState>,
) -> Result<()> {
    with_vault(&state, |open| {
        let path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let content = std::fs::read_to_string(&path).map_err(|e| err("could not read note", e))?;

        let mut note = Note::parse(&content, &title_from_path(&path));
        let old_title = note.frontmatter.title.clone();

        let title = title.trim();
        if !title.is_empty() {
            note.frontmatter.title = title.to_string();
        }
        note.frontmatter.tags = tags
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        note.frontmatter.model = model.map(|m| m.trim().to_string()).filter(|m| !m.is_empty());
        note.body = format!("\n{}\n", body.trim());
        note.frontmatter.updated = note::now_rfc3339();

        note.write_to(&path)
            .map_err(|e| err("could not write note", e))?;

        if old_title != note.frontmatter.title {
            retitle_files(&path, &old_title, &note.frontmatter.title);
            update_vault_references(&open.vault, &old_title, &note.frontmatter.title);
        }
        sync_mirror(&note);

        open.index
            .sync(&open.vault)
            .map_err(|e| err("could not reindex vault", e))
    })
}

/// Bring every collection's children in line with its parent note's title.
///
/// Self-heals vaults where the parent was renamed outside the app — or by an
/// earlier version that did not propagate the rename — so the sidebar never
/// shows a stale collection name.
fn reconcile_collections(vault: &Vault) {
    for note_type in [NoteType::Prompt, NoteType::Idea] {
        let Ok(entries) = std::fs::read_dir(vault.dir_for(note_type)) else {
            continue;
        };

        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            // prompts/shipper-prompts/ is owned by prompts/shipper-prompts.md
            let parent_file = dir.with_extension("md");
            let Ok(raw) = std::fs::read_to_string(&parent_file) else {
                continue;
            };
            let wanted = Note::parse(&raw, &title_from_path(&parent_file))
                .frontmatter
                .title;

            for path in vault::markdown_files_in(&dir) {
                let Ok(child_raw) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let mut child = Note::parse(&child_raw, &title_from_path(&path));
                // Only touch notes that were split out of a collection.
                if child.frontmatter.source.is_none()
                    || child.frontmatter.source.as_deref() == Some(wanted.as_str())
                {
                    continue;
                }
                child.frontmatter.source = Some(wanted.clone());
                let _ = child.write_to(&path);
            }
        }
    }
}

/// A sensible default vault location, so first-run does not start with an empty
/// field and a file dialog. A dotfolder at the top of the home directory, in the
/// same spirit as `.ssh` or `.config`.
#[tauri::command]
fn suggest_vault_path(app: tauri::AppHandle) -> String {
    let base = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join(".sudonotes").to_string_lossy().to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathInfo {
    exists: bool,
    note_count: usize,
}

/// Describe a candidate vault folder without creating anything.
#[tauri::command]
fn inspect_path(path: String) -> PathInfo {
    let path = PathBuf::from(path.trim());
    PathInfo {
        exists: path.is_dir(),
        note_count: vault::count_notes(&path),
    }
}

/// The vault opened last time, if it still exists.
#[tauri::command]
fn last_vault(app: tauri::AppHandle) -> Option<String> {
    let file = last_vault_file(&app)?;
    let path = std::fs::read_to_string(file).ok()?;
    let path = path.trim();
    (!path.is_empty() && PathBuf::from(path).is_dir()).then(|| path.to_string())
}

#[tauri::command]
fn list_notes(note_type: Option<NoteType>, state: State<AppState>) -> Result<Vec<NoteMeta>> {
    with_vault(&state, |open| {
        let mut notes = open.index.list(note_type).map_err(|e| err("list failed", e))?;

        // Attach each linked idea's project icon, computed once per project.
        let mut icons: std::collections::HashMap<String, Option<String>> =
            std::collections::HashMap::new();
        for note in &mut notes {
            let Some(project) = &note.project else {
                continue;
            };
            let icon = icons
                .entry(project.clone())
                .or_insert_with(|| project::describe(std::path::Path::new(project)).icon)
                .clone();
            note.icon = icon;
        }
        Ok(notes)
    })
}

#[tauri::command]
fn read_note(id: String, state: State<AppState>) -> Result<NoteDetail> {
    with_vault(&state, |open| {
        let path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open.vault.type_of(&path).ok_or("note is outside the vault")?;
        let content = std::fs::read_to_string(&path).map_err(|e| err("could not read note", e))?;
        let note = Note::parse(&content, &title_from_path(&path));

        let fm = note.frontmatter;
        Ok(NoteDetail {
            id: fm.id,
            title: fm.title,
            note_type,
            tags: fm.tags,
            summary: fm.summary,
            model: fm.model,
            collection: fm.source,
            position: fm.position,
            project: fm.project,
            on_hold: fm.on_hold,
            models: fm.models,
            bubble_tags: fm.bubble_tags,
            created: fm.created,
            updated: fm.updated,
            body: note.body,
            path: path.to_string_lossy().to_string(),
        })
    })
}

#[tauri::command]
fn create_note(note_type: NoteType, title: String, state: State<AppState>) -> Result<String> {
    with_vault(&state, |open| {
        let title = if title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            title.trim().to_string()
        };
        let path = open.vault.unique_path(note_type, &title);
        let note = Note::new(&title, "\n".to_string());
        note.write_to(&path)
            .map_err(|e| err("could not write note", e))?;
        open.index
            .upsert(note_type, &path, &note, file_mtime(&path))
            .map_err(|e| err("could not index note", e))?;
        Ok(note.frontmatter.id)
    })
}

/// Add a prompt into the open collection: a note in the collection subfolder,
/// linked from the parent's index. Returns the new child's id.
#[tauri::command]
fn create_child(
    parent_id: String,
    title: String,
    body: String,
    state: State<AppState>,
) -> Result<String> {
    with_vault(&state, |open| {
        let parent_path = open
            .index
            .path_of(&parent_id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&parent_path)
            .ok_or("note is outside the vault")?;
        let content =
            std::fs::read_to_string(&parent_path).map_err(|e| err("could not read note", e))?;

        let mut parent = Note::parse(&content, &title_from_path(&parent_path));
        let collection = parent.frontmatter.title.clone();

        // prompts/shipper-prompts.md -> prompts/shipper-prompts/
        let dir = parent_path.with_extension("");
        std::fs::create_dir_all(&dir).map_err(|e| err("could not create collection folder", e))?;

        let title = if title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            title.trim().to_string()
        };

        let position = open
            .index
            .collection_paths(&collection)
            .map_err(|e| err("lookup failed", e))?
            .into_iter()
            .filter_map(|(_, path)| {
                let raw = std::fs::read_to_string(&path).ok()?;
                Note::parse(&raw, &title_from_path(&path)).frontmatter.position
            })
            .max()
            .unwrap_or(0)
            + 1;

        let child_body = if body.trim().is_empty() {
            "\n".to_string()
        } else {
            format!("\n{}\n", body.trim())
        };
        let mut child = Note::new(&title, child_body);
        child.frontmatter.source = Some(collection.clone());
        child.frontmatter.position = Some(position);

        let path = unique_in(&dir, &title);
        child
            .write_to(&path)
            .map_err(|e| err("could not write prompt", e))?;
        open.index
            .upsert(note_type, &path, &child, file_mtime(&path))
            .map_err(|e| err("could not index prompt", e))?;

        // The parent becomes an index linking to the new prompt.
        parent.body = if parent.body.trim().is_empty() {
            format!("\n- [[{title}]]\n")
        } else {
            format!("{}\n- [[{title}]]\n", parent.body.trim_end())
        };
        parent.frontmatter.updated = note::now_rfc3339();
        parent
            .write_to(&parent_path)
            .map_err(|e| err("could not write note", e))?;
        open.index
            .upsert(note_type, &parent_path, &parent, file_mtime(&parent_path))
            .map_err(|e| err("could not index note", e))?;

        Ok(child.frontmatter.id)
    })
}

/// Apply a new visual order to a collection's children: rewrite each child's
/// `position` in its markdown frontmatter and rebuild the parent's [[link]]
/// index to match.
#[tauri::command]
fn reorder_children(
    parent_id: String,
    ordered: Vec<String>,
    state: State<AppState>,
) -> Result<()> {
    with_vault(&state, |open| {
        let parent_path = open
            .index
            .path_of(&parent_id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&parent_path)
            .ok_or("note is outside the vault")?;
        let content =
            std::fs::read_to_string(&parent_path).map_err(|e| err("could not read note", e))?;
        let mut parent = Note::parse(&content, &title_from_path(&parent_path));

        let mut links = String::new();
        for (i, child_id) in ordered.iter().enumerate() {
            let child_path = open
                .index
                .path_of(child_id)
                .map_err(|e| err("lookup failed", e))?
                .ok_or("child not found")?;
            let child_raw =
                std::fs::read_to_string(&child_path).map_err(|e| err("could not read child", e))?;
            let mut child = Note::parse(&child_raw, &title_from_path(&child_path));
            if child.frontmatter.position != Some(i as u32 + 1) {
                child.frontmatter.position = Some(i as u32 + 1);
                child.frontmatter.updated = note::now_rfc3339();
                child
                    .write_to(&child_path)
                    .map_err(|e| err("could not write child", e))?;
                open.index
                    .upsert(note_type, &child_path, &child, file_mtime(&child_path))
                    .map_err(|e| err("could not index child", e))?;
            }
            links.push_str(&format!("- [[{}]]\n", child.frontmatter.title));
        }

        // Keep whatever else the parent body holds, and rewrite the index list.
        let kept: Vec<&str> = parent
            .body
            .lines()
            .filter(|line| !(line.trim().starts_with('-') && line.contains("[[")))
            .collect();
        let kept = kept.join("\n").trim().to_string();
        parent.body = if kept.is_empty() {
            format!("\n{links}")
        } else {
            format!("\n{kept}\n\n{links}")
        };
        parent.frontmatter.updated = note::now_rfc3339();
        parent
            .write_to(&parent_path)
            .map_err(|e| err("could not write note", e))?;
        open.index
            .upsert(note_type, &parent_path, &parent, file_mtime(&parent_path))
            .map_err(|e| err("could not index note", e))?;

        Ok(())
    })
}

/// Apply a new visual order to the top level of a section by writing each
/// note's `position`. A collection is ordered by its own parent note, so
/// buckets and loose notes share one list and one command.
///
/// Unlike `reorder_children` this touches no bodies — only the frontmatter of
/// the notes whose position actually changed.
#[tauri::command]
fn reorder_notes(ordered: Vec<String>, state: State<AppState>) -> Result<()> {
    with_vault(&state, |open| {
        for (i, id) in ordered.iter().enumerate() {
            let path = open
                .index
                .path_of(id)
                .map_err(|e| err("lookup failed", e))?
                .ok_or("note not found")?;
            let note_type = open
                .vault
                .type_of(&path)
                .ok_or("note is outside the vault")?;
            let raw = std::fs::read_to_string(&path).map_err(|e| err("could not read note", e))?;
            let mut note = Note::parse(&raw, &title_from_path(&path));

            let position = i as u32 + 1;
            if note.frontmatter.position == Some(position) {
                continue;
            }
            note.frontmatter.position = Some(position);
            note.frontmatter.updated = note::now_rfc3339();
            note.write_to(&path)
                .map_err(|e| err("could not write note", e))?;
            open.index
                .upsert(note_type, &path, &note, file_mtime(&path))
                .map_err(|e| err("could not index note", e))?;
        }

        Ok(())
    })
}

/// Where vault snapshots live: the app's own data directory, deliberately not
/// inside the vault, so deleting the vault folder does not take them along.
fn backup_dir(app: &tauri::AppHandle) -> std::result::Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("backups"))
        .map_err(|e| format!("no app data directory: {e}"))
}

fn backup_state_for(app: &tauri::AppHandle) -> Result<backup::BackupSettings> {
    let dir = backup_dir(app)?;
    Ok(backup::BackupSettings {
        enabled: backup::enabled(&dir),
        keep: backup::keep_count(&dir),
        interval_minutes: backup::interval_minutes(&dir),
        directory: dir.display().to_string(),
        last: backup::list(&dir).into_iter().next(),
    })
}

#[tauri::command]
fn backup_state(app: tauri::AppHandle) -> Result<backup::BackupSettings> {
    backup_state_for(&app)
}

#[tauri::command]
fn set_backup_enabled(enabled: bool, app: tauri::AppHandle) -> Result<backup::BackupSettings> {
    let dir = backup_dir(&app)?;
    backup::set_enabled(&dir, enabled)?;
    backup_state_for(&app)
}

/// Adjust how many archives are kept and how often one is written. Values are
/// clamped to the allowed ranges before they are stored.
#[tauri::command]
fn set_backup_retention(
    keep: usize,
    interval_minutes: u64,
    app: tauri::AppHandle,
) -> Result<backup::BackupSettings> {
    let dir = backup_dir(&app)?;
    backup::set_retention(&dir, keep, interval_minutes)?;
    backup_state_for(&app)
}

/// Snapshot the open vault now, whatever the schedule says.
#[tauri::command]
fn backup_now(app: tauri::AppHandle, state: State<AppState>) -> Result<backup::BackupInfo> {
    let dir = backup_dir(&app)?;
    with_vault(&state, |open| Ok(backup::create(&open.vault, &dir)?))
}

/// Unpack a `.bak` into a folder the user picked. Notes already there are
/// replaced; before that happens their current state is snapshotted into the
/// backup directory, so the restore is never the last copy of anything.
#[tauri::command]
fn restore_backup(
    archive: String,
    destination: String,
    app: tauri::AppHandle,
) -> Result<usize> {
    Ok(backup::restore(
        std::path::Path::new(&archive),
        std::path::Path::new(&destination),
        &backup_dir(&app)?,
    )?)
}

#[tauri::command]
fn write_note(id: String, body: String, state: State<AppState>) -> Result<()> {
    save(&state, &id, |note| note.body = body)
}

#[tauri::command]
fn update_model(id: String, model: Option<String>, state: State<AppState>) -> Result<()> {
    save(&state, &id, |note| {
        note.frontmatter.model = model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
    })
}

/// Assign the model a bubble's prompt targets, keyed by the bubble's first
/// line. An empty model clears the assignment. Returns the updated map so the
/// editor can keep its copy in step.
#[tauri::command]
fn set_bubble_model(
    id: String,
    key: String,
    model: String,
    state: State<AppState>,
) -> Result<BTreeMap<String, String>> {
    with_vault(&state, |open| {
        let path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&path)
            .ok_or("note is outside the vault")?;
        let content = std::fs::read_to_string(&path).map_err(|e| err("could not read note", e))?;
        let mut note = Note::parse(&content, &title_from_path(&path));

        let key = key.trim().to_string();
        let model = model.trim().to_string();
        if model.is_empty() {
            note.frontmatter.models.remove(&key);
        } else {
            note.frontmatter.models.insert(key, model);
        }
        note.frontmatter.updated = note::now_rfc3339();
        note.write_to(&path)
            .map_err(|e| err("could not write note", e))?;
        sync_mirror(&note);
        open.index
            .upsert(note_type, &path, &note, file_mtime(&path))
            .map_err(|e| err("could not index note", e))?;
        Ok(note.frontmatter.models)
    })
}

/// Toggle the paused/on-hold marker shown beside an idea in the sidebar.
#[tauri::command]
fn set_note_on_hold(id: String, on_hold: bool, state: State<AppState>) -> Result<()> {
    save(&state, &id, |note| note.frontmatter.on_hold = on_hold)
}

/// Replace the tags attached to one idea bubble. Empty tag lists clear the
/// entry. Returns the updated map so the editor can update without reloading.
#[tauri::command]
fn set_bubble_tags(
    id: String,
    key: String,
    tags: Vec<String>,
    state: State<AppState>,
) -> Result<BTreeMap<String, Vec<String>>> {
    with_vault(&state, |open| {
        let path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&path)
            .ok_or("note is outside the vault")?;
        let content = std::fs::read_to_string(&path).map_err(|e| err("could not read note", e))?;
        let mut note = Note::parse(&content, &title_from_path(&path));

        let key = key.trim().to_string();
        let mut tags: Vec<String> = tags
            .into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect();
        tags.sort_by_key(|tag| tag.to_lowercase());
        tags.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
        if tags.is_empty() {
            note.frontmatter.bubble_tags.remove(&key);
        } else {
            note.frontmatter.bubble_tags.insert(key, tags);
        }
        note.frontmatter.updated = note::now_rfc3339();
        note.write_to(&path)
            .map_err(|e| err("could not write note", e))?;
        sync_mirror(&note);
        open.index
            .upsert(note_type, &path, &note, file_mtime(&path))
            .map_err(|e| err("could not index note", e))?;
        Ok(note.frontmatter.bubble_tags)
    })
}

/// Rename a note, keeping the vault browsable: the file follows the new title,
/// and if the note owns a collection folder, the folder and every prompt inside
/// it follow too.
#[tauri::command]
fn rename_note(id: String, title: String, state: State<AppState>) -> Result<()> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("title cannot be empty".into());
    }

    with_vault(&state, |open| {
        let old_path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let content = std::fs::read_to_string(&old_path).map_err(|e| err("could not read note", e))?;

        let mut note = Note::parse(&content, &title_from_path(&old_path));
        let old_title = note.frontmatter.title.clone();
        if old_title == title {
            return Ok(());
        }
        note.frontmatter.title = title.clone();
        note.frontmatter.updated = note::now_rfc3339();
        note.write_to(&old_path)
            .map_err(|e| err("could not write note", e))?;

        retitle_files(&old_path, &old_title, &title);
        update_vault_references(&open.vault, &old_title, &title);

        // The mirror is always IDEAS.md, so a rename just rewrites it.
        sync_mirror(&note);

        // Paths moved, so rebuild from disk rather than patching entries.
        open.index
            .sync(&open.vault)
            .map_err(|e| err("could not reindex vault", e))
    })
}

/// Read a note, apply an edit, bump `updated`, write it back, and reindex.
fn save(state: &State<AppState>, id: &str, edit: impl FnOnce(&mut Note)) -> Result<()> {
    with_vault(state, |open| {
        let path = open
            .index
            .path_of(id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open.vault.type_of(&path).ok_or("note is outside the vault")?;
        let content = std::fs::read_to_string(&path).map_err(|e| err("could not read note", e))?;

        let mut note = Note::parse(&content, &title_from_path(&path));
        edit(&mut note);
        note.frontmatter.updated = note::now_rfc3339();

        note.write_to(&path)
            .map_err(|e| err("could not write note", e))?;
        sync_mirror(&note);
        open.index
            .upsert(note_type, &path, &note, file_mtime(&path))
            .map_err(|e| err("could not index note", e))
    })
}

#[tauri::command]
fn delete_note(id: String, state: State<AppState>) -> Result<()> {
    with_vault(&state, |open| {
        let path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;

        // A deleted child prompt leaves a stale [[link]] in its parent's index.
        let removed_child = std::fs::read_to_string(&path)
            .ok()
            .map(|raw| Note::parse(&raw, &title_from_path(&path)))
            .filter(|note| note.frontmatter.source.is_some())
            .map(|note| (note.frontmatter.source.unwrap(), note.frontmatter.title));

        std::fs::remove_file(&path).map_err(|e| err("could not delete note", e))?;
        open.index
            .remove_path(&path)
            .map_err(|e| err("could not update index", e))?;

        // A collection note owns a subfolder of prompts; deleting the bucket
        // takes its children with it.
        let dir = path.with_extension("");
        if dir.is_dir() {
            for child in vault::markdown_files_in(&dir) {
                let _ = std::fs::remove_file(&child);
                let _ = open.index.remove_path(&child);
            }
            let _ = std::fs::remove_dir(&dir);
        }

        if let Some((collection, title)) = removed_child {
            remove_index_link(&open, &path, &collection, &title);
        }

        Ok(())
    })
}

/// Remove `- [[title]]` from the collection's parent note, so a deleted prompt
/// stops showing in the bucket's index.
fn remove_index_link(open: &OpenVault, child_path: &std::path::Path, collection: &str, title: &str) {
    let parent_path = child_path.parent().map(|dir| dir.with_extension("md"));
    let Some(parent_path) = parent_path.filter(|path| path.is_file()) else {
        return;
    };
    let Ok(raw) = std::fs::read_to_string(&parent_path) else {
        return;
    };
    let mut parent = Note::parse(&raw, &title_from_path(&parent_path));
    // Only touch the bucket that owns this collection.
    if parent.frontmatter.source.is_some() || parent.frontmatter.title != collection {
        return;
    }

    let marker = format!("[[{title}]]");
    let removed = parent
        .body
        .lines()
        .any(|line| line.trim().starts_with('-') && line.contains(&marker));
    if !removed {
        return;
    }

    let kept: Vec<&str> = parent
        .body
        .lines()
        .filter(|line| !(line.trim().starts_with('-') && line.contains(&marker)))
        .collect();
    parent.body = format!("\n{}\n", kept.join("\n").trim());
    parent.frontmatter.updated = note::now_rfc3339();
    let _ = parent.write_to(&parent_path);
    let note_type = open.vault.type_of(&parent_path);
    if let Some(note_type) = note_type {
        let _ = open
            .index
            .upsert(note_type, &parent_path, &parent, file_mtime(&parent_path));
    }
}

#[tauri::command]
fn search(query: String, limit: Option<u32>, state: State<AppState>) -> Result<Vec<SearchHit>> {
    with_vault(&state, |open| search_vault(open, &query, limit.unwrap_or(50)))
}

const BUBBLE_START: &str = "<!-- bubble -->";
const BUBBLE_END: &str = "<!-- /bubble -->";

#[derive(Debug, Default)]
struct SearchSpec {
    text: String,
    tag: Option<String>,
}

/// Parse the deliberately small search syntax. A query beginning with
/// `tag:` is tag-only; quoted values keep spaces in a tag such as
/// `tag:"Opus 5"` together. Other input remains ordinary full-text search.
fn parse_search_spec(input: &str) -> SearchSpec {
    let trimmed = input.trim();
    let Some(prefix) = trimmed.get(..4) else {
        return SearchSpec {
            text: trimmed.to_string(),
            tag: None,
        };
    };
    if !prefix.eq_ignore_ascii_case("tag:") {
        return SearchSpec {
            text: trimmed.to_string(),
            tag: None,
        };
    }

    let rest = trimmed[4..].trim_start();
    if rest.is_empty() {
        return SearchSpec {
            text: trimmed.to_string(),
            tag: None,
        };
    }

    if let Some(quoted) = rest.strip_prefix('"') {
        if let Some(end) = quoted.find('"') {
            let value = quoted[..end].trim();
            if !value.is_empty() && quoted[end + 1..].trim().is_empty() {
                return SearchSpec {
                    text: String::new(),
                    tag: Some(value.to_string()),
                };
            }
        }
    } else {
        return SearchSpec {
            text: String::new(),
            tag: Some(rest.to_string()),
        };
    }

    SearchSpec {
        text: trimmed.to_string(),
        tag: None,
    }
}

/// Normalise model ids, model names, and tag values so users can search with
/// human-friendly spacing (`Opus 5`) even when frontmatter stores a provider id
/// such as `anthropic/claude-opus-5`.
fn normalise_search_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
        } else {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn metadata_matches(value: &str, query: &str) -> bool {
    let value = normalise_search_text(value);
    let query = normalise_search_text(query);
    if value.is_empty() || query.is_empty() {
        return false;
    }
    if value.contains(&query) {
        return true;
    }

    // Also tolerate a user omitting separators, e.g. `opus5` for `opus-5`.
    let compact_value: String = value.chars().filter(|ch| !ch.is_whitespace()).collect();
    let compact_query: String = query.chars().filter(|ch| !ch.is_whitespace()).collect();
    !compact_query.is_empty() && compact_value.contains(&compact_query)
}

/// Return one `(label, UTF-16 start offset)` per bubble. Marker pairs are
/// treated as a single bubble even when they contain blank lines, matching the
/// editor's bubble grouping rules closely enough for search navigation.
fn bubble_entries(body: &str) -> Vec<(String, usize)> {
    let mut entries = Vec::new();
    let mut active: Option<(Option<(String, usize)>, bool)> = None;
    let mut offset = 0usize;
    let mut in_comment = false;

    for raw_line in body.split_inclusive('\n') {
        let line = raw_line.strip_suffix('\n').unwrap_or(raw_line);
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed = line.trim();

        if trimmed == BUBBLE_START {
            if let Some((Some((label, start)), _)) = active.take() {
                entries.push((label, start));
            }
            active = Some((None, true));
            offset += raw_line.len();
            continue;
        }

        if trimmed == BUBBLE_END {
            if let Some((Some((label, start)), _)) = active.take() {
                entries.push((label, start));
            }
            offset += raw_line.len();
            continue;
        }

        if in_comment {
            if trimmed == "-->" || trimmed.starts_with("-->") {
                in_comment = false;
            }
            offset += raw_line.len();
            continue;
        }

        if trimmed == "<!--" || (trimmed.starts_with("<!--") && !trimmed.starts_with("<!-- bubble")) {
            if let Some((Some((label, start)), _)) = active.take() {
                entries.push((label, start));
            }
            if trimmed == "<!--" || !trimmed.ends_with("-->") {
                in_comment = true;
            }
            offset += raw_line.len();
            continue;
        }

        if trimmed.is_empty() {
            let closes_regular_bubble = active
                .as_ref()
                .map(|(_, in_marker)| !*in_marker)
                .unwrap_or(false);
            if closes_regular_bubble {
                if let Some((Some((label, start)), _)) = active.take() {
                    entries.push((label, start));
                }
            }
            offset += raw_line.len();
            continue;
        }

        match &mut active {
            Some((label @ None, _)) => {
                *label = Some((trimmed.to_string(), offset));
            }
            Some(_) => {}
            None => {
                active = Some((Some((trimmed.to_string(), offset)), false));
            }
        }
        offset += raw_line.len();
    }

    if let Some((Some((label, start)), _)) = active {
        entries.push((label, start));
    }

    entries
        .into_iter()
        .map(|(label, byte_start)| {
            let utf16_start = body[..byte_start].encode_utf16().count();
            (label, utf16_start)
        })
        .collect()
}

fn hit_key(hit: &SearchHit) -> String {
    match &hit.bubble {
        Some(bubble) => format!("{}:bubble:{}", hit.id, bubble.start),
        None => format!("{}:note", hit.id),
    }
}

fn add_search_hit(hits: &mut Vec<SearchHit>, seen: &mut HashSet<String>, hit: SearchHit) {
    if seen.insert(hit_key(&hit)) {
        hits.push(hit);
    }
}

/// Search both the indexed note text and metadata that intentionally stays out
/// of the FTS table (frontmatter models and per-bubble assignments). The latter
/// is read from markdown on demand so the files remain the source of truth.
fn search_vault(open: &mut OpenVault, query: &str, requested_limit: u32) -> Result<Vec<SearchHit>> {
    let spec = parse_search_spec(query);
    let limit = requested_limit.clamp(1, 200) as usize;

    // Fetch extra text hits before adding metadata hits; otherwise a vault with
    // many body matches could crowd out the model/bubble results the user asked
    // for.
    let text_limit = (limit.saturating_mul(4)).min(200) as u32;
    let mut hits = if spec.tag.is_none() && !spec.text.trim().is_empty() {
        open.index
            .search(&spec.text, text_limit)
            .map_err(|e| err("search failed", e))?
    } else {
        Vec::new()
    };
    let mut seen: HashSet<String> = hits.iter().map(hit_key).collect();

    let notes = open
        .index
        .list(None)
        .map_err(|e| err("search metadata lookup failed", e))?;
    for meta in notes {
        let Some(path) = open
            .index
            .path_of(&meta.id)
            .map_err(|e| err("search path lookup failed", e))?
        else {
            continue;
        };
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let note = Note::parse(&raw, &title_from_path(&path));

        if let Some(tag_query) = spec.tag.as_deref() {
            let matching_note_tags: Vec<String> = note
                .frontmatter
                .tags
                .iter()
                .filter(|tag| metadata_matches(tag, tag_query))
                .cloned()
                .collect();
            if !matching_note_tags.is_empty() {
                add_search_hit(
                    &mut hits,
                    &mut seen,
                    SearchHit {
                        id: meta.id.clone(),
                        title: note.frontmatter.title.clone(),
                        note_type: meta.note_type,
                        snippet: format!("Tags: {}", matching_note_tags.join(", ")),
                        bubble: None,
                        model: None,
                        tags: matching_note_tags,
                    },
                );
            }

            if meta.note_type == NoteType::Idea {
                for (label, start) in bubble_entries(&note.body) {
                    let Some(tags) = note.frontmatter.bubble_tags.get(&label) else {
                        continue;
                    };
                    let matching_tags: Vec<String> = tags
                        .iter()
                        .filter(|tag| metadata_matches(tag, tag_query))
                        .cloned()
                        .collect();
                    if matching_tags.is_empty() {
                        continue;
                    }
                    add_search_hit(
                        &mut hits,
                        &mut seen,
                        SearchHit {
                            id: meta.id.clone(),
                            title: note.frontmatter.title.clone(),
                            note_type: meta.note_type,
                            snippet: format!("Bubble · Tags: {}", matching_tags.join(", ")),
                            bubble: Some(SearchBubble { label, start }),
                            model: None,
                            tags: matching_tags,
                        },
                    );
                }
            }
            continue;
        }

        let matching_note_tags: Vec<String> = note
            .frontmatter
            .tags
            .iter()
            .filter(|tag| metadata_matches(tag, &spec.text))
            .cloned()
            .collect();
        if !matching_note_tags.is_empty() {
            let key = format!("{}:note", meta.id);
            if seen.contains(&key) {
                if let Some(existing) = hits
                    .iter_mut()
                    .find(|hit| hit.id == meta.id && hit.bubble.is_none())
                {
                    existing.tags = matching_note_tags.clone();
                    existing.snippet = format!(
                        "{} · Tags: {}",
                        existing.snippet,
                        matching_note_tags.join(", ")
                    );
                }
            } else {
                add_search_hit(
                    &mut hits,
                    &mut seen,
                    SearchHit {
                        id: meta.id.clone(),
                        title: note.frontmatter.title.clone(),
                        note_type: meta.note_type,
                        snippet: format!("Tags: {}", matching_note_tags.join(", ")),
                        bubble: None,
                        model: None,
                        tags: matching_note_tags,
                    },
                );
            }
        }

        if let Some(model) = note.frontmatter.model.as_deref().filter(|model| {
            metadata_matches(model, &spec.text)
        }) {
            let key = format!("{}:note", meta.id);
            if seen.contains(&key) {
                if let Some(existing) = hits
                    .iter_mut()
                    .find(|hit| hit.id == meta.id && hit.bubble.is_none())
                {
                    existing.model = Some(model.to_string());
                    existing.snippet = format!("{} · Model: {model}", existing.snippet);
                }
            } else {
                add_search_hit(
                    &mut hits,
                    &mut seen,
                    SearchHit {
                        id: meta.id.clone(),
                        title: note.frontmatter.title.clone(),
                        note_type: meta.note_type,
                        snippet: format!("Model: {model}"),
                        bubble: None,
                        model: Some(model.to_string()),
                        tags: Vec::new(),
                    },
                );
            }
        }

        if meta.note_type != NoteType::Idea {
            continue;
        }
        for (label, start) in bubble_entries(&note.body) {
            let model = note.frontmatter.models.get(&label);
            let matching_model = model.filter(|value| metadata_matches(value, &spec.text));
            let matching_tags: Vec<String> = note
                .frontmatter
                .bubble_tags
                .get(&label)
                .into_iter()
                .flat_map(|tags| tags.iter())
                .filter(|tag| metadata_matches(tag, &spec.text))
                .cloned()
                .collect();
            if matching_model.is_none() && matching_tags.is_empty() {
                continue;
            }

            let mut details = Vec::new();
            if let Some(model) = matching_model {
                details.push(format!("Model: {model}"));
            }
            if !matching_tags.is_empty() {
                details.push(format!("Tags: {}", matching_tags.join(", ")));
            }
            add_search_hit(
                &mut hits,
                &mut seen,
                SearchHit {
                    id: meta.id.clone(),
                    title: note.frontmatter.title.clone(),
                    note_type: meta.note_type,
                    snippet: format!("Bubble · {}", details.join(" · ")),
                    bubble: Some(SearchBubble { label, start }),
                    model: matching_model.cloned(),
                    tags: matching_tags,
                },
            );
        }
    }

    hits.truncate(limit);
    Ok(hits)
}

#[tauri::command]
fn backlinks(id: String, state: State<AppState>) -> Result<Vec<NoteMeta>> {
    with_vault(&state, |open| {
        let title = open
            .index
            .title_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        open.index
            .backlinks(&title)
            .map_err(|e| err("backlink lookup failed", e))
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChildPrompt {
    id: String,
    title: String,
    body: String,
    tags: Vec<String>,
    model: Option<String>,
    position: Option<u32>,
}

/// The prompts filed under this note's collection, in their original order, so
/// the collection page can show them inline instead of a list of links.
#[tauri::command]
fn collection_children(id: String, state: State<AppState>) -> Result<Vec<ChildPrompt>> {
    with_vault(&state, |open| {
        let title = open
            .index
            .title_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;

        let mut children: Vec<ChildPrompt> = open
            .index
            .collection_paths(&title)
            .map_err(|e| err("lookup failed", e))?
            .into_iter()
            .filter_map(|(child_id, path)| {
                let raw = std::fs::read_to_string(&path).ok()?;
                let note = Note::parse(&raw, &title_from_path(&path));
                Some(ChildPrompt {
                    id: child_id,
                    title: note.frontmatter.title,
                    body: note.body.trim().to_string(),
                    tags: note.frontmatter.tags,
                    model: note.frontmatter.model,
                    position: note.frontmatter.position,
                })
            })
            .collect();

        children.sort_by(|a, b| {
            a.position
                .unwrap_or(u32::MAX)
                .cmp(&b.position.unwrap_or(u32::MAX))
                .then_with(|| a.title.cmp(&b.title))
        });

        Ok(children)
    })
}

/// Detect the individual prompts inside pasted text. Nothing is written — the
/// UI shows these for confirmation first.
#[tauri::command]
fn split_preview(text: String) -> Vec<split::DraftPrompt> {
    split::split(&text)
}

/// Write confirmed drafts as individual notes in a folder named after the
/// parent note, and turn the parent into an index that links to each of them.
#[tauri::command]
fn apply_split(
    id: String,
    drafts: Vec<split::DraftPrompt>,
    paste: String,
    state: State<AppState>,
) -> Result<usize> {
    if drafts.is_empty() {
        return Err("nothing to split".into());
    }

    with_vault(&state, |open| {
        let parent_path = open
            .index
            .path_of(&id)
            .map_err(|e| err("lookup failed", e))?
            .ok_or("note not found")?;
        let note_type = open
            .vault
            .type_of(&parent_path)
            .ok_or("note is outside the vault")?;

        let content =
            std::fs::read_to_string(&parent_path).map_err(|e| err("could not read note", e))?;
        let mut parent = Note::parse(&content, &title_from_path(&parent_path));
        let collection = parent.frontmatter.title.clone();

        // prompts/shipper-prompts.md -> prompts/shipper-prompts/
        let dir = parent_path.with_extension("");
        std::fs::create_dir_all(&dir).map_err(|e| err("could not create collection folder", e))?;

        let mut links = String::new();
        for (i, draft) in drafts.iter().enumerate() {
            let title = if draft.title.trim().is_empty() {
                format!("Prompt {}", i + 1)
            } else {
                draft.title.trim().to_string()
            };

            let mut child = Note::new(&title, format!("\n{}\n", draft.body.trim()));
            child.frontmatter.tags = draft.tags.clone();
            child.frontmatter.summary = Some(draft.summary.clone()).filter(|s| !s.is_empty());
            child.frontmatter.source = Some(collection.clone());
            child.frontmatter.position = Some(i as u32 + 1);

            let path = unique_in(&dir, &title);
            child
                .write_to(&path)
                .map_err(|e| err("could not write prompt", e))?;
            open.index
                .upsert(note_type, &path, &child, file_mtime(&path))
                .map_err(|e| err("could not index prompt", e))?;

            links.push_str(&format!("- [[{title}]]\n"));
        }

        // The parent keeps its identity and gains a table of contents, so the
        // existing backlinks panel shows the collection from every child.
        // Only the pasted text is consumed — anything the note already held is
        // preserved above the index.
        let kept = strip_paste(&parent.body, &paste);
        parent.body = if kept.is_empty() {
            format!("\n{links}")
        } else {
            format!("\n{kept}\n\n{links}")
        };
        parent.frontmatter.updated = note::now_rfc3339();
        parent
            .write_to(&parent_path)
            .map_err(|e| err("could not write note", e))?;
        open.index
            .upsert(note_type, &parent_path, &parent, file_mtime(&parent_path))
            .map_err(|e| err("could not index note", e))?;

        Ok(drafts.len())
    })
}

/// Remove the pasted block from a body, leaving whatever was there before it.
/// If the paste cannot be located the body is left untouched — never destroy
/// content just because the match failed.
fn strip_paste(body: &str, paste: &str) -> String {
    if paste.is_empty() {
        return body.trim().to_string();
    }
    if body.contains(paste) {
        return body.replace(paste, "").trim().to_string();
    }
    let trimmed = paste.trim();
    if !trimmed.is_empty() && body.contains(trimmed) {
        return body.replace(trimmed, "").trim().to_string();
    }
    body.trim().to_string()
}

/// A free path for `title` inside `dir`.
fn unique_in(dir: &std::path::Path, title: &str) -> PathBuf {
    let stem = note::slugify(title);
    let mut candidate = dir.join(format!("{stem}.md"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{n}.md"));
        n += 1;
    }
    candidate
}

/// Resolve a `[[wiki link]]` target to a note id so the UI can navigate to it.
#[tauri::command]
fn resolve_link(title: String, state: State<AppState>) -> Result<Option<String>> {
    with_vault(&state, |open| {
        open.index
            .resolve_title(&title)
            .map_err(|e| err("lookup failed", e))
    })
}

#[cfg(test)]
mod tests {
    use super::{
        bubble_entries, metadata_matches, parse_search_spec, search_vault, strip_paste, Index,
        Note, OpenVault, Vault,
    };
    use std::collections::BTreeMap;

    #[test]
    fn parses_tag_only_queries_without_losing_spaces() {
        let spec = parse_search_spec(r#"tag:"Opus 5""#);
        assert_eq!(spec.text, "");
        assert_eq!(spec.tag.as_deref(), Some("Opus 5"));

        let spec = parse_search_spec("tag:design");
        assert_eq!(spec.tag.as_deref(), Some("design"));
        assert!(parse_search_spec("tag:").tag.is_none());
    }

    #[test]
    fn model_matching_ignores_provider_separators() {
        assert!(metadata_matches("anthropic/claude-opus-5", "Opus 5"));
        assert!(metadata_matches("openai/gpt-5.3", "gpt53"));
        assert!(!metadata_matches("openai/gpt-5.3", "sonnet"));
    }

    #[test]
    fn finds_regular_and_marked_bubbles_with_utf16_offsets() {
        let body = "\nFirst\n\n<!-- bubble -->\nSecond 😀\n\nThird\n<!-- /bubble -->\n";
        let entries = bubble_entries(body);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].0, "First");
        assert_eq!(entries[1].0, "Second 😀");
        assert_eq!(
            entries[1].1,
            body[..body.find("Second").unwrap()].encode_utf16().count()
        );
    }

    #[test]
    fn searches_note_and_bubble_models_and_tag_only_queries() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path().to_path_buf()).unwrap();

        let mut idea = Note::new(
            "Roadmap",
            "\nFirst bubble\n\nSecond bubble\n\nThird bubble\n".to_string(),
        );
        idea.frontmatter.models = BTreeMap::from([(
            "Second bubble".to_string(),
            "anthropic/claude-opus-5".to_string(),
        )]);
        idea.frontmatter.bubble_tags = BTreeMap::from([(
            "First bubble".to_string(),
            vec!["design".to_string()],
        )]);
        std::fs::write(
            vault.root.join("ideas/roadmap.md"),
            idea.to_markdown(),
        )
        .unwrap();

        let mut prompt = Note::new("Prompt", "\nWrite a launch plan.\n".to_string());
        prompt.frontmatter.model = Some("anthropic/claude-opus-5".to_string());
        std::fs::write(vault.root.join("prompts/prompt.md"), prompt.to_markdown()).unwrap();

        let mut index = Index::open(&vault.index_path()).unwrap();
        index.sync(&vault).unwrap();
        let mut open = OpenVault {
            vault,
            index,
            _watcher: None,
        };

        let model_hits = search_vault(&mut open, "Opus 5", 200).unwrap();
        assert!(model_hits.iter().any(|hit| hit.title == "Prompt" && hit.bubble.is_none()));
        assert!(model_hits.iter().any(|hit| {
            hit.title == "Roadmap"
                && hit.bubble.as_ref().is_some_and(|bubble| bubble.label == "Second bubble")
        }));
        assert!(!model_hits.iter().any(|hit| {
            hit.bubble.as_ref().is_some_and(|bubble| bubble.label == "First bubble")
        }));

        let tag_hits = search_vault(&mut open, r#"tag:"design""#, 200).unwrap();
        assert_eq!(tag_hits.len(), 1);
        assert_eq!(
            tag_hits[0].bubble.as_ref().map(|bubble| bubble.label.as_str()),
            Some("First bubble")
        );
    }

    #[test]
    fn removes_only_the_pasted_block() {
        let body = "\nMy own notes.\n\nDesign\n\nSome pasted prompt.\n";
        let paste = "Design\n\nSome pasted prompt.\n";
        assert_eq!(strip_paste(body, paste), "My own notes.");
    }

    #[test]
    fn tolerates_whitespace_drift_around_the_paste() {
        let body = "Kept text.\n\nDesign\n\nPasted.";
        let paste = "\n  Design\n\nPasted.  \n";
        assert_eq!(strip_paste(body, paste), "Kept text.");
    }

    #[test]
    fn leaves_the_body_alone_when_the_paste_is_not_found() {
        // Never destroy content just because the match failed.
        let body = "Something the user wrote.";
        assert_eq!(strip_paste(body, "unrelated text"), "Something the user wrote.");
        assert_eq!(strip_paste(body, ""), "Something the user wrote.");
    }

    #[test]
    fn empties_a_note_that_held_only_the_paste() {
        let body = "\nDesign\n\nPasted.\n";
        assert_eq!(strip_paste(body, "Design\n\nPasted."), "");
    }
}

#[cfg(test)]
mod updater_configuration_tests {
    #[test]
    fn main_window_can_check_install_and_restart_after_updates() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("default capability must be valid JSON");
        let permissions = capability["permissions"]
            .as_array()
            .expect("default capability must list permissions");

        for required in ["updater:default", "process:allow-restart"] {
            assert!(
                permissions.iter().any(|permission| permission == required),
                "default capability is missing {required}"
            );
        }
    }
}

/// Bring the main window into view: show, unminimize, and focus it. Windows
/// restricts SetForegroundWindow for background processes, so the always-on-top
/// flag is flipped briefly to actually raise the window above the current one.
fn raise_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_always_on_top(true);
        if let Err(e) = window.set_focus() {
            eprintln!("warning: could not focus the window: {e}");
        }
        let _ = window.set_always_on_top(false);
    } else {
        eprintln!("warning: Ctrl+Alt+N pressed but no \"main\" window exists");
    }
}

/// A low-level keyboard hook that owns Ctrl+Alt+N outright on Windows.
///
/// RegisterHotKey only ever allows one owner for a combination — whichever
/// process registered first (often AutoHotkey) wins, and a later registration
/// fails. A WH_KEYBOARD_LL hook sees every key press before it is dispatched
/// to any window or hotkey, so sudonotes takes the combination for itself and
/// swallows it before anything else (including AutoHotkey) reacts.
#[cfg(target_os = "windows")]
mod hotkey {
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, KBDLLHOOKSTRUCT, SetWindowsHookExW,
        TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, MSG,
    };

    /// VK_N, the N key.
    const VK_N: u32 = 0x4E;
    /// WM_KEYDOWN and WM_SYSKEYDOWN (the latter while Alt is held).
    const WM_KEYDOWN: usize = 0x0100;
    const WM_SYSKEYDOWN: usize = 0x0104;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && (wparam == WM_KEYDOWN || wparam == WM_SYSKEYDOWN) {
            let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
            if kb.vkCode == VK_N {
                let ctrl = (GetAsyncKeyState(VK_CONTROL as i32) as i32 & 0x8000) != 0;
                let alt = (GetAsyncKeyState(VK_MENU as i32) as i32 & 0x8000) != 0;
                let shift = (GetAsyncKeyState(VK_SHIFT as i32) as i32 & 0x8000) != 0;
                if ctrl && alt && !shift {
                    eprintln!("info: Ctrl+Alt+N pressed; raising the window");
                    if let Some(app) = APP.get() {
                        let _ = app.clone().run_on_main_thread(move || super::raise_main_window(app));
                    }
                    // Swallow the key so no other process ever sees Ctrl+Alt+N.
                    return 1;
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    /// Install the hook and pump its message queue on a background thread. The
    /// hook lives as long as the thread (and therefore the app) does; Windows
    /// removes it automatically when the thread exits.
    pub fn install(app: tauri::AppHandle) {
        let _ = APP.set(app);
        std::thread::spawn(|| unsafe {
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), std::ptr::null_mut(), 0);
            if hook.is_null() {
                eprintln!("warning: could not install the Ctrl+Alt+N keyboard hook");
                return;
            }
            eprintln!("info: Ctrl+Alt+N owned via a low-level keyboard hook");
            let mut msg = std::mem::zeroed::<MSG>();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            UnhookWindowsHookEx(hook);
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    // On Windows the combination is taken via the low-level keyboard hook, which
    // wins over any other process's registration. The global-shortcut plugin is
    // the equivalent mechanism on the other platforms.
    #[cfg(not(target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .setup(|app| {
            // Ctrl+Alt+N is a system-wide shortcut: it brings the window back
            // into view no matter what the user is doing. Wired up in Rust,
            // because the webview never sees keys while the app is in the
            // background.
            #[cfg(target_os = "windows")]
            hotkey::install(app.handle().clone());

            #[cfg(not(target_os = "windows"))]
            {
                let shortcut = "ctrl+alt+n"
                    .parse::<tauri_plugin_global_shortcut::Shortcut>()
                    .expect("valid accelerator");
                if let Err(error) = app
                    .global_shortcut()
                    .on_shortcut(shortcut, |app, _shortcut, event| {
                        if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            eprintln!("info: Ctrl+Alt+N pressed; raising the window");
                            raise_main_window(app);
                        }
                    })
                {
                    // A hotkey conflict must never stop the app from starting;
                    // the shortcut just does not work until it goes away.
                    eprintln!("warning: could not register the Ctrl+Alt+N global shortcut: {error}");
                } else {
                    eprintln!("info: registered the Ctrl+Alt+N global shortcut");
                }
            }
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_vault,
            last_vault,
            get_ai_settings,
            set_ai_settings,
            set_bubble_metadata_visible,
            ai_health,
            app_version,
            model_catalog,
            analyze_note,
            auto_tag_note,
            suggest_title,
            suggest_vault_path,
            inspect_path,
            list_notes,
            read_note,
            create_note,
            create_child,
            reorder_children,
            reorder_notes,
            backup_state,
            set_backup_enabled,
            set_backup_retention,
            backup_now,
            restore_backup,
            write_note,
            update_model,
            set_note_on_hold,
            set_bubble_model,
            set_bubble_tags,
            rename_note,
            update_note,
            delete_note,
            link_project,
            import_project_idea,
            unlink_project,
            project_info,
            search,
            backlinks,
            split_preview,
            apply_split,
            collection_children,
            resolve_link,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
