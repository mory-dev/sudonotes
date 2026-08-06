//! Vault layout: a user-chosen directory holding `prompts/` and `ideas/`
//! subtrees of markdown files, plus a `.sudonotes/` folder for the index.

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::note::{filename_for, NoteType};

pub const INDEX_DIR: &str = ".sudonotes";
pub const INDEX_FILE: &str = "index.db";

pub struct Vault {
    pub root: PathBuf,
}

impl Vault {
    /// Open a vault, creating the standard directories if they are missing.
    pub fn open(root: PathBuf) -> std::io::Result<Self> {
        for dir in [
            root.join(NoteType::Prompt.dir_name()),
            root.join(NoteType::Idea.dir_name()),
            root.join(INDEX_DIR),
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(Vault { root })
    }

    pub fn index_path(&self) -> PathBuf {
        self.root.join(INDEX_DIR).join(INDEX_FILE)
    }

    pub fn dir_for(&self, note_type: NoteType) -> PathBuf {
        self.root.join(note_type.dir_name())
    }

    /// Every markdown file under `prompts/` and `ideas/`, with its type.
    pub fn scan(&self) -> Vec<(NoteType, PathBuf)> {
        let mut out = Vec::new();
        for note_type in [NoteType::Prompt, NoteType::Idea] {
            for entry in WalkDir::new(self.dir_for(note_type))
                .into_iter()
                .filter_map(Result::ok)
            {
                let path = entry.path();
                if entry.file_type().is_file() && is_markdown(path) {
                    out.push((note_type, path.to_path_buf()));
                }
            }
        }
        out
    }

    /// Which subtree a path belongs to, or `None` if it is outside the vault
    /// (or inside `.sudonotes/`).
    pub fn type_of(&self, path: &Path) -> Option<NoteType> {
        let relative = path.strip_prefix(&self.root).ok()?;
        let first = relative.components().next()?;
        NoteType::from_dir_name(first.as_os_str().to_str()?)
    }

    /// A free path for a new note, derived from its title.
    pub fn unique_path(&self, note_type: NoteType, title: &str) -> PathBuf {
        let dir = self.dir_for(note_type);
        let stem = filename_for(title);
        let mut candidate = dir.join(format!("{stem}.md"));
        let mut n = 2;
        while candidate.exists() {
            candidate = dir.join(format!("{stem}-{n}.md"));
            n += 1;
        }
        candidate
    }
}

/// Count the markdown files already in a folder, without creating anything.
/// Used to tell the user whether they picked an existing vault.
pub fn count_notes(root: &Path) -> usize {
    [NoteType::Prompt, NoteType::Idea]
        .iter()
        .map(|note_type| {
            WalkDir::new(root.join(note_type.dir_name()))
                .into_iter()
                .filter_map(Result::ok)
                .filter(|e| e.file_type().is_file() && is_markdown(e.path()))
                .count()
        })
        .sum()
}

/// Markdown files directly inside `dir` and below it.
pub fn markdown_files_in(dir: &Path) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_markdown(e.path()))
        .map(|e| e.path().to_path_buf())
        .collect()
}

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

/// The file stem, used as a fallback title for files that arrived without
/// frontmatter.
pub fn title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_markdown_files() {
        assert!(is_markdown(Path::new("a/b.md")));
        assert!(is_markdown(Path::new("a/b.MD")));
        // Atomic-write temp files must not be picked up by a scan.
        assert!(!is_markdown(Path::new("a/b.md.tmp")));
        assert!(!is_markdown(Path::new("a/b.txt")));
    }

    #[test]
    fn derives_a_fallback_title() {
        assert_eq!(title_from_path(Path::new("x/my-note.md")), "my-note");
    }

    #[test]
    fn maps_paths_to_note_types() {
        let vault = Vault {
            root: PathBuf::from("/vault"),
        };
        assert_eq!(
            vault.type_of(Path::new("/vault/prompts/a.md")),
            Some(NoteType::Prompt)
        );
        assert_eq!(
            vault.type_of(Path::new("/vault/ideas/nested/b.md")),
            Some(NoteType::Idea)
        );
        assert_eq!(vault.type_of(Path::new("/vault/.sudonotes/index.db")), None);
        assert_eq!(vault.type_of(Path::new("/elsewhere/a.md")), None);
    }
}
