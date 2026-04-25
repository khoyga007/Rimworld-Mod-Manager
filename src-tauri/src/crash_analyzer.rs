use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Parsed representation of a RimWorld Player.log / crash dump.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CrashReport {
    pub log_path: String,
    pub log_excerpt: String,
    pub exception_count: usize,
    pub exceptions: Vec<ExceptionBlock>,
    pub suspects: Vec<ModSuspect>,
    pub mods_mentioned: Vec<String>,
    pub harmony_patches: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExceptionBlock {
    pub header: String,
    pub stacktrace: String,
    pub hits: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModSuspect {
    pub mod_id: String,
    pub mod_name: String,
    pub confidence: u8, // 0..100
    pub reason: String,
    pub hit_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledModRef {
    pub id: String,
    pub name: String,
    pub package_id: Option<String>,
    pub author: Option<String>,
}

/// Auto-detect the Player.log path across Windows / Linux / macOS.
pub fn default_player_log() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(up) = std::env::var("USERPROFILE") {
            let p = PathBuf::from(up)
                .join("AppData")
                .join("LocalLow")
                .join("Ludeon Studios")
                .join("RimWorld by Ludeon Studios")
                .join("Player.log");
            if p.exists() { return Some(p); }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            let p = home
                .join(".config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Player.log");
            if p.exists() { return Some(p); }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let p = home
                .join("Library/Logs/Ludeon Studios/RimWorld by Ludeon Studios/Player.log");
            if p.exists() { return Some(p); }
        }
    }
    None
}

/// Read a log file safely. Tail last ~600 KB to bound memory.
pub fn read_log_tail(path: &Path, max_bytes: usize) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let start = bytes.len().saturating_sub(max_bytes);
    let slice = &bytes[start..];
    Ok(String::from_utf8_lossy(slice).into_owned())
}

/// Full analyze: takes raw log text + installed mod refs, returns CrashReport.
pub fn analyze(log_path: &str, log_text: &str, installed: &[InstalledModRef]) -> CrashReport {
    let exceptions = extract_exceptions(log_text);
    let harmony_patches = extract_harmony_patches(log_text);
    let mods_mentioned = extract_mod_refs(log_text);

    // Score installed mods based on how often their name / id / author appear
    // in exception stacktraces or harmony lines.
    let suspects = score_suspects(&exceptions, &harmony_patches, &mods_mentioned, installed);

    // Build excerpt: last 200 lines or all exception blocks concatenated
    let excerpt = build_excerpt(log_text, &exceptions);

    CrashReport {
        log_path: log_path.to_string(),
        log_excerpt: excerpt,
        exception_count: exceptions.iter().map(|e| e.hits).sum(),
        exceptions,
        suspects,
        mods_mentioned,
        harmony_patches,
    }
}

fn build_excerpt(log_text: &str, exceptions: &[ExceptionBlock]) -> String {
    if !exceptions.is_empty() {
        let mut parts: Vec<String> = exceptions
            .iter()
            .take(5)
            .map(|e| format!("{}\n{}", e.header, e.stacktrace))
            .collect();
        let joined = parts.join("\n---\n");
        if joined.len() > 8000 {
            parts.clear();
            parts.push(joined.chars().take(8000).collect());
            return parts.remove(0);
        }
        return joined;
    }
    // fallback: last 100 lines
    let lines: Vec<&str> = log_text.lines().collect();
    let start = lines.len().saturating_sub(100);
    lines[start..].join("\n")
}

/// Find Exception / Error blocks and their stacktraces.
/// RimWorld / Unity typically emit:
///   Exception in ... : SomeMessage
///     at Namespace.Type.Method () [0x00000] in <xxx>:0
///     at ...
fn extract_exceptions(log_text: &str) -> Vec<ExceptionBlock> {
    let header_re = Regex::new(
        r"(?m)^(?:.*(?:Exception|Error)(?:\s*(?:in|:|during).*)?)$"
    ).unwrap();
    let mut blocks: HashMap<String, ExceptionBlock> = HashMap::new();
    let lines: Vec<&str> = log_text.lines().collect();
    let mut i = 0usize;
    while i < lines.len() {
        let line = lines[i];
        // Heuristic: header line must contain "Exception" or "Error" word and
        // not look like a simple info log.
        let low = line.to_lowercase();
        let looks_like_header = (low.contains("exception") || low.contains("error"))
            && !low.starts_with("info")
            && !low.starts_with("debug")
            && !low.contains("no error");
        if !looks_like_header || !header_re.is_match(line) {
            i += 1;
            continue;
        }
        let header = line.trim().to_string();
        // Collect following indented "at ..." stacktrace lines.
        let mut trace_lines: Vec<String> = Vec::new();
        let mut j = i + 1;
        while j < lines.len() {
            let l = lines[j];
            let t = l.trim_start();
            if t.starts_with("at ") || t.starts_with("--- End") || t.starts_with("UnityEngine.") {
                trace_lines.push(l.to_string());
                j += 1;
                if trace_lines.len() > 60 { break; }
            } else {
                break;
            }
        }
        if trace_lines.is_empty() {
            i += 1;
            continue;
        }
        let trace = trace_lines.join("\n");
        let key = format!("{}::{}", header, trace);
        blocks
            .entry(key)
            .and_modify(|b| b.hits += 1)
            .or_insert(ExceptionBlock {
                header,
                stacktrace: trace,
                hits: 1,
            });
        i = j;
    }

    let mut v: Vec<ExceptionBlock> = blocks.into_values().collect();
    v.sort_by(|a, b| b.hits.cmp(&a.hits));
    v.truncate(20);
    v
}

fn extract_harmony_patches(log_text: &str) -> Vec<String> {
    // Harmony prefix/postfix/transpiler frames look like:
    //   (wrapper dynamic-method) ModName.Foo.Bar_Patch0(...)
    //   HarmonyLib.Patches...
    let re = Regex::new(r"(?i)(?:dynamic-method|HarmonyLib|Harmony patch|patched by)[^\n]{0,160}").unwrap();
    let mut out: Vec<String> = re
        .find_iter(log_text)
        .map(|m| m.as_str().trim().to_string())
        .collect();
    out.sort();
    out.dedup();
    out.truncate(40);
    out
}

fn extract_mod_refs(log_text: &str) -> Vec<String> {
    // RimWorld mod messages often look like "[ModName] ..." or
    // "Mod ModName (author.package): ...".
    let bracket_re = Regex::new(r"\[([A-Za-z0-9 _\.'\-]{3,60})\]").unwrap();
    let mod_re = Regex::new(r"(?i)Mod\s+([A-Za-z0-9 _\.'\-]{3,60})\s*\(").unwrap();

    let mut refs: HashMap<String, usize> = HashMap::new();
    for cap in bracket_re.captures_iter(log_text) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().trim().to_string();
            if name.len() < 3 { continue; }
            // Filter noise tags like [Info], [Warning], common unity tags.
            let low = name.to_lowercase();
            if matches!(low.as_str(), "info" | "warning" | "error" | "debug" | "log" | "exception") {
                continue;
            }
            *refs.entry(name).or_insert(0) += 1;
        }
    }
    for cap in mod_re.captures_iter(log_text) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().trim().to_string();
            *refs.entry(name).or_insert(0) += 1;
        }
    }
    let mut list: Vec<(String, usize)> = refs.into_iter().collect();
    list.sort_by(|a, b| b.1.cmp(&a.1));
    list.into_iter().map(|(k, _)| k).take(50).collect()
}

fn score_suspects(
    exceptions: &[ExceptionBlock],
    harmony_patches: &[String],
    mods_mentioned: &[String],
    installed: &[InstalledModRef],
) -> Vec<ModSuspect> {
    let mut trace_blob = String::new();
    for e in exceptions {
        trace_blob.push_str(&e.stacktrace);
        trace_blob.push('\n');
    }
    let trace_lower = trace_blob.to_lowercase();
    let harmony_blob = harmony_patches.join("\n").to_lowercase();
    let mentioned_lower: Vec<String> = mods_mentioned.iter().map(|m| m.to_lowercase()).collect();

    let mut out: Vec<ModSuspect> = Vec::new();

    for m in installed {
        let name_l = m.name.to_lowercase();
        let id_l = m.id.to_lowercase();
        let pkg_l = m.package_id.as_deref().unwrap_or("").to_lowercase();

        let mut hits = 0usize;
        let mut reasons: Vec<String> = Vec::new();

        // Strong signal: package_id appears in stacktrace namespace
        if !pkg_l.is_empty() {
            let parts: Vec<&str> = pkg_l.split('.').collect();
            // Most mods namespace their code under <Author> or <ModRoot>. Match the
            // longer second segment if present, else the whole thing.
            let needle = if parts.len() >= 2 { parts[1..].join(".") } else { pkg_l.clone() };
            if !needle.is_empty() && trace_lower.contains(&needle) {
                hits += 5;
                reasons.push(format!("stacktrace references {}", needle));
            }
        }
        // Mod name token match in stacktrace (ignore very short names < 4 chars)
        if name_l.len() >= 4 {
            let sanitized: String = name_l.chars().filter(|c| c.is_alphanumeric()).collect();
            if !sanitized.is_empty() {
                let mut frames = 0usize;
                let blob_tokens: String = trace_lower.chars().filter(|c| c.is_alphanumeric()).collect();
                // count occurrences (rough)
                let mut idx = 0usize;
                while let Some(found) = blob_tokens[idx..].find(&sanitized) {
                    frames += 1;
                    idx += found + sanitized.len();
                    if frames > 20 { break; }
                }
                if frames > 0 {
                    hits += frames.min(10) * 2;
                    reasons.push(format!("{} stacktrace frames match '{}'", frames, m.name));
                }
            }
        }
        // Harmony patch references
        if !id_l.is_empty() && harmony_blob.contains(&id_l) {
            hits += 3;
            reasons.push("referenced in a Harmony patch".to_string());
        }
        // Mentioned in bracket tags
        if mentioned_lower.iter().any(|m| m == &name_l || (name_l.len() >= 4 && m.contains(&name_l))) {
            hits += 2;
            reasons.push("tagged in a log line".to_string());
        }

        if hits == 0 { continue; }
        let confidence = ((hits as f32 / 15.0) * 100.0).min(98.0) as u8;
        out.push(ModSuspect {
            mod_id: m.id.clone(),
            mod_name: m.name.clone(),
            confidence,
            reason: reasons.join("; "),
            hit_count: hits,
        });
    }

    out.sort_by(|a, b| b.hit_count.cmp(&a.hit_count));
    out.truncate(15);
    out
}
