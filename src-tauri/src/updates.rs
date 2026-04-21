use crate::mods::ModInfo;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStatus {
    pub mod_id: String,
    pub remote_file_id: String,
    pub local_time: i64,
    pub remote_time: i64,
    pub has_update: bool,
    pub title: String,
}

pub async fn check(mods: &[ModInfo]) -> Result<Vec<UpdateStatus>> {
    let workshop_mods: Vec<&ModInfo> = mods
        .iter()
        .filter(|m| m.remote_file_id.is_some())
        .collect();
    if workshop_mods.is_empty() {
        return Ok(vec![]);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    let mut form: Vec<(String, String)> = vec![("itemcount".to_string(), workshop_mods.len().to_string())];
    for (i, m) in workshop_mods.iter().enumerate() {
        form.push((
            format!("publishedfileids[{}]", i),
            m.remote_file_id.clone().unwrap(),
        ));
    }

    let res: serde_json::Value = client
        .post("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/")
        .form(&form)
        .send()
        .await?
        .json()
        .await?;

    let details = res
        .get("response")
        .and_then(|r| r.get("publishedfiledetails"))
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();

    let by_id: HashMap<String, (i64, String)> = details
        .iter()
        .filter_map(|d| {
            let id = d.get("publishedfileid")?.as_str()?.to_string();
            let t = d.get("time_updated")?.as_i64().unwrap_or(0);
            let title = d
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some((id, (t, title)))
        })
        .collect();

    let mut out: Vec<UpdateStatus> = Vec::new();
    for m in &workshop_mods {
        let rid = m.remote_file_id.clone().unwrap();
        let local_time = local_mtime(&m.path);
        let (remote_time, title) = by_id.get(&rid).cloned().unwrap_or((0, m.name.clone()));
        out.push(UpdateStatus {
            mod_id: m.id.clone(),
            remote_file_id: rid,
            local_time,
            remote_time,
            has_update: remote_time > 0 && remote_time > local_time + 60,
            title,
        });
    }
    Ok(out)
}

fn local_mtime(path: &str) -> i64 {
    let p = PathBuf::from(path);
    if !p.exists() {
        return 0;
    }
    let mut newest: SystemTime = SystemTime::UNIX_EPOCH;
    for entry in walkdir::WalkDir::new(&p).into_iter().filter_map(|e| e.ok()) {
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified > newest {
                    newest = modified;
                }
            }
        }
    }
    newest
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

