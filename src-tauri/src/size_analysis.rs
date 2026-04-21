use crate::paths;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HeavyFile {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SizeBreakdown {
    pub total: u64,
    pub assets: u64,
    pub scripts: u64,
    pub localisation: u64,
    pub other: u64,
    pub file_count: u64,
    pub heavy_files: Vec<HeavyFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CacheEntry {
    mtime_ms: i64,
    breakdown: SizeBreakdown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Cache {
    entries: HashMap<String, CacheEntry>,
}

fn cache_path() -> std::path::PathBuf {
    paths::config_dir().join("mod_sizes.json")
}

fn load_cache() -> Cache {
    let p = cache_path();
    fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_cache(c: &Cache) {
    if let Ok(txt) = serde_json::to_string(c) {
        let _ = fs::write(cache_path(), txt);
    }
}

fn dir_mtime_ms(p: &Path) -> i64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn classify(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "dds" | "tga" | "png" | "jpg" | "jpeg" | "bmp" | "mesh" | "anim" | "wav" | "ogg"
        | "mp3" | "flac" | "xac" | "xsm" => "assets",
        "txt" | "asset" | "gfx" | "gui" | "json" | "csv" | "sfx" | "settings" => "scripts",
        "yml" | "yaml" => "localisation",
        _ => "other",
    }
}

pub fn analyze(mod_path: &Path) -> SizeBreakdown {
    let mut b = SizeBreakdown::default();
    if !mod_path.exists() {
        return b;
    }
    let mut files: Vec<HeavyFile> = Vec::new();
    for e in WalkDir::new(mod_path).follow_links(false).into_iter().filter_map(|x| x.ok()) {
        if !e.file_type().is_file() {
            continue;
        }
        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
        b.total += size;
        b.file_count += 1;
        let ext = e
            .path()
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        match classify(ext) {
            "assets" => b.assets += size,
            "scripts" => b.scripts += size,
            "localisation" => b.localisation += size,
            _ => b.other += size,
        }
        if size >= 1_000_000 {
            let rel = e
                .path()
                .strip_prefix(mod_path)
                .unwrap_or(e.path())
                .to_string_lossy()
                .into_owned();
            files.push(HeavyFile {
                path: rel,
                size_bytes: size,
            });
        }
    }
    files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    files.truncate(10);
    b.heavy_files = files;
    b
}

/// Analyze list of (mod_id, mod_path). Uses cache keyed by mod_id + dir mtime.
pub fn analyze_many(mods: Vec<(String, String)>, force: bool) -> Result<HashMap<String, SizeBreakdown>> {
    let mut cache = load_cache();
    let mut out: HashMap<String, SizeBreakdown> = HashMap::new();
    let mut dirty = false;
    for (id, path) in mods {
        let p = Path::new(&path);
        let mtime = dir_mtime_ms(p);
        if !force {
            if let Some(ent) = cache.entries.get(&id) {
                if ent.mtime_ms == mtime && mtime != 0 {
                    out.insert(id, ent.breakdown.clone());
                    continue;
                }
            }
        }
        let b = analyze(p);
        cache.entries.insert(
            id.clone(),
            CacheEntry {
                mtime_ms: mtime,
                breakdown: b.clone(),
            },
        );
        out.insert(id, b);
        dirty = true;
    }
    if dirty {
        save_cache(&cache);
    }
    Ok(out)
}

