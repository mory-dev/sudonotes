//! Which files belong to a vault, and what a new one is called.
//!
//! These rules are as much a part of the on-disk contract as the frontmatter.
//! If two clients disagree about what counts as a note, or about which name a
//! title claims, they produce duplicates instead of edits.

use std::path::Path;

use crate::note::filename_for;

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

/// The first free file stem for a title: `refactor-reviewer`, then
/// `refactor-reviewer-2`, and so on.
///
/// The caller decides what "taken" means — a directory listing on the desktop,
/// a handle lookup in the browser — but the sequence must be identical on both,
/// so it lives here rather than in either client.
pub fn unique_stem(title: &str, taken: impl Fn(&str) -> bool) -> String {
    let stem = filename_for(title);
    if !taken(&stem) {
        return stem;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{stem}-{n}");
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
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
    fn leaves_a_free_name_alone() {
        assert_eq!(unique_stem("Refactor Reviewer", |_| false), "refactor-reviewer");
    }

    #[test]
    fn counts_up_past_taken_names() {
        let used = ["refactor-reviewer", "refactor-reviewer-2"];
        assert_eq!(
            unique_stem("Refactor Reviewer", |s| used.contains(&s)),
            "refactor-reviewer-3"
        );
    }

    #[test]
    fn keeps_the_project_idea_name() {
        assert_eq!(unique_stem("IDEAS", |_| false), "IDEAS");
    }
}
