use crate::about::ModAbout;
use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

const STELLARIS_APP_ID: &str = "294100";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopMeta {
    pub title: String,
    pub description: Option<String>,
    pub preview_url: Option<String>,
    pub time_updated: Option<i64>,
    pub tags: Vec<String>,
    pub file_size: Option<u64>,
}

pub async fn fetch_collection_items(collection_id: &str) -> Result<Vec<String>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("RimWorldModManager/0.1")
        .build()?;

    let form = [
        ("collectioncount", "1"),
        ("publishedfileids[0]", collection_id),
    ];
    let res: serde_json::Value = client
        .post("https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/")
        .form(&form)
        .send()
        .await?
        .json()
        .await?;

    let items = res
        .get("response")
        .and_then(|r| r.get("collectiondetails"))
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("children"))
        .and_then(|c| c.as_array())
        .ok_or_else(|| anyhow!("Collection not found or empty"))?;

    Ok(items
        .iter()
        .filter_map(|v| v.get("publishedfileid").and_then(|x| x.as_str()).map(String::from))
        .collect())
}

pub async fn fetch_metas(ids: &[String]) -> Result<Vec<(String, WorkshopMeta)>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("RimWorldModManager/0.1")
        .build()?;

    let mut form: Vec<(String, String)> = Vec::with_capacity(ids.len() + 1);
    form.push(("itemcount".to_string(), ids.len().to_string()));
    for (i, id) in ids.iter().enumerate() {
        form.push((format!("publishedfileids[{}]", i), id.clone()));
    }

    let res = client
        .post("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/")
        .form(&form)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let arr = res
        .get("response")
        .and_then(|r| r.get("publishedfiledetails"))
        .and_then(|p| p.as_array())
        .ok_or_else(|| anyhow!("Workshop API returned no details"))?;

    let mut out = Vec::new();
    for v in arr {
        let id = match v.get("publishedfileid").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let title = v.get("title").and_then(|x| x.as_str()).unwrap_or("Workshop Mod").to_string();
        let description = v.get("description").and_then(|x| x.as_str()).map(String::from);
        let preview_url = v.get("preview_url").and_then(|x| x.as_str()).map(String::from);
        let time_updated = v.get("time_updated").and_then(|x| x.as_i64());
        let file_size = v.get("file_size").and_then(|x| x.as_str().and_then(|s| s.parse().ok()).or_else(|| x.as_u64()));
        let tags = v.get("tags").and_then(|t| t.as_array()).map(|a| {
            a.iter().filter_map(|v| v.get("tag").and_then(|t| t.as_str()).map(String::from)).collect()
        }).unwrap_or_default();
        out.push((id, WorkshopMeta { title, description, preview_url, time_updated, tags, file_size }));
    }
    Ok(out)
}

pub async fn fetch_meta(workshop_id: &str) -> Result<WorkshopMeta> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("RimWorldModManager/0.1")
        .build()?;

    let form = [("itemcount", "1"), ("publishedfileids[0]", workshop_id)];
    let res = client
        .post("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/")
        .form(&form)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let details = res
        .get("response")
        .and_then(|r| r.get("publishedfiledetails"))
        .and_then(|p| p.get(0))
        .ok_or_else(|| anyhow!("Workshop API returned no details"))?;

    let title = details
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Workshop Mod")
        .to_string();

    let description = details.get("description").and_then(|v| v.as_str()).map(String::from);
    let preview_url = details.get("preview_url").and_then(|v| v.as_str()).map(String::from);
    let time_updated = details.get("time_updated").and_then(|v| v.as_i64());
    let file_size = details
        .get("file_size")
        .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64()));

    let tags = details
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.get("tag").and_then(|t| t.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    Ok(WorkshopMeta {
        title,
        description,
        preview_url,
        time_updated,
        tags,
        file_size,
    })
}

pub struct DownloadResult {
    pub staging_folder: PathBuf,
    pub about: ModAbout,
}

pub async fn download<F>(
    workshop_id: &str,
    staging_root: &Path,
    mut on_progress: F,
) -> Result<DownloadResult>
where
    F: FnMut(u8, &str) + Send,
{
    on_progress(3, "Fetching Workshop metadata...");
    let meta = fetch_meta(workshop_id)
        .await
        .context("Could not query Steam Workshop API")?;

    // --- Try SteamCMD first (most reliable) ---
    on_progress(8, "Trying SteamCMD (anonymous)...");
    let steamcmd_err = match crate::steamcmd::download_workshop_item(workshop_id, |p, m| on_progress(p, m)).await {
        Ok(folder) => {
            on_progress(90, "Reading about...");
            let about = build_about(&folder, &meta, workshop_id);
            return Ok(DownloadResult {
                staging_folder: folder,
                about,
            });
        }
        Err(e) => {
            let msg = e.to_string();
            on_progress(12, &format!("SteamCMD failed, falling back: {}", truncate(&msg, 120)));
            msg
        }
    };

    // --- Fallback to web mirrors ---
    let staging_folder = staging_root.join(format!("dl_{}", workshop_id));
    if staging_folder.exists() {
        std::fs::remove_dir_all(&staging_folder).ok();
    }
    std::fs::create_dir_all(&staging_folder)?;

    let zip_path = staging_root.join(format!("dl_{}.zip", workshop_id));
    if zip_path.exists() {
        std::fs::remove_file(&zip_path).ok();
    }

    if let Err(e) = try_download_any(workshop_id, &zip_path, &mut on_progress).await {
        return Err(anyhow!(
            "SteamCMD: {}\n\nWeb mirrors: {}",
            steamcmd_err,
            e
        ));
    }

    on_progress(82, "Extracting archive...");
    extract_zip(&zip_path, &staging_folder)?;
    std::fs::remove_file(&zip_path).ok();

    let inner = find_mod_root(&staging_folder)?;

    on_progress(92, "Reading about...");
    let about = build_about(&inner, &meta, workshop_id);

    Ok(DownloadResult {
        staging_folder: inner,
        about,
    })
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n { s.to_string() } else { format!("{}...", &s[..n]) }
}

async fn try_download_any<F>(
    workshop_id: &str,
    zip_path: &Path,
    on_progress: &mut F,
) -> Result<()>
where
    F: FnMut(u8, &str),
{
    let mut errors: Vec<String> = Vec::new();

    on_progress(15, "Trying steamworkshop.download...");
    match provider_steamworkshop_download(workshop_id, zip_path, on_progress).await {
        Ok(()) => return Ok(()),
        Err(e) => errors.push(format!("steamworkshop.download: {e}")),
    }

    on_progress(20, "Trying steamworkshopdownloader.io...");
    for host in ["backend-03-prd", "backend-02-prd", "backend-01-prd", "backend-prd"] {
        match provider_swd_io(host, workshop_id, zip_path, on_progress).await {
            Ok(()) => return Ok(()),
            Err(e) => errors.push(format!("{host}: {e}")),
        }
    }

    on_progress(25, "Trying smods.ru...");
    match provider_smods(workshop_id, zip_path, on_progress).await {
        Ok(()) => return Ok(()),
        Err(e) => errors.push(format!("smods: {e}")),
    }

    Err(anyhow!(
        "All mirrors failed. Workshop downloaders are frequently rate-limited or offline — try again in a minute, or download the .zip manually from steamworkshopdownloader.io and drop it in the mod folder.\n\nDetails: {}",
        errors.join(" | ")
    ))
}

// ---------- Provider 1: steamworkshop.download ----------
async fn provider_steamworkshop_download<F>(
    workshop_id: &str,
    zip_path: &Path,
    on_progress: &mut F,
) -> Result<()>
where
    F: FnMut(u8, &str),
{
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) StellarMM")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()?;

    on_progress(30, "steamworkshop.download: requesting...");
    let form = [("item", workshop_id), ("app", STELLARIS_APP_ID)];
    let html = client
        .post("https://steamworkshop.download/online/steamonline.php")
        .header("Referer", "https://steamworkshop.download/")
        .form(&form)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    let re = Regex::new(r#"href=["'](https?://[^"']+\.zip[^"']*)["']"#).unwrap();
    let url = re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| anyhow!("no download link in response"))?;

    on_progress(40, "Downloading...");
    stream_to_file(&client, &url, zip_path, on_progress).await
}

// ---------- Provider 2: steamworkshopdownloader.io ----------
async fn provider_swd_io<F>(
    host: &str,
    workshop_id: &str,
    zip_path: &Path,
    on_progress: &mut F,
) -> Result<()>
where
    F: FnMut(u8, &str),
{
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent("Mozilla/5.0 StellarMM")
        .build()?;

    let base = format!("https://{}.steamworkshopdownloader.io", host);

    let body = serde_json::json!({
        "publishedFileId": workshop_id.parse::<u64>().unwrap_or(0),
        "collectionId": null,
        "extract": true,
        "hidden": false,
        "direct": false,
        "autodownload": false
    });
    let req_res: serde_json::Value = client
        .post(format!("{}/api/download/request", base))
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let uuid = req_res
        .get("uuid")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("missing uuid"))?
        .to_string();

    for i in 0..60u32 {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let status: serde_json::Value = client
            .post(format!("{}/api/download/status", base))
            .json(&serde_json::json!({ "uuids": [uuid] }))
            .send()
            .await?
            .json()
            .await?;
        let node = status.get(&uuid).cloned().unwrap_or(serde_json::Value::Null);
        let state = node.get("status").and_then(|v| v.as_str()).unwrap_or("");
        on_progress(
            30 + (i % 15) as u8,
            &format!("swd.io preparing: {state}"),
        );
        if state == "prepared" || state == "transmitted" {
            let url = format!("{}/api/download/transmit?uuid={}", base, uuid);
            on_progress(45, "Downloading...");
            return stream_to_file(&client, &url, zip_path, on_progress).await;
        }
        if state == "error" {
            return Err(anyhow!("mirror reported error"));
        }
    }
    Err(anyhow!("swd.io timed out"))
}

// ---------- Provider 3: smods.ru ----------
async fn provider_smods<F>(
    workshop_id: &str,
    zip_path: &Path,
    on_progress: &mut F,
) -> Result<()>
where
    F: FnMut(u8, &str),
{
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .user_agent("Mozilla/5.0 StellarMM")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?;

    let page_url = format!(
        "https://smods.ru/archives/mods/steamcommunity/sharedfiles/filedetails/?id={}",
        workshop_id
    );
    let html = client.get(&page_url).send().await?.text().await?;
    let re = Regex::new(r#"href=["']([^"']+\.zip)["']"#).unwrap();
    let url = re
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| anyhow!("no zip link on smods"))?;

    on_progress(45, "Downloading...");
    stream_to_file(&client, &url, zip_path, on_progress).await
}

// ---------- Shared: stream download ----------
async fn stream_to_file<F>(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    on_progress: &mut F,
) -> Result<()>
where
    F: FnMut(u8, &str),
{
    let resp = client.get(url).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();

    let mut file = std::fs::File::create(path)?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        use std::io::Write;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        let pct = if total > 0 {
            45 + ((downloaded as f64 / total as f64) * 35.0) as u8
        } else {
            55
        };
        on_progress(
            pct.min(80),
            &format!("Downloading... {:.1} MB", downloaded as f64 / 1_048_576.0),
        );
    }
    if downloaded < 256 {
        return Err(anyhow!("downloaded file too small ({} bytes) — mirror likely returned an error page", downloaded));
    }
    Ok(())
}

pub fn extract_zip_public(zip_path: &Path, out_dir: &Path) -> Result<()> {
    extract_zip(zip_path, out_dir)
}

pub fn find_mod_root_public(folder: &Path) -> Result<PathBuf> {
    find_mod_root(folder)
}

fn extract_zip(zip_path: &Path, out_dir: &Path) -> Result<()> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .context("File is not a valid ZIP archive (mirror may have served an error page)")?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let rel = match entry.enclosed_name() {
            Some(p) => {
                if p.to_string_lossy().contains("..") { continue; }
                p.to_owned()
            },
            None => continue,
        };
        let target = out_dir.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&target)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }
    Ok(())
}

fn find_mod_root(folder: &Path) -> Result<PathBuf> {
    if folder.join("About").join("About.xml").exists() {
        return Ok(folder.to_path_buf());
    }
    for entry in std::fs::read_dir(folder)? {
        let entry = entry?;
        let p = entry.path();
        if p.is_dir() && p.join("About").join("About.xml").exists() {
            return Ok(p);
        }
    }
    if has_mod_content(folder) {
        return Ok(folder.to_path_buf());
    }
    for entry in std::fs::read_dir(folder)? {
        let entry = entry?;
        let p = entry.path();
        if p.is_dir() && has_mod_content(&p) {
            return Ok(p);
        }
    }
    let entries: Vec<_> = std::fs::read_dir(folder)?.filter_map(|e| e.ok()).collect();
    if entries.len() == 1 && entries[0].path().is_dir() {
        return Ok(entries[0].path());
    }
    Ok(folder.to_path_buf())
}

fn has_mod_content(p: &Path) -> bool {
    p.join("About").join("About.xml").exists()
}

fn build_about(folder: &Path, meta: &WorkshopMeta, workshop_id: &str) -> crate::about::ModAbout {
    let inner = folder.join("About").join("About.xml");
    let mut d = if inner.exists() {
        let txt = std::fs::read_to_string(&inner).unwrap_or_default();
        crate::about::parse_about(&txt).unwrap_or_default()
    } else {
        crate::about::ModAbout::default()
    };
    if d.name.is_empty() {
        d.name = meta.title.clone();
    }
    d
}


