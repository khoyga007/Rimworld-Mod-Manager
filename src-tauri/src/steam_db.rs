use serde::Deserialize;
use std::collections::HashMap;

/// Subset of the RimSort Steam Workshop Database schema.
///
/// Upstream source (same file RimSort uses):
///   https://github.com/RimSort/Steam-Workshop-Database/raw/main/steamDB.json
///
/// We only care about mapping `published_file_id` → `packageid` so the auto-sort
/// engine can resolve dependency edges that reference Steam numeric IDs.
#[derive(Debug, Deserialize, Default)]
pub struct SteamDatabase {
    pub database: HashMap<String, SteamEntry>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct SteamEntry {
    // RimSort's steamDB.json redundantly stores BOTH `packageId` (camelCase) and
    // `packageid` (lowercase) on the same entry. `serde(alias)` would treat them
    // as duplicates and fail the entire parse, so capture them separately and
    // merge via `package_id()`.
    #[serde(default, rename = "packageId")]
    pub package_id_camel: Option<String>,
    #[serde(default, rename = "packageid")]
    pub package_id_lower: Option<String>,
    #[allow(dead_code)]
    pub name: Option<String>,
}

impl SteamEntry {
    pub fn package_id(&self) -> Option<&str> {
        self.package_id_camel.as_deref().or(self.package_id_lower.as_deref())
    }
}

/// Load the cached Steam DB and build a pfid → packageid (lowercase) map.
/// Returns an empty map if the file is missing or malformed.
pub fn load_pfid_to_packageid() -> HashMap<String, String> {
    let path = crate::paths::config_dir().join("steamDB.json");
    let mut out = HashMap::new();
    let Ok(txt) = std::fs::read_to_string(&path) else { return out; };
    let Ok(db) = serde_json::from_str::<SteamDatabase>(&txt) else { return out; };
    for (pfid, entry) in db.database {
        if let Some(pkg) = entry.package_id() {
            if !pkg.is_empty() {
                out.insert(pfid, pkg.to_lowercase());
            }
        }
    }
    out
}

/// True if the string is all ASCII digits (published_file_id format).
pub fn is_pfid(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

/// Reverse lookup: package_id (lowercase) → published_file_id. Used to auto-download
/// missing dependencies via SteamCMD.
pub fn load_packageid_to_pfid() -> HashMap<String, String> {
    let path = crate::paths::config_dir().join("steamDB.json");
    let mut out = HashMap::new();
    let Ok(txt) = std::fs::read_to_string(&path) else { return out; };
    let Ok(db) = serde_json::from_str::<SteamDatabase>(&txt) else { return out; };
    for (pfid, entry) in db.database {
        if let Some(pkg) = entry.package_id() {
            if !pkg.is_empty() {
                out.entry(pkg.to_lowercase()).or_insert(pfid);
            }
        }
    }
    out
}
