use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct SaveGameInfo {
    pub file_name: String,
    pub colony_name: String,
    pub seed: String,
    pub game_version: String,
    pub mod_ids: Vec<String>,
    pub mod_names: Vec<String>,
    pub save_date: String,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaveAnalysis {
    pub save: SaveGameInfo,
    pub missing_mods: Vec<MissingSaveMod>,
    pub present_mods: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MissingSaveMod {
    pub id: String,
    pub name: String,
}

/// List all .rws save files
pub fn list_saves() -> Result<Vec<SaveGameInfo>> {
    let saves_dir = get_saves_dir()?;
    if !saves_dir.exists() {
        return Ok(Vec::new());
    }
    let mut saves = Vec::new();
    for entry in std::fs::read_dir(&saves_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map(|e| e == "rws").unwrap_or(false) {
            match parse_save_header(&path) {
                Ok(info) => saves.push(info),
                Err(_) => continue,
            }
        }
    }
    saves.sort_by(|a, b| b.save_date.cmp(&a.save_date));
    Ok(saves)
}

/// Analyze a save file against currently installed mods
pub fn analyze_save(file_name: &str, installed_ids: &[String]) -> Result<SaveAnalysis> {
    let saves_dir = get_saves_dir()?;
    let path = saves_dir.join(file_name);
    let save = parse_save_header(&path)?;

    let installed_lower: std::collections::HashSet<String> =
        installed_ids.iter().map(|id| id.to_lowercase()).collect();

    let mut missing_mods = Vec::new();
    let mut present_mods = Vec::new();

    for (i, mod_id) in save.mod_ids.iter().enumerate() {
        let id_lower = mod_id.to_lowercase();
        if installed_lower.contains(&id_lower) {
            present_mods.push(mod_id.clone());
        } else {
            let name = save.mod_names.get(i).cloned().unwrap_or_else(|| mod_id.clone());
            missing_mods.push(MissingSaveMod {
                id: mod_id.clone(),
                name,
            });
        }
    }

    Ok(SaveAnalysis {
        save,
        missing_mods,
        present_mods,
    })
}

fn get_saves_dir() -> Result<PathBuf> {
    let user = std::env::var("USERPROFILE").context("No USERPROFILE")?;
    Ok(PathBuf::from(user)
        .join("AppData")
        .join("LocalLow")
        .join("Ludeon Studios")
        .join("RimWorld by Ludeon Studios")
        .join("Saves"))
}

/// Parse just the header of a RimWorld save file (XML)
/// We only read the first ~64KB to avoid loading huge save files
fn parse_save_header(path: &Path) -> Result<SaveGameInfo> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let file_size = std::fs::metadata(path)?.len();
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Read only first 256KB for header parsing
    let raw = std::fs::read(path)?;
    let content = if raw.len() > 256 * 1024 {
        String::from_utf8_lossy(&raw[..256 * 1024]).to_string()
    } else {
        String::from_utf8_lossy(&raw).to_string()
    };

    let mut reader = Reader::from_str(&content);
    let mut buf = Vec::new();
    let mut path_stack: Vec<String> = Vec::new();

    let mut colony_name = String::new();
    let mut seed = String::new();
    let mut game_version = String::new();
    let mut mod_ids: Vec<String> = Vec::new();
    let mut mod_names: Vec<String> = Vec::new();
    let mut save_date = String::new();
    let mut in_mod_ids = false;
    let mut in_mod_names = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "modIds" { in_mod_ids = true; }
                if name == "modNames" || name == "modSteamIds" { in_mod_names = true; }
                path_stack.push(name);
            }
            Ok(Event::End(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "modIds" { in_mod_ids = false; }
                if name == "modNames" || name == "modSteamIds" { in_mod_names = false; }
                path_stack.pop();
                // Stop early after we got what we need
                if !mod_ids.is_empty() && !colony_name.is_empty() && name == "meta" {
                    break;
                }
            }
            Ok(Event::Text(e)) => {
                let txt = e.unescape().unwrap_or_default().to_string();
                if txt.trim().is_empty() { continue; }
                let tag = path_stack.last().map(|s| s.as_str()).unwrap_or("");

                if in_mod_ids && tag == "li" {
                    mod_ids.push(txt.trim().to_string());
                } else if in_mod_names && tag == "li" {
                    mod_names.push(txt.trim().to_string());
                } else if tag == "gameVersion" {
                    game_version = txt.trim().to_string();
                } else if tag == "seed" && seed.is_empty() {
                    seed = txt.trim().to_string();
                } else if tag == "mapSize" || tag == "colonyName" {
                    colony_name = txt.trim().to_string();
                } else if tag == "realWorldDate" || tag == "createdDate" {
                    save_date = txt.trim().to_string();
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    if colony_name.is_empty() {
        colony_name = file_name.replace(".rws", "").to_string();
    }

    Ok(SaveGameInfo {
        file_name,
        colony_name,
        seed,
        game_version,
        mod_ids,
        mod_names,
        save_date,
        file_size,
    })
}
