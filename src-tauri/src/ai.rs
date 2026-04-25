use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

use crate::crash_analyzer::{CrashReport, InstalledModRef};
use crate::paths;

const DEFAULT_GEMINI_MODEL: &str = "gemini-2.0-flash";
const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL: &str = "llama3.1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// "gemini" | "ollama" | "off"
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub gemini_api_key: String,
    #[serde(default = "default_gemini_model")]
    pub gemini_model: String,
    #[serde(default = "default_ollama_url")]
    pub ollama_url: String,
    #[serde(default = "default_ollama_model")]
    pub ollama_model: String,
    /// If true, only call AI when user clicks "Deep analyze"
    #[serde(default = "default_true")]
    pub manual_only: bool,
}

fn default_provider() -> String { "off".to_string() }
fn default_gemini_model() -> String { DEFAULT_GEMINI_MODEL.to_string() }
fn default_ollama_url() -> String { DEFAULT_OLLAMA_URL.to_string() }
fn default_ollama_model() -> String { DEFAULT_OLLAMA_MODEL.to_string() }
fn default_true() -> bool { true }

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: default_provider(),
            gemini_api_key: String::new(),
            gemini_model: default_gemini_model(),
            ollama_url: default_ollama_url(),
            ollama_model: default_ollama_model(),
            manual_only: true,
        }
    }
}

fn config_path() -> PathBuf {
    paths::config_dir().join("ai_config.json")
}

pub fn load_config() -> AiConfig {
    let p = config_path();
    if !p.exists() {
        return AiConfig::default();
    }
    match std::fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => AiConfig::default(),
    }
}

pub fn save_config(cfg: &AiConfig) -> Result<(), String> {
    let p = config_path();
    let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&p, s).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiAnalysis {
    pub provider: String,
    pub model: String,
    pub root_cause: String,
    pub fix_steps: Vec<String>,
    pub suspect_mods: Vec<AiSuspect>,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSuspect {
    pub name: String,
    pub confidence: u8,
    pub reason: String,
}

fn build_prompt(report: &CrashReport, installed: &[InstalledModRef], lang: &str) -> String {
    let mut installed_list = String::new();
    for (i, m) in installed.iter().take(120).enumerate() {
        let pkg = m.package_id.as_deref().unwrap_or("");
        installed_list.push_str(&format!("{}. {} [{}]\n", i + 1, m.name, pkg));
    }

    let mut excerpt = report.log_excerpt.clone();
    if excerpt.len() > 6000 {
        excerpt.truncate(6000);
    }

    let suspects_pre: String = report
        .suspects
        .iter()
        .take(10)
        .map(|s| format!("- {} ({}%) — {}", s.mod_name, s.confidence, s.reason))
        .collect::<Vec<_>>()
        .join("\n");

    let harmony = report.harmony_patches.iter().take(20).cloned().collect::<Vec<_>>().join("\n");

    let lang_line = match lang {
        "vi" => "IMPORTANT: Write all values inside the JSON (root_cause, fix_steps, suspect_mods.reason) in VIETNAMESE. Keep mod names, file paths, exception types, and code identifiers in their original English form.",
        _ => "Write all values inside the JSON in English.",
    };

    format!(
        r#"You are an expert RimWorld modding troubleshooter. Analyze this crash log and identify the most likely culprit mods and the fix.

{lang_line}

Return ONLY valid JSON (no markdown fences, no commentary), exactly this shape:
{{
  "root_cause": "1-3 sentence plain-English explanation",
  "fix_steps": ["step 1", "step 2", "..."],
  "suspect_mods": [
    {{ "name": "Mod Name", "confidence": 0-100, "reason": "why" }}
  ]
}}

INSTALLED MODS (subset):
{installed_list}

HEURISTIC PRE-SUSPECTS:
{suspects_pre}

HARMONY PATCHES SEEN:
{harmony}

LOG EXCERPT:
```
{excerpt}
```
"#,
        lang_line = lang_line,
        installed_list = installed_list,
        suspects_pre = suspects_pre,
        harmony = harmony,
        excerpt = excerpt
    )
}

fn parse_json_response(raw: &str) -> AiAnalysis {
    // Strip ```json ... ``` fences if present.
    let trimmed = raw.trim();
    let body = if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start + 3..];
        let after = after.strip_prefix("json").unwrap_or(after);
        let after = after.trim_start_matches('\n');
        if let Some(end) = after.rfind("```") {
            &after[..end]
        } else {
            after
        }
    } else {
        trimmed
    };

    #[derive(Deserialize)]
    struct Tmp {
        #[serde(default)]
        root_cause: String,
        #[serde(default)]
        fix_steps: Vec<String>,
        #[serde(default)]
        suspect_mods: Vec<AiSuspect>,
    }

    // Try to find {...} block if there's surrounding text.
    let json_slice = if let (Some(s), Some(e)) = (body.find('{'), body.rfind('}')) {
        &body[s..=e]
    } else {
        body
    };

    let parsed: Tmp = serde_json::from_str(json_slice).unwrap_or(Tmp {
        root_cause: String::new(),
        fix_steps: Vec::new(),
        suspect_mods: Vec::new(),
    });

    AiAnalysis {
        provider: String::new(),
        model: String::new(),
        root_cause: parsed.root_cause,
        fix_steps: parsed.fix_steps,
        suspect_mods: parsed.suspect_mods,
        raw: raw.to_string(),
    }
}

pub async fn analyze_with_ai(
    report: &CrashReport,
    installed: &[InstalledModRef],
    lang: &str,
) -> Result<AiAnalysis, String> {
    let cfg = load_config();
    if cfg.provider == "off" {
        return Err("AI provider disabled. Configure in Settings.".to_string());
    }
    let prompt = build_prompt(report, installed, lang);

    let raw = match cfg.provider.as_str() {
        "gemini" => call_gemini(&cfg, &prompt).await?,
        "ollama" => call_ollama(&cfg, &prompt).await?,
        other => return Err(format!("Unknown AI provider: {}", other)),
    };

    let mut analysis = parse_json_response(&raw);
    analysis.provider = cfg.provider.clone();
    analysis.model = match cfg.provider.as_str() {
        "gemini" => cfg.gemini_model.clone(),
        "ollama" => cfg.ollama_model.clone(),
        _ => String::new(),
    };
    Ok(analysis)
}

async fn call_gemini(cfg: &AiConfig, prompt: &str) -> Result<String, String> {
    if cfg.gemini_api_key.trim().is_empty() {
        return Err("Gemini API key empty. Set in Settings.".to_string());
    }
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        cfg.gemini_model, cfg.gemini_api_key
    );
    let body = serde_json::json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini HTTP {}: {}", status, text));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = v["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if text.is_empty() {
        return Err(format!("Gemini returned empty response: {}", v));
    }
    Ok(text)
}

async fn call_ollama(cfg: &AiConfig, prompt: &str) -> Result<String, String> {
    let url = format!("{}/api/generate", cfg.ollama_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": cfg.ollama_model,
        "prompt": prompt,
        "stream": false,
        "format": "json",
        "options": { "temperature": 0.2 }
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama HTTP {}: {}", status, text));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = v["response"].as_str().unwrap_or("").to_string();
    if text.is_empty() {
        return Err(format!("Ollama returned empty response: {}", v));
    }
    Ok(text)
}

/// Quick connectivity test.
pub async fn test_provider(cfg: &AiConfig) -> Result<String, String> {
    let prompt = "Reply with the single word: OK";
    match cfg.provider.as_str() {
        "gemini" => call_gemini(cfg, prompt).await,
        "ollama" => call_ollama(cfg, prompt).await,
        other => Err(format!("Unknown provider: {}", other)),
    }
}
