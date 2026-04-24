use crate::paths::config_dir;
use anyhow::{Context, Result};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BACKUPS: usize = 5;

#[derive(Debug, Clone, Serialize)]
pub struct DlcBackup {
    pub name: String,
    pub path: String,
    pub timestamp_ms: u128,
    pub size_bytes: u64,
    pub enabled_count: usize,
}

fn backup_dir() -> PathBuf {
    let d = config_dir().join("backups");
    let _ = fs::create_dir_all(&d);
    d
}

/// Snapshot the current ModsConfig.xml before overwriting. Deduped: if the
/// latest backup is byte-identical to the current file, this is a no-op.
/// Keeps at most MAX_BACKUPS snapshots.
pub fn snapshot(dlc_path: &Path) -> Result<()> {
    if !dlc_path.exists() {
        return Ok(());
    }
    let current = fs::read(dlc_path)?;
    let dir = backup_dir();

    let entries = list_entries(&dir)?;
    if let Some((latest_path, _)) = entries.first() {
        if let Ok(prev) = fs::read(latest_path) {
            if prev == current {
                return Ok(());
            }
        }
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = dir.join(format!("dlc_load_{}.json", ts));
    fs::write(&target, &current)?;

    prune(&dir)?;
    Ok(())
}

fn list_entries(dir: &Path) -> Result<Vec<(PathBuf, u128)>> {
    let mut out: Vec<(PathBuf, u128)> = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for e in fs::read_dir(dir)? {
        let e = e?;
        let p = e.path();
        let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(ts_str) = stem.strip_prefix("dlc_load_") else {
            continue;
        };
        let Ok(ts) = ts_str.parse::<u128>() else {
            continue;
        };
        out.push((p, ts));
    }
    out.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(out)
}

fn prune(dir: &Path) -> Result<()> {
    let entries = list_entries(dir)?;
    for (p, _) in entries.into_iter().skip(MAX_BACKUPS) {
        let _ = fs::remove_file(&p);
    }
    Ok(())
}

pub fn list() -> Result<Vec<DlcBackup>> {
    let dir = backup_dir();
    let entries = list_entries(&dir)?;
    let mut out = Vec::new();
    for (path, ts) in entries {
        let meta = fs::metadata(&path).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let enabled_count = fs::read_to_string(&path)
            .ok()
            .and_then(|txt| serde_json::from_str::<serde_json::Value>(&txt).ok())
            .and_then(|v| v.get("enabled_mods").cloned())
            .and_then(|v| v.as_array().map(|a| a.len()))
            .unwrap_or(0);
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        out.push(DlcBackup {
            name,
            path: path.to_string_lossy().into_owned(),
            timestamp_ms: ts,
            size_bytes: size,
            enabled_count,
        });
    }
    Ok(out)
}

pub fn restore(name: &str, dlc_path: &Path) -> Result<()> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        anyhow::bail!("invalid backup name");
    }
    let src = backup_dir().join(name);
    if !src.exists() {
        anyhow::bail!("backup not found");
    }
    // Snapshot the current state before restore so the user can undo the undo.
    snapshot(dlc_path).ok();
    let data = fs::read(&src).with_context(|| format!("read {}", src.display()))?;
    fs::write(dlc_path, data).with_context(|| format!("write {}", dlc_path.display()))?;
    Ok(())
}

