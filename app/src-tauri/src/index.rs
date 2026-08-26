//! SQLite index over the vault.
//!
//! This database is a disposable cache — the markdown files are the source of
//! truth. Deleting `.sudonotes/index.db` (or bumping `SCHEMA_VERSION`) simply
//! causes a full rebuild on the next launch.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::note::{extract_links, Note, NoteType};
use crate::vault::{title_from_path, Vault};

const SCHEMA_VERSION: i32 = 7;

#[derive(Debug, Clone, Serialize)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub note_type: NoteType,
    pub tags: Vec<String>,
    /// The collection this note belongs to, if it sits in a subfolder.
    pub collection: Option<String>,
    pub summary: Option<String>,
    pub updated: String,
    /// The LLM this prompt is written for, if any.
    pub model: Option<String>,
    /// Original order within its collection, when the note is a child prompt.
    pub position: Option<u32>,
    /// Project folder a linked idea mirrors into, if any.
    pub project: Option<String>,
    /// Whether this idea is paused/on hold in the sidebar.
    #[serde(rename = "onHold")]
    pub on_hold: bool,
    /// Favicon of the linked project, populated by the list command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Blank-line separated groups in the body — the note's bubbles. Only
    /// meaningful for ideas, where the sidebar shows it beside the title.
    pub bubbles: u32,
}

/// The bubbles of a body: runs of non-blank lines, matching the boxes the
/// editor draws and the "In this idea" outline.
fn count_bubbles(body: &str) -> u32 {
    let mut count = 0;
    let mut in_group = false;
    for line in body.lines() {
        if line.trim().is_empty() {
            in_group = false;
        } else if !in_group {
            in_group = true;
            count += 1;
        }
    }
    count
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchBubble {
    /// The first line that identifies this bubble (the same key used by the
    /// per-bubble model and tag maps).
    pub label: String,
    /// UTF-16 document offset, so the editor can jump to the matching bubble.
    pub start: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub note_type: NoteType,
    pub snippet: String,
    /// Present when the hit came from an idea bubble rather than the note as a
    /// whole.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bubble: Option<SearchBubble>,
    /// The model assignment that matched the query, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Tags that matched a tag-only query (or a bubble's metadata search).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tags: Vec<String>,
}

pub struct Index {
    conn: Connection,
}

impl Index {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::from_connection(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )?;

        let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version != SCHEMA_VERSION {
            conn.execute_batch(
                "DROP TABLE IF EXISTS notes;
                 DROP TABLE IF EXISTS notes_fts;
                 DROP TABLE IF EXISTS links;",
            )?;
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (
                 id      TEXT PRIMARY KEY,
                 path    TEXT UNIQUE NOT NULL,
                 type    TEXT NOT NULL,
                 title   TEXT NOT NULL,
                 tags       TEXT NOT NULL DEFAULT '',
                 collection TEXT NOT NULL DEFAULT '',
                 summary    TEXT NOT NULL DEFAULT '',
                 project    TEXT NOT NULL DEFAULT '',
                 on_hold    INTEGER NOT NULL DEFAULT 0,
                 model      TEXT NOT NULL DEFAULT '',
                 position   INTEGER,
                 created TEXT NOT NULL,
                 updated TEXT NOT NULL,
                 mtime   INTEGER NOT NULL,
                 bubbles INTEGER NOT NULL DEFAULT 0
             );
             CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                 id UNINDEXED,
                 title,
                 body,
                 tokenize='unicode61 remove_diacritics 2'
             );
             CREATE TABLE IF NOT EXISTS links (
                 src_id       TEXT NOT NULL,
                 target_title TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_title);
             CREATE INDEX IF NOT EXISTS idx_links_src ON links(src_id);",
        )?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;

        Ok(Index { conn })
    }

    /// Bring the index in line with the files on disk. Unchanged files (matching
    /// mtime) are skipped, so reopening a large vault stays fast.
    pub fn sync(&mut self, vault: &Vault) -> rusqlite::Result<()> {
        let on_disk = vault.scan();

        let mut known: HashMap<String, i64> = HashMap::new();
        {
            let mut stmt = self.conn.prepare("SELECT path, mtime FROM notes")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
            for row in rows {
                let (path, mtime) = row?;
                known.insert(path, mtime);
            }
        }

        let tx = self.conn.transaction()?;
        let mut seen: Vec<String> = Vec::with_capacity(on_disk.len());

        for (note_type, path) in &on_disk {
            let key = path.to_string_lossy().to_string();
            seen.push(key.clone());

            let mtime = file_mtime(path);
            if known.get(&key) == Some(&mtime) {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(path) else {
                continue;
            };
            let note = Note::parse(&content, &title_from_path(path));
            upsert_in(&tx, *note_type, path, &note, mtime)?;
        }

        for path in known.keys() {
            if !seen.contains(path) {
                remove_in(&tx, path)?;
            }
        }

        tx.commit()
    }

    pub fn upsert(
        &self,
        note_type: NoteType,
        path: &Path,
        note: &Note,
        mtime: i64,
    ) -> rusqlite::Result<()> {
        upsert_in(&self.conn, note_type, path, note, mtime)
    }

    pub fn remove_path(&self, path: &Path) -> rusqlite::Result<()> {
        remove_in(&self.conn, &path.to_string_lossy())
    }

    pub fn list(&self, note_type: Option<NoteType>) -> rusqlite::Result<Vec<NoteMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, type, tags, collection, summary, updated, project, on_hold, model, position, bubbles FROM notes
             WHERE (?1 IS NULL OR type = ?1)
             ORDER BY updated DESC",
        )?;
        let filter = note_type.map(type_name);
        let rows = stmt.query_map(params![filter], |r| {
            Ok(NoteMeta {
                id: r.get(0)?,
                title: r.get(1)?,
                note_type: parse_type(&r.get::<_, String>(2)?),
                tags: split_tags(&r.get::<_, String>(3)?),
                collection: non_empty(r.get::<_, String>(4)?),
                summary: non_empty(r.get::<_, String>(5)?),
                updated: r.get(6)?,
                project: non_empty(r.get::<_, String>(7)?),
                on_hold: r.get::<_, i64>(8)? != 0,
                model: non_empty(r.get::<_, String>(9)?),
                position: r.get(10)?,
                icon: None,
                bubbles: r.get(11)?,
            })
        })?;
        rows.collect()
    }

    /// Every note filed under a collection, as (id, path).
    pub fn collection_paths(&self, name: &str) -> rusqlite::Result<Vec<(String, PathBuf)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path FROM notes WHERE collection = ?1")?;
        let rows = stmt.query_map(params![name], |r| {
            Ok((r.get::<_, String>(0)?, PathBuf::from(r.get::<_, String>(1)?)))
        })?;
        rows.collect()
    }

    pub fn path_of(&self, id: &str) -> rusqlite::Result<Option<PathBuf>> {
        self.conn
            .query_row("SELECT path FROM notes WHERE id = ?1", params![id], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map(|opt| opt.map(PathBuf::from))
    }

    pub fn title_of(&self, id: &str) -> rusqlite::Result<Option<String>> {
        self.conn
            .query_row("SELECT title FROM notes WHERE id = ?1", params![id], |r| {
                r.get(0)
            })
            .optional()
    }

    /// Resolve a `[[wiki link]]` target to a note id, matching on title first
    /// and falling back to the file stem.
    pub fn resolve_title(&self, title: &str) -> rusqlite::Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT id FROM notes WHERE lower(title) = lower(?1) LIMIT 1",
                params![title],
                |r| r.get(0),
            )
            .optional()
    }

    pub fn search(&self, query: &str, limit: u32) -> rusqlite::Result<Vec<SearchHit>> {
        let Some(match_expr) = fts_query(query) else {
            return Ok(Vec::new());
        };

        let mut stmt = self.conn.prepare(
            "SELECT n.id, n.title, n.type,
                    snippet(notes_fts, 2, '', '', '…', 12),
                    substr(f.body, 1, 160)
             FROM notes_fts f
             JOIN notes n ON n.id = f.id
             WHERE notes_fts MATCH ?1
             ORDER BY bm25(notes_fts, 0.0, 10.0, 1.0)
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![match_expr, limit], |r| {
            let snippet: String = r.get(3)?;
            let prefix: String = r.get(4)?;
            let snippet = if snippet.trim().is_empty() {
                prefix
            } else {
                snippet
            };
            Ok(SearchHit {
                id: r.get(0)?,
                title: r.get(1)?,
                note_type: parse_type(&r.get::<_, String>(2)?),
                snippet: snippet.split_whitespace().collect::<Vec<_>>().join(" "),
                bubble: None,
                model: None,
                tags: Vec::new(),
            })
        })?;
        rows.collect()
    }

    /// Notes whose body contains a `[[link]]` pointing at `title`.
    pub fn backlinks(&self, title: &str) -> rusqlite::Result<Vec<NoteMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT n.id, n.title, n.type, n.tags, n.collection, n.summary, n.updated, n.project, n.on_hold, n.model, n.position, n.bubbles
             FROM links l
             JOIN notes n ON n.id = l.src_id
             WHERE lower(l.target_title) = lower(?1)
             ORDER BY n.updated DESC",
        )?;
        let rows = stmt.query_map(params![title], |r| {
            Ok(NoteMeta {
                id: r.get(0)?,
                title: r.get(1)?,
                note_type: parse_type(&r.get::<_, String>(2)?),
                tags: split_tags(&r.get::<_, String>(3)?),
                collection: non_empty(r.get::<_, String>(4)?),
                summary: non_empty(r.get::<_, String>(5)?),
                updated: r.get(6)?,
                project: non_empty(r.get::<_, String>(7)?),
                on_hold: r.get::<_, i64>(8)? != 0,
                model: non_empty(r.get::<_, String>(9)?),
                position: r.get(10)?,
                icon: None,
                bubbles: r.get(11)?,
            })
        })?;
        rows.collect()
    }
}

fn upsert_in(
    conn: &Connection,
    note_type: NoteType,
    path: &Path,
    note: &Note,
    mtime: i64,
) -> rusqlite::Result<()> {
    let key = path.to_string_lossy().to_string();
    let fm = &note.frontmatter;

    // A file may have been rewritten with a different id, so clear by both.
    conn.execute("DELETE FROM notes WHERE path = ?1 OR id = ?2", params![key, fm.id])?;
    conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![fm.id])?;
    conn.execute("DELETE FROM links WHERE src_id = ?1", params![fm.id])?;

    conn.execute(
        "INSERT INTO notes (id, path, type, title, tags, collection, summary, project, on_hold, model, position, created, updated, mtime, bubbles)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            fm.id,
            key,
            type_name(note_type),
            fm.title,
            fm.tags.join(","),
            collection_of(path, note).unwrap_or_default(),
            fm.summary.clone().unwrap_or_default(),
            fm.project.clone().unwrap_or_default(),
            if fm.on_hold { 1 } else { 0 },
            fm.model.clone().unwrap_or_default(),
            fm.position,
            fm.created,
            fm.updated,
            mtime,
            count_bubbles(&note.body)
        ],
    )?;
    conn.execute(
        "INSERT INTO notes_fts (id, title, body) VALUES (?1, ?2, ?3)",
        params![fm.id, fm.title, note.body],
    )?;

    for target in extract_links(&note.body) {
        conn.execute(
            "INSERT INTO links (src_id, target_title) VALUES (?1, ?2)",
            params![fm.id, target],
        )?;
    }
    Ok(())
}

fn remove_in(conn: &Connection, path: &str) -> rusqlite::Result<()> {
    let id: Option<String> = conn
        .query_row("SELECT id FROM notes WHERE path = ?1", params![path], |r| {
            r.get(0)
        })
        .optional()?;
    if let Some(id) = id {
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM notes_fts WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM links WHERE src_id = ?1", params![id])?;
    }
    Ok(())
}

pub fn file_mtime(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Which collection a note belongs to: the `source` it was split from, falling
/// back to the name of the subfolder it sits in. Notes directly under
/// `prompts/` or `ideas/` belong to no collection.
fn collection_of(path: &Path, note: &Note) -> Option<String> {
    if let Some(source) = &note.frontmatter.source {
        return Some(source.clone());
    }
    let folder = path.parent()?.file_name()?.to_str()?;
    (folder != NoteType::Prompt.dir_name() && folder != NoteType::Idea.dir_name())
        .then(|| folder.to_string())
}

fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn type_name(note_type: NoteType) -> &'static str {
    match note_type {
        NoteType::Prompt => "prompt",
        NoteType::Idea => "idea",
    }
}

fn parse_type(s: &str) -> NoteType {
    match s {
        "prompt" => NoteType::Prompt,
        _ => NoteType::Idea,
    }
}

fn split_tags(s: &str) -> Vec<String> {
    s.split(',')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect()
}

/// Turn free-form user input into a safe FTS5 MATCH expression.
///
/// Punctuation is stripped rather than escaped (FTS5 would treat it as query
/// syntax), and the final token gets a `*` so results update usefully while the
/// user is still typing.
fn fts_query(input: &str) -> Option<String> {
    let tokens: Vec<String> = input
        .split_whitespace()
        .map(|t| {
            t.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect::<String>()
        })
        .filter(|t| !t.is_empty())
        .collect();

    if tokens.is_empty() {
        return None;
    }

    let last = tokens.len() - 1;
    Some(
        tokens
            .iter()
            .enumerate()
            .map(|(i, t)| {
                if i == last {
                    format!("\"{t}\"*")
                } else {
                    format!("\"{t}\"")
                }
            })
            .collect::<Vec<_>>()
            .join(" "),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(title: &str, body: &str) -> Note {
        Note::new(title, body.to_string())
    }

    #[test]
    fn builds_safe_match_expressions() {
        assert_eq!(fts_query("refactor rev").unwrap(), "\"refactor\" \"rev\"*");
        // Quotes and parens would otherwise be FTS5 syntax errors.
        assert_eq!(fts_query("a\"b (c)").unwrap(), "\"ab\" \"c\"*");
        assert!(fts_query("   ").is_none());
        assert!(fts_query("!!!").is_none());
    }

    #[test]
    fn indexes_and_finds_notes() {
        let index = Index::open_in_memory().unwrap();
        let a = note("Refactor reviewer", "Look for duplication and naming issues.");
        let b = note("Grocery list", "Milk and bread.");
        index
            .upsert(NoteType::Prompt, Path::new("/v/prompts/a.md"), &a, 1)
            .unwrap();
        index
            .upsert(NoteType::Idea, Path::new("/v/ideas/b.md"), &b, 1)
            .unwrap();

        let hits = index.search("duplication", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Refactor reviewer");

        // Prefix matching on the trailing token.
        assert_eq!(index.search("groc", 10).unwrap().len(), 1);
        assert!(index.search("nonexistent", 10).unwrap().is_empty());
    }

    #[test]
    fn ranks_title_matches_above_body_matches() {
        let index = Index::open_in_memory().unwrap();
        let body_match = note("Something else", "a note about widgets");
        let title_match = note("Widgets", "unrelated text");
        index
            .upsert(NoteType::Idea, Path::new("/v/ideas/a.md"), &body_match, 1)
            .unwrap();
        index
            .upsert(NoteType::Idea, Path::new("/v/ideas/b.md"), &title_match, 1)
            .unwrap();

        let hits = index.search("widgets", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "Widgets");
    }

    #[test]
    fn tracks_backlinks() {
        let index = Index::open_in_memory().unwrap();
        let target = note("Beta", "the target note");
        let source = note("Alpha", "see [[Beta]] for details");
        index
            .upsert(NoteType::Idea, Path::new("/v/ideas/beta.md"), &target, 1)
            .unwrap();
        index
            .upsert(NoteType::Idea, Path::new("/v/ideas/alpha.md"), &source, 1)
            .unwrap();

        let back = index.backlinks("Beta").unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].title, "Alpha");
        // Case-insensitive resolution.
        assert_eq!(index.backlinks("beta").unwrap().len(), 1);

        // Removing the link clears the backlink.
        let edited = Note {
            frontmatter: source.frontmatter.clone(),
            body: "no links anymore".to_string(),
        };
        index
            .upsert(NoteType::Idea, Path::new("/v/ideas/alpha.md"), &edited, 2)
            .unwrap();
        assert!(index.backlinks("Beta").unwrap().is_empty());
    }

    #[test]
    fn replaces_rather_than_duplicates_on_reindex() {
        let index = Index::open_in_memory().unwrap();
        let mut n = note("First", "original body");
        let path = Path::new("/v/ideas/n.md");
        index.upsert(NoteType::Idea, path, &n, 1).unwrap();

        n.frontmatter.title = "Second".to_string();
        n.body = "updated body".to_string();
        index.upsert(NoteType::Idea, path, &n, 2).unwrap();

        let all = index.list(None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Second");
        assert!(index.search("original", 10).unwrap().is_empty());
        assert_eq!(index.search("updated", 10).unwrap().len(), 1);
    }

    #[test]
    fn filters_list_by_type() {
        let index = Index::open_in_memory().unwrap();
        index
            .upsert(
                NoteType::Prompt,
                Path::new("/v/prompts/a.md"),
                &note("P", "x"),
                1,
            )
            .unwrap();
        index
            .upsert(NoteType::Idea, Path::new("/v/ideas/b.md"), &note("I", "y"), 1)
            .unwrap();

        assert_eq!(index.list(Some(NoteType::Prompt)).unwrap().len(), 1);
        assert_eq!(index.list(Some(NoteType::Idea)).unwrap().len(), 1);
        assert_eq!(index.list(None).unwrap().len(), 2);
    }

    #[test]
    fn groups_notes_into_collections() {
        let index = Index::open_in_memory().unwrap();

        // A note split out of a collection carries `source`.
        let mut child = note("Design", "body");
        child.frontmatter.source = Some("Shipper prompts".into());
        index
            .upsert(
                NoteType::Prompt,
                Path::new("/v/prompts/shipper-prompts/design.md"),
                &child,
                1,
            )
            .unwrap();

        // A note simply dropped in a subfolder falls back to the folder name.
        index
            .upsert(
                NoteType::Prompt,
                Path::new("/v/prompts/misc/loose.md"),
                &note("Loose", "body"),
                1,
            )
            .unwrap();

        // A top-level note belongs to no collection.
        index
            .upsert(
                NoteType::Prompt,
                Path::new("/v/prompts/solo.md"),
                &note("Solo", "body"),
                1,
            )
            .unwrap();

        let by_title = |title: &str| {
            index
                .list(None)
                .unwrap()
                .into_iter()
                .find(|n| n.title == title)
                .unwrap()
        };

        assert_eq!(
            by_title("Design").collection.as_deref(),
            Some("Shipper prompts")
        );
        assert_eq!(by_title("Loose").collection.as_deref(), Some("misc"));
        assert_eq!(by_title("Solo").collection, None);
    }

    #[test]
    fn removes_notes_by_path() {
        let index = Index::open_in_memory().unwrap();
        let path = Path::new("/v/ideas/gone.md");
        index.upsert(NoteType::Idea, path, &note("Gone", "body"), 1).unwrap();
        index.remove_path(path).unwrap();

        assert!(index.list(None).unwrap().is_empty());
        assert!(index.search("body", 10).unwrap().is_empty());
    }
}
