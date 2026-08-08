//! Linking an idea to a software project.
//!
//! A linked idea is mirrored into the project's root as a plain `.md` file and
//! added to `.gitignore`, so a coding agent working in that repo can read it
//! without the note ever being committed. The vault copy stays canonical — the
//! mirror is rewritten on every save.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use base64::Engine;
use serde::Serialize;
use walkdir::WalkDir;

/// Cap on favicon size, so a stray large file cannot bloat the payload.
const MAX_ICON_BYTES: u64 = 512 * 1024;

/// Where project icons usually live, best first. A shallow scan of the project
/// root (below) catches any other layout.
const ICON_CANDIDATES: &[&str] = &[
    "public/favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "public/apple-touch-icon.png",
    "public/logo.svg",
    "public/logo.png",
    "static/favicon.svg",
    "static/favicon.ico",
    "static/favicon.png",
    "app/public/favicon.svg",
    "app/public/favicon.ico",
    "app/public/favicon.png",
    "app/favicon.ico",
    "app/favicon.svg",
    "app/favicon.png",
    "web/public/favicon.svg",
    "frontend/public/favicon.svg",
    "client/public/favicon.svg",
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

/// Folders never worth scanning for an icon — they are large and unlikely to
/// hold one, and pruning them keeps the fallback scan cheap.
const SKIP_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    ".idea",
    ".vscode",
    ".next",
    ".nuxt",
    ".cargo",
    ".cache",
    ".venv",
    "venv",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "__pycache__",
    "coverage",
];

/// How often a linked project's icon is re-checked on disk, so an icon dropped
/// in later shows up on its own without re-scanning on every call.
const ICON_CACHE_TTL: Duration = Duration::from_secs(30);

static ICON_CACHE: OnceLock<Mutex<HashMap<PathBuf, (Option<String>, SystemTime)>>> =
    OnceLock::new();

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
        icon: cached_icon(path),
    }
}

/// The project's icon, cached briefly so repeated list/project lookups stay
/// cheap; once the TTL passes the folder is re-scanned, so an icon added later
/// is picked up without any manual step.
fn cached_icon(root: &Path) -> Option<String> {
    let cache = ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let Ok(mut guard) = cache.lock() else {
        return find_icon(root);
    };
    let now = SystemTime::now();
    if let Some((icon, checked)) = guard.get(root) {
        if now.duration_since(*checked).is_ok_and(|age| age < ICON_CACHE_TTL) {
            return icon.clone();
        }
    }
    let icon = find_icon(root);
    guard.insert(root.to_path_buf(), (icon.clone(), now));
    icon
}

/// First recognisable icon in the project, as a data URI. Known locations are
/// checked first; if none match, a shallow scan (a few levels, skipping heavy
/// folders) ranks icon-shaped files so a real favicon wins over incidental UI
/// assets such as `icon-addlink.svg`.
fn find_icon(root: &Path) -> Option<String> {
    for candidate in ICON_CANDIDATES {
        if let Some(uri) = encode_icon(&root.join(candidate)) {
            return Some(uri);
        }
    }

    let walker = WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() > 0 && entry.file_type().is_dir() {
                let name = entry.file_name().to_string_lossy();
                !SKIP_DIRS.iter().any(|skip| name.eq_ignore_ascii_case(skip))
            } else {
                true
            }
        });
    let mut candidates = Vec::new();
    for entry in walker.filter_map(Result::ok) {
        if entry.file_type().is_file() {
            let name = entry.file_name().to_string_lossy();
            if let Some(priority) = icon_name_priority(&name) {
                let path = entry.into_path();
                let tie_breaker = path.to_string_lossy().to_ascii_lowercase();
                candidates.push((priority, tie_breaker, path));
            }
        }
    }
    candidates.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
    });

    candidates
        .into_iter()
        .find_map(|(_, _, path)| encode_icon(&path))
}

/// Does a file name look like a project icon? (favicon.*, logo*, icon*,
/// apple-touch-icon*, …)
/// Lower values are more likely to represent the project itself, preventing
/// framework/admin UI icons from beating an actual favicon merely because the
/// filesystem returned them first.
fn icon_name_priority(name: &str) -> Option<u8> {
    let lower = name.to_ascii_lowercase();
    let Some((stem, ext)) = lower.rsplit_once('.') else {
        return None;
    };
    if !matches!(ext, "svg" | "png" | "ico" | "jpg" | "jpeg") {
        return None;
    }

    match stem {
        "favicon" => Some(0),
        stem if stem.starts_with("favicon") => Some(1),
        "apple-touch-icon" | "apple-touch-icon-precomposed" => Some(2),
        "logo" => Some(3),
        stem if stem.starts_with("logo") => Some(4),
        "icon" => Some(5),
        stem if stem.starts_with("icon") => Some(6),
        _ => None,
    }
}

/// Read an icon file and base64-encode it as a `data:` URI, or `None` when the
/// path is missing, too large, or not a supported image type.
fn encode_icon(path: &Path) -> Option<String> {
    let Ok(meta) = std::fs::metadata(path) else {
        return None;
    };
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_ICON_BYTES {
        return None;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return None;
    };
    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => return None,
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{encoded}"))
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

    #[test]
    fn finds_icons_under_app_public() {
        let dir = temp_dir("app-public");
        std::fs::create_dir_all(dir.join("app/public")).unwrap();
        std::fs::write(dir.join("app/public/favicon.svg"), "<svg/>").unwrap();

        let info = describe(&dir);
        assert!(info.icon.unwrap().starts_with("data:image/svg+xml;base64,"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scans_shallowly_for_icons() {
        let dir = temp_dir("shallow");
        std::fs::create_dir_all(dir.join("web/src/ui")).unwrap();
        std::fs::write(dir.join("web/src/ui/favicon.png"), b"png").unwrap();

        assert!(find_icon(&dir).is_some());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prefers_a_favicon_over_an_incidental_ui_icon() {
        let dir = temp_dir("favicon-priority");
        let admin_icon = dir.join("staticfiles/admin/img/icon-addlink.svg");
        let favicon = dir.join("staticfiles/images/favicons/favicon.ico");
        std::fs::create_dir_all(admin_icon.parent().unwrap()).unwrap();
        std::fs::write(&admin_icon, "<svg>plus</svg>").unwrap();
        std::fs::create_dir_all(favicon.parent().unwrap()).unwrap();
        std::fs::write(&favicon, b"eye").unwrap();

        assert_eq!(find_icon(&dir), encode_icon(&favicon));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ignores_heavy_folders() {
        let dir = temp_dir("heavy");
        std::fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        std::fs::write(dir.join("node_modules/pkg/logo.svg"), "<svg/>").unwrap();

        assert!(find_icon(&dir).is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn picks_up_an_icon_added_later() {
        let dir = temp_dir("later");
        assert!(find_icon(&dir).is_none());

        std::fs::create_dir_all(dir.join("public")).unwrap();
        std::fs::write(dir.join("public/favicon.svg"), "<svg/>").unwrap();
        assert!(find_icon(&dir).is_some());

        std::fs::remove_dir_all(&dir).ok();
    }
}
