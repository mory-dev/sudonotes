//! Cached, provider-neutral model metadata from models.dev.
//!
//! The provider-agnostic `/models.json` endpoint lists each official model
//! once (keyed `provider/model`), so a Claude or DeepSeek model shows up a
//! single time rather than once per hosting provider (Bedrock, Azure,
//! OpenRouter, …).

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const CATALOG_URL: &str = "https://models.dev/models.json";
const CACHE_NAME: &str = "models-cache-v2.json";
const CACHE_TTL_SECS: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub name: String,
    pub context: Option<u64>,
    pub output: Option<u64>,
    pub reasoning: bool,
    pub vision: bool,
    pub tools: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalog {
    pub models: Vec<ModelInfo>,
    pub fetched_at: u64,
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("could not locate app config: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create app config: {e}"))?;
    Ok(dir.join(CACHE_NAME))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_cache(path: &PathBuf) -> Option<ModelCatalog> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn number_field(value: &Value, parent: &str, key: &str) -> Option<u64> {
    value
        .get(parent)
        .and_then(|v| v.get(key))
        .and_then(Value::as_u64)
}

fn has_image_input(value: &Value) -> bool {
    value
        .get("modalities")
        .and_then(|v| v.get("input"))
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|v| v.as_str() == Some("image")))
}

fn parse_catalog(value: &Value) -> Vec<ModelInfo> {
    let Some(models) = value.as_object() else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for (id, model) in models {
        let Some((provider, model_id)) = id.split_once('/') else {
            continue;
        };
        let name = model
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string();
        result.push(ModelInfo {
            id: id.clone(),
            provider: provider.to_string(),
            model: model_id.to_string(),
            name,
            context: number_field(model, "limit", "context"),
            output: number_field(model, "limit", "output"),
            reasoning: bool_field(model, "reasoning"),
            vision: has_image_input(model),
            tools: bool_field(model, "tool_call"),
        });
    }

    result.sort_by(|a, b| {
        a.provider
            .cmp(&b.provider)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    result
}

pub async fn list(app: &AppHandle, force: bool) -> Result<ModelCatalog, String> {
    let path = cache_path(app)?;
    let cached = read_cache(&path);
    let fresh = cached.as_ref().is_some_and(|c| now().saturating_sub(c.fetched_at) < CACHE_TTL_SECS);
    if !force && fresh {
        return Ok(cached.unwrap());
    }

    let fetched = reqwest::Client::new()
        .get(CATALOG_URL)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    let models = parse_catalog(&fetched);
    if models.is_empty() {
        return cached.ok_or_else(|| "model catalog returned no models".to_string());
    }

    let catalog = ModelCatalog {
        models,
        fetched_at: now(),
    };
    let raw = serde_json::to_string(&catalog).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_flat_model_catalog() {
        let value = json!({
            "deepseek/deepseek-chat": {
                "name": "DeepSeek Chat",
                "reasoning": false,
                "tool_call": true,
                "limit": {"context": 64000, "output": 8192},
                "modalities": {"input": ["text"], "output": ["text"]}
            }
        });
        let models = parse_catalog(&value);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "deepseek/deepseek-chat");
        assert_eq!(models[0].provider, "deepseek");
        assert_eq!(models[0].model, "deepseek-chat");
        assert_eq!(models[0].context, Some(64000));
        assert!(models[0].tools);
        assert!(!models[0].vision);
    }
}
