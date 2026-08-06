//! Markdown note representation: frontmatter parsing, serialization, atomic writes.
//!
//! The frontmatter schema is fixed and tiny (five keys), so it is parsed by hand
//! rather than pulling in a full YAML crate. Anything we did not write ourselves
//! is tolerated: missing keys are filled with defaults so that a plain `.md` file
//! dropped into the vault by another editor still opens cleanly.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteType {
    Prompt,
    Idea,
}

impl NoteType {
    pub fn dir_name(self) -> &'static str {
        match self {
            NoteType::Prompt => "prompts",
            NoteType::Idea => "ideas",
        }
    }

    pub fn from_dir_name(name: &str) -> Option<Self> {
        match name {
            "prompts" => Some(NoteType::Prompt),
            "ideas" => Some(NoteType::Idea),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frontmatter {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    /// One-line description, shown under the title in lists and search results.
    pub summary: Option<String>,
    /// Which LLM this prompt is written for.
    pub model: Option<String>,
    /// The collection this prompt was split out of.
    pub source: Option<String>,
    /// Original order within that collection, so it can be reassembled.
    pub position: Option<u32>,
    /// Absolute path of a software project this idea is linked to. The note is
    /// mirrored into that project's root so it can be worked on in place.
    pub project: Option<String>,
    pub created: String,
    pub updated: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note {
    pub frontmatter: Frontmatter,
    /// Everything after the closing `---` line, kept verbatim so that
    /// parse → serialize is a byte-for-byte round trip.
    pub body: String,
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn new_id() -> String {
    ulid::Ulid::generate().to_string()
}

impl Note {
    /// Build a new note with freshly generated id and timestamps.
    pub fn new(title: &str, body: String) -> Self {
        let now = now_rfc3339();
        Note {
            frontmatter: Frontmatter {
                id: new_id(),
                title: title.to_string(),
                tags: Vec::new(),
                summary: None,
                model: None,
                source: None,
                position: None,
                project: None,
                created: now.clone(),
                updated: now,
            },
            body,
        }
    }

    /// Parse a markdown file. Missing or absent frontmatter is synthesized so
    /// that externally created files are always usable.
    pub fn parse(content: &str, fallback_title: &str) -> Self {
        let (fields, body) = split_frontmatter(content);

        let title = fields
            .iter()
            .find(|(k, _)| k == "title")
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| fallback_title.to_string());

        let id = fields
            .iter()
            .find(|(k, _)| k == "id")
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(new_id);

        let created = fields
            .iter()
            .find(|(k, _)| k == "created")
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(now_rfc3339);

        let updated = fields
            .iter()
            .find(|(k, _)| k == "updated")
            .map(|(_, v)| v.clone())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| created.clone());

        let tags = fields
            .iter()
            .find(|(k, _)| k == "tags")
            .map(|(_, v)| parse_tags(v))
            .unwrap_or_default();

        let optional = |key: &str| {
            fields
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.clone())
                .filter(|v| !v.is_empty())
        };

        Note {
            frontmatter: Frontmatter {
                id,
                title,
                tags,
                summary: optional("summary"),
                model: optional("model"),
                source: optional("source"),
                position: optional("position").and_then(|v| v.parse().ok()),
                project: optional("project"),
                created,
                updated,
            },
            body: body.to_string(),
        }
    }

    pub fn to_markdown(&self) -> String {
        let fm = &self.frontmatter;
        let tags = if fm.tags.is_empty() {
            "[]".to_string()
        } else {
            let items: Vec<String> = fm.tags.iter().map(|t| quote(t)).collect();
            format!("[{}]", items.join(", "))
        };
        // Optional keys are omitted entirely when unset, so ordinary notes keep
        // a five-line frontmatter block.
        let mut extras = String::new();
        if let Some(summary) = &fm.summary {
            extras.push_str(&format!("summary: {}\n", quote(summary)));
        }
        if let Some(model) = &fm.model {
            extras.push_str(&format!("model: {}\n", quote(model)));
        }
        if let Some(source) = &fm.source {
            extras.push_str(&format!("source: {}\n", quote(source)));
        }
        if let Some(position) = fm.position {
            extras.push_str(&format!("position: {position}\n"));
        }
        if let Some(project) = &fm.project {
            extras.push_str(&format!("project: {}\n", quote(project)));
        }

        format!(
            "---\nid: {}\ntitle: {}\ntags: {}\n{}created: {}\nupdated: {}\n---\n{}",
            fm.id,
            quote(&fm.title),
            tags,
            extras,
            fm.created,
            fm.updated,
            self.body
        )
    }

    /// Write the note to disk atomically: a sibling temp file followed by a
    /// rename, so a crash mid-write cannot truncate an existing note.
    pub fn write_to(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("md.tmp");
        fs::write(&tmp, self.to_markdown())?;
        fs::rename(&tmp, path)
    }
}

/// Split a document into frontmatter key/value pairs and the remaining body.
/// Returns an empty field list when the document has no frontmatter block.
fn split_frontmatter(content: &str) -> (Vec<(String, String)>, &str) {
    let stripped = content.strip_prefix("\u{feff}").unwrap_or(content);
    let rest = match stripped.strip_prefix("---\n") {
        Some(r) => r,
        None => match stripped.strip_prefix("---\r\n") {
            Some(r) => r,
            None => return (Vec::new(), stripped),
        },
    };

    // Locate the closing delimiter line.
    let mut offset = 0usize;
    let mut end: Option<(usize, usize)> = None; // (block_end, body_start)
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            end = Some((offset, offset + line.len()));
            break;
        }
        offset += line.len();
    }

    let (block_end, body_start) = match end {
        Some(v) => v,
        // Unterminated frontmatter: treat the whole document as body.
        None => return (Vec::new(), stripped),
    };

    let block = &rest[..block_end];
    (parse_fields(block), &rest[body_start..])
}

fn parse_fields(block: &str) -> Vec<(String, String)> {
    let lines: Vec<&str> = block.lines().collect();
    let mut fields = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        i += 1;

        // Skip blank lines and anything that is not a top-level `key: value`.
        if line.trim().is_empty() || line.starts_with(char::is_whitespace) {
            continue;
        }
        let Some(colon) = line.find(':') else { continue };
        let key = line[..colon].trim().to_string();
        let mut value = line[colon + 1..].trim().to_string();

        // A key with no inline value may be followed by a block sequence:
        //   tags:
        //     - alpha
        //     - beta
        if value.is_empty() {
            let mut items = Vec::new();
            while i < lines.len() {
                let item = lines[i].trim();
                if let Some(rest) = item.strip_prefix("- ") {
                    items.push(unquote(rest));
                    i += 1;
                } else if item == "-" {
                    i += 1;
                } else {
                    break;
                }
            }
            if !items.is_empty() {
                let quoted: Vec<String> = items.iter().map(|s| quote(s)).collect();
                value = format!("[{}]", quoted.join(", "));
            }
        }

        fields.push((key, if value.starts_with('[') { value } else { unquote(&value) }));
    }

    fields
}

fn parse_tags(value: &str) -> Vec<String> {
    let v = value.trim();
    let inner = match v.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        Some(inner) => inner,
        // A bare scalar is treated as a single tag.
        None if !v.is_empty() => return vec![unquote(v)],
        None => return Vec::new(),
    };
    split_flow_items(inner)
        .into_iter()
        .map(|s| unquote(&s))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Split `a, "b, c", d` on commas that sit outside quotes.
fn split_flow_items(s: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut quote_char: Option<char> = None;

    for c in s.chars() {
        match quote_char {
            Some(q) => {
                current.push(c);
                if c == q {
                    quote_char = None;
                }
            }
            None => match c {
                '"' | '\'' => {
                    quote_char = Some(c);
                    current.push(c);
                }
                ',' => {
                    items.push(std::mem::take(&mut current));
                }
                _ => current.push(c),
            },
        }
    }
    if !current.trim().is_empty() {
        items.push(current);
    }
    items
}

fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        let inner = &s[1..s.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        }
        out
    } else if s.len() >= 2 && s.starts_with('\'') && s.ends_with('\'') {
        s[1..s.len() - 1].replace("''", "'")
    } else {
        s.to_string()
    }
}

/// The file stem for a title. The project-standard idea note keeps its name as
/// `IDEAS` (so it becomes IDEAS.md), everything else is slugified.
pub fn filename_for(title: &str) -> String {
    if title.eq_ignore_ascii_case("ideas") {
        "IDEAS".to_string()
    } else {
        slugify(title)
    }
}

/// Turn a title into a filesystem-safe file stem.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut pending_dash = false;
    for c in title.chars() {
        if c.is_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.extend(c.to_lowercase());
        } else {
            pending_dash = true;
        }
        if out.chars().count() >= 60 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed
    }
}

/// Extract wiki-style `[[target]]` link targets, ignoring the `|alias` part.
pub fn extract_links(body: &str) -> Vec<String> {
    let bytes: Vec<char> = body.chars().collect();
    let mut links = Vec::new();
    let mut i = 0;

    while i + 1 < bytes.len() {
        if bytes[i] == '[' && bytes[i + 1] == '[' {
            let start = i + 2;
            let mut j = start;
            while j + 1 < bytes.len() && !(bytes[j] == ']' && bytes[j + 1] == ']') {
                // A newline before the closing brackets means this was not a link.
                if bytes[j] == '\n' {
                    break;
                }
                j += 1;
            }
            if j + 1 < bytes.len() && bytes[j] == ']' && bytes[j + 1] == ']' {
                let raw: String = bytes[start..j].iter().collect();
                let target = raw.split('|').next().unwrap_or("").trim().to_string();
                if !target.is_empty() && !links.contains(&target) {
                    links.push(target);
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }

    links
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_note_byte_for_byte() {
        let original = "---\nid: 01J8XABCDEF\ntitle: \"Refactor reviewer\"\ntags: [\"code\", \"review\"]\ncreated: 2026-08-06T12:00:00Z\nupdated: 2026-08-06T12:30:00Z\n---\n\n# Heading\n\nSome body text.\n";
        let note = Note::parse(original, "fallback");
        assert_eq!(note.to_markdown(), original);
    }

    #[test]
    fn parses_fields_and_body() {
        let src = "---\nid: abc\ntitle: \"Hello: world\"\ntags: [one, two]\ncreated: c\nupdated: u\n---\nbody here";
        let note = Note::parse(src, "fallback");
        assert_eq!(note.frontmatter.id, "abc");
        assert_eq!(note.frontmatter.title, "Hello: world");
        assert_eq!(note.frontmatter.tags, vec!["one", "two"]);
        assert_eq!(note.body, "body here");
    }

    #[test]
    fn preserves_titles_needing_escapes() {
        let mut note = Note::new("He said \"hi\" \\ bye", "body".into());
        note.frontmatter.tags = vec!["a,b".into()];
        let reparsed = Note::parse(&note.to_markdown(), "fallback");
        assert_eq!(reparsed.frontmatter.title, "He said \"hi\" \\ bye");
        assert_eq!(reparsed.frontmatter.tags, vec!["a,b"]);
    }

    #[test]
    fn synthesizes_frontmatter_for_a_plain_file() {
        let note = Note::parse("just some markdown\n", "My Note");
        assert_eq!(note.frontmatter.title, "My Note");
        assert!(note.frontmatter.tags.is_empty());
        assert!(!note.frontmatter.id.is_empty());
        assert_eq!(note.body, "just some markdown\n");
    }

    #[test]
    fn treats_unterminated_frontmatter_as_body() {
        let src = "---\nid: abc\ntitle: nope\n";
        let note = Note::parse(src, "Fallback");
        assert_eq!(note.frontmatter.title, "Fallback");
        assert_eq!(note.body, src);
    }

    #[test]
    fn reads_block_sequence_tags() {
        let src = "---\nid: abc\ntitle: T\ntags:\n  - alpha\n  - beta\ncreated: c\nupdated: u\n---\nx";
        let note = Note::parse(src, "fallback");
        assert_eq!(note.frontmatter.tags, vec!["alpha", "beta"]);
    }

    #[test]
    fn handles_crlf_frontmatter() {
        let src = "---\r\nid: abc\r\ntitle: \"T\"\r\ntags: []\r\ncreated: c\r\nupdated: u\r\n---\r\nbody";
        let note = Note::parse(src, "fallback");
        assert_eq!(note.frontmatter.id, "abc");
        assert_eq!(note.frontmatter.title, "T");
        assert_eq!(note.body, "body");
    }

    #[test]
    fn slugifies_titles() {
        assert_eq!(slugify("Refactor Reviewer"), "refactor-reviewer");
        assert_eq!(slugify("  Hello, World!  "), "hello-world");
        assert_eq!(slugify("***"), "untitled");
        assert_eq!(slugify("a  --  b"), "a-b");
    }

    #[test]
    fn extracts_wiki_links() {
        let body = "See [[Alpha]] and [[Beta|the beta note]], plus [[Alpha]] again.";
        assert_eq!(extract_links(body), vec!["Alpha", "Beta"]);
    }

    #[test]
    fn ignores_non_links() {
        assert!(extract_links("a [single] bracket and [[unclosed\nnext line").is_empty());
        assert!(extract_links("[[]]").is_empty());
    }
}
