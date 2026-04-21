use crate::mods::ModInfo;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Deserialize, Default)]
#[allow(dead_code)]
pub struct RimPyDatabase {
    pub timestamp: Option<i64>,
    pub rules: HashMap<String, RimPyRule>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct RimPyRule {
    #[serde(rename = "loadAfter")]
    pub load_after: Option<HashMap<String, serde_json::Value>>,
    #[serde(rename = "loadBefore")]
    pub load_before: Option<HashMap<String, serde_json::Value>>,
    #[serde(rename = "incompatibleWith")]
    pub incompatible_with: Option<HashMap<String, serde_json::Value>>,
    #[serde(rename = "loadBottom")]
    pub load_bottom: Option<FlagValue>,
    #[serde(rename = "loadTop")]
    pub load_top: Option<FlagValue>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct FlagValue {
    pub value: Option<bool>,
}

pub fn load_rimpy_rules() -> HashMap<String, RimPyRule> {
    let path = crate::paths::config_dir().join("communityRules.json");
    if let Ok(txt) = std::fs::read_to_string(path) {
        if let Ok(db) = serde_json::from_str::<RimPyDatabase>(&txt) {
            return db.rules;
        }
    }
    HashMap::new()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Bucket {
    Harmony,        // Always #1
    Core,           // Base game
    Dlc,            // Official expansions (Fixed order)
    Library,        // Frameworks/Libraries (HugsLib, VEF, etc.)
    TotalConversion,// Massive overhauls
    MapGen,         // Biomes, map generation
    Race,           // New species
    General,        // Clothes, weapons, etc.
    Animation,      // Animations, poses
    Ui,             // Interface tweaks
    Patch,          // Compatibility patches
    Performance,    // Rocketman, etc. - Always last
}

impl Bucket {
    fn label(self) -> &'static str {
        match self {
            Bucket::Harmony => "Harmony",
            Bucket::Core => "Core",
            Bucket::Dlc => "Official DLC",
            Bucket::Library => "Library/Framework",
            Bucket::TotalConversion => "Total Conversion",
            Bucket::MapGen => "Map/Biomes",
            Bucket::Race => "Race",
            Bucket::General => "General",
            Bucket::Animation => "Animation",
            Bucket::Ui => "UI",
            Bucket::Patch => "Patch/Compatibility",
            Bucket::Performance => "Performance (Bottom)",
        }
    }

    fn order(self) -> i32 {
        match self {
            Bucket::Harmony => -100,
            Bucket::Core => -95,
            Bucket::Dlc => -90,
            Bucket::Library => -70,
            Bucket::TotalConversion => -30,
            Bucket::MapGen => -10,
            Bucket::Race => 10,
            Bucket::General => 50,
            Bucket::Animation => 70,
            Bucket::Ui => 80,
            Bucket::Patch => 90,
            Bucket::Performance => 100,
        }
    }
}

fn classify(m: &ModInfo) -> Bucket {
    let id_lower = m.id.to_lowercase();
    let name_lower = m.name.to_lowercase();

    // 1. Harmony & Core
    if id_lower == "brrainz.harmony" { return Bucket::Harmony; }
    if id_lower == "ludeon.rimworld" { return Bucket::Core; }
    
    // 2. DLCs
    if id_lower.starts_with("ludeon.rimworld.") { return Bucket::Dlc; }

    // 3. Libraries / Frameworks (ID or Name match)
    let library_markers = [
        "unlimitedhugs.hugslib",
        "oskarpotocki.vanillafactionsexpanded.core",
        "vanilla expanded framework",
        "vanilla faction",
        "jecstools",
        "humanoid alien races",
        "bepinex",
        "tabula rasa",
    ];
    if library_markers.iter().any(|&k| id_lower.contains(k) || name_lower.contains(k)) {
        return Bucket::Library;
    }
    
    // 4. Performance
    let perf_markers = ["rocketman", "performance optimizer", "runtimegc", "performance fish", "adaptive storage framework"];
    if perf_markers.iter().any(|&k| id_lower.contains(k) || name_lower.contains(k)) {
        return Bucket::Performance;
    }

    // 5. Animation
    if name_lower.contains("animation") || name_lower.contains("facial") || name_lower.contains("pose") {
        return Bucket::Animation;
    }

    // 6. UI
    let ui_markers = ["ui", "interface", "hud", "menu", "tab", "mood bar", "inventory"];
    if ui_markers.iter().any(|&k| name_lower.contains(k) || id_lower.contains(k)) {
        return Bucket::Ui;
    }

    // 7. Patch
    let patch_markers = ["patch", "compat", "compatibility", "fix for"];
    if patch_markers.iter().any(|&k| name_lower.contains(k)) {
        return Bucket::Patch;
    }

    // 8. Tags based
    let tags_lower: Vec<String> = m.tags.iter().map(|t| t.to_lowercase()).collect();
    let has_tag = |needle: &str| tags_lower.iter().any(|t| t.contains(needle));

    if has_tag("library") || has_tag("framework") || has_tag("utility") { return Bucket::Library; }
    if has_tag("map generation") || has_tag("biomes") { return Bucket::MapGen; }
    if has_tag("race") || has_tag("species") { return Bucket::Race; }
    if has_tag("total conversion") { return Bucket::TotalConversion; }

    Bucket::General
}

// Fixed DLC order helper
fn dlc_weight(id: &str) -> i32 {
    match id.to_lowercase().as_str() {
        "ludeon.rimworld.royalty" => 1,
        "ludeon.rimworld.ideology" => 2,
        "ludeon.rimworld.biotech" => 3,
        "ludeon.rimworld.anomaly" => 4,
        _ => 99, // Unknown/Mod-based DLC IDs go last
    }
}

pub fn sort_mods(mods: &[ModInfo]) -> Vec<String> {
    let enabled: Vec<&ModInfo> = mods.iter().filter(|m| m.enabled).collect();

    let mut id_lookup: HashMap<String, String> = HashMap::new();
    for m in &enabled {
        id_lookup.insert(m.id.to_lowercase(), m.id.clone());
        id_lookup.insert(normalize_name(&m.name), m.id.clone());
    }

    let mut deps: HashMap<String, Vec<String>> = HashMap::new();
    let mut in_degree: HashMap<String, usize> = enabled.iter().map(|m| (m.id.clone(), 0)).collect();

    let rimpy = load_rimpy_rules();

    for m in &enabled {
        let mut la = m.load_after.clone();
        let mut lb = m.load_before.clone();
        
        if let Some(rule) = rimpy.get(&m.id.to_lowercase()) {
            if let Some(r_la) = &rule.load_after { la.extend(r_la.keys().cloned()); }
            if let Some(r_lb) = &rule.load_before { lb.extend(r_lb.keys().cloned()); }
        }

        for dep in m.dependencies.iter().chain(la.iter()) {
            let dep_key = dep.to_lowercase();
            let norm_key = normalize_name(dep);
            if let Some(dep_id) = id_lookup.get(&dep_key).or_else(|| id_lookup.get(&norm_key)) {
                if dep_id == &m.id { continue; }
                deps.entry(dep_id.clone()).or_default().push(m.id.clone());
                *in_degree.entry(m.id.clone()).or_insert(0) += 1;
            }
        }
        for dep in &lb {
            let dep_key = dep.to_lowercase();
            let norm_key = normalize_name(dep);
            if let Some(dep_id) = id_lookup.get(&dep_key).or_else(|| id_lookup.get(&norm_key)) {
                if dep_id == &m.id { continue; }
                deps.entry(m.id.clone()).or_default().push(dep_id.clone());
                *in_degree.entry(dep_id.clone()).or_insert(0) += 1;
            }
        }
    }

    let bucket_of: HashMap<String, Bucket> = enabled.iter().map(|m| {
        let mut b = classify(m);
        if let Some(rule) = rimpy.get(&m.id.to_lowercase()) {
            if rule.load_bottom.as_ref().and_then(|f| f.value).unwrap_or(false) { b = Bucket::Performance; }
            if rule.load_top.as_ref().and_then(|f| f.value).unwrap_or(false) { b = Bucket::Core; }
        }
        (m.id.clone(), b)
    }).collect();
    let name_of: HashMap<String, String> = enabled.iter().map(|m| (m.id.clone(), m.name.to_lowercase())).collect();
    let order_of: HashMap<String, i32> = enabled.iter().map(|m| (m.id.clone(), m.load_order)).collect();

    let mut ready: Vec<String> = in_degree.iter().filter(|(_, &d)| d == 0).map(|(id, _)| id.clone()).collect();
    let mut result_ids: Vec<String> = Vec::with_capacity(enabled.len());

    while !ready.is_empty() {
        ready.sort_by(|a, b| {
            let ba = bucket_of.get(a).copied().unwrap_or(Bucket::General);
            let bb = bucket_of.get(b).copied().unwrap_or(Bucket::General);
            
            // 1. Bucket priority
            let order_cmp = ba.order().cmp(&bb.order());
            if order_cmp != std::cmp::Ordering::Equal { return order_cmp; }
            
            // 2. Special DLC chronological order
            if ba == Bucket::Dlc && bb == Bucket::Dlc {
                let wa = dlc_weight(a);
                let wb = dlc_weight(b);
                if wa != wb { return wa.cmp(&wb); }
            }
            
            // 3. User original order fallback
            let oa = order_of.get(a).copied().unwrap_or(i32::MAX);
            let ob = order_of.get(b).copied().unwrap_or(i32::MAX);
            let original_order_cmp = oa.cmp(&ob);
            if original_order_cmp != std::cmp::Ordering::Equal { return original_order_cmp; }

            // 4. Alphabetical fallback
            name_of.get(a).cmp(&name_of.get(b))
        });
        
        let pick = ready.remove(0);
        if let Some(children) = deps.get(&pick) {
            for child in children {
                if let Some(d) = in_degree.get_mut(child) {
                    if *d > 0 {
                        *d -= 1;
                        if *d == 0 { ready.push(child.clone()); }
                    }
                }
            }
        }
        result_ids.push(pick);
    }

    if result_ids.len() < enabled.len() {
        let included: HashSet<String> = result_ids.iter().cloned().collect();
        let mut leftover: Vec<&&ModInfo> = enabled.iter().filter(|m| !included.contains(&m.id)).collect();
        leftover.sort_by_key(|m| bucket_of.get(&m.id).copied().unwrap_or(Bucket::General).order());
        for m in leftover { result_ids.push(m.id.clone()); }
    }

    result_ids
}

fn normalize_name(s: &str) -> String {
    s.trim().to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum LoadOrderIssue {
    MissingDependency { mod_id: String, mod_name: String, missing: String },
    Cycle { mod_ids: Vec<String>, mod_names: Vec<String> },
    OutOfOrder { mod_id: String, mod_name: String, current_index: usize, suggested_index: usize },
    Incompatible { mod_id: String, mod_name: String, conflicting_id: String, conflicting_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModPlan {
    pub mod_id: String,
    pub mod_name: String,
    pub suggested_index: usize,
    pub current_index: Option<usize>,
    pub bucket: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadOrderAnalysis {
    pub suggested: Vec<String>,
    pub plan: Vec<ModPlan>,
    pub issues: Vec<LoadOrderIssue>,
}

pub fn analyze(mods: &[ModInfo]) -> LoadOrderAnalysis {
    let suggested = sort_mods(mods);
    let enabled: Vec<&ModInfo> = mods.iter().filter(|m| m.enabled).collect();
    let mut id_lookup: HashMap<String, String> = HashMap::new();
    for m in &enabled {
        id_lookup.insert(m.id.to_lowercase(), m.id.clone());
        id_lookup.insert(normalize_name(&m.name), m.id.clone());
    }

    let mut issues = Vec::new();
    let name_of: HashMap<String, String> = enabled.iter().map(|m| (m.id.clone(), m.name.clone())).collect();
    let rimpy = load_rimpy_rules();

    for m in &enabled {
        for dep in &m.dependencies {
            let dep_key = dep.to_lowercase();
            let norm_key = normalize_name(dep);
            if !id_lookup.contains_key(&dep_key) && !id_lookup.contains_key(&norm_key) {
                issues.push(LoadOrderIssue::MissingDependency {
                    mod_id: m.id.clone(),
                    mod_name: m.name.clone(),
                    missing: dep.clone(),
                });
            }
        }
        
        // Incompatibility detection
        let mut incompats = m.incompatible_with.clone();
        if let Some(rule) = rimpy.get(&m.id.to_lowercase()) {
            if let Some(r_inc) = &rule.incompatible_with {
                incompats.extend(r_inc.keys().cloned());
            }
        }
        for inc in &incompats {
            let inc_key = inc.to_lowercase();
            let norm_key = normalize_name(inc);
            if let Some(inc_id) = id_lookup.get(&inc_key).or_else(|| id_lookup.get(&norm_key)) {
                let inc_name = name_of.get(inc_id).cloned().unwrap_or_else(|| inc_id.clone());
                issues.push(LoadOrderIssue::Incompatible {
                    mod_id: m.id.clone(),
                    mod_name: m.name.clone(),
                    conflicting_id: inc_id.clone(),
                    conflicting_name: inc_name,
                });
            }
        }
    }

    // Cycle detection
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut deps: HashMap<String, Vec<String>> = HashMap::new();

    for m in &enabled {
        in_degree.entry(m.id.clone()).or_insert(0);
        
        let mut la = m.load_after.clone();
        let mut lb = m.load_before.clone();
        if let Some(rule) = rimpy.get(&m.id.to_lowercase()) {
            if let Some(r_la) = &rule.load_after { la.extend(r_la.keys().cloned()); }
            if let Some(r_lb) = &rule.load_before { lb.extend(r_lb.keys().cloned()); }
        }

        for dep in m.dependencies.iter().chain(la.iter()) {
            let dep_key = dep.to_lowercase();
            let norm_key = normalize_name(dep);
            if let Some(dep_id) = id_lookup.get(&dep_key).or_else(|| id_lookup.get(&norm_key)) {
                if dep_id == &m.id { continue; }
                deps.entry(dep_id.clone()).or_default().push(m.id.clone());
                *in_degree.entry(m.id.clone()).or_insert(0) += 1;
            }
        }
        for dep in &lb {
            let dep_key = dep.to_lowercase();
            let norm_key = normalize_name(dep);
            if let Some(dep_id) = id_lookup.get(&dep_key).or_else(|| id_lookup.get(&norm_key)) {
                if dep_id == &m.id { continue; }
                deps.entry(m.id.clone()).or_default().push(dep_id.clone());
                *in_degree.entry(dep_id.clone()).or_insert(0) += 1;
            }
        }
    }

    let mut ready: Vec<String> = in_degree.iter().filter(|(_, &d)| d == 0).map(|(id, _)| id.clone()).collect();
    let mut processed = 0;
    while let Some(pick) = ready.pop() {
        processed += 1;
        if let Some(children) = deps.get(&pick) {
            for child in children {
                if let Some(d) = in_degree.get_mut(child) {
                    if *d > 0 {
                        *d -= 1;
                        if *d == 0 { ready.push(child.clone()); }
                    }
                }
            }
        }
    }
    if processed < in_degree.len() {
        let cycle_nodes: Vec<String> = in_degree.iter()
            .filter(|(_, &d)| d > 0)
            .map(|(id, _)| id.clone())
            .collect();
        let cycle_names: Vec<String> = cycle_nodes.iter()
            .map(|id| name_of.get(id).cloned().unwrap_or_else(|| id.clone()))
            .collect();
        issues.push(LoadOrderIssue::Cycle {
            mod_ids: cycle_nodes,
            mod_names: cycle_names,
        });
    }

    let current_sorted: Vec<&ModInfo> = {
        let mut c = enabled.clone();
        c.sort_by_key(|m| m.load_order);
        c
    };
    let current_index_of: HashMap<String, usize> = current_sorted.iter().enumerate().map(|(i, m)| (m.id.clone(), i)).collect();

    let bucket_of: HashMap<String, Bucket> = enabled.iter().map(|m| {
        let mut b = classify(m);
        if let Some(rule) = rimpy.get(&m.id.to_lowercase()) {
            if rule.load_bottom.as_ref().and_then(|f| f.value).unwrap_or(false) { b = Bucket::Performance; }
            if rule.load_top.as_ref().and_then(|f| f.value).unwrap_or(false) { b = Bucket::Core; }
        }
        (m.id.clone(), b)
    }).collect();

    let plan = suggested.iter().enumerate().map(|(i, id)| {
        let b = bucket_of.get(id).copied().unwrap_or(Bucket::General);
        let cur = current_index_of.get(id).copied();
        if let Some(cur_i) = cur {
            if cur_i != i {
                issues.push(LoadOrderIssue::OutOfOrder {
                    mod_id: id.clone(),
                    mod_name: name_of.get(id).cloned().unwrap_or_else(|| id.clone()),
                    current_index: cur_i,
                    suggested_index: i,
                });
            }
        }
        ModPlan {
            mod_id: id.clone(),
            mod_name: name_of.get(id).cloned().unwrap_or_else(|| id.clone()),
            suggested_index: i,
            current_index: cur,
            bucket: b.label().to_string(),
            reason: format!("Bucket: {}", b.label()),
        }
    }).collect();

    LoadOrderAnalysis { suggested, plan, issues }
}
