//! Markdown note representation: frontmatter parsing and serialization.
//!
//! The frontmatter schema is fixed and small, so it is parsed by hand
//! rather than pulling in a full YAML crate. Anything we did not write ourselves
//! is tolerated: missing keys are filled with defaults so that a plain `.md` file
//! dropped into the vault by another editor still opens cleanly.
//!
//! Writing a note to disk is deliberately *not* here — that is the one part that
//! differs between a desktop app and a browser, and the one part that must not
//! be reimplemented twice is everything else.

use std::collections::BTreeMap;

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

/// The sidebar marker on an idea, cycled off → orange → green.
///
/// Orange is what the old boolean `onHold` meant, so a note written before this
/// existed reads back as orange rather than losing its mark.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkState {
    #[default]
    Off,
    Orange,
    Green,
}

impl MarkState {
    pub fn as_str(self) -> &'static str {
        match self {
            MarkState::Off => "off",
            MarkState::Orange => "orange",
            MarkState::Green => "green",
        }
    }

    /// Read a mark from frontmatter or from the frontend.
    ///
    /// Also accepts the booleans the `onHold` key used to hold, which is what
    /// keeps existing vaults from silently losing their marks.
    pub fn parse(value: &str) -> MarkState {
        match value.trim().to_ascii_lowercase().as_str() {
            "green" => MarkState::Green,
            "orange" | "true" | "yes" | "1" => MarkState::Orange,
            _ => MarkState::Off,
        }
    }

    pub fn is_off(self) -> bool {
        matches!(self, MarkState::Off)
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
    /// How this idea is marked in the sidebar.
    pub mark: MarkState,
    /// Per-bubble model assignment for idea notes: the first line of a bubble
    /// maps to the model that bubble's prompt targets.
    pub models: BTreeMap<String, String>,
    /// Per-bubble tags for idea notes: the first line of a bubble maps to the
    /// small set of tags attached to that bubble.
    pub bubble_tags: BTreeMap<String, Vec<String>>,
    /// Per-bubble GitHub issue: the first line of a bubble maps to the issue it
    /// became, as `owner/repo#123`. Only which issue is durable — whether it is
    /// open or closed is cached in the index and re-fetched, never written here.
    pub bubble_issues: BTreeMap<String, String>,
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
                mark: MarkState::Off,
                models: BTreeMap::new(),
                bubble_tags: BTreeMap::new(),
                bubble_issues: BTreeMap::new(),
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

        let models = fields
            .iter()
            .find(|(k, _)| k == "models")
            .and_then(|(_, v)| serde_json::from_str::<BTreeMap<String, String>>(v).ok())
            .unwrap_or_default();

        let bubble_tags = fields
            .iter()
            .find(|(k, _)| k == "bubbleTags")
            .and_then(|(_, v)| serde_json::from_str::<BTreeMap<String, Vec<String>>>(v).ok())
            .unwrap_or_default();

        let bubble_issues = fields
            .iter()
            .find(|(k, _)| k == "bubbleIssues")
            .and_then(|(_, v)| serde_json::from_str::<BTreeMap<String, String>>(v).ok())
            .unwrap_or_default();

        // `onHold` is the boolean this replaced; reading it keeps notes written
        // before the third state from losing their mark.
        let mark = optional("mark")
            .or_else(|| optional("onHold"))
            .or_else(|| optional("on_hold"))
            .map(|value| MarkState::parse(&value))
            .unwrap_or_default();

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
                mark,
                models,
                bubble_tags,
                bubble_issues,
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
        if !fm.mark.is_off() {
            extras.push_str(&format!("mark: {}\n", fm.mark.as_str()));
        }
        if !fm.models.is_empty() {
            if let Ok(json) = serde_json::to_string(&fm.models) {
                extras.push_str(&format!("models: {json}\n"));
            }
        }
        if !fm.bubble_tags.is_empty() {
            if let Ok(json) = serde_json::to_string(&fm.bubble_tags) {
                extras.push_str(&format!("bubbleTags: {json}\n"));
            }
        }
        if !fm.bubble_issues.is_empty() {
            if let Ok(json) = serde_json::to_string(&fm.bubble_issues) {
                extras.push_str(&format!("bubbleIssues: {json}\n"));
            }
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

/// Replace wiki-style `[[target]]` and `[[target|alias]]` links that match `old_title`
/// with `[[new_title]]` (or `[[new_title|alias]]`), case-insensitively.
/// Returns the updated body and a boolean indicating whether any link was changed.
pub fn replace_links(body: &str, old_title: &str, new_title: &str) -> (String, bool) {
    let old_trimmed = old_title.trim();
    let new_trimmed = new_title.trim();
    if old_trimmed.is_empty() || new_trimmed.is_empty() || old_trimmed.eq_ignore_ascii_case(new_trimmed) {
        return (body.to_string(), false);
    }

    let chars: Vec<char> = body.chars().collect();
    let mut out = String::with_capacity(body.len());
    let mut i = 0;
    let mut changed = false;

    while i < chars.len() {
        if i + 1 < chars.len() && chars[i] == '[' && chars[i + 1] == '[' {
            let start = i + 2;
            let mut j = start;
            while j + 1 < chars.len() && !(chars[j] == ']' && chars[j + 1] == ']') {
                if chars[j] == '\n' {
                    break;
                }
                j += 1;
            }
            if j + 1 < chars.len() && chars[j] == ']' && chars[j + 1] == ']' {
                let inner: String = chars[start..j].iter().collect();
                let mut parts = inner.splitn(2, '|');
                let target_part = parts.next().unwrap_or("");
                let alias_part = parts.next();

                if target_part.trim().eq_ignore_ascii_case(old_trimmed) {
                    changed = true;
                    out.push_str("[[");
                    out.push_str(new_trimmed);
                    if let Some(alias) = alias_part {
                        out.push('|');
                        out.push_str(alias);
                    }
                    out.push_str("]]");
                } else {
                    out.push_str("[[");
                    out.push_str(&inner);
                    out.push_str("]]");
                }
                i = j + 2;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }

    (out, changed)
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



pub const LLM_DIRECTIVE_HEADER: &str = "<!--\n  sudonotes: Project Idea Backlog (synced with sudonotes)\n  - This file contains the project roadmap, ideas, and feature backlog.\n  - Ideas are separated by blank lines or <!-- bubble --> tags.\n  - Changes made to this file automatically sync into sudonotes.\n-->";

/// Check if content (or note body) contains the sudonotes LLM directive comment block.
pub fn has_directive_header(content: &str) -> bool {
    let (_, body) = split_frontmatter(content);
    let target = if body.trim_start().starts_with("<!--") {
        body.trim_start()
    } else {
        content.trim_start()
    };
    target.starts_with("<!--") && target.contains("sudonotes: Project Idea Backlog")
}

/// Ensure markdown contains the standard LLM directive header.
/// When frontmatter is present, the directive block is placed at the top of the body.
/// When no frontmatter is present, it is placed at the top of the file.
pub fn ensure_directive_header(markdown: &str) -> String {
    if has_directive_header(markdown) {
        return markdown.to_string();
    }

    let (fields, body) = split_frontmatter(markdown);
    let trimmed_body = body.trim_start();
    let directive = LLM_DIRECTIVE_HEADER;

    if fields.is_empty() && !markdown.trim_start().starts_with("---") {
        let trimmed = markdown.trim_start();
        if trimmed.is_empty() {
            directive.to_string()
        } else {
            format!("{directive}\n\n{trimmed}")
        }
    } else {
        let stripped = markdown.strip_prefix("\u{feff}").unwrap_or(markdown);
        let Some(rest) = stripped.strip_prefix("---\n").or_else(|| stripped.strip_prefix("---\r\n")) else {
            return format!("{directive}\n\n{markdown}");
        };
        let mut offset = 0usize;
        let mut end: Option<usize> = None;
        for line in rest.split_inclusive('\n') {
            if line.trim_end_matches(['\r', '\n']) == "---" {
                end = Some(offset + line.len());
                break;
            }
            offset += line.len();
        }
        if let Some(body_start) = end {
            let header_part = &stripped[..(stripped.len() - rest.len() + body_start)];
            if trimmed_body.is_empty() {
                format!("{header_part}\n{directive}\n")
            } else {
                format!("{header_part}\n{directive}\n\n{trimmed_body}")
            }
        } else {
            format!("{directive}\n\n{markdown}")
        }
    }
}

/// Strip the directive header from content if present.
pub fn strip_directive_header(content: &str) -> &str {
    let trimmed = content.trim_start();
    if !has_directive_header(trimmed) {
        return content;
    }
    // Find the closing "-->" on its own line
    if let Some(pos) = trimmed.find("\n-->") {
        let after = &trimmed[pos + 4..];
        after.strip_prefix("\r\n").or_else(|| after.strip_prefix('\n')).unwrap_or(after)
    } else if let Some(pos) = trimmed.find("\r\n-->") {
        let after = &trimmed[pos + 5..];
        after.strip_prefix("\r\n").or_else(|| after.strip_prefix('\n')).unwrap_or(after)
    } else {
        content
    }
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
    fn round_trips_bubble_models() {
        let mut note = Note::new("Brainstorm", "First bubble.\n\nSecond bubble.\n".into());
        note.frontmatter
            .models
            .insert("First bubble.".into(), "deepseek/deepseek-chat".into());
        let reparsed = Note::parse(&note.to_markdown(), "fallback");
        assert_eq!(
            reparsed.frontmatter.models.get("First bubble.").map(String::as_str),
            Some("deepseek/deepseek-chat")
        );
        // Notes without bubble models never emit the key.
        let plain = Note::new("x", "y".into());
        assert!(!plain.to_markdown().contains("models:"));
    }

    #[test]
    fn round_trips_bubble_tags() {
        let mut note = Note::new("Brainstorm", "First bubble.\n\nSecond bubble.\n".into());
        note.frontmatter.bubble_tags.insert(
            "First bubble.".into(),
            vec!["design".into(), "workflow".into()],
        );
        let markdown = note.to_markdown();
        let reparsed = Note::parse(&markdown, "fallback");
        assert_eq!(
            reparsed.frontmatter.bubble_tags.get("First bubble."),
            Some(&vec!["design".into(), "workflow".into()])
        );
        assert!(markdown.contains("bubbleTags:"));

        let plain = Note::new("x", "y".into());
        assert!(!plain.to_markdown().contains("bubbleTags:"));
    }

    #[test]
    fn round_trips_bubble_issues() {
        let mut note = Note::new("Brainstorm", "First bubble.\n\nSecond bubble.\n".into());
        note.frontmatter
            .bubble_issues
            .insert("First bubble.".into(), "mory-dev/sudonotes#42".into());
        let markdown = note.to_markdown();
        let reparsed = Note::parse(&markdown, "fallback");
        assert_eq!(
            reparsed.frontmatter.bubble_issues.get("First bubble."),
            Some(&"mory-dev/sudonotes#42".to_string())
        );
        assert!(markdown.contains("bubbleIssues:"));

        // A note with no linked issues never emits the key.
        let plain = Note::new("x", "y".into());
        assert!(!plain.to_markdown().contains("bubbleIssues:"));
    }

    #[test]
    fn round_trips_each_mark_state() {
        for mark in [MarkState::Orange, MarkState::Green] {
            let mut note = Note::new("Marked idea", "A project to revisit later.".into());
            note.frontmatter.mark = mark;
            let markdown = note.to_markdown();
            assert!(markdown.contains(&format!("mark: {}", mark.as_str())));
            assert_eq!(Note::parse(&markdown, "fallback").frontmatter.mark, mark);
        }

        // An unmarked idea keeps its five-line frontmatter.
        let plain = Note::new("Active idea", "Keep moving.".into());
        assert!(!plain.to_markdown().contains("mark:"));
        assert!(plain.frontmatter.mark.is_off());
    }

    #[test]
    fn reads_the_boolean_on_hold_this_replaced() {
        // Vaults written before the third state existed must not lose a mark.
        let legacy = "---\nid: 01J\ntitle: \"Paused\"\ntags: []\nonHold: true\ncreated: x\nupdated: y\n---\nBody\n";
        assert_eq!(Note::parse(legacy, "fallback").frontmatter.mark, MarkState::Orange);

        let off = "---\nid: 01J\ntitle: \"Active\"\ntags: []\nonHold: false\ncreated: x\nupdated: y\n---\nBody\n";
        assert!(Note::parse(off, "fallback").frontmatter.mark.is_off());
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
    fn replaces_wiki_links_and_preserves_aliases() {
        let body = "See [[Alpha]] and [[alpha|custom alias]], plus [[Beta]] and [[Alpha]].";
        let (updated, changed) = replace_links(body, "Alpha", "Gamma");
        assert!(changed);
        assert_eq!(
            updated,
            "See [[Gamma]] and [[Gamma|custom alias]], plus [[Beta]] and [[Gamma]]."
        );
    }

    #[test]
    fn leaves_unrelated_links_alone_when_replacing() {
        let body = "See [[Beta]] and [[Beta|alias]].";
        let (updated, changed) = replace_links(body, "Alpha", "Gamma");
        assert!(!changed);
        assert_eq!(updated, body);
    }

    #[test]
    fn ignores_non_links_when_replacing() {
        let body = "a [single] bracket and [[unclosed\nnext line";
        let (updated, changed) = replace_links(body, "single", "double");
        assert!(!changed);
        assert_eq!(updated, body);
    }


    #[test]
    fn adds_directive_header_to_note_with_frontmatter() {
        let original = "---\nid: abc\ntitle: \"My Note\"\ntags: []\ncreated: c\nupdated: u\n---\n\nFirst bubble\n";
        let formatted = ensure_directive_header(original);
        assert!(has_directive_header(&formatted));
        assert!(formatted.starts_with("---\nid: abc\n"));
        assert!(formatted.contains(LLM_DIRECTIVE_HEADER));
        assert!(formatted.ends_with("First bubble\n"));

        // Idempotent: should not duplicate
        let formatted_again = ensure_directive_header(&formatted);
        assert_eq!(formatted, formatted_again);
    }

    #[test]
    fn adds_directive_header_to_plain_markdown() {
        let original = "# Ideas\n\n- Idea 1\n- Idea 2\n";
        let formatted = ensure_directive_header(original);
        assert!(has_directive_header(&formatted));
        assert!(formatted.starts_with(LLM_DIRECTIVE_HEADER));
        assert!(formatted.contains("# Ideas"));

        // Idempotent
        assert_eq!(ensure_directive_header(&formatted), formatted);
    }

    #[test]
    fn strips_directive_header() {
        let with_directive = format!("{}\n\nReal content here", LLM_DIRECTIVE_HEADER);
        let stripped = strip_directive_header(&with_directive);
        assert_eq!(stripped.trim(), "Real content here");
        assert!(!has_directive_header(stripped));
    }

}
