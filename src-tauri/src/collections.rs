use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub mod_ids: Vec<String>,
    pub note: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct PresetStore {
    #[serde(default)]
    pub presets: Vec<Preset>,
}

fn store_path() -> PathBuf {
    crate::paths::config_dir().join("presets.json")
}

pub fn load() -> PresetStore {
    let p = store_path();
    if !p.exists() {
        return PresetStore::default();
    }
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(store: &PresetStore) -> Result<()> {
    let txt = serde_json::to_string_pretty(store)?;
    std::fs::write(store_path(), txt)?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn gen_id() -> String {
    format!("p_{}", now())
}

pub fn create(name: &str, mod_ids: Vec<String>, note: Option<String>) -> Result<Preset> {
    let mut store = load();
    let preset = Preset {
        id: gen_id(),
        name: name.to_string(),
        created_at: now(),
        updated_at: now(),
        mod_ids,
        note,
    };
    store.presets.push(preset.clone());
    save(&store)?;
    Ok(preset)
}

pub fn update(id: &str, name: Option<String>, mod_ids: Option<Vec<String>>, note: Option<String>) -> Result<()> {
    let mut store = load();
    if let Some(p) = store.presets.iter_mut().find(|p| p.id == id) {
        if let Some(n) = name {
            p.name = n;
        }
        if let Some(m) = mod_ids {
            p.mod_ids = m;
        }
        if let Some(n) = note {
            p.note = Some(n);
        }
        p.updated_at = now();
    }
    save(&store)
}

pub fn delete(id: &str) -> Result<()> {
    let mut store = load();
    store.presets.retain(|p| p.id != id);
    save(&store)
}

