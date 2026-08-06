//! Linking an idea to a software project.
//!
//! A linked idea is mirrored into the project's root as a plain `.md` file and
//! added to `.gitignore`, so a coding agent working in that repo can read it
//! without the note ever being committed. The vault copy stays canonical — the
//! mirror is rewritten on every save.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;

/// Cap on favicon size, so a stray large file cannot bloat the payload.
const MAX_ICON_BYTES: u64 = 512 * 1024;

/// Where project icons usually live, best first.
const ICON_CANDIDATES: &[&str] = &[
    "public/favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "public/logo.svg",
    "public/logo.png",
    "static/favicon.svg",
    "static/favicon.ico",
    "static/favicon.png",
    "app/favicon.ico",
    "src/favicon.svg",
    "src/assets/favicon.svg",
    "assets/favicon.svg",
    "assets/favicon.png",
    "favicon.svg",
    "favicon.ico",
    "favicon.png",
    "logo.svg",
    "logo.png",
    "icon.svg",
    "icon.png",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    /// Folder name, used as the display label.
    pub name: String,
    pub exists: bool,
    pub is_git_repo: bool,
    /// Favicon as a `data:` URI, ready to drop into an `<img src>`.
    pub icon: Option<String>,
}

pub fn describe(path: &Path) -> ProjectInfo {
    ProjectInfo {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project")
            .to_string(),
        exists: path.is_dir(),
        is_git_repo: path.join(".git").exists(),
        icon: find_icon(path),
    }
}

/// First recognisable icon in the project, as a data URI.
fn find_icon(root: &Path) -> Option<String> {
    for candidate in ICON_CANDIDATES {
        let path = root.join(candidate);
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_ICON_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let mime = match path.extension().and_then(|e| e.to_str()) {
            Some("svg") => "image/svg+xml",
            Some("png") => "image/png",
            Some("ico") => "image/x-icon",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            _ => continue,
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Some(format!("data:{mime};base64,{encoded}"));
    }
    None
}

/// The file an idea is mirrored to inside its project.
pub fn mirror_path(root: &Path, slug: &str) -> PathBuf {
    root.join(format!("{slug}.md"))
}

/// Write the idea into the project root and make sure git ignores it.
pub fn write_mirror(root: &Path, slug: &str, contents: &str) -> std::io::Result<PathBuf> {
    if !root.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "project folder does not exist",
        ));
    }
    let path = mirror_path(root, slug);
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, &path)?;
    ensure_ignored(root, &format!("{slug}.md"));
    Ok(path)
}

pub fn remove_mirror(root: &Path, slug: &str) {
    let _ = std::fs::remove_file(mirror_path(root, slug));
}

/// Append `entry` to the project's `.gitignore` unless it is already listed.
/// Only touches repositories — a folder with no `.git` and no `.gitignore` is
/// left alone.
fn ensure_ignored(root: &Path, entry: &str) {
    let gitignore = root.join(".gitignore");
    if !root.join(".git").exists() && !gitignore.exists() {
        return;
    }

    let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
    if existing
        .lines()
        .any(|line| line.trim() == entry || line.trim() == format!("/{entry}"))
    {
        return;
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    if !next.contains("# sudonotes") {
        next.push_str("\n# sudonotes ideas\n");
    }
    next.push_str(entry);
    next.push('\n');
    let _ = std::fs::write(&gitignore, next);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sudonotes-test-{name}-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_mirror_and_ignores_it_in_a_repo() {
        let dir = temp_dir("mirror");
        std::fs::create_dir_all(dir.join(".git")).unwrap();

        write_mirror(&dir, "my-idea", "# hello\n").unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.join("my-idea.md")).unwrap(),
            "# hello\n"
        );
        let ignored = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert!(ignored.contains("my-idea.md"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_not_duplicate_an_existing_ignore_entry() {
        let dir = temp_dir("dupe");
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join(".gitignore"), "node_modules\n/my-idea.md\n").unwrap();

        write_mirror(&dir, "my-idea", "x").unwrap();

        let ignored = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(ignored.matches("my-idea.md").count(), 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn leaves_a_plain_folder_without_a_gitignore() {
        let dir = temp_dir("plain");
        write_mirror(&dir, "idea", "x").unwrap();

        assert!(dir.join("idea.md").is_file());
        assert!(!dir.join(".gitignore").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_a_missing_folder() {
        let missing = std::env::temp_dir().join("sudonotes-does-not-exist-xyz");
        let info = describe(&missing);
        assert!(!info.exists);
        assert!(info.icon.is_none());
    }

    #[test]
    fn finds_and_encodes_an_icon() {
        let dir = temp_dir("icon");
        std::fs::create_dir_all(dir.join("public")).unwrap();
        std::fs::write(dir.join("public/favicon.svg"), "<svg/>").unwrap();

        let info = describe(&dir);
        assert_eq!(info.name, dir.file_name().unwrap().to_str().unwrap());
        assert!(info.icon.unwrap().starts_with("data:image/svg+xml;base64,"));

        std::fs::remove_dir_all(&dir).ok();
    }
}
