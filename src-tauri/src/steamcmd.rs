use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

const RIMWORLD_APP_ID: &str = "294100";
const STEAMCMD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

pub fn steamcmd_dir() -> PathBuf {
    let mut d = crate::paths::config_dir();
    d.push("steamcmd");
    d
}

pub fn steamcmd_exe() -> PathBuf {
    steamcmd_dir().join("steamcmd.exe")
}

pub async fn ensure_installed<F>(on_progress: &mut F) -> Result<PathBuf>
where
    F: FnMut(u8, &str),
{
    let exe = steamcmd_exe();
    if exe.exists() {
        return Ok(exe);
    }

    on_progress(10, "Downloading SteamCMD (first-time setup)...");
    let dir = steamcmd_dir();
    std::fs::create_dir_all(&dir)?;

    let zip_path = dir.join("steamcmd.zip");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()?;
    let resp = client.get(STEAMCMD_URL).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut file = std::fs::File::create(&zip_path)?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        use std::io::Write;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        let pct = if total > 0 {
            10 + ((downloaded as f64 / total as f64) * 8.0) as u8
        } else {
            15
        };
        on_progress(pct.min(18), "Downloading SteamCMD...");
    }
    drop(file);

    on_progress(18, "Extracting SteamCMD...");
    let f = std::fs::File::open(&zip_path)?;
    let mut archive = zip::ZipArchive::new(f)?;
    archive.extract(&dir)?;
    std::fs::remove_file(&zip_path).ok();

    if !exe.exists() {
        return Err(anyhow!("SteamCMD extracted but steamcmd.exe not found"));
    }

    on_progress(20, "SteamCMD ready");
    Ok(exe)
}

pub async fn download_workshop_item<F>(
    workshop_id: &str,
    mut on_progress: F,
) -> Result<PathBuf>
where
    F: FnMut(u8, &str),
{
    let exe = ensure_installed(&mut on_progress).await?;
    let dir = steamcmd_dir();

    let content_dir = dir
        .join("steamapps")
        .join("workshop")
        .join("content")
        .join(RIMWORLD_APP_ID)
        .join(workshop_id);
    if content_dir.exists() {
        std::fs::remove_dir_all(&content_dir).ok();
    }

    on_progress(25, "Connecting to Steam...");

    let args = vec![
        "+@ShutdownOnFailedCommand".to_string(),
        "1".to_string(),
        "+@NoPromptForPassword".to_string(),
        "1".to_string(),
        "+force_install_dir".to_string(),
        dir.to_string_lossy().to_string(),
        "+login".to_string(),
        "anonymous".to_string(),
        "+workshop_download_item".to_string(),
        RIMWORLD_APP_ID.to_string(),
        workshop_id.to_string(),
        "+quit".to_string(),
    ];

    let workshop_id_owned = workshop_id.to_string();
    let content_dir_clone = content_dir.clone();

    let stdout_task = tokio::task::spawn_blocking(move || -> Result<String> {
        use std::io::{BufRead, BufReader};
        let mut cmd = std::process::Command::new(&exe);
        cmd.args(&args)
            .current_dir(&dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().context("Failed to launch SteamCMD")?;
        let mut collected = String::new();

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                collected.push_str(&line);
                collected.push('\n');
            }
        }

        let status = child.wait()?;
        if !status.success() {
            let lower = collected.to_lowercase();
            let hint = if lower.contains("no connection") || lower.contains("failed (no connection)") {
                "\n\n💡 Can't reach Steam servers. Your ISP may be blocking Steam CM servers (common in some regions).\nFix: enable a VPN (Cloudflare WARP is free and works well) and retry."
            } else if lower.contains("invalid password") || lower.contains("rate limit") {
                "\n\n💡 Steam rate-limited this IP. Wait a few minutes and retry, or switch VPN region."
            } else if lower.contains("access denied") || lower.contains("failure") && lower.contains("workshop") {
                "\n\n💡 Steam refused the download. Verify the Workshop ID is correct and the mod is public."
            } else {
                ""
            };
            return Err(anyhow!(
                "SteamCMD exited with code {}.{}\n\n--- Output (last 40 lines) ---\n{}",
                status.code().unwrap_or(-1),
                hint,
                tail(&collected, 40)
            ));
        }
        Ok(collected)
    });

    on_progress(45, "SteamCMD downloading...");

    let output = stdout_task
        .await
        .context("SteamCMD thread panicked")??;

    if !content_dir_clone.exists() {
        return Err(anyhow!(
            "SteamCMD finished but mod folder not found (expected at {}).\n--- Output ---\n{}",
            content_dir_clone.display(),
            tail(&output, 30)
        ));
    }

    on_progress(75, &format!("Downloaded mod #{}", workshop_id_owned));
    Ok(content_dir)
}

fn tail(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

pub enum BatchEvent {
    Line(String),
    ItemDone(String),
    ItemFailed(String, String),
}

/// Batch download multiple workshop items in a single SteamCMD invocation.
/// One login + one session — much faster than spawning per-mod.
/// Returns a map of mod_id → Result<content_dir_path, error_message>.
pub async fn download_workshop_items_batch<F>(
    ids: &[String],
    mut on_event: F,
) -> Result<HashMap<String, std::result::Result<PathBuf, String>>>
where
    F: FnMut(BatchEvent) + Send + 'static,
{
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Dummy progress closure for ensure_installed (it only runs on first use).
    let mut noop = |_p: u8, _m: &str| {};
    let exe = ensure_installed(&mut noop).await?;
    let dir = steamcmd_dir();

    // Wipe cached content folders so we get fresh copies + can detect success by existence.
    let ids_owned: Vec<String> = ids.to_vec();
    for id in &ids_owned {
        let content_dir = dir
            .join("steamapps")
            .join("workshop")
            .join("content")
            .join(RIMWORLD_APP_ID)
            .join(id);
        if content_dir.exists() {
            std::fs::remove_dir_all(&content_dir).ok();
        }
    }

    // NOTE: ShutdownOnFailedCommand=0 so one failure doesn't abort remaining items.
    let mut args: Vec<String> = vec![
        "+@ShutdownOnFailedCommand".into(),
        "0".into(),
        "+@NoPromptForPassword".into(),
        "1".into(),
        "+force_install_dir".into(),
        dir.to_string_lossy().to_string(),
        "+login".into(),
        "anonymous".into(),
    ];
    for id in &ids_owned {
        args.push("+workshop_download_item".into());
        args.push(RIMWORLD_APP_ID.into());
        args.push(id.clone());
    }
    args.push("+quit".into());

    let dir_clone = dir.clone();
    let ids_for_task = ids_owned.clone();

    let output = tokio::task::spawn_blocking(move || -> Result<String> {
        use std::io::{BufRead, BufReader};
        let mut cmd = std::process::Command::new(&exe);
        cmd.args(&args)
            .current_dir(&dir_clone)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().context("Failed to launch SteamCMD")?;
        let mut collected = String::new();

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                // Per-item success: "Success. Downloaded item 1234 to \"...\" (... bytes)"
                if let Some(id) = parse_success_line(&line, &ids_for_task) {
                    on_event(BatchEvent::ItemDone(id));
                } else if let Some((id, reason)) = parse_failure_line(&line, &ids_for_task) {
                    on_event(BatchEvent::ItemFailed(id, reason));
                } else {
                    on_event(BatchEvent::Line(line.clone()));
                }
                collected.push_str(&line);
                collected.push('\n');
            }
        }

        let _ = child.wait()?;
        Ok(collected)
    })
    .await
    .context("SteamCMD thread panicked")??;

    // Final reconciliation: check each content dir. This is the source of truth —
    // stdout parsing can miss lines with different phrasing.
    let mut out: HashMap<String, std::result::Result<PathBuf, String>> = HashMap::new();
    for id in &ids_owned {
        let content_dir = dir
            .join("steamapps")
            .join("workshop")
            .join("content")
            .join(RIMWORLD_APP_ID)
            .join(id);
        if content_dir.exists() {
            out.insert(id.clone(), Ok(content_dir));
        } else {
            let reason = extract_item_error(&output, id)
                .unwrap_or_else(|| "SteamCMD did not produce mod folder".to_string());
            out.insert(id.clone(), Err(reason));
        }
    }
    Ok(out)
}

fn parse_success_line(line: &str, ids: &[String]) -> Option<String> {
    // Matches "Success. Downloaded item <id>" variants
    let l = line.to_lowercase();
    if !l.contains("success") || !l.contains("downloaded item") {
        return None;
    }
    for id in ids {
        if line.contains(id) {
            return Some(id.clone());
        }
    }
    None
}

fn parse_failure_line(line: &str, ids: &[String]) -> Option<(String, String)> {
    let l = line.to_lowercase();
    if !(l.contains("error") && l.contains("download item")) {
        return None;
    }
    for id in ids {
        if line.contains(id) {
            return Some((id.clone(), line.trim().to_string()));
        }
    }
    None
}

fn extract_item_error(output: &str, id: &str) -> Option<String> {
    for line in output.lines() {
        if line.contains(id) && line.to_lowercase().contains("error") {
            return Some(line.trim().to_string());
        }
    }
    None
}


