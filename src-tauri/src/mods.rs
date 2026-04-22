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
    pub dependencies: Vec<crate::about::Dependency>,
    pub load_after: Vec<String>,
    pub load_before: Vec<String>,
    pub incompatible_with: Vec<String>,
    pub missing_dependencies: Vec<crate::about::Dependency>,
    pub picture: Option<String>,
    pub path: String,
    pub descriptor_path: String,
    pub remote_file_id: Option<String>,
    pub source: ModSource,
    pub enabled: bool,
    pub load_order: i32,
    pub size_bytes: u64,
    pub custom_tags: Vec<String>,
    pub custom_note: String,
    pub workshop_name: Option<String>,
    pub created_at: u64,
}

// Custom Metadata Storage (Tags + Notes + Workshop Names + Performance Cache)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CustomMetadata {
    pub tags: Vec<String>,
    pub note: String,
    pub workshop_name: Option<String>,
    pub first_seen_at: Option<u64>,
    pub cached_size: Option<u64>,
    pub last_modified: Option<u64>,
    // Persistent cache of slow-to-parse XML data
    pub cached_name: Option<String>,
    pub cached_author: Option<String>,
    pub cached_package_id: Option<String>,
    pub cached_supported_versions: Option<Vec<String>>,
    pub cached_dependencies: Option<Vec<crate::about::Dependency>>,
    pub cached_load_after: Option<Vec<String>>,
    pub cached_load_before: Option<Vec<String>>,
    pub cached_incompatible_with: Option<Vec<String>>,
    pub cached_published_file_id: Option<String>,
}

type CustomMetadataMap = std::collections::HashMap<String, CustomMetadata>;

fn read_custom_metadata(paths: &RimWorldPaths) -> CustomMetadataMap {
    let p = PathBuf::from(&paths.mods_config_path).parent().unwrap().join("custom_metadata.json");
    if let Ok(txt) = fs::read_to_string(p) {
        return serde_json::from_str(&txt).unwrap_or_default();
    }
    // Migration from old custom_tags.json if exists
    let old_p = PathBuf::from(&paths.mods_config_path).parent().unwrap().join("custom_tags.json");
    if let Ok(txt) = fs::read_to_string(&old_p) {
        let old_map: std::collections::HashMap<String, Vec<String>> = serde_json::from_str(&txt).unwrap_or_default();
        let mut new_map = CustomMetadataMap::new();
        for (id, tags) in old_map {
            new_map.insert(id, CustomMetadata { 
                tags, 
                note: String::new(), 
                workshop_name: None, 
                first_seen_at: Some(1), 
                ..Default::default()
            });
        }
        let _ = fs::remove_file(old_p); // Clean up
        return new_map;
    }
    CustomMetadataMap::new()
}

fn write_custom_metadata(paths: &RimWorldPaths, metadata: &CustomMetadataMap) -> Result<()> {
    let p = PathBuf::from(&paths.mods_config_path).parent().unwrap().join("custom_metadata.json");
    let txt = serde_json::to_string(metadata)?;
    fs::write(p, txt)?;
    Ok(())
}


pub fn set_mod_tags(paths: &RimWorldPaths, id: &str, tags: Vec<String>) -> Result<()> {
    let mut map = read_custom_metadata(paths);
    let entry = map.entry(id.to_string()).or_default();
    entry.tags = tags;
    write_custom_metadata(paths, &map)?;
    clear_cache();
    Ok(())
}

pub fn set_mod_note(paths: &RimWorldPaths, id: &str, note: String) -> Result<()> {
    let mut map = read_custom_metadata(paths);
    let entry = map.entry(id.to_string()).or_default();
    entry.note = note;
    write_custom_metadata(paths, &map)?;
    clear_cache();
    Ok(())
}

pub fn set_mod_workshop_name(paths: &RimWorldPaths, id: &str, name: String) -> Result<()> {
    let mut map = read_custom_metadata(paths);
    let entry = map.entry(id.to_string()).or_default();
    entry.workshop_name = Some(name);
    write_custom_metadata(paths, &map)?;
    clear_cache();
    Ok(())
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
        active.insert(0, "Ludeon.RimWorld".to_string());
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
    
    // Store paths for thumbnailer
    {
        let mut gp = GLOBAL_PATHS.lock().unwrap();
        *gp = Some(paths.clone());
    }

    let mut metadata = read_custom_metadata(paths);
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
        let local_mods = PathBuf::from(gd).join("Mods");
        if local_mods.exists() {
            dirs_to_scan.push((local_mods, ModSource::Local));
        }
    }
    
    // Fallback steam workshop path
    let steam_workshop = PathBuf::from("C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\294100");
    if steam_workshop.exists() {
        dirs_to_scan.push((steam_workshop, ModSource::Workshop));
    }

    let config = read_mods_config(Path::new(&paths.mods_config_path)).unwrap_or_default();
    
    // Collect all mod candidate paths first
    let mut candidates = vec![];
    for (dir, source) in &dirs_to_scan {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let mod_path = entry.path();
                if mod_path.is_dir() {
                    let about_file = mod_path.join("About").join("About.xml");
                    if about_file.exists() {
                        let m_time = fs::metadata(&mod_path).and_then(|m| m.modified()).ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs());
                        candidates.push((about_file, mod_path, source.clone(), m_time));
                    }
                }
            }
        }
    }

    use rayon::prelude::*;
    let mut metadata_changed = false;

    // Parallel scan with cache check
    let results: Vec<ModInfo> = candidates.into_par_iter().map(|(about_file, mod_path, source, m_time)| {
        // Try to get from metadata cache first
        // Note: We read metadata map multiple times here but it's small/fast compared to XML parse
        // Actually, for extreme speed, we should pass the map into the par_iter
        // but since we need to mutate it later, we do a simple check
        load_mod_smart(&about_file, &mod_path, &config, source, m_time, &metadata)
    }).filter_map(|r| r.ok()).collect();

    let mut out = results;
    let mut seen_ids = std::collections::HashSet::new();
    out.retain(|m| seen_ids.insert(m.id.clone()));

    // Merge metadata and calculate sizes efficiently
    for info in out.iter_mut() {
        let m_time = fs::metadata(&info.path).and_then(|m| m.modified()).ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        if let Some(m) = metadata.get_mut(&info.id) {
            if m.first_seen_at.is_none() {
                m.first_seen_at = Some(1);
                metadata_changed = true;
            }
            
            // Sync the permanent cache back into metadata if it was a fresh scan
            if m.last_modified != m_time {
                m.cached_name = Some(info.name.clone());
                m.cached_author = Some(info.author.clone());
                m.cached_package_id = Some(info.id.clone());
                m.cached_supported_versions = Some(info.supported_version.as_ref().map(|s| s.split(", ").map(|v| v.to_string()).collect()).unwrap_or_default());
                m.cached_dependencies = Some(info.dependencies.clone());
                m.cached_load_after = Some(info.load_after.clone());
                m.cached_load_before = Some(info.load_before.clone());
                m.cached_incompatible_with = Some(info.incompatible_with.clone());
                m.cached_published_file_id = info.remote_file_id.clone();
                
                // Performance trick: Cache dir size
                m.cached_size = Some(dir_size(Path::new(&info.path)));
                m.last_modified = m_time;
                metadata_changed = true;
            }

            info.size_bytes = m.cached_size.unwrap_or(0);
            info.custom_tags = m.tags.clone();
            info.custom_note = m.note.clone();
            info.workshop_name = m.workshop_name.clone();
            info.created_at = m.first_seen_at.unwrap_or(0);
        } else {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
            let size = dir_size(Path::new(&info.path));
            metadata.insert(info.id.clone(), CustomMetadata {
                first_seen_at: Some(now),
                cached_size: Some(size),
                last_modified: m_time,
                cached_name: Some(info.name.clone()),
                cached_author: Some(info.author.clone()),
                cached_package_id: Some(info.id.clone()),
                cached_supported_versions: Some(info.supported_version.as_ref().map(|s| s.split(", ").map(|v| v.to_string()).collect()).unwrap_or_default()),
                cached_dependencies: Some(info.dependencies.clone()),
                cached_load_after: Some(info.load_after.clone()),
                cached_load_before: Some(info.load_before.clone()),
                cached_incompatible_with: Some(info.incompatible_with.clone()),
                cached_published_file_id: info.remote_file_id.clone(),
                ..Default::default()
            });
            info.size_bytes = size;
            info.created_at = now;
            metadata_changed = true;
        }
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

    // Dependency Guard: Check for missing dependencies
    let all_package_ids: std::collections::HashSet<String> = out.iter().map(|m| m.id.to_lowercase()).collect();
    for m in out.iter_mut() {
        let mut missing = Vec::new();
        for dep in &m.dependencies {
            if !all_package_ids.contains(&dep.package_id.to_lowercase()) {
                missing.push(dep.clone());
            }
        }
        m.missing_dependencies = missing;
    }

    out.sort_by_key(|m| m.load_order);

    if metadata_changed {
        let _ = write_custom_metadata(paths, &metadata);
    }

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

// Global paths holder for thumbnailer during par_iter
static GLOBAL_PATHS: Lazy<Mutex<Option<RimWorldPaths>>> = Lazy::new(|| Mutex::new(None));

fn load_mod_smart(
    about_file: &Path, 
    mod_path: &Path, 
    config: &ModsConfig, 
    source: ModSource, 
    m_time: Option<u64>,
    metadata: &CustomMetadataMap
) -> Result<ModInfo> {
    let fallback_name = mod_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown_mod");
    let id;

    // 1. Try Cache First
    let mut cached_data = None;
    for (m_id, m) in metadata {
        if m.last_modified == m_time && m.cached_name.is_some() {
            if mod_path.to_string_lossy().contains(m_id) || fallback_name == m_id {
                cached_data = Some((m_id.clone(), m));
                break;
            }
        }
    }

    if let Some((m_id, m)) = cached_data {
        let id_lower = m_id.to_lowercase();
        let enabled = config.active_mods.iter().any(|a| a.to_lowercase() == id_lower);
        
        let picture_path = {
            let gp = GLOBAL_PATHS.lock().unwrap();
            if let Some(p) = gp.as_ref() {
                ensure_thumbnail(mod_path, &m_id, p)
            } else {
                None
            }
        };

        return Ok(ModInfo {
            id: m_id,
            name: m.cached_name.clone().unwrap_or_default(),
            author: m.cached_author.clone().unwrap_or_default(),
            version: None,
            supported_version: Some(m.cached_supported_versions.clone().unwrap_or_default().join(", ")),
            tags: vec![],
            dependencies: m.cached_dependencies.clone().unwrap_or_default(),
            load_after: m.cached_load_after.clone().unwrap_or_default(),
            load_before: m.cached_load_before.clone().unwrap_or_default(),
            incompatible_with: m.cached_incompatible_with.clone().unwrap_or_default(),
            picture: picture_path,
            path: mod_path.to_string_lossy().into_owned(),
            descriptor_path: about_file.to_string_lossy().into_owned(),
            remote_file_id: m.cached_published_file_id.clone(),
            source,
            enabled,
            load_order: i32::MAX,
            size_bytes: m.cached_size.unwrap_or(0),
            custom_tags: m.tags.clone(),
            custom_note: m.note.clone(),
            workshop_name: m.workshop_name.clone(),
            created_at: m.first_seen_at.unwrap_or(0),
            missing_dependencies: vec![],
        });
    }

    // 2. Fallback to Full Scan (Slow)
    let txt = fs::read_to_string(about_file)?;
    let d = about::parse_about(&txt).unwrap_or_default();

    id = if d.package_id.is_empty() {
        fallback_name.to_lowercase()
    } else {
        d.package_id.clone()
    };
    
    let id_lower = id.to_lowercase();
    let enabled = config.active_mods.iter().any(|a| a.to_lowercase() == id_lower);

    let picture_path = {
        let gp = GLOBAL_PATHS.lock().unwrap();
        if let Some(p) = gp.as_ref() {
            ensure_thumbnail(mod_path, &id, p)
        } else {
            None
        }
    };

    let name = if d.name.is_empty() {
        fallback_name.to_string()
    } else {
        d.name.clone()
    };

    let mut remote_file_id = d.published_file_id;
    if remote_file_id.is_none() && fallback_name.chars().all(|c| c.is_ascii_digit()) {
        remote_file_id = Some(fallback_name.to_string());
    }

    let mut custom_tags = vec![];
    let is_external = remote_file_id.is_none() && source == ModSource::Local && !REQUIRED_MOD_IDS.contains(&id_lower.as_str());
    if is_external {
        custom_tags.push("Third-Party".to_string());
        if id_lower.contains("rjw") || name.to_lowercase().contains("rimjobworld") {
            custom_tags.push("RJW Ecosystem".to_string());
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
        size_bytes: 0, 
        custom_tags,
        custom_note: String::new(),
        workshop_name: None,
        created_at: 0,
        missing_dependencies: vec![],
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

fn ensure_thumbnail(mod_path: &Path, mod_id: &str, paths: &RimWorldPaths) -> Option<String> {
    let mut preview_path = None;
    
    // Candidates for preview images
    let candidates = [
        "About/Preview.png", "About/preview.png", "About/Preview.jpg", "About/preview.jpg",
        "Preview.png", "preview.png", "Preview.jpg", "preview.jpg", "Preview.jpeg", "preview.jpeg"
    ];

    for c in candidates {
        let p = mod_path.join(c);
        if p.exists() {
            preview_path = Some(p);
            break;
        }
    }

    // Deep search if no common candidates found
    if preview_path.is_none() {
        if let Ok(iter) = fs::read_dir(mod_path) {
            for entry in iter.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains("preview") && (name.ends_with(".png") || name.ends_with(".jpg") || name.ends_with(".jpeg") || name.ends_with(".webp")) {
                    preview_path = Some(entry.path());
                    break;
                }
                // Check one level deeper in common folders
                if entry.path().is_dir() {
                    let dir_name = name.clone();
                    if dir_name == "about" || dir_name == "textures" || dir_name == "preview" {
                        if let Ok(sub_iter) = fs::read_dir(entry.path()) {
                            for sub_entry in sub_iter.flatten() {
                                let sub_name = sub_entry.file_name().to_string_lossy().to_lowercase();
                                if sub_name.contains("preview") && (sub_name.ends_with(".png") || sub_name.ends_with(".jpg") || sub_name.ends_with(".jpeg") || sub_name.ends_with(".webp")) {
                                    preview_path = Some(sub_entry.path());
                                    break;
                                }
                            }
                        }
                    }
                }
                if preview_path.is_some() { break; }
            }
        }
    }

    let preview_path = preview_path?;
    let cache_dir = PathBuf::from(&paths.mods_config_path).parent().unwrap().join("thumbnails");
    if !cache_dir.exists() {
        let _ = fs::create_dir_all(&cache_dir);
    }

    let thumb_path = cache_dir.join(format!("{}.jpg", mod_id));
    
    // Check if thumbnail is up to date
    let original_mtime = fs::metadata(&preview_path).and_then(|m| m.modified()).ok();
    let thumb_mtime = fs::metadata(&thumb_path).and_then(|m| m.modified()).ok();

    if thumb_path.exists() && thumb_mtime >= original_mtime {
        return Some(thumb_path.to_string_lossy().into_owned());
    }

    // Generate new thumbnail
    if let Ok(img) = image::open(&preview_path) {
        let thumbnail = img.thumbnail(160, 160);
        if let Ok(_) = thumbnail.save_with_format(&thumb_path, image::ImageFormat::Jpeg) {
            return Some(thumb_path.to_string_lossy().into_owned());
        }
    }

    // Fallback to original if thumbnailing fails
    Some(preview_path.to_string_lossy().into_owned())
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
    
    // Trust the frontend's list entirely for the active order
    config.active_mods = ids.iter().cloned().collect();
    
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

