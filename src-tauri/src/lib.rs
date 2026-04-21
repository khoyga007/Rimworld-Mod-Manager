mod auto_sort;
mod backups;
mod collections;
pub mod about;
mod log_tail;
mod mods;
mod paths;
mod savegame;
mod size_analysis;
mod steamcmd;
mod updates;
mod workshop;

use paths::RimWorldPaths;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

static DOWNLOAD_LOCK: TokioMutex<()> = TokioMutex::const_new(());

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
    mods::set_all_enabled(&p, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_load_order(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_order(&p, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_enabled_set(state: State<AppState>, ids: Vec<String>) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::set_enabled_set(&p, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_mod(state: State<AppState>, id: String) -> Result<(), String> {
    let p = state.paths.lock().unwrap().clone();
    mods::delete_mod(&p, &id).map_err(|e| e.to_string())
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

    let emit_queued = |app: &tauri::AppHandle, status: &str, pct: u8, msg: &str| {
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                workshop_id: id.clone(),
                status: status.to_string(),
                progress: pct,
                message: msg.to_string(),
            },
        );
    };

    emit_queued(&app, "queued", 0, "Queued");

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
            },
        );
        let staging = paths::config_dir().join("staging");
        let _ = std::fs::create_dir_all(&staging);

        let progress_app = app_h.clone();
        let progress_id = id_for_task.clone();
        let result = workshop::download(&id_for_task, &staging, |pct, msg| {
            let _ = progress_app.emit(
                "download-progress",
                DownloadProgress {
                    workshop_id: progress_id.clone(),
                    status: "downloading".to_string(),
                    progress: pct,
                    message: msg.to_string(),
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
                        let _ = app_h.emit(
                            "download-progress",
                            DownloadProgress {
                                workshop_id: id_for_task.clone(),
                                status: "done".to_string(),
                                progress: 100,
                                message: "Installed".to_string(),
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

    let emit = |app: &tauri::AppHandle, id: &str, status: &str, pct: u8, msg: &str| {
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                workshop_id: id.to_string(),
                status: status.to_string(),
                progress: pct,
                message: msg.to_string(),
            },
        );
    };

    for id in &ids {
        emit(&app, id, "queued", 0, "Queued in batch");
    }

    tauri::async_runtime::spawn(async move {
        let app_h = app.clone();
        let _guard = DOWNLOAD_LOCK.lock().await;

        for id in &ids {
            emit(&app_h, id, "downloading", 5, "Batching via SteamCMD (1 session)...");
        }

        let cb_app = app_h.clone();
        let cb_ids = ids.clone();
        let results = steamcmd::download_workshop_items_batch(&ids, move |ev| {
            match ev {
                steamcmd::BatchEvent::ItemDone(id) => {
                    emit(&cb_app, &id, "downloading", 80, "Downloaded, installing...");
                }
                steamcmd::BatchEvent::ItemFailed(id, reason) => {
                    emit(&cb_app, &id, "downloading", 50, &format!("SteamCMD: {}", truncate_msg(&reason, 140)));
                }
                steamcmd::BatchEvent::Line(line) => {
                    let l = line.to_lowercase();
                    if l.contains("downloading") || l.contains("update state") {
                        for id in &cb_ids {
                            emit(&cb_app, id, "downloading", 40, &truncate_msg(&line, 120));
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
                    emit(&app_h, id, "error", 0, &format!("Batch SteamCMD failed: {}", e));
                }
                return;
            }
        };

        let metas = workshop::fetch_metas(&ids).await.unwrap_or_default();
        let meta_map: std::collections::HashMap<String, workshop::WorkshopMeta> =
            metas.into_iter().collect();

        let mut failed_ids: Vec<String> = Vec::new();
        for id in &ids {
            match results.get(id) {
                Some(Ok(folder)) => {
                    emit(&app_h, id, "installing", 92, "Installing...");
                    let meta = meta_map.get(id).cloned().unwrap_or(workshop::WorkshopMeta {
                        title: format!("Workshop Mod {}", id),
                        description: None,
                        preview_url: None,
                        time_updated: None,
                        tags: Vec::new(),
                        file_size: None,
                    });
                    let about = build_about_from_folder(folder, &meta, id);
                    match mods::install_from_folder(&paths_cloned, folder, id, &about) {
                        Ok(_) => emit(&app_h, id, "done", 100, "Installed"),
                        Err(e) => emit(&app_h, id, "error", 0, &format!("Install failed: {}", e)),
                    }
                }
                _ => {
                    failed_ids.push(id.clone());
                }
            }
        }

        if !failed_ids.is_empty() {
            for id in &failed_ids {
                emit(&app_h, id, "downloading", 20, "SteamCMD missed this one — trying web mirrors...");
            }
            let staging = paths::config_dir().join("staging");
            let _ = std::fs::create_dir_all(&staging);
            for id in &failed_ids {
                let prog_app = app_h.clone();
                let prog_id = id.clone();
                let res = workshop::download(id, &staging, move |pct, msg| {
                    emit(&prog_app, &prog_id, "downloading", pct, msg);
                })
                .await;
                match res {
                    Ok(dl) => {
                        emit(&app_h, id, "installing", 95, "Installing...");
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
                                emit(&app_h, id, "done", 100, "Installed");
                            }
                            Err(e) => emit(&app_h, id, "error", 0, &format!("Install failed: {}", e)),
                        }
                    }
                    Err(e) => emit(&app_h, id, "error", 0, &format!("{}", e)),
                }
            }
        }
    });

    Ok(())
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
fn apply_auto_sort(state: State<AppState>) -> Result<Vec<String>, String> {
    let p = state.paths.lock().unwrap().clone();
    let ms = mods::list(&p).map_err(|e| e.to_string())?;
    let suggested = auto_sort::sort_mods(&ms);
    mods::set_order(&p, &suggested).map_err(|e| e.to_string())?;
    Ok(suggested)
}

#[tauri::command]
fn analyze_load_order(state: State<AppState>) -> Result<auto_sort::LoadOrderAnalysis, String> {
    let p = state.paths.lock().unwrap().clone();
    let ms = mods::list(&p).map_err(|e| e.to_string())?;
    Ok(auto_sort::analyze(&ms))
}

// ---------- Updates ----------
#[tauri::command]
async fn check_mod_updates(state: State<'_, AppState>) -> Result<Vec<updates::UpdateStatus>, String> {
    let p = state.paths.lock().unwrap().clone();
    let ms = mods::list(&p).map_err(|e| e.to_string())?;
    updates::check(&ms).await.map_err(|e| e.to_string())
}

// ---------- Collections / Presets ----------
#[tauri::command]
fn list_presets() -> Result<Vec<collections::Preset>, String> {
    Ok(collections::load().presets)
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
    mods::write_mods_config(std::path::Path::new(&p.mods_config_path), &config)
        .map_err(|e| e.to_string())
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
            list_presets,
            create_preset,
            update_preset,
            delete_preset,
            apply_preset,
            fetch_workshop_metas,
            list_save_games,
            analyze_save_game,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

