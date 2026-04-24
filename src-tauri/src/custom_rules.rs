use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// User-authored load-order rules, stored per-mod by lowercase package_id.
/// Merged on top of the community rules during auto-sort.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CustomRule {
    #[serde(default)]
    pub load_after: Vec<String>,
    #[serde(default)]
    pub load_before: Vec<String>,
    #[serde(default)]
    pub load_top: bool,
    #[serde(default)]
    pub load_bottom: bool,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CustomRules {
    #[serde(default)]
    pub rules: HashMap<String, CustomRule>,
}

fn path() -> std::path::PathBuf {
    crate::paths::config_dir().join("customRules.json")
}

pub fn load() -> CustomRules {
    let Ok(txt) = std::fs::read_to_string(path()) else { return CustomRules::default(); };
    serde_json::from_str::<CustomRules>(&txt).unwrap_or_default()
}

pub fn save(rules: &CustomRules) -> Result<(), String> {
    let txt = serde_json::to_string_pretty(rules).map_err(|e| e.to_string())?;
    std::fs::write(path(), txt).map_err(|e| e.to_string())
}

/// Normalize keys to lowercase so merging with the sort engine is consistent.
pub fn load_normalized() -> HashMap<String, CustomRule> {
    let db = load();
    db.rules.into_iter().map(|(k, v)| (k.to_lowercase(), v)).collect()
}
