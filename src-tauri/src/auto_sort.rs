use crate::mods::ModInfo;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Default)]
#[allow(dead_code)]
pub struct RimPyDatabase {
    pub timestamp: Option<i64>,
    pub rules: HashMap<String, RimPyRule>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[allow(dead_code)]
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
#[allow(dead_code)]
pub struct FlagValue {
    pub value: Option<bool>,
}

pub fn load_rimpy_rules() -> HashMap<String, RimPyRule> {
    let path = crate::paths::config_dir().join("communityRules.json");
    if let Ok(txt) = std::fs::read_to_string(path) {
        if let Ok(db) = serde_json::from_str::<RimPyDatabase>(&txt) {
            let mut normalized = HashMap::new();
            for (id, rule) in db.rules {
                normalized.insert(id.to_lowercase(), rule);
            }
            return normalized;
        }
    }
    HashMap::new()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
enum Bucket {
    Harmony,
    Core,
    Dlc,
    Library,
    TotalConversion,
    MapGen,
    Race,
    General,
    Animation,
    Ui,
    Patch,
    Performance,
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

const ANCHOR_ORDER: &[&str] = &[
    "zetrith.prepatcher",
    "brrainz.harmony",
    "ludeon.rimworld",
    "ludeon.rimworld.royalty",
    "ludeon.rimworld.ideology",
    "ludeon.rimworld.biotech",
    "ludeon.rimworld.anomaly",
    "ludeon.rimworld.odyssey",
];

fn enforce_anchor_edges(
    deps: &mut HashMap<String, Vec<String>>,
    in_degree: &mut HashMap<String, usize>,
    id_lookup: &HashMap<String, String>,
) {
    let mut anchor_rank: HashMap<String, usize> = HashMap::new();
    for (i, &id) in ANCHOR_ORDER.iter().enumerate() {
        if let Some(normalized) = id_lookup.get(id) {
            anchor_rank.insert(normalized.clone(), i);
        }
    }

    for (anchor_id, &rank) in &anchor_rank {
        let predecessor = if rank > 0 { ANCHOR_ORDER[rank - 1] } else { "" };
        let allowed_pred_id = id_lookup.get(predecessor).cloned();

        let mut parents_to_prune: Vec<String> = Vec::new();
        for (parent, children) in deps.iter() {
            if children.contains(anchor_id) {
                if Some(parent.clone()) != allowed_pred_id {
                    parents_to_prune.push(parent.clone());
                }
            }
        }
        for parent in parents_to_prune {
            if let Some(children) = deps.get_mut(&parent) {
                children.retain(|c| c != anchor_id);
            }
        }

        let new_in_degree = if rank == 0 {
            0
        } else if let Some(ref pred) = allowed_pred_id {
            if deps.get(pred).map_or(false, |ch| ch.contains(anchor_id)) { 1 } else { 0 }
        } else {
            0
        };
        if let Some(deg) = in_degree.get_mut(anchor_id) {
            *deg = new_in_degree;
        }
    }
}

fn classify(m: &ModInfo) -> Bucket {
    let id_lower = m.id.to_lowercase();
    let name_lower = m.name.to_lowercase();
    if id_lower == "brrainz.harmony" { return Bucket::Harmony; }
    if id_lower == "ludeon.rimworld" { return Bucket::Core; }
    if id_lower.starts_with("ludeon.rimworld.") { return Bucket::Dlc; }
    let lib_markers = ["prepatcher", "fishery", "hugslib", "vanilla expanded framework", "humanoid alien races", "bepinex"];
    if lib_markers.iter().any(|&k| id_lower.contains(k) || name_lower.contains(k)) { return Bucket::Library; }
    let perf_markers = ["performance fish", "rocketman", "performance optimizer", "runtimegc"];
    if perf_markers.iter().any(|&k| id_lower.contains(k) || name_lower.contains(k)) { return Bucket::Performance; }
    if name_lower.contains("animation") || name_lower.contains("facial") { return Bucket::Animation; }
    if name_lower.contains("ui") || name_lower.contains("interface") { return Bucket::Ui; }
    if name_lower.contains("patch") || name_lower.contains("compat") { return Bucket::Patch; }
    let tags: Vec<String> = m.tags.iter().map(|t| t.to_lowercase()).collect();
    if tags.iter().any(|t| t.contains("library") || t.contains("framework")) { return Bucket::Library; }
    if tags.iter().any(|t| t.contains("race")) { return Bucket::Race; }
    Bucket::General
}

fn dlc_weight(id: &str) -> i32 {
    let id_lower = id.to_lowercase();
    if id_lower == "ludeon.rimworld" { return 0; }
    if id_lower.contains("royalty") { return 1; }
    if id_lower.contains("ideology") { return 2; }
    if id_lower.contains("biotech") { return 3; }
    if id_lower.contains("anomaly") { return 4; }
    if id_lower.contains("odyssey") { return 5; }
    99
}

pub fn sort_mods(mods: &[ModInfo]) -> Vec<String> {
    sort_and_analyze(mods).0
}

pub fn sort_and_analyze(mods: &[ModInfo]) -> (Vec<String>, Vec<LoadOrderIssue>) {
    let enabled: Vec<&ModInfo> = mods.iter().filter(|m| {
        m.enabled || m.id.to_lowercase() == "ludeon.rimworld" || m.id.to_lowercase().starts_with("ludeon.rimworld.")
    }).collect();
    let mut id_lookup: HashMap<String, String> = HashMap::new();
    for m in &enabled { id_lookup.insert(m.id.to_lowercase(), m.id.clone()); }
    let name_map: HashMap<String, String> = enabled.iter().map(|m| (m.id.clone(), m.name.clone())).collect();

    let mut deps: HashMap<String, Vec<String>> = HashMap::new();
    let mut in_degree: HashMap<String, usize> = enabled.iter().map(|m| (m.id.clone(), 0)).collect();
    let rimpy = load_rimpy_rules();
    let mut issues: Vec<LoadOrderIssue> = Vec::new();

    for m in &enabled {
        let mut la = m.load_after.clone();
        let mut lb = m.load_before.clone();
        if let Some(rule) = rimpy.get(&m.id.to_lowercase()) {
            if let Some(r_la) = &rule.load_after { la.extend(r_la.keys().cloned()); }
            if let Some(r_lb) = &rule.load_before { lb.extend(r_lb.keys().cloned()); }
        }
        if let Some(pos) = ANCHOR_ORDER.iter().position(|&id| id == m.id.to_lowercase()) {
            if pos > 0 {
                let prev = ANCHOR_ORDER[pos - 1].to_string();
                if id_lookup.contains_key(&prev) { la.push(prev); }
            }
        }

        // Hard dependencies first — emit MissingDependency when target not installed/enabled.
        for d in &m.dependencies {
            match id_lookup.get(&d.package_id.to_lowercase()) {
                Some(dep_id) if dep_id != &m.id => {
                    deps.entry(dep_id.clone()).or_default().push(m.id.clone());
                    *in_degree.entry(m.id.clone()).or_insert(0) += 1;
                }
                None => {
                    issues.push(LoadOrderIssue::MissingDependency {
                        mod_id: m.id.clone(),
                        mod_name: m.name.clone(),
                        missing: d.package_id.clone(),
                    });
                }
                _ => {}
            }
        }
        // Soft loadAfter edges (no missing-dep issue — these are hints).
        for dep in &la {
            if let Some(dep_id) = id_lookup.get(&dep.to_lowercase()) {
                if dep_id != &m.id {
                    deps.entry(dep_id.clone()).or_default().push(m.id.clone());
                    *in_degree.entry(m.id.clone()).or_insert(0) += 1;
                }
            }
        }
        for dep in &lb {
            if let Some(dep_id) = id_lookup.get(&dep.to_lowercase()) {
                if dep_id != &m.id {
                    deps.entry(m.id.clone()).or_default().push(dep_id.clone());
                    *in_degree.entry(dep_id.clone()).or_insert(0) += 1;
                }
            }
        }
    }

    // Incompatibility pairs from rimpy rules (dedupe by sorted pair).
    let mut seen_incompat: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    for m in &enabled {
        if let Some(rule) = rimpy.get(&m.id.to_lowercase()) {
            if let Some(incs) = &rule.incompatible_with {
                for other_key in incs.keys() {
                    if let Some(other_id) = id_lookup.get(&other_key.to_lowercase()) {
                        if other_id == &m.id { continue; }
                        let (a, b) = if m.id <= *other_id { (m.id.clone(), other_id.clone()) } else { (other_id.clone(), m.id.clone()) };
                        if seen_incompat.insert((a.clone(), b.clone())) {
                            issues.push(LoadOrderIssue::Incompatible {
                                mod_id: a.clone(),
                                mod_name: name_map.get(&a).cloned().unwrap_or_else(|| a.clone()),
                                conflicting_id: b.clone(),
                                conflicting_name: name_map.get(&b).cloned().unwrap_or_else(|| b.clone()),
                            });
                        }
                    }
                }
            }
        }
    }

    enforce_anchor_edges(&mut deps, &mut in_degree, &id_lookup);

    // Build bucket map, honoring rimpy loadTop/loadBottom overrides.
    let bucket_of: HashMap<String, Bucket> = enabled.iter().map(|m| {
        let mut b = classify(m);
        if let Some(rule) = rimpy.get(&m.id.to_lowercase()) {
            if rule.load_top.as_ref().and_then(|f| f.value).unwrap_or(false) {
                b = Bucket::Harmony;
            } else if rule.load_bottom.as_ref().and_then(|f| f.value).unwrap_or(false) {
                b = Bucket::Performance;
            }
        }
        (m.id.clone(), b)
    }).collect();
    let name_of: HashMap<String, String> = enabled.iter().map(|m| (m.id.clone(), m.name.to_lowercase())).collect();
    let order_of: HashMap<String, i32> = enabled.iter().map(|m| (m.id.clone(), m.load_order)).collect();

    let mut ready: Vec<String> = in_degree.iter().filter(|(_, &d)| d == 0).map(|(id, _)| id.clone()).collect();
    let mut result = Vec::new();
    while !ready.is_empty() {
        ready.sort_by(|a, b| {
            let ba = bucket_of.get(a).copied().unwrap_or(Bucket::General);
            let bb = bucket_of.get(b).copied().unwrap_or(Bucket::General);
            let order_cmp = ba.order().cmp(&bb.order());
            if order_cmp != std::cmp::Ordering::Equal { return order_cmp; }
            if (ba == Bucket::Dlc || ba == Bucket::Core) && (bb == Bucket::Dlc || bb == Bucket::Core) {
                let wa = dlc_weight(a); let wb = dlc_weight(b); if wa != wb { return wa.cmp(&wb); }
            }
            let oa = order_of.get(a).copied().unwrap_or(i32::MAX);
            let ob = order_of.get(b).copied().unwrap_or(i32::MAX);
            let original_order_cmp = oa.cmp(&ob);
            if original_order_cmp != std::cmp::Ordering::Equal { return original_order_cmp; }
            name_of.get(a).cmp(&name_of.get(b))
        });
        let pick = ready.remove(0);
        if let Some(children) = deps.get(&pick) {
            for child in children {
                if let Some(d) = in_degree.get_mut(child) {
                    if *d > 0 { *d -= 1; if *d == 0 { ready.push(child.clone()); } }
                }
            }
        }
        result.push(pick);
    }

    // Cycle detection: any mod still with in_degree > 0 is stuck in a cycle.
    let mut stuck: Vec<String> = in_degree.iter().filter(|(_, &d)| d > 0).map(|(id, _)| id.clone()).collect();
    if !stuck.is_empty() {
        stuck.sort_by(|a, b| name_of.get(a).cmp(&name_of.get(b)));
        let mod_names: Vec<String> = stuck.iter()
            .map(|id| name_map.get(id).cloned().unwrap_or_else(|| id.clone()))
            .collect();
        issues.push(LoadOrderIssue::Cycle { mod_ids: stuck.clone(), mod_names });
        // Append stuck mods at the end so they still appear in the applied order.
        result.extend(stuck);
    }

    (result, issues)
}

pub fn analyze(mods: &[ModInfo]) -> LoadOrderAnalysis {
    let (suggested, mut issues) = sort_and_analyze(mods);
    let enabled: Vec<&ModInfo> = mods.iter().filter(|m| {
        m.enabled || m.id.to_lowercase() == "ludeon.rimworld" || m.id.to_lowercase().starts_with("ludeon.rimworld.")
    }).collect();
    let name_of: HashMap<String, String> = enabled.iter().map(|m| (m.id.clone(), m.name.clone())).collect();
    let bucket_of: HashMap<String, Bucket> = enabled.iter().map(|m| (m.id.clone(), classify(m))).collect();

    // Only flag OutOfOrder for mods currently in the enabled list (skip mods not in `mods`).
    for (i, id) in suggested.iter().enumerate() {
        if let Some(cur) = mods.iter().position(|m| &m.id == id) {
            if cur != i {
                issues.push(LoadOrderIssue::OutOfOrder {
                    mod_id: id.clone(),
                    mod_name: name_of.get(id).cloned().unwrap_or_else(|| id.clone()),
                    current_index: cur,
                    suggested_index: i,
                });
            }
        }
    }

    let plan = suggested.iter().enumerate().map(|(i, id)| {
        let b = bucket_of.get(id).copied().unwrap_or(Bucket::General);
        let cur = mods.iter().position(|m| &m.id == id);
        ModPlan {
            mod_id: id.clone(),
            mod_name: name_of.get(id).cloned().unwrap_or(id.clone()),
            suggested_index: i,
            current_index: cur,
            bucket: b.label().to_string(),
            reason: format!("Bucket: {}", b.label()),
        }
    }).collect();
    LoadOrderAnalysis { suggested, plan, issues }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModPlan { pub mod_id: String, pub mod_name: String, pub suggested_index: usize, pub current_index: Option<usize>, pub bucket: String, pub reason: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadOrderAnalysis { pub suggested: Vec<String>, pub plan: Vec<ModPlan>, pub issues: Vec<LoadOrderIssue> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum LoadOrderIssue { MissingDependency { mod_id: String, mod_name: String, missing: String }, Cycle { mod_ids: Vec<String>, mod_names: Vec<String> }, OutOfOrder { mod_id: String, mod_name: String, current_index: usize, suggested_index: usize }, Incompatible { mod_id: String, mod_name: String, conflicting_id: String, conflicting_name: String } }
