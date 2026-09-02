//! Cloud analysis, refinement suggestions, and automatic tags, routed through
//! the sudonotes API proxy (which holds the provider key) rather than the
//! user's machine.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::models;
use crate::vault::INDEX_DIR;

/// Per-vault, so two vaults can disagree about whether AI is on. Never holds a
/// credential — the provider key lives on the server.
const SETTINGS_FILE: &str = "settings.json";
/// The device id, which is not a secret and is not vault-specific.
const DEVICE_FILE: &str = "device.txt";
const DEFAULT_ANALYZER_MODEL: &str = "deepseek-chat";
const API_BASE: &str = "https://api.sudonotes.com/v1";

const TAG_VOCABULARY: &[&str] = &[
    "feedback",
    "feature",
    "bug",
    "question",
    "research",
    "design",
    "product",
    "data",
    "testing",
    "performance",
    "security",
    "marketing",
    "seo",
    "docs",
    "onboarding",
    "workflow",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub show_bubble_metadata: bool,
    /// The proxy is available by default; the provider key lives on the server.
    pub configured: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub fit: String,
    pub fit_reason: String,
    pub issues: Vec<String>,
    pub refinements: Vec<String>,
    pub refined_text: Option<String>,
    pub suggested_tags: Vec<String>,
    pub alternatives: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct NoteInput {
    pub title: String,
    pub note_type: String,
    pub body: String,
    pub model: Option<String>,
}

fn settings_path(root: &Path) -> PathBuf {
    root.join(INDEX_DIR).join(SETTINGS_FILE)
}

fn api_base() -> String {
    std::env::var("SUDONOTES_API_BASE")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| API_BASE.to_string())
}

/// A vault's preferences. A missing or unreadable file means defaults, never an
/// error — the settings file is optional and the vault must still open.
pub fn settings(root: &Path) -> AiSettings {
    let saved = fs::read_to_string(settings_path(root))
        .ok()
        .and_then(|raw| serde_json::from_str::<AiSettings>(&raw).ok())
        .unwrap_or(AiSettings {
            enabled: true,
            show_bubble_metadata: true,
            configured: true,
        });
    AiSettings {
        enabled: saved.enabled,
        show_bubble_metadata: saved.show_bubble_metadata,
        configured: true,
    }
}

pub fn save_settings(root: &Path, enabled: bool) -> Result<AiSettings, String> {
    let mut next = settings(root);
    next.enabled = enabled;
    write_settings(root, next)
}

pub fn save_bubble_metadata_visibility(
    root: &Path,
    visible: bool,
) -> Result<AiSettings, String> {
    let mut next = settings(root);
    next.show_bubble_metadata = visible;
    write_settings(root, next)
}

fn write_settings(root: &Path, next: AiSettings) -> Result<AiSettings, String> {
    let path = settings_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(next)
}

/// This install's device id, minted on first use and cached on disk.
///
/// It is an identity, not a credential: it exists so the server can rate-limit
/// per install rather than per IP. Failing to get one is not an error — the
/// request simply goes out without it and is limited by IP instead.
async fn device_token(app: &AppHandle) -> Option<String> {
    let path = app.path().app_config_dir().ok()?.join(DEVICE_FILE);
    if let Some(existing) = fs::read_to_string(&path).ok().filter(|t| !t.trim().is_empty()) {
        return Some(existing.trim().to_string());
    }

    let minted = reqwest::Client::new()
        .post(format!("{}/device", api_base()))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?
        .get("device")
        .and_then(Value::as_str)
        .map(str::to_string)?;

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, &minted);
    Some(minted)
}

fn json_content(value: Value) -> Result<Value, String> {
    let content = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .ok_or_else(|| "DeepSeek returned no analysis".to_string())?;
    let cleaned = content
        .trim()
        .strip_prefix("```json")
        .and_then(|value| value.strip_suffix("```"))
        .unwrap_or(content.trim())
        .trim();
    serde_json::from_str(cleaned).map_err(|e| format!("invalid DeepSeek JSON: {e}"))
}

async fn complete(app: &AppHandle, system: &str, prompt: &str) -> Result<Value, String> {
    let mut request = reqwest::Client::new().post(format!("{}/chat/completions", api_base()));
    if let Some(device) = device_token(app).await {
        request = request.header("X-Sudonotes-Device", device);
    }
    let response = request
        .json(&json!({
            "model": DEFAULT_ANALYZER_MODEL,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ]
        }))
        .timeout(std::time::Duration::from_secs(45))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    json_content(response)
}

/// Whether the AI proxy is up: the status-bar dot turns green only when this
/// answers. Reachable-but-unhealthy is what keeps the dot orange instead.
pub async fn health() -> bool {
    let client = reqwest::Client::new();
    let url = format!("{}/health", api_base());
    match client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .ok()
            .and_then(|value| value.get("status").and_then(Value::as_str).map(str::to_string))
            .is_some_and(|status| status == "ok"),
        _ => false,
    }
}

fn normalize_tags(value: &Value) -> Vec<String> {    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    let mut tags = Vec::new();
    for item in items.iter().filter_map(Value::as_str) {
        let tag = item.trim().to_lowercase();
        if TAG_VOCABULARY.contains(&tag.as_str()) && !tags.contains(&tag) {
            tags.push(tag);
        }
        if tags.len() == 5 {
            break;
        }
    }
    tags
}

pub async fn analyze(app: &AppHandle, note: &NoteInput) -> Result<AnalysisResult, String> {
    let catalog = models::list(app, false).await.ok();
    let model_context = note
        .model
        .as_deref()
        .map(|model| {
            catalog
                .as_ref()
                .and_then(|catalog| catalog.models.iter().find(|item| item.id == model))
                .map(|item| serde_json::to_string(item).unwrap_or_default())
                .unwrap_or_else(|| format!("selected model: {model}"))
        })
        .unwrap_or_else(|| "no target model selected".to_string());
    let system = r#"You review prompts and ideas for a local prompt notebook. Return only valid JSON with exactly these keys: fit (one of excellent, good, uncertain, poor, not_applicable), fit_reason (string), issues (array of short strings), refinements (array of short strings), refined_text (string or null), suggested_tags (array), alternatives (array of model IDs). Use only these tags when suggesting tags: feedback, feature, bug, question, research, design, product, data, testing, performance, security, marketing, seo, docs, onboarding, workflow. Do not invent model capabilities; say uncertain when metadata is missing. Preserve the author's intent and do not add encouragement."#;
    let prompt = format!(
        "Note type: {}\nTitle: {}\nTarget model metadata: {}\nBody:\n{}",
        note.note_type, note.title, model_context, note.body
    );
    let value = complete(app, system, &prompt).await?;
    Ok(AnalysisResult {
        fit: value
            .get("fit")
            .and_then(Value::as_str)
            .unwrap_or("uncertain")
            .to_string(),
        fit_reason: value
            .get("fit_reason")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        issues: value
            .get("issues")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        refinements: value
            .get("refinements")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        refined_text: value.get("refined_text").and_then(Value::as_str).map(str::to_string),
        suggested_tags: normalize_tags(value.get("suggested_tags").unwrap_or(&Value::Null)),
        alternatives: value
            .get("alternatives")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
    })
}

pub async fn tags(app: &AppHandle, note: &NoteInput) -> Result<Vec<String>, String> {
    let system = r#"Classify the note using only the allowed tags. Return only JSON in the form {"tags":["..."]}. Choose up to five tags based on what the note does, not merely its title. Allowed tags: feedback, feature, bug, question, research, design, product, data, testing, performance, security, marketing, seo, docs, onboarding, workflow."#;
    let prompt = format!("Type: {}\nTitle: {}\nBody:\n{}", note.note_type, note.title, note.body);
    let value = complete(app, system, &prompt).await?;
    Ok(normalize_tags(value.get("tags").unwrap_or(&Value::Null)))
}

/// Ask the model for a brief title for some content (a pasted prompt). Returns
/// an empty string when the model is not configured or produces nothing useful.
pub async fn suggest_title(app: &AppHandle, content: &str) -> Result<String, String> {
    let system = r#"You write the frontmatter `title` for a prompt or idea note. Return ONLY a short JSON object {"title": "..."}. Keep it to at most 8 words, no quotes, no trailing punctuation, no newlines. Prefer the concrete subject (e.g. "Plan for DeepSeek V4") over a long restatement of the text."#;
    let prompt = format!("Content:\n{}", content.trim());
    let value = complete(app, system, &prompt).await?;
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .trim_matches(['"', '\'', '.'])
        .trim()
        .to_string();
    Ok(title)
}

/// A drafted GitHub issue, ready for the user to edit before it is filed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDraft {
    pub title: String,
    pub body: String,
}

/// Draft an issue from one idea bubble.
///
/// The model writes a readable title and a short piece of framing; the bubble's
/// own words then follow, intact. Only the first half is left to the prompt —
/// `assemble_draft` checks the result and restores the original if it drifted.
pub async fn draft_issue(
    app: &AppHandle,
    bubble: &str,
    note_title: &str,
    model: Option<&str>,
    tags: &[String],
) -> Result<IssueDraft, String> {
    let system = r#"You turn one note from an idea notebook into a GitHub issue. Return ONLY JSON {"title": "...", "body": "..."}.

The title: at most 10 words, imperative, no trailing punctuation. Fix the author's typos and expand their shorthand — it is a heading other people will read.

The body: open with one short paragraph (1-3 sentences) explaining what is being asked for and why, in clear prose. Then a line containing exactly `## Notes`, then the author's note reproduced VERBATIM — every line, unedited, original spelling and wording preserved.

Never invent requirements, acceptance criteria, reproduction steps, environments or scope the author did not write. If the note is a single clear sentence, the opening paragraph may simply restate it. Do not add headings other than `## Notes`."#;
    let tag_context = if tags.is_empty() {
        String::new()
    } else {
        format!("\nTopic tags: {}", tags.join(", "))
    };
    let prompt = format!("Note title: {note_title}{tag_context}\nBubble:\n{bubble}");
    let value = complete(app, system, &prompt).await?;

    Ok(assemble_draft(
        value.get("title").and_then(Value::as_str).unwrap_or(""),
        value.get("body").and_then(Value::as_str).unwrap_or(""),
        bubble,
        note_title,
        model,
    ))
}

/// The draft used when AI is switched off or the model call fails: the bubble,
/// unchanged, with its first line as the title.
pub fn local_draft(bubble: &str, note_title: &str, model: Option<&str>) -> IssueDraft {
    assemble_draft("", "", bubble, note_title, model)
}

/// Build the final draft from whatever the model returned.
///
/// Two things are enforced here rather than asked for: the bubble text is
/// present in the body, and the provenance footer is written by us. A prompt can
/// drift; this cannot.
fn assemble_draft(
    title: &str,
    body: &str,
    bubble: &str,
    note_title: &str,
    model: Option<&str>,
) -> IssueDraft {
    let bubble = bubble.trim();
    let title = title.trim().trim_matches(['"', '\'']).trim();
    let title = if title.is_empty() {
        first_line_title(bubble)
    } else {
        title.to_string()
    };

    let body = body.trim();
    let mut out = if body.is_empty() {
        bubble.to_string()
    } else if contains_verbatim(body, bubble) {
        body.to_string()
    } else {
        // The model paraphrased instead of quoting. Keep its framing — that is
        // the part worth having — but put the author's actual words back under
        // the heading it was asked to use.
        format!("{body}\n\n## Notes\n\n{bubble}")
    };

    // Tags are deliberately absent here: they are applied as GitHub labels, so
    // repeating them as prose would be noise.
    out.push_str("\n\n---\n");
    out.push_str(&crate::github::format_issue_footer(note_title, model));
    out.push('\n');

    IssueDraft { title, body: out }
}

/// Whether every line of the bubble survived into the drafted body.
///
/// Compared line by line and whitespace-insensitively: a model that only
/// reflowed or re-indented has still kept the author's words, while one that
/// summarised has not.
fn contains_verbatim(body: &str, bubble: &str) -> bool {
    let haystack: Vec<&str> = body.lines().map(str::trim).collect();
    bubble
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .all(|line| haystack.contains(&line))
}

/// A title from the bubble's own first line, for the no-AI path.
fn first_line_title(bubble: &str) -> String {
    let first = bubble
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Idea")
        .trim_start_matches('#')
        .trim();
    if first.chars().count() <= 70 {
        return first.to_string();
    }
    let short: String = first.chars().take(67).collect();
    format!("{}…", short.trim_end())
}

pub fn local_tags(note: &NoteInput) -> Vec<String> {    let haystack = format!("{} {}", note.title, note.body).to_lowercase();
    let mut tags = Vec::new();
    let terms: &[(&str, &str)] = &[
        ("feedback", "feedback"),
        ("feature", "feature"),
        ("bug", "bug"),
        ("error", "bug"),
        ("question", "question"),
        ("research", "research"),
        ("design", "design"),
        ("data", "data"),
        ("test", "testing"),
        ("performance", "performance"),
        ("security", "security"),
        ("marketing", "marketing"),
        ("seo", "seo"),
        ("documentation", "docs"),
        ("onboarding", "onboarding"),
    ];
    for (needle, tag) in terms {
        if haystack.split(|c: char| !c.is_alphanumeric()).any(|word| word == *needle)
            && !tags.iter().any(|current| current == tag)
        {
            tags.push((*tag).to_string());
        }
        if tags.len() == 5 {
            break;
        }
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_default_to_showing_bubble_metadata() {
        let parsed: AiSettings =
            serde_json::from_str(r#"{"enabled":false,"configured":true}"#).unwrap();
        assert!(!parsed.enabled);
        assert!(parsed.show_bubble_metadata);
    }

    #[test]
    fn saving_one_preference_preserves_the_other() {
        let dir = tempfile::tempdir().unwrap();
        let hidden = save_bubble_metadata_visibility(dir.path(), false).unwrap();
        assert!(!hidden.show_bubble_metadata);

        let disabled = save_settings(dir.path(), false).unwrap();
        assert!(!disabled.enabled);
        assert!(!disabled.show_bubble_metadata);
    }

    #[test]
    fn a_faithful_draft_is_left_alone() {
        let bubble = "Mute closed bubbles.\nThey should dim, not vanish.";
        let draft = assemble_draft(
            "Mute closed bubbles",
            "Closed issues should stay visible.\n\nMute closed bubbles.\nThey should dim, not vanish.",
            bubble,
            "GitHub integration",
            None,
        );

        assert_eq!(draft.title, "Mute closed bubbles");
        assert!(!draft.body.contains("## Notes"));
        assert!(draft.body.contains("They should dim, not vanish."));
    }

    #[test]
    fn a_paraphrased_draft_gets_the_original_back() {
        // The guarantee: a model that summarises cannot silently replace the
        // author's words.
        let bubble = "Mute closed bubbles.\nThey should dim, not vanish.";
        let draft = assemble_draft(
            "Handle closed issues",
            "We should probably do something about issues once they are done.",
            bubble,
            "GitHub integration",
            None,
        );

        assert!(draft.body.contains("## Notes"));
        assert!(draft.body.contains("They should dim, not vanish."));
    }

    #[test]
    fn reindenting_still_counts_as_verbatim() {
        assert!(contains_verbatim("  Mute closed bubbles.  ", "Mute closed bubbles."));
        assert!(!contains_verbatim("Mute the bubbles.", "Mute closed bubbles."));
    }

    #[test]
    fn falls_back_to_the_bubble_when_there_is_no_model() {
        let draft = local_draft(
            "# Mute closed bubbles\n\nThey should dim.",
            "GitHub integration",
            Some("deepseek/deepseek-chat"),
        );

        assert_eq!(draft.title, "Mute closed bubbles");
        assert!(draft.body.starts_with("# Mute closed bubbles"));
        assert!(draft.body.contains("idea: GitHub integration"));
        assert!(draft.body.contains("model: @deepseek-ai(deepseek-chat)"));
        // Tags belong on the issue as labels, not restated in the body.
        assert!(!draft.body.contains("tags:"));
    }

    #[test]
    fn omits_model_in_draft_footer_when_missing() {
        let draft = local_draft(
            "# Mute closed bubbles\n\nThey should dim.",
            "GitHub integration",
            None,
        );

        assert_eq!(draft.title, "Mute closed bubbles");
        assert!(draft.body.contains("From [sudonotes](https://sudonotes.com) · idea: GitHub integration"));
        assert!(!draft.body.contains("· model:"));
    }

    #[test]
    fn shortens_an_overlong_fallback_title() {
        let long = "a ".repeat(60);
        let draft = local_draft(&long, "Ideas", None);
        assert!(draft.title.chars().count() <= 70);
        assert!(draft.title.ends_with('…'));
    }

    #[test]
    fn local_tags_classify_known_terms() {
        let note = NoteInput {
            title: "Checkout bug".to_string(),
            note_type: "idea".to_string(),
            body: "Add feedback about the feature and test its performance".to_string(),
            model: None,
        };
        let tags = local_tags(&note);
        assert!(tags.contains(&"bug".to_string()));
        assert!(tags.contains(&"feedback".to_string()));
        assert!(tags.contains(&"feature".to_string()));
        assert!(tags.contains(&"testing".to_string()));
    }
}
