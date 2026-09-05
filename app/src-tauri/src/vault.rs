//! Vault layout: a user-chosen directory holding `prompts/` and `ideas/`
//! subtrees of markdown files, plus a `.sudonotes/` folder for the index.

use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::note::NoteType;

// The naming rules are part of the on-disk contract, so they live in the shared
// core; re-exported here because the rest of the app reaches for them via
// `crate::vault`.
pub use sudonotes_core::naming::{is_markdown, title_from_path};

pub const INDEX_DIR: &str = ".sudonotes";
pub const INDEX_FILE: &str = "index.db";
/// Vault-scoped scratch dump. Not a note — never scanned under prompts/ or ideas/.
pub const BLACKHOLE_FILE: &str = "blackhole.md";

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

    /// The single scratch file for this vault. Missing means the dump is empty.
    pub fn blackhole_path(&self) -> PathBuf {
        self.root.join(INDEX_DIR).join(BLACKHOLE_FILE)
    }

    /// Read the dump. A missing file is an empty string, not an error.
    pub fn read_blackhole(&self) -> std::io::Result<String> {
        match std::fs::read_to_string(self.blackhole_path()) {
            Ok(body) => Ok(body),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(e) => Err(e),
        }
    }

    /// Write the dump, creating `.sudonotes/` if needed. Plain markdown, no frontmatter.
    pub fn write_blackhole(&self, body: &str) -> std::io::Result<()> {
        let path = self.blackhole_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, body)
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
        let stem = sudonotes_core::naming::unique_stem(title, |candidate| {
            dir.join(format!("{candidate}.md")).exists()
        });
        dir.join(format!("{stem}.md"))
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(
            vault.type_of(Path::new("/vault/.sudonotes/blackhole.md")),
            None
        );
        assert_eq!(vault.type_of(Path::new("/elsewhere/a.md")), None);
    }

    #[test]
    fn scan_ignores_the_blackhole_dump() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path().to_path_buf()).unwrap();
        std::fs::write(vault.root.join("ideas/one.md"), "an idea").unwrap();
        vault.write_blackhole("scratch that is not a note").unwrap();

        let scanned = vault.scan();
        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].0, NoteType::Idea);
        assert_eq!(scanned[0].1.file_name().unwrap(), "one.md");
        assert_eq!(vault.read_blackhole().unwrap(), "scratch that is not a note");
    }
}
