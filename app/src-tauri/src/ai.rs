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
    /// The proxy is available by default; the provider key lives on the server.
    pub configured: bool,
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

/// A vault's AI preference. A missing or unreadable file means defaults, never
/// an error — the settings file is optional and the vault must still open.
pub fn settings(root: &Path) -> AiSettings {
    let enabled = fs::read_to_string(settings_path(root))
        .ok()
        .and_then(|raw| serde_json::from_str::<AiSettings>(&raw).ok())
        .map(|value| value.enabled)
        .unwrap_or(true);
    AiSettings {
        enabled,
        configured: true,
    }
}

pub fn save_settings(root: &Path, enabled: bool) -> Result<AiSettings, String> {
    let next = AiSettings {
        enabled,
        configured: true,
    };
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

fn normalize_tags(value: &Value) -> Vec<String> {
    let Some(items) = value.as_array() else {
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
