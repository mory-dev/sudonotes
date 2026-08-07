//! Splits a pasted blob of text into individual prompts.
//!
//! This is the deterministic strategy: it reads structure the text already has
//! (Markdown headings, underlined headings, or short standalone title lines) and
//! never calls out to a model. It handles well-organised pastes instantly, for
//! free, and offline. An LLM strategy can be added alongside it later for input
//! too messy for these rules — the command surface returns the same drafts
//! either way.
//!
//! Because heading detection is a guess, nothing is written to disk from here:
//! the drafts are shown to the user for confirmation first.

use serde::{Deserialize, Serialize};

/// Longest a line can be and still be treated as a title.
const MAX_TITLE_LEN: usize = 60;
const MAX_TITLE_WORDS: usize = 8;
const SUMMARY_LEN: usize = 110;

/// Topic tags worth recognising in prompt text.
const VOCABULARY: &[&str] = &[
    "design",
    "seo",
    "marketing",
    "data",
    "ai",
    "code",
    "review",
    "testing",
    "product",
    "growth",
    "security",
    "performance",
    "docs",
    "pricing",
    "onboarding",
    "maintenance",
    "value",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftPrompt {
    pub title: String,
    pub body: String,
    pub summary: String,
    pub tags: Vec<String>,
}

/// Detect the individual prompts in `text`. Returns an empty vec when the text
/// has no structure worth splitting (fewer than two sections).
pub fn split(text: &str) -> Vec<DraftPrompt> {
    let lines: Vec<&str> = text.lines().collect();
    let headings = detect_headings(&lines);

    if headings.len() < 2 {
        return Vec::new();
    }

    let mut drafts = Vec::new();
    for (n, (start, title, consumed)) in headings.iter().enumerate() {
        let body_start = start + consumed;
        let body_end = headings.get(n + 1).map(|(next, _, _)| *next).unwrap_or(lines.len());
        if body_start >= body_end {
            continue;
        }

        let body = lines[body_start..body_end].join("\n").trim().to_string();
        if body.is_empty() {
            continue;
        }

        drafts.push(DraftPrompt {
            summary: summarize(&body),
            tags: tags_for(title, &body),
            title: title.clone(),
            body,
        });
    }

    if drafts.len() < 2 {
        return Vec::new();
    }
    drafts
}

/// Find the headings, as (line index, title, lines the heading occupies).
///
/// Markdown headings win outright when the text has them — mixing them with the
/// looser "short standalone line" rule is where false positives come from. The
/// loose rule only runs on text with no explicit headings at all.
fn detect_headings(lines: &[&str]) -> Vec<(usize, String, usize)> {
    let explicit = collect(lines, explicit_heading_at);
    if explicit.len() >= 2 {
        return explicit;
    }
    collect(lines, bare_heading_at)
}

fn collect(
    lines: &[&str],
    detect: impl Fn(&[&str], usize) -> Option<(String, usize)>,
) -> Vec<(usize, String, usize)> {
    let mut found: Vec<(usize, String, usize)> = Vec::new();
    for i in 0..lines.len() {
        // Skip lines already consumed, such as a setext underline.
        if found.last().is_some_and(|(start, _, used)| i < start + used) {
            continue;
        }
        if let Some((title, consumed)) = detect(lines, i) {
            found.push((i, title, consumed));
        }
    }
    found
}

/// `## Title`, or a title underlined with `===` / `---`.
fn explicit_heading_at(lines: &[&str], i: usize) -> Option<(String, usize)> {
    let line = lines[i].trim();
    if line.is_empty() {
        return None;
    }

    if let Some(rest) = line.strip_prefix('#') {
        let title = rest.trim_start_matches('#').trim();
        return (!title.is_empty()).then(|| (title.to_string(), 1));
    }

    let underline = lines.get(i + 1)?.trim();
    if underline.len() >= 3
        && (underline.chars().all(|c| c == '=') || underline.chars().all(|c| c == '-'))
    {
        return Some((line.to_string(), 2));
    }

    None
}

/// A short standalone line surrounded by blank lines, with a real paragraph
/// under it:
///
/// ```text
/// Design
///
/// Site looks like plain HTML - no visual identity ...
/// ```
fn bare_heading_at(lines: &[&str], i: usize) -> Option<(String, usize)> {
    let line = lines[i].trim();
    if line.is_empty() || !looks_like_title(line) {
        return None;
    }

    let preceded_by_blank = i == 0 || lines[i - 1].trim().is_empty();
    let followed_by_blank = lines.get(i + 1).is_none_or(|l| l.trim().is_empty());
    if !preceded_by_blank || !followed_by_blank {
        return None;
    }

    // Require substance underneath, so a short line of body text does not get
    // promoted to a heading just because blank lines surround it.
    followed_by_paragraph(lines, i + 1).then(|| (line.to_string(), 1))
}

/// Does the next non-empty run read as a paragraph rather than another title?
fn followed_by_paragraph(lines: &[&str], from: usize) -> bool {
    let mut non_empty = 0;
    for line in &lines[from..] {
        let text = line.trim();
        if text.is_empty() {
            if non_empty > 0 {
                break;
            }
            continue;
        }
        non_empty += 1;
        if text.len() > MAX_TITLE_LEN {
            return true;
        }
    }
    non_empty >= 2
}

fn looks_like_title(line: &str) -> bool {
    if line.len() > MAX_TITLE_LEN || line.split_whitespace().count() > MAX_TITLE_WORDS {
        return false;
    }
    // Bullets and quotes are content, not titles.
    if line.starts_with(['-', '*', '+', '>', '|']) {
        return false;
    }
    // Sentence-ending punctuation means prose.
    if line.ends_with(['.', ',', ':', ';']) {
        return false;
    }
    line.chars().any(char::is_alphanumeric)
}

/// First sentence of the body, trimmed to a readable length at a word boundary.
fn summarize(body: &str) -> String {
    let first = body
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with(['-', '*', '+', '#', '>']))
        .unwrap_or("");

    let sentence = match first.find(". ") {
        Some(end) => &first[..end + 1],
        None => first,
    };

    if sentence.chars().count() <= SUMMARY_LEN {
        return sentence.trim().to_string();
    }

    let truncated: String = sentence.chars().take(SUMMARY_LEN).collect();
    let cut = truncated.rfind(' ').unwrap_or(truncated.len());
    format!("{}…", truncated[..cut].trim_end_matches([',', '.', ' ']))
}

/// A tag from the title when it is short enough to be a topic, plus any known
/// vocabulary appearing in the text.
fn tags_for(title: &str, body: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();

    let title_words = title.split_whitespace().count();
    if title_words <= 2 {
        let slug = crate::note::slugify(title);
        if slug != "untitled" {
            tags.push(slug);
        }
    }

    let haystack = format!("{} {}", title.to_lowercase(), body.to_lowercase());
    for word in VOCABULARY {
        if tags.iter().any(|t| t == word) {
            continue;
        }
        // Match on word boundaries so "ai" does not fire inside "maintain".
        if haystack
            .split(|c: char| !c.is_alphanumeric())
            .any(|token| token == *word)
        {
            tags.push((*word).to_string());
        }
    }

    tags.truncate(4);
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape of a real paste: bare title lines separated by blank lines.
    const SHIPPER: &str = r#"Design

Site looks like plain HTML — no visual identity, nothing that signals a real product.
Rank the 8 changes that most move it from "template" to "designed," by impact-to-effort.
What would you not do before v1? What existing UI should be cut?

SEO

Assess what's actually indexable today, then rank the 8 highest-leverage fixes.
Separate "ships before v1" from "post-launch."

Marketing

Need reach with near-zero ongoing manual effort.
Rank 8 channels by reach-per-hour-of-upkeep.
"#;

    #[test]
    fn splits_bare_title_lines() {
        let drafts = split(SHIPPER);
        let titles: Vec<&str> = drafts.iter().map(|d| d.title.as_str()).collect();
        assert_eq!(titles, vec!["Design", "SEO", "Marketing"]);
    }

    #[test]
    fn does_not_split_on_prose_lines() {
        // "What would you not do before v1?" is followed by a blank line but is
        // preceded by text, so it must not become a section.
        let drafts = split(SHIPPER);
        assert!(!drafts.iter().any(|d| d.title.starts_with("What would")));
        assert!(drafts[0].body.contains("What would you not do before v1?"));
    }

    #[test]
    fn keeps_each_body_with_its_heading() {
        let drafts = split(SHIPPER);
        assert!(drafts[0].body.starts_with("Site looks like plain HTML"));
        assert!(drafts[1].body.starts_with("Assess what's actually indexable"));
        assert!(drafts[2].body.ends_with("reach-per-hour-of-upkeep."));
    }

    #[test]
    fn derives_summary_and_tags() {
        let drafts = split(SHIPPER);
        assert_eq!(drafts[1].title, "SEO");
        assert!(drafts[1].tags.contains(&"seo".to_string()));
        assert!(!drafts[1].summary.is_empty());
        assert!(drafts[1].summary.chars().count() <= SUMMARY_LEN + 1);
    }

    #[test]
    fn splits_markdown_headings() {
        let text = "## Alpha\n\nfirst body\n\n## Beta\n\nsecond body\n";
        let drafts = split(text);
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].title, "Alpha");
        assert_eq!(drafts[0].body, "first body");
        assert_eq!(drafts[1].title, "Beta");
    }

    #[test]
    fn splits_underlined_headings() {
        let text = "Alpha\n=====\n\nfirst body\n\nBeta\n====\n\nsecond body\n";
        let drafts = split(text);
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].title, "Alpha");
        assert_eq!(drafts[0].body, "first body");
    }

    #[test]
    fn returns_nothing_for_a_single_prompt() {
        assert!(split("Just one prompt with no structure at all.").is_empty());
        assert!(split("# Only heading\n\nwith a body\n").is_empty());
        assert!(split("").is_empty());
    }

    #[test]
    fn ignores_sections_with_no_body() {
        let text = "## Alpha\n\n## Beta\n\n## Gamma\n";
        assert!(split(text).is_empty());
    }

    #[test]
    fn does_not_treat_bullets_as_titles() {
        let text = "- item one\n\n- item two\n\n- item three\n";
        assert!(split(text).is_empty());
    }
}
