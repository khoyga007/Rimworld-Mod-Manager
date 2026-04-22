use crate::about;
use crate::paths::RimWorldPaths;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use std::io::Write;
use std::sync::Mutex;
use once_cell::sync::Lazy;

static MOD_CACHE: Lazy<Mutex<Option<Vec<ModInfo>>>> = Lazy::new(|| Mutex::new(None));

const REQUIRED_MOD_IDS: &[&str] = &[
    "ludeon.rimworld", 
    "ludeon.rimworld.royalty", 
    "ludeon.rimworld.ideology", 
    "ludeon.rimworld.biotech", 
    "ludeon.rimworld.anomaly"
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModSource {
    Official,  // From Data/ (Core & DLCs)
    Workshop,  // From Steam Workshop
    Local,     // From Mods/
    Other,     // LND, SW, etc.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModInfo {
    pub id: String, // Equivalent to packageId
    pub name: String,
    pub author: String,
    pub version: Option<String>,
    pub supported_version: Option<String>,
    pub tags: Vec<String>,
    pub dependencies: Vec<String>,
    pub load_after: Vec<String>,
    pub load_before: Vec<String>,
    pub incompatible_with: Vec<String>,
    pub picture: Option<String>,
    pub path: String,
    pub descriptor_path: String,
    pub remote_file_id: Option<String>,
    pub source: ModSource,
    pub enabled: bool,
    pub load_order: i32,
    pub size_bytes: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ModsConfig {
    pub version: String,
    pub active_mods: Vec<String>,
    pub known_expansions: Vec<String>,
}

pub fn read_mods_config(path: &Path) -> Result<ModsConfig> {
    if !path.exists() {
        return Ok(ModsConfig::default());
    }
    let txt = fs::read_to_string(path)?;
    let mut config = ModsConfig::default();
    let mut in_active = false;
    let mut in_known = false;
    
    for line in txt.lines() {
        let l = line.trim();
        if let Some(v) = l.strip_prefix("<version>").and_then(|s| s.strip_suffix("</version>")) {
            config.version = v.trim().to_string();
        } else if l.starts_with("<activeMods>") {
            in_active = true;
        } else if l.starts_with("</activeMods>") {
            in_active = false;
        } else if l.starts_with("<knownExpansions>") {
            in_known = true;
        } else if l.starts_with("</knownExpansions>") {
            in_known = false;
        } else if l.starts_with("<li>") && l.ends_with("</li>") {
            let val = l.replace("<li>", "").replace("</li>", "");
            if in_active {
                config.active_mods.push(val);
            } else if in_known {
                config.known_expansions.push(val);
            }
        }
    }

    // Deduplicate active_mods: keep first occurrence (case-insensitive)
    let mut seen = std::collections::HashSet::new();
    config.active_mods.retain(|id| seen.insert(id.to_lowercase()));

    Ok(config)
}

pub fn write_mods_config(path: &Path, config: &ModsConfig) -> Result<()> {
    let mut active = config.active_mods.clone();
    // Ensure core is always present
    if !active.iter().any(|m| m.to_lowercase() == "ludeon.rimworld") {
        active.insert(0, "ludeon.rimworld".to_string());
    }

    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
    out.push_str("<ModsConfigData>\n");
    if !config.version.is_empty() {
        out.push_str(&format!("  <version>{}</version>\n", config.version));
    } else {
        out.push_str("  <version>1.5.0</version>\n");
    }
    
    out.push_str("  <activeMods>\n");
    for m in &active {
        out.push_str(&format!("    <li>{}</li>\n", m));
    }
    out.push_str("  </activeMods>\n");
    
    out.push_str("  <knownExpansions>\n");
    for m in &config.known_expansions {
        out.push_str(&format!("    <li>{}</li>\n", m));
    }
    out.push_str("  </knownExpansions>\n");
    
    out.push_str("</ModsConfigData>\n");
    
    // Atomic Write
    let temp_path = path.with_extension("tmp");
    {
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(out.as_bytes())?;
        file.sync_all()?;
    }
    
    let _ = crate::backups::snapshot(path);
    std::fs::rename(&temp_path, path)?;
    
    Ok(())
}

pub fn list(paths: &RimWorldPaths) -> Result<Vec<ModInfo>> {
    {
        let cache = MOD_CACHE.lock().unwrap();
        if let Some(cached_mods) = cache.as_ref() {
            return Ok(cached_mods.clone());
        }
    }

    let mut dirs_to_scan = Vec::new();
    
    if let Some(gd) = &paths.game_dir {
        let game_path = PathBuf::from(gd);
        eprintln!("[RIMPRO] Game dir: {}", gd);
        eprintln!("[RIMPRO] Game dir exists: {}", game_path.exists());
        
        let data_dir = game_path.join("Data");
        if data_dir.exists() { 
            eprintln!("[RIMPRO] Found Data/ dir");
            dirs_to_scan.push((data_dir, ModSource::Official)); 
        }
        let mods_dir = game_path.join("Mods");
        if mods_dir.exists() { 
            eprintln!("[RIMPRO] Found Mods/ dir");
            dirs_to_scan.push((mods_dir, ModSource::Local)); 
        }
        let lnd_dir = game_path.join("LinkNeverDie.Com-GSE").join("mods");
        if lnd_dir.exists() { dirs_to_scan.push((lnd_dir, ModSource::Other)); }
        let sw_dir = game_path.join("SW_mod");
        if sw_dir.exists() { dirs_to_scan.push((sw_dir, ModSource::Other)); }
    } else {
        eprintln!("[RIMPRO] WARNING: game_dir is None! No mods will be scanned.");
    }
    
    // Fallback steam workshop path
    let steam_workshop = PathBuf::from("C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\294100");
    if steam_workshop.exists() {
        eprintln!("[RIMPRO] Found Steam Workshop dir");
        dirs_to_scan.push((steam_workshop, ModSource::Workshop));
    }

    eprintln!("[RIMPRO] Total directories to scan: {}", dirs_to_scan.len());

    let config = read_mods_config(Path::new(&paths.mods_config_path)).unwrap_or_default();

    let mut out: Vec<ModInfo> = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    
    for (dir, source) in dirs_to_scan {
        let mut count = 0;
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let mod_path = entry.path();
                if mod_path.is_dir() {
                    let about_file = mod_path.join("About").join("About.xml");
                    if about_file.exists() {
                        match load_mod(&about_file, &mod_path, &config, source.clone()) {
                            Ok(info) => {
                                if seen_ids.insert(info.id.clone()) {
                                    out.push(info);
                                    count += 1;
                                }
                            }
                            Err(e) => {
                                eprintln!("[RIMPRO] Failed to load mod at {:?}: {}", mod_path, e);
                            }
                        }
                    }
                }
            }
        }
        eprintln!("[RIMPRO] Scanned {:?} → {} mods found", dir, count);
    }

    // Set load orders (case-insensitive match)
    for (i, id) in config.active_mods.iter().enumerate() {
        let id_lower = id.to_lowercase();
        if let Some(m) = out.iter_mut().find(|m| m.id.to_lowercase() == id_lower) {
            m.load_order = i as i32;
        }
    }
    
    let base = config.active_mods.len() as i32;
    let mut k = 0;
    let active_lower: Vec<String> = config.active_mods.iter().map(|a| a.to_lowercase()).collect();
    for m in out.iter_mut() {
        if !active_lower.contains(&m.id.to_lowercase()) {
            m.load_order = base + k;
            k += 1;
        }
    }

    out.sort_by_key(|m| m.load_order);

    {
        let mut cache = MOD_CACHE.lock().unwrap();
        *cache = Some(out.clone());
    }

    Ok(out)
}

pub fn clear_cache() {
    let mut cache = MOD_CACHE.lock().unwrap();
    *cache = None;
}

fn load_mod(about_file: &Path, mod_path: &Path, config: &ModsConfig, source: ModSource) -> Result<ModInfo> {
    let txt = fs::read_to_string(about_file)?;
    let d = about::parse_about(&txt).unwrap_or_default();

    let fallback_name = mod_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown_mod");

    let id = if d.package_id.is_empty() {
        fallback_name.to_lowercase()
    } else {
        d.package_id.clone()
    };
    
    let id_lower = id.to_lowercase();
    let enabled = config.active_mods.iter().any(|a| a.to_lowercase() == id_lower);

    let size_bytes = dir_size(mod_path);
    let picture = mod_path.join("About").join("Preview.png");
    let picture_path = if picture.exists() {
        Some(picture.to_string_lossy().replace("\\", "/"))
    } else {
        None
    };

    let name = if d.name.is_empty() {
        fallback_name.to_string()
    } else {
        d.name.clone()
    };

    let mut remote_file_id = d.published_file_id;
    
    // 1. If folder name is numeric, that's likely our Workshop ID (very common in manual installs)
    if remote_file_id.is_none() {
        if fallback_name.chars().all(|c| c.is_ascii_digit()) {
            remote_file_id = Some(fallback_name.to_string());
        }
    }

    // 2. Check for PublishedFileId.txt (Steam-created metadata)
    if remote_file_id.is_none() {
        let pub_id_file = mod_path.join("PublishedFileId.txt");
        if pub_id_file.exists() {
            if let Ok(content) = fs::read_to_string(pub_id_file) {
                let cleaned = content.trim();
                if !cleaned.is_empty() && cleaned.chars().all(|c| c.is_ascii_digit()) {
                    remote_file_id = Some(cleaned.to_string());
                }
            }
        }
    }

    Ok(ModInfo {
        id,
        name,
        author: d.author,
        version: None,
        supported_version: Some(d.supported_versions.join(", ")),
        tags: vec![],
        dependencies: d.mod_dependencies,
        load_after: d.load_after,
        load_before: d.load_before,
        incompatible_with: d.incompatible_with,
        picture: picture_path,
        path: mod_path.to_string_lossy().into_owned(),
        descriptor_path: about_file.to_string_lossy().into_owned(),
        remote_file_id,
        source,
        enabled,
        load_order: i32::MAX,
        size_bytes,
    })
}

fn dir_size(p: &Path) -> u64 {
    WalkDir::new(p)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}

pub fn set_enabled(paths: &RimWorldPaths, id: &str, enabled: bool) -> Result<()> {
    let mut config = read_mods_config(Path::new(&paths.mods_config_path))?;
    let id_lower = id.to_lowercase();
    
    if !enabled && REQUIRED_MOD_IDS.iter().any(|&r| r == id_lower) {
        return Err(anyhow::anyhow!("Cannot disable mandatory mod: {}", id));
    }

    config.active_mods.retain(|m| m.to_lowercase() != id_lower);
    if enabled {
        config.active_mods.push(id.to_string());
    }
    write_mods_config(Path::new(&paths.mods_config_path), &config)?;
    clear_cache();
    Ok(())
}

pub fn set_all_enabled(paths: &RimWorldPaths, enabled: bool) -> Result<()> {
    let mods = list(paths)?;
    let mut config = read_mods_config(Path::new(&paths.mods_config_path))?;
    if enabled {
        config.active_mods = mods.iter().map(|m| m.id.clone()).collect();
    } else {
        // Only keep mandatory mods
        config.active_mods.retain(|m| {
            let m_lower = m.to_lowercase();
            REQUIRED_MOD_IDS.iter().any(|&r| r == m_lower)
        });
    }
    write_mods_config(Path::new(&paths.mods_config_path), &config)?;
    clear_cache();
    Ok(())
}

pub fn set_enabled_set(paths: &RimWorldPaths, ids: &[String]) -> Result<()> {
    let mut config = read_mods_config(Path::new(&paths.mods_config_path))?;
    let mut seen = std::collections::HashSet::new();
    let ordered: Vec<String> = ids
        .iter()
        .filter(|id| seen.insert((*id).clone()))
        .cloned()
        .collect();
    config.active_mods = ordered;
    write_mods_config(Path::new(&paths.mods_config_path), &config)?;
    clear_cache();
    Ok(())
}

pub fn set_order(paths: &RimWorldPaths, ids: &[String]) -> Result<()> {
    let mut config = read_mods_config(Path::new(&paths.mods_config_path))?;
    let enabled_lower: std::collections::HashSet<String> = config.active_mods.iter().map(|a| a.to_lowercase()).collect();
    let mut new_order: Vec<String> = ids.iter().filter(|id| enabled_lower.contains(&id.to_lowercase())).cloned().collect();
    for id in config.active_mods.iter() {
        let id_lower = id.to_lowercase();
        if !new_order.iter().any(|o| o.to_lowercase() == id_lower) {
            new_order.push(id_lower);
        }
    }
    config.active_mods = new_order;
    write_mods_config(Path::new(&paths.mods_config_path), &config)?;
    clear_cache();
    Ok(())
}

pub fn delete_mod(paths: &RimWorldPaths, id: &str) -> Result<()> {
    let mods = list(paths)?;
    let target = mods.iter().find(|m| m.id == id).context("Mod not found")?;

    let folder = Path::new(&target.path);
    if folder.exists() {
        fs::remove_dir_all(folder).ok();
    }

    let mut config = read_mods_config(Path::new(&paths.mods_config_path))?;
    let id_lower = id.to_lowercase();
    config.active_mods.retain(|m| m.to_lowercase() != id_lower);
    write_mods_config(Path::new(&paths.mods_config_path), &config)?;
    clear_cache();
    Ok(())
}

pub fn install_from_folder(
    paths: &RimWorldPaths,
    source_folder: &Path,
    workshop_id: &str,
    _descriptor: &crate::about::ModAbout,
) -> Result<String> {
    // Just copy the mod to Mods folder in game_dir if possible
    if let Some(gd) = &paths.game_dir {
        let dest = PathBuf::from(gd).join("Mods").join(workshop_id);
        fs::create_dir_all(&dest)?;
        copy_dir_recursive(source_folder, &dest)?;
        clear_cache();
        return Ok(workshop_id.to_string());
    }
    Err(anyhow::anyhow!("Game directory not set"))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else {
            fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}

#[derive(Debug, Default, serde::Serialize)]
#[allow(dead_code)]
pub struct MigrateReport {
    pub moved: u32,
    pub skipped: u32,
    pub failed: Vec<String>,
    pub details: Vec<String>,
}

#[allow(dead_code)]
pub fn migrate_content(_paths: &RimWorldPaths) -> Result<MigrateReport> {
    Ok(MigrateReport::default())
}

pub fn backup_mod_to_local(paths: &RimWorldPaths, mod_id: &str) -> Result<()> {
    let mods_list = list(paths)?;
    let target_mod = mods_list.iter().find(|m| m.id.eq_ignore_ascii_case(mod_id))
        .context("Mod not found in current list")?;

    let gd = paths.game_dir.as_ref().context("Game directory not set")?;
    let game_path = PathBuf::from(gd);
    let local_mods_dir = game_path.join("Mods");

    if !local_mods_dir.exists() {
        fs::create_dir_all(&local_mods_dir)?;
    }

    // Create a safe directory name based on mod name
    let safe_name: String = target_mod.name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { '_' })
        .collect();
    let safe_name = safe_name.trim().to_string();

    let dest_dir = local_mods_dir.join(&safe_name);
    
    if dest_dir.exists() {
        anyhow::bail!("A local mod with this name already exists: {}", safe_name);
    }

    // Copy directory
    copy_dir_recursive(Path::new(&target_mod.path), &dest_dir)?;

    // Optional: Remove .git folder if exists
    let git_dir = dest_dir.join(".git");
    if git_dir.exists() {
        let _ = fs::remove_dir_all(git_dir);
    }
    
    clear_cache();

    Ok(())
}

