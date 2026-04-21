use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RimWorldPaths {
    pub config_dir: String,
    pub mods_config_path: String,
    pub game_dir: Option<String>,
}

pub fn detect() -> Result<RimWorldPaths> {
    let locallow_str = std::env::var("USERPROFILE").context("Could not locate USERPROFILE")?;
    let locallow = PathBuf::from(locallow_str).join("AppData").join("LocalLow");
    let config_dir = locallow.join("Ludeon Studios").join("RimWorld by Ludeon Studios").join("Config");
    
    let game_dir = load_game_dir();
    
    Ok(RimWorldPaths {
        config_dir: config_dir.to_string_lossy().into_owned(),
        mods_config_path: config_dir.join("ModsConfig.xml").to_string_lossy().into_owned(),
        game_dir,
    })
}

pub fn ensure_dirs(p: &RimWorldPaths) -> Result<()> {
    std::fs::create_dir_all(&p.config_dir).ok();
    
    if !Path::new(&p.mods_config_path).exists() {
        let default_xml = r#"<?xml version="1.0" encoding="utf-8"?>
<ModsConfigData>
  <version>1.5.0</version>
  <activeMods>
    <li>ludeon.rimworld</li>
  </activeMods>
  <knownExpansions>
    <li>ludeon.rimworld.royalty</li>
    <li>ludeon.rimworld.ideology</li>
    <li>ludeon.rimworld.biotech</li>
    <li>ludeon.rimworld.anomaly</li>
  </knownExpansions>
</ModsConfigData>"#;
        std::fs::write(&p.mods_config_path, default_xml)?;
    }
    Ok(())
}

fn game_dir_file() -> PathBuf {
    config_dir().join("game_dir.txt")
}

pub fn load_game_dir() -> Option<String> {
    let f = game_dir_file();
    if !f.exists() {
        return None;
    }
    std::fs::read_to_string(&f)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn save_game_dir(path: Option<&str>) -> Result<()> {
    let f = game_dir_file();
    match path {
        Some(p) if !p.trim().is_empty() => std::fs::write(&f, p.trim()).map_err(Into::into),
        _ => {
            let _ = std::fs::remove_file(&f);
            Ok(())
        }
    }
}

pub fn config_dir() -> PathBuf {
    let mut d = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    d.push("RimWorldModManager");
    let _ = std::fs::create_dir_all(&d);
    d
}

