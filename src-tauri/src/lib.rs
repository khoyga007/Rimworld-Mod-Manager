mod auto_sort;
mod backups;
mod collections;
pub mod about;
mod log_tail;
mod mods;
mod paths;
mod savegame;
mod size_analysis;
mod steam_db;
mod steamcmd;
mod updates;
mod workshop;
mod optimize;

use paths::RimWorldPaths;
use serde::{Deserialize, Serialize};
use base64::Engine as _;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, State};
use tokio::sync::Mutex as TokioMutex;

static DOWNLOAD_LOCK: TokioMutex<()> = TokioMutex::const_new(());
static OPTIMIZE_LOCK: TokioMutex<()> = TokioMutex::const_new(());

struct AppState {
    paths: Mutex<RimWorldPaths>,
    log_tailer: Mutex<Option<log_tail::LogTailer>>,
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    workshop_id: String,
    status: String,
    progress: u8,
    message: String,
    title: Option<String>,
    preview_url: Option<String>,
}

#[derive(Serialize)]
struct AutoUpdateResult {
    checked: usize,
    updated: usize,
    failed: usize,
    skipped: usize,
}

#[tauri::command]
fn detect_paths(state: State<AppState>) -> Result<RimWorldPaths, String> {
    let p = paths::detect().map_err(|e| e.to_string())?;
    paths::ensure_dirs(&p).map_err(|e| e.to_string())?;
    *state.paths.lock().unwrap() = p.clone();
    Ok(p)
}

#[tauri::command]
fn set_user_dir(state: State<AppState>, path: String) -> Result<RimWorldPaths, String> {
    // Actually set_game_dir in RimWorld, but keep the name for frontend compatibility
    paths::save_game_dir(Some(&path)).map_err(|e| e.to_string())?;
    let p = paths::detect().map_err(|e| e.to_string())?;
    paths::ensure_dirs(&p).map_err(|e| e.to_string())?;
    *state.paths.lock().unwrap() = p.clone();
    mods::clear_cache(); // Clear cache so the next list_mods call actually scans
    Ok(p)
}

#[tauri::command]
fn list_mods(state: State<AppState>) -> Result<Vec<mods::ModInfo>, String> {
    let p = state.paths.lock().unwrap().clone();
    mods::list(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_mod_enabled(state: State<AppState>, id: String, enabled: bool) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_enabled(&p, &id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_all_mods_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_all_enabled(&p, enabled).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_load_order(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_order(&p, &ids).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_mod_tags(state: State<AppState>, id: String, tags: Vec<mods::CustomTag>) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_mod_tags(&p, &id, tags).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_mod_note(state: State<AppState>, id: String, note: String) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_mod_note(&p, &id, note).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_mod_workshop_name(state: State<AppState>, id: String, name: String) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_mod_workshop_name(&p, &id, name).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_enabled_set(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_enabled_set(&p, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn nuke_local_mods(state: State<AppState>) -> Result<u32, String> {
    let p = state.paths.lock().unwrap().clone();
    mods::delete_all_local_mods(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_mod(state: State<AppState>, id: String) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::delete_mod(&p, &id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn backup_mod_to_local(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    tauri::async_runtime::spawn_blocking(move || {
        mods::backup_mod_to_local(&p, &id)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn optimize_mod_textures(app: tauri::AppHandle, state: State<'_, AppState>, id: String, format: optimize::CompressionFormat) -> Result<(), String> {
    let _guard = OPTIMIZE_LOCK.try_lock().map_err(|_| "Another optimize/resize/revert is running. Please wait.".to_string())?;

    // Auto-download texconv if needed
    if !optimize::has_texconv() {
        optimize::ensure_texconv().await.map_err(|e| format!("Failed to download texconv.exe: {}", e))?;
    }

    let p = state.paths.lock().unwrap().clone();

    let mod_list = mods::list(&p).map_err(|e| e.to_string())?;
    let target_mod = mod_list.into_iter().find(|m| m.id.eq_ignore_ascii_case(&id))
        .ok_or_else(|| "Mod not found".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        optimize::optimize_mod_textures(app, p, target_mod, format)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn optimize_all_local_mods(app: tauri::AppHandle, state: State<'_, AppState>, format: optimize::CompressionFormat) -> Result<(), String> {
    let _guard = OPTIMIZE_LOCK.try_lock().map_err(|_| "Another optimize/resize/revert is running. Please wait.".to_string())?;

    // Auto-download texconv if needed
    if !optimize::has_texconv() {
        optimize::ensure_texconv().await.map_err(|e| format!("Failed to download texconv.exe: {}", e))?;
    }

    let p = state.paths.lock().unwrap().clone();
    let mod_list = mods::list(&p).map_err(|e| e.to_string())?;
    let local_mods: Vec<_> = mod_list.into_iter().filter(|m| !m.path.contains("workshop")).collect();
    
    if local_mods.is_empty() {
        return Err("No local mods found. Only local (copied) mods can be optimized.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        for m in local_mods {
            let _ = optimize::optimize_mod_textures(app.clone(), p.clone(), m, format);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn revert_all_local_mods(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _guard = OPTIMIZE_LOCK.try_lock().map_err(|_| "Another optimize/resize/revert is running. Please wait.".to_string())?;

    let p = state.paths.lock().unwrap().clone();
    let mod_list = mods::list(&p).map_err(|e| e.to_string())?;
    let local_mods: Vec<_> = mod_list.into_iter().filter(|m| !m.path.contains("workshop")).collect();

    if local_mods.is_empty() {
        return Err("No local mods found.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        for m in local_mods {
            let _ = optimize::revert_mod_textures(app.clone(), p.clone(), m);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn revert_mod_textures(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _guard = OPTIMIZE_LOCK.try_lock().map_err(|_| "Another optimize/resize/revert is running. Please wait.".to_string())?;

    let p = state.paths.lock().unwrap().clone();
    let mod_list = mods::list(&p).map_err(|e| e.to_string())?;
    let target_mod = mod_list.into_iter().find(|m| m.id.eq_ignore_ascii_case(&id))
        .ok_or_else(|| "Mod not found".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        optimize::revert_mod_textures(app, p, target_mod)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn check_texconv() -> bool {
    optimize::has_texconv()
}

#[tauri::command]
async fn download_texconv() -> Result<String, String> {
    let path = optimize::ensure_texconv().await.map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn resize_mod_textures(app: tauri::AppHandle, state: State<'_, AppState>, id: String, max_res: u32, format: optimize::CompressionFormat) -> Result<(), String> {
    let _guard = OPTIMIZE_LOCK.try_lock().map_err(|_| "Another optimize/resize/revert is running. Please wait.".to_string())?;

    if !optimize::has_texconv() {
        optimize::ensure_texconv().await.map_err(|e| format!("Failed to download texconv.exe: {}", e))?;
    }

    let p = state.paths.lock().unwrap().clone();
    let mod_list = mods::list(&p).map_err(|e| e.to_string())?;
    let target_mod = mod_list.into_iter().find(|m| m.id.eq_ignore_ascii_case(&id))
        .ok_or_else(|| "Mod not found".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        optimize::resize_mod_textures(app, p, target_mod, max_res, format)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn resize_all_local_mods(app: tauri::AppHandle, state: State<'_, AppState>, max_res: u32, format: optimize::CompressionFormat) -> Result<(), String> {
    let _guard = OPTIMIZE_LOCK.try_lock().map_err(|_| "Another optimize/resize/revert is running. Please wait.".to_string())?;

    if !optimize::has_texconv() {
        optimize::ensure_texconv().await.map_err(|e| format!("Failed to download texconv.exe: {}", e))?;
    }

    let p = state.paths.lock().unwrap().clone();
    let mod_list = mods::list(&p).map_err(|e| e.to_string())?;
    let local_mods: Vec<_> = mod_list.into_iter().filter(|m| !m.path.contains("workshop")).collect();

    if local_mods.is_empty() {
        return Err("No local mods found. Only local (copied) mods can be resized.".to_string());
    }

    let join_result = tauri::async_runtime::spawn_blocking(move || {
        for m in local_mods {
            let _ = optimize::resize_mod_textures(app.clone(), p.clone(), m, max_res, format);
        }
        Ok::<(), anyhow::Error>(())
    })
    .await;

    join_result.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    Ok(())
}


#[derive(Serialize)]
struct LogPayload {
    path: String,
    content: String,
}

#[tauri::command]
fn read_rimworld_log() -> Result<LogPayload, String> {
    // Keep name read_stellaris_log for frontend compatibility
    let locallow_str = std::env::var("USERPROFILE").unwrap_or_default();
    let path_buf = PathBuf::from(locallow_str).join("AppData").join("LocalLow").join("Ludeon Studios").join("RimWorld by Ludeon Studios").join("Player.log");
    let content = if path_buf.exists() {
        std::fs::read_to_string(&path_buf).unwrap_or_default()
    } else {
        String::new()
    };
    let tail: String = content
        .lines()
        .rev()
        .take(2000)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    Ok(LogPayload {
        path: path_buf.to_string_lossy().into_owned(),
        content: tail,
    })
}

#[tauri::command]
fn start_log_tail(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    let locallow_str = std::env::var("USERPROFILE").unwrap_or_default();
    let log = PathBuf::from(locallow_str).join("AppData").join("LocalLow").join("Ludeon Studios").join("RimWorld by Ludeon Studios").join("Player.log");
    let mut guard = state.log_tailer.lock().unwrap();
    if let Some(t) = guard.as_ref() {
        t.stop();
    }
    let tailer = log_tail::LogTailer::new();
    tailer.start(app, log);
    *guard = Some(tailer);
    Ok(())
}

#[tauri::command]
fn stop_log_tail(state: State<AppState>) -> Result<(), String> {
    let guard = state.log_tailer.lock().unwrap();
    if let Some(t) = guard.as_ref() {
        t.stop();
    }
    Ok(())
}

#[tauri::command]
fn get_stored_exe_path() -> Result<Option<String>, String> {
    let file = paths::config_dir().join("exe.txt");
    if !file.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&file)
        .map(|s| Some(s.trim().to_string()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_stored_exe_path(path: String) -> Result<(), String> {
    let file = paths::config_dir().join("exe.txt");
    std::fs::write(&file, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_mods_config_backups() -> Result<Vec<backups::DlcBackup>, String> {
    backups::list().map_err(|e| e.to_string())
}

#[tauri::command]
fn restore_mods_config_backup(state: State<AppState>, name: String) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    let path = std::path::PathBuf::from(&p.mods_config_path);
    backups::restore(&name, &path).map_err(|e| e.to_string())?;
    mods::clear_cache();
    Ok(())
}

#[tauri::command]
fn open_path_or_url(target: String) -> Result<(), String> {
    open::that_detached(&target).map_err(|e| format!("Failed to open {}: {}", target, e))
}

#[tauri::command]
async fn analyze_mod_sizes(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<std::collections::HashMap<String, size_analysis::SizeBreakdown>, String> {
    let p = state.paths.lock().unwrap().clone();
    let mod_list = mods::list(&p).map_err(|e| e.to_string())?;
    let pairs: Vec<(String, String)> = mod_list.into_iter().map(|m| (m.id, m.path)).collect();
    tauri::async_runtime::spawn_blocking(move || {
        size_analysis::analyze_many(pairs, force.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn launch_rimworld() -> Result<(), String> {
    let file = paths::config_dir().join("exe.txt");
    let exe = std::fs::read_to_string(&file)
        .map_err(|_| "Set RimWorld executable path in Settings first.".to_string())?
        .trim()
        .to_string();
    if exe.is_empty() {
        return Err("No executable configured".to_string());
    }
    let exe_path = PathBuf::from(&exe);
    let dir = exe_path.parent().map(|p| p.to_path_buf());
    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&exe_path);
        if let Some(d) = dir {
            cmd.current_dir(d);
        }
        let _ = cmd.spawn();
    });
    Ok(())
}

#[tauri::command]
async fn install_from_zip(
    state: State<'_, AppState>,
    zip_path: String,
    workshop_id: Option<String>,
) -> Result<String, String> {
    let paths = state.paths.lock().unwrap().clone();
    let zip_path_buf = PathBuf::from(&zip_path);
    if !zip_path_buf.exists() {
        return Err("Zip file not found".to_string());
    }

    let staging = paths::config_dir()
        .join("staging")
        .join(format!("import_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    workshop::extract_zip_public(&zip_path_buf, &staging).map_err(|e| e.to_string())?;
    let inner = workshop::find_mod_root_public(&staging).map_err(|e| e.to_string())?;

    let id = workshop_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            let name = zip_path_buf
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("imported")
                .to_string();
            let digits: String = name.chars().filter(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() {
                format!("local_{}", std::process::id())
            } else {
                digits
            }
        });

    let inner_desc_path = inner.join("About").join("About.xml");
    let desc = if inner_desc_path.exists() {
        let txt = std::fs::read_to_string(&inner_desc_path).unwrap_or_default();
        about::parse_about(&txt).unwrap_or_default()
    } else {
        about::ModAbout::default()
    };

    let mod_id = mods::install_from_folder(&paths, &inner, &id, &desc).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&staging);
    Ok(mod_id)
}

#[tauri::command]
fn open_workshop_downloader(workshop_id: String) -> Result<(), String> {
    let url = format!(
        "https://steamworkshopdownloader.io/download/{}/{}",
        "294100", workshop_id
    );
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_collection(collection_id: String) -> Result<Vec<String>, String> {
    workshop::fetch_collection_items(&collection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn download_workshop_mod(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workshop_id: String,
) -> Result<(), String> {
    let paths_cloned = state.paths.lock().unwrap().clone();
    let id = workshop_id.clone();
    let id_for_task = workshop_id.clone();

    let emit_queued = |app: &tauri::AppHandle, status: &str, pct: u8, msg: &str, title: Option<String>, preview: Option<String>| {
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                workshop_id: id.clone(),
                status: status.to_string(),
                progress: pct,
                message: msg.to_string(),
                title,
                preview_url: preview,
            },
        );
    };

    emit_queued(&app, "queued", 0, "Queued", None, None);

    tauri::async_runtime::spawn(async move {
        let app_h = app.clone();
        let _guard = DOWNLOAD_LOCK.lock().await;
        let _ = app_h.emit(
            "download-progress",
            DownloadProgress {
                workshop_id: id_for_task.clone(),
                status: "downloading".to_string(),
                progress: 1,
                message: "Starting...".to_string(),
                title: None,
                preview_url: None,
            },
        );
        let staging = paths::config_dir().join("staging");
        let _ = std::fs::create_dir_all(&staging);

        let progress_app = app_h.clone();
        let progress_id = id_for_task.clone();

        // Fetch meta early for preview
        let meta = workshop::fetch_meta(&id_for_task).await.ok();
        let title_opt = meta.as_ref().map(|m| m.title.clone());
        let preview_opt = meta.as_ref().and_then(|m| m.preview_url.clone());

        let result = workshop::download(&id_for_task, &staging, |pct, msg| {
            let _ = progress_app.emit(
                "download-progress",
                DownloadProgress {
                    workshop_id: progress_id.clone(),
                    status: "downloading".to_string(),
                    progress: pct,
                    message: msg.to_string(),
                    title: title_opt.clone(),
                    preview_url: preview_opt.clone(),
                },
            );
        })
        .await;

        match result {
            Ok(dl) => {
                let _ = app_h.emit(
                    "download-progress",
                    DownloadProgress {
                        workshop_id: id_for_task.clone(),
                        status: "installing".to_string(),
                        progress: 95,
                        message: "Installing mod...".to_string(),
                        title: title_opt.clone(),
                        preview_url: preview_opt.clone(),
                    },
                );
                match mods::install_from_folder(
                    &paths_cloned,
                    &dl.staging_folder,
                    &id_for_task,
                    &dl.about,
                ) {
                    Ok(_) => {
                        let staging_root = paths::config_dir().join("staging");
                        if let Ok(rel) = dl.staging_folder.strip_prefix(&staging_root) {
                            if let Some(first) = rel.components().next() {
                                let top = staging_root.join(first.as_os_str());
                                let _ = std::fs::remove_dir_all(&top);
                            }
                        }
                        if let Some(t) = title_opt.clone() {
                            let _ = mods::set_mod_workshop_name(&paths_cloned, &id_for_task, t);
                        }
                        let _ = app_h.emit(
                            "download-progress",
                            DownloadProgress {
                                workshop_id: id_for_task.clone(),
                                status: "done".to_string(),
                                progress: 100,
                                message: "Installed".to_string(),
                                title: title_opt.clone(),
                                preview_url: preview_opt.clone(),
                            },
                        );
                    }
                    Err(e) => {
                        let _ = app_h.emit(
                            "download-progress",
                            DownloadProgress {
                                workshop_id: id_for_task.clone(),
                                status: "error".to_string(),
                                progress: 0,
                                message: format!("Install failed: {}", e),
                                title: title_opt.clone(),
                                preview_url: preview_opt.clone(),
                            },
                        );
                    }
                }
            }
            Err(e) => {
                let _ = app_h.emit(
                    "download-progress",
                    DownloadProgress {
                        workshop_id: id_for_task.clone(),
                        status: "error".to_string(),
                        progress: 0,
                        message: format!("{}", e),
                        title: title_opt.clone(),
                        preview_url: preview_opt.clone(),
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn download_workshop_mods_batch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let paths_cloned = state.paths.lock().unwrap().clone();

    tauri::async_runtime::spawn(async move {
        let _ = install_workshop_mods_batch_impl(app, paths_cloned, ids, "done", "Installed").await;
    });

    Ok(())
}

async fn install_workshop_mods_batch_impl(
    app: tauri::AppHandle,
    paths_cloned: paths::RimWorldPaths,
    ids: Vec<String>,
    final_status: &'static str,
    final_message: &'static str,
) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }

    // Fetch all metas early for preview
    let metas = workshop::fetch_metas(&ids).await.unwrap_or_default();
    let meta_map: std::collections::HashMap<String, workshop::WorkshopMeta> =
        metas.into_iter().collect();

    let emit = |app: &tauri::AppHandle, id: &str, status: &str, pct: u8, msg: &str, meta_map: &std::collections::HashMap<String, workshop::WorkshopMeta>| {
        let meta = meta_map.get(id);
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                workshop_id: id.to_string(),
                status: status.to_string(),
                progress: pct,
                message: msg.to_string(),
                title: meta.map(|m| m.title.clone()),
                preview_url: meta.and_then(|m| m.preview_url.clone()),
            },
        );
    };

    for id in &ids {
        emit(&app, id, "queued", 0, "Queued in batch", &meta_map);
    }

    let app_h = app.clone();
    let meta_map_task = meta_map.clone();
    let _guard = DOWNLOAD_LOCK.lock().await;

    for id in &ids {
        emit(&app_h, id, "downloading", 5, "Batching via SteamCMD (1 session)...", &meta_map_task);
    }

    let cb_app = app_h.clone();
    let cb_ids = ids.clone();
    let cb_meta_map = meta_map_task.clone();
    let results = steamcmd::download_workshop_items_batch(&ids, move |ev| {
        match ev {
            steamcmd::BatchEvent::ItemDone(id) => {
                emit(&cb_app, &id, "downloading", 80, "Downloaded, installing...", &cb_meta_map);
            }
            steamcmd::BatchEvent::ItemFailed(id, reason) => {
                emit(&cb_app, &id, "downloading", 50, &format!("SteamCMD: {}", truncate_msg(&reason, 140)), &cb_meta_map);
            }
            steamcmd::BatchEvent::Line(line) => {
                let l = line.to_lowercase();
                if l.contains("downloading") || l.contains("update state") {
                    for id in &cb_ids {
                        emit(&cb_app, id, "downloading", 40, &truncate_msg(&line, 120), &cb_meta_map);
                    }
                }
            }
        }
    })
    .await;

    let results = match results {
        Ok(r) => r,
        Err(e) => {
            for id in &ids {
                emit(&app_h, id, "error", 0, &format!("Batch SteamCMD failed: {}", e), &meta_map_task);
            }
            return Err(format!("Batch SteamCMD failed: {}", e));
        }
    };

    let mut updated = 0usize;
    let mut failed_ids: Vec<String> = Vec::new();
    for id in &ids {
        match results.get(id) {
            Some(Ok(folder)) => {
                emit(&app_h, id, "installing", 92, "Installing...", &meta_map_task);
                let meta = meta_map_task.get(id).cloned().unwrap_or(workshop::WorkshopMeta {
                    title: format!("Workshop Mod {}", id),
                    description: None,
                    preview_url: None,
                    time_updated: None,
                    tags: Vec::new(),
                    file_size: None,
                });
                let about = build_about_from_folder(folder, &meta, id);
                match mods::install_from_folder(&paths_cloned, folder, id, &about) {
                    Ok(_) => {
                        let _ = mods::set_mod_workshop_name(&paths_cloned, id, meta.title.clone());
                        emit(&app_h, id, final_status, 100, final_message, &meta_map_task);
                        updated += 1;
                    },
                    Err(e) => emit(&app_h, id, "error", 0, &format!("Install failed: {}", e), &meta_map_task),
                }
            }
            _ => {
                failed_ids.push(id.clone());
            }
        }
    }

    if !failed_ids.is_empty() {
        for id in &failed_ids {
            emit(&app_h, id, "downloading", 20, "SteamCMD missed this one — trying web mirrors...", &meta_map_task);
        }
        let staging = paths::config_dir().join("staging");
        let _ = std::fs::create_dir_all(&staging);
        for id in &failed_ids {
            let prog_app = app_h.clone();
            let prog_id = id.clone();
            let prog_meta_map = meta_map_task.clone();
            let res = workshop::download(id, &staging, move |pct, msg| {
                emit(&prog_app, &prog_id, "downloading", pct, msg, &prog_meta_map);
            })
            .await;
            match res {
                Ok(dl) => {
                    emit(&app_h, id, "installing", 95, "Installing...", &meta_map_task);
                    match mods::install_from_folder(
                        &paths_cloned,
                        &dl.staging_folder,
                        id,
                        &dl.about,
                    ) {
                        Ok(_) => {
                            let staging_root = paths::config_dir().join("staging");
                            if let Ok(rel) = dl.staging_folder.strip_prefix(&staging_root) {
                                if let Some(first) = rel.components().next() {
                                    let top = staging_root.join(first.as_os_str());
                                    let _ = std::fs::remove_dir_all(&top);
                                }
                            }
                            if let Some(meta) = meta_map_task.get(id) {
                                let _ = mods::set_mod_workshop_name(&paths_cloned, id, meta.title.clone());
                            }
                            emit(&app_h, id, final_status, 100, final_message, &meta_map_task);
                            updated += 1;
                        }
                        Err(e) => emit(&app_h, id, "error", 0, &format!("Install failed: {}", e), &meta_map_task),
                    }
                }
                Err(e) => emit(&app_h, id, "error", 0, &format!("{}", e), &meta_map_task),
            }
        }
    }

    mods::clear_cache();
    Ok(updated)
}

fn truncate_msg(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        format!("{}...", &s[..n])
    }
}

fn build_about_from_folder(
    folder: &std::path::Path,
    meta: &workshop::WorkshopMeta,
    _workshop_id: &str,
) -> about::ModAbout {
    let inner = folder.join("About").join("About.xml");
    let mut d = if inner.exists() {
        let txt = std::fs::read_to_string(&inner).unwrap_or_default();
        about::parse_about(&txt).unwrap_or_default()
    } else {
        about::ModAbout::default()
    };
    if d.name.is_empty() {
        d.name = meta.title.clone();
    }
    d
}

// ---------- Auto-sort ----------
#[derive(Serialize)]
struct SortPreview {
    current: Vec<String>,
    suggested: Vec<String>,
}

#[tauri::command]
fn preview_auto_sort(state: State<AppState>) -> Result<SortPreview, String> {
    let p = state.paths.lock().unwrap().clone();
    let ms = mods::list(&p).map_err(|e| e.to_string())?;
    let current: Vec<String> = ms.iter().filter(|m| m.enabled).map(|m| m.id.clone()).collect();
    let suggested = auto_sort::sort_mods(&ms);
    Ok(SortPreview { current, suggested })
}

#[tauri::command]
fn apply_auto_sort(state: State<AppState>, active_ids: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let p = state.paths.lock().unwrap().clone();
    let mut ms = mods::list(&p).map_err(|e| e.to_string())?;
    
    // If frontend provided currently active IDs (unsaved changes), respect them
    if let Some(ids) = active_ids {
        let ids_lower: std::collections::HashSet<String> = ids.iter().map(|s| s.to_lowercase()).collect();
        for m in ms.iter_mut() {
            m.enabled = ids_lower.contains(&m.id.to_lowercase());
        }
    }

    let suggested = auto_sort::sort_mods(&ms);
    mods::set_order(&p, &suggested).map_err(|e| e.to_string())?;
    mods::clear_cache();
    Ok(suggested)
}

#[tauri::command]
fn analyze_load_order(state: State<AppState>) -> Result<auto_sort::LoadOrderAnalysis, String> {
    let p = state.paths.lock().unwrap().clone();
    let ms = mods::list(&p).map_err(|e| e.to_string())?;
    Ok(auto_sort::analyze(&ms))
}

#[tauri::command]
async fn update_community_rules() -> Result<(), String> {
    let url = "https://raw.githubusercontent.com/RimSort/Community-Rules-Database/main/communityRules.json";
    let client = reqwest::Client::builder()
        .user_agent("RimWorldModManager/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    
    let path = paths::config_dir().join("communityRules.json");
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn update_steam_db() -> Result<(), String> {
    let url = "https://raw.githubusercontent.com/RimSort/Steam-Workshop-Database/main/steamDB.json";
    let client = reqwest::Client::builder()
        .user_agent("RimWorldModManager/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;

    let path = paths::config_dir().join("steamDB.json");
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct MissingDepResolution {
    pub package_id: String,
    pub pfid: Option<String>,
}

/// Resolve a list of missing package_ids against the cached Steam DB and return
/// which ones have a known Workshop ID (downloadable) vs. which are unknown.
/// Does NOT trigger a download — the frontend calls download_workshop_mods_batch
/// with the resolved pfids after the user confirms.
#[tauri::command]
async fn resolve_missing_dependencies(package_ids: Vec<String>) -> Result<Vec<MissingDepResolution>, String> {
    let map = steam_db::load_packageid_to_pfid();
    Ok(package_ids
        .into_iter()
        .map(|pkg| {
            let key = pkg.to_lowercase();
            MissingDepResolution {
                pfid: map.get(&key).cloned(),
                package_id: pkg,
            }
        })
        .collect())
}

// ---------- Updates ----------
#[tauri::command]
async fn check_mod_updates(state: State<'_, AppState>) -> Result<Vec<updates::UpdateStatus>, String> {
    let p = state.paths.lock().unwrap().clone();
    let ms = mods::list(&p).map_err(|e| e.to_string())?;
    updates::check(&ms).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn auto_update_mods(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<AutoUpdateResult, String> {
    let p = state.paths.lock().unwrap().clone();
    let ms = mods::list(&p).map_err(|e| e.to_string())?;
    let statuses = updates::check(&ms).await.map_err(|e| e.to_string())?;
    let ids: Vec<String> = statuses
        .iter()
        .filter(|status| status.has_update)
        .map(|status| status.remote_file_id.clone())
        .collect();

    if ids.is_empty() {
        return Ok(AutoUpdateResult {
            checked: statuses.len(),
            updated: 0,
            failed: 0,
            skipped: statuses.len(),
        });
    }

    let updated = install_workshop_mods_batch_impl(app, p, ids.clone(), "updated", "Updated").await?;
    Ok(AutoUpdateResult {
        checked: statuses.len(),
        updated,
        failed: ids.len().saturating_sub(updated),
        skipped: statuses.len().saturating_sub(ids.len()),
    })
}

// ---------- Collections / Presets ----------
#[tauri::command]
fn list_presets(_state: State<AppState>) -> Result<Vec<collections::Preset>, String> {
    Ok(collections::load().presets)
}

#[tauri::command]
fn refresh_mods(state: State<AppState>) -> Result<Vec<mods::ModInfo>, String> {
    mods::clear_cache();
    let p = state.paths.lock().unwrap().clone();
    mods::list(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_preset(
    name: String,
    mod_ids: Vec<String>,
    note: Option<String>,
) -> Result<collections::Preset, String> {
    collections::create(&name, mod_ids, note).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_preset(
    id: String,
    name: Option<String>,
    mod_ids: Option<Vec<String>>,
    note: Option<String>,
) -> Result<(), String> {
    collections::update(&id, name, mod_ids, note).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_preset(id: String) -> Result<(), String> {
    collections::delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn apply_preset(state: State<AppState>, id: String) -> Result<(), String> {
    let store = collections::load();
    let preset = store
        .presets
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "Preset not found".to_string())?;
    let p = state.paths.lock().unwrap().clone();
    let mut config = mods::read_mods_config(std::path::Path::new(&p.mods_config_path))
        .map_err(|e| e.to_string())?;
    config.active_mods = preset.mod_ids.clone();
    mods::write_mods_config(std::path::Path::new(&p.mods_config_path), &config, &p)
        .map_err(|e| e.to_string())?;
    mods::clear_cache();
    Ok(())
}

#[tauri::command]
async fn fetch_workshop_metas(ids: Vec<String>) -> Result<Vec<(String, workshop::WorkshopMeta)>, String> {
    workshop::fetch_metas(&ids).await.map_err(|e| e.to_string())
}

// ---------- Save Game Analysis ----------
#[tauri::command]
fn list_save_games() -> Result<Vec<savegame::SaveGameInfo>, String> {
    savegame::list_saves().map_err(|e| e.to_string())
}

#[tauri::command]
fn analyze_save_game(state: State<AppState>, file_name: String) -> Result<savegame::SaveAnalysis, String> {
    let p = state.paths.lock().unwrap().clone();
    let ms = mods::list(&p).map_err(|e| e.to_string())?;
    let installed_ids: Vec<String> = ms.iter().map(|m| m.id.clone()).collect();
    savegame::analyze_save(&file_name, &installed_ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_mod_image(path: String) -> Result<String, String> {
    let mut resolved = PathBuf::from(&path);
    if resolved.is_dir() {
        resolved = mods::resolve_preview_image(&resolved)
            .ok_or_else(|| "Preview image not found".to_string())?;
    }

    let p = resolved.as_path();
    if !p.exists() {
        return Err("File not found".into());
    }
    let data = std::fs::read(p).map_err(|e| e.to_string())?;
    let ext = p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
async fn restore_all_local_mods(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // 1. Try to acquire the lock. If failed, it means another operation (download/restore) is running.
    let _guard = DOWNLOAD_LOCK.try_lock().map_err(|_| "A download or restore operation is already in progress. Please wait until it finishes.".to_string())?;

    let p = state.paths.lock().unwrap().clone();
    let app_h = app.clone();
    
    let emit_progress = |app: &tauri::AppHandle, pct: u8, msg: &str| {
        let _ = app.emit("download-progress", DownloadProgress {
            workshop_id: "system_restore".to_string(),
            status: "restoring".to_string(),
            progress: pct,
            message: msg.to_string(),
            title: Some("System Restore".into()),
            preview_url: None,
        });
    };

    emit_progress(&app, 1, "Initializing restore...");

    let res = steamcmd::restore_local_mods_logic(app_h.clone(), p, |pct, msg| {
        emit_progress(&app_h, pct, msg);
    }).await;

    match res {
        Ok(_) => {
            emit_progress(&app_h, 100, "Restore complete!");
            Ok(())
        }
        Err(e) => {
            let msg = format!("Restore failed: {}", e);
            let _ = app_h.emit("download-progress", DownloadProgress {
                workshop_id: "system_restore".to_string(),
                status: "error".to_string(),
                progress: 0,
                message: msg.clone(),
                title: Some("System Restore".into()),
                preview_url: None,
            });
            Err(msg)
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct HubProvider {
    name: String,
    display_name: Option<String>,
    description: Option<String>,
    url: String,
    authors: Option<Vec<String>>,
    info_url: Option<String>,
    branch: Option<String>,
    disabled: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
struct HubManifest {
    providers: std::collections::HashMap<String, std::collections::HashMap<String, HubProvider>>,
}

#[tauri::command]
async fn fetch_mod_hub() -> Result<HubManifest, String> {
    let url = "https://gitgud.io/AblativeAbsolute/libidinous_loader_providers/-/raw/v1/providers.toml";
    let client = reqwest::Client::new();
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    
    let manifest: HubManifest = toml::from_str(&text).map_err(|e| e.to_string())?;
    Ok(manifest)
}

#[tauri::command]
async fn install_hub_mod(state: State<'_, AppState>, provider: HubProvider) -> Result<Vec<crate::about::Dependency>, String> {
    let p = state.paths.lock().unwrap().clone();
    let normalize = |value: &str| -> String {
        value
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect()
    };
    
    // We'll use ZIP download as a simple alternative to Git cloning
    // GitGud/GitHub/GitLab format: {url}/-/archive/{branch}/{name}-{branch}.zip
    let base_url = provider.url.trim_end_matches(".git");
    let branch = provider.branch.as_deref().unwrap_or("master");
    
    // If it's GitHub, the URL is slightly different: {url}/archive/refs/heads/{branch}.zip
    let final_url = if provider.url.contains("github.com") {
        format!("{}/archive/refs/heads/{}.zip", base_url, branch)
    } else {
        format!("{}/-/archive/{}/{}-{}.zip", base_url, branch, provider.name, branch)
    };

    println!("[HUB] Downloading from: {}", final_url);
    
    let client = reqwest::Client::new();
    let resp = client.get(&final_url).send().await.map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    
    // Extract to a temp folder and then install
    let temp_dir = std::env::temp_dir().join(format!("rimhub_{}", provider.name));
    if temp_dir.exists() { let _ = fs::remove_dir_all(&temp_dir); }
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    archive.extract(&temp_dir).map_err(|e| e.to_string())?;
    
    // Find the actual mod folder (ZIPs often have a nested parent folder)
    let mut mod_folder = temp_dir.clone();
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if entry.path().join("About").exists() {
                    mod_folder = entry.path();
                    break;
                }
            }
        }
    }

    // Install using existing logic
    let installed_folder_name = mods::install_from_folder(&p, &mod_folder, &provider.name, &about::ModAbout {
        name: provider.display_name.clone().unwrap_or(provider.name.clone()),
        author: provider.authors.as_ref().map(|a| a.join(", ")).unwrap_or_default(),
        ..Default::default()
    }).map_err(|e| e.to_string())?;

    // Cleanup
    let _ = fs::remove_dir_all(&temp_dir);
    mods::clear_cache();
    
    // Final check for missing dependencies of this specific mod
    let all_mods = mods::list(&p).map_err(|e| e.to_string())?;
    let provider_name = normalize(&provider.name);
    let provider_display_name = provider
        .display_name
        .as_deref()
        .map(normalize)
        .filter(|value| !value.is_empty());
    let installed_folder_name = normalize(&installed_folder_name);
    let target_mod = all_mods.into_iter().find(|m| {
        let mod_name = normalize(&m.name);
        let mod_id = normalize(&m.id);
        let mod_folder = PathBuf::from(&m.path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(normalize)
            .unwrap_or_default();

        mod_name == provider_name
            || mod_id == provider_name
            || mod_folder == provider_name
            || mod_name == installed_folder_name
            || mod_id == installed_folder_name
            || mod_folder == installed_folder_name
            || provider_display_name.as_ref().is_some_and(|display_name| {
                mod_name == *display_name || mod_id == *display_name || mod_folder == *display_name
            })
    });
    
    if let Some(m) = target_mod {
        Ok(m.missing_dependencies)
    } else {
        Ok(vec![])
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_paths = paths::detect().unwrap_or(RimWorldPaths {
        config_dir: String::new(),
        mods_config_path: String::new(),
        game_dir: None,
    });
    let app_state = AppState {
        paths: Mutex::new(initial_paths),
        log_tailer: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            detect_paths,
            set_user_dir,
            list_mods,
            set_mod_enabled,
            set_all_mods_enabled,
            set_load_order,
            set_enabled_set,
            delete_mod,
            backup_mod_to_local,
            nuke_local_mods,
            restore_all_local_mods,
            optimize_mod_textures,
            optimize_all_local_mods,
            revert_all_local_mods,
            check_texconv,
            download_texconv,
            read_rimworld_log,
            start_log_tail,
            stop_log_tail,
            get_stored_exe_path,
            set_stored_exe_path,
            open_path_or_url,
            analyze_mod_sizes,
            launch_rimworld,
            install_from_zip,
            open_workshop_downloader,
            fetch_collection,
            download_workshop_mod,
            download_workshop_mods_batch,
            preview_auto_sort,
            apply_auto_sort,
            analyze_load_order,
            check_mod_updates,
            auto_update_mods,
            fetch_mod_hub,
            install_hub_mod,
            list_presets,
            create_preset,
            update_preset,
            delete_preset,
            apply_preset,
            refresh_mods,
            fetch_workshop_metas,
            list_save_games,
            analyze_save_game,
            update_community_rules,
            update_steam_db,
            resolve_missing_dependencies,
            read_mod_image,
            resize_mod_textures,
            resize_all_local_mods,
            revert_mod_textures,
            set_mod_tags,
            set_mod_note,
            set_mod_workshop_name,
            list_mods_config_backups,
            restore_mods_config_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
