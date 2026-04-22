use crate::paths::RimWorldPaths;
use crate::mods::ModInfo;
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;
use rayon::prelude::*;

#[derive(serde::Serialize, Clone)]
pub struct OptimizeProgress {
    pub mod_id: String,
    pub status: String,
    pub progress: u8,
    pub message: String,
}

pub fn emit_progress(app: &AppHandle, payload: OptimizeProgress) {
    let _ = app.emit("optimize-progress", payload);
}

// ---------------------------------------------------------------------------
// texconv.exe management
// ---------------------------------------------------------------------------

fn texconv_dir() -> PathBuf {
    crate::paths::config_dir().join("texconv")
}

fn texconv_path() -> PathBuf {
    texconv_dir().join("texconv.exe")
}

/// Check if texconv.exe is available
pub fn has_texconv() -> bool {
    texconv_path().exists()
}

/// Download texconv.exe from Microsoft DirectXTex GitHub releases
pub async fn ensure_texconv() -> Result<PathBuf> {
    let exe = texconv_path();
    if exe.exists() {
        return Ok(exe);
    }

    let dir = texconv_dir();
    fs::create_dir_all(&dir)?;

    // Download the standalone texconv release from Microsoft
    let url = "https://github.com/Microsoft/DirectXTex/releases/latest/download/texconv.exe";

    let client = reqwest::Client::builder()
        .user_agent("RimWorldModManager/0.1")
        .build()?;

    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("Failed to download texconv.exe: HTTP {}", resp.status());
    }

    let bytes = resp.bytes().await?;
    fs::write(&exe, &bytes)?;

    Ok(exe)
}

// ---------------------------------------------------------------------------
// Optimize: PNG → DDS via texconv.exe
// ---------------------------------------------------------------------------

pub fn optimize_mod_textures(app: AppHandle, _paths: RimWorldPaths, mod_info: ModInfo) -> Result<()> {
    if mod_info.path.contains("workshop") {
        anyhow::bail!("Cannot optimize Workshop mods directly. Please 'Copy to Local' first.");
    }

    let texconv = texconv_path();
    if !texconv.exists() {
        anyhow::bail!("texconv.exe not found. Please click 'Download texconv' in Settings first.");
    }

    let mod_path = PathBuf::from(&mod_info.path);
    let textures_dir = mod_path.join("Textures");

    if !textures_dir.exists() {
        emit_progress(&app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "done".into(),
            progress: 100,
            message: "No Textures folder found.".into(),
        });
        return Ok(());
    }

    emit_progress(&app, OptimizeProgress {
        mod_id: mod_info.id.clone(),
        status: "scanning".into(),
        progress: 0,
        message: format!("Scanning {}...", mod_info.name),
    });

    let mut png_files = Vec::new();
    for entry in WalkDir::new(&textures_dir) {
        if let Ok(e) = entry {
            if e.path().is_file() {
                if let Some(ext) = e.path().extension() {
                    if ext.to_string_lossy().eq_ignore_ascii_case("png") {
                        png_files.push(e.path().to_path_buf());
                    }
                }
            }
        }
    }

    if png_files.is_empty() {
        emit_progress(&app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "done".into(),
            progress: 100,
            message: "No PNG files to optimize.".into(),
        });
        return Ok(());
    }

    let total = png_files.len();
    let completed = std::sync::atomic::AtomicUsize::new(0);
    let failed_count = std::sync::atomic::AtomicUsize::new(0);

    // Group PNG files by their parent directory to batch texconv calls
    let mut groups: std::collections::HashMap<PathBuf, Vec<PathBuf>> = std::collections::HashMap::new();
    for png_path in png_files {
        let dds_path = png_path.with_extension("dds");
        // Skip if DDS exists and is newer than PNG
        if dds_path.exists() {
            if let (Ok(m_png), Ok(m_dds)) = (fs::metadata(&png_path), fs::metadata(&dds_path)) {
                if let (Ok(t_png), Ok(t_dds)) = (m_png.modified(), m_dds.modified()) {
                    if t_dds >= t_png {
                        let _ = fs::remove_file(&png_path);
                        completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        continue;
                    }
                }
            }
        }
        if let Some(parent) = png_path.parent() {
            groups.entry(parent.to_path_buf()).or_default().push(png_path);
        }
    }

    let groups_vec: Vec<(PathBuf, Vec<PathBuf>)> = groups.into_iter().collect();
    
    // Process each directory group in parallel
    groups_vec.par_iter().for_each(|(parent, files)| {
        // Process in chunks of 50 to avoid command line length limits
        for chunk in files.chunks(50) {
            let mut cmd = Command::new(&texconv);
            cmd.args([
                "-f", "BC7_UNORM",
                "-y",
                "-vflip",
                "-aw", "4",
                "-ah", "4",
                "-m", "0",
                "-if", "FANT",
                "-gpu", "1",
                "-sepalpha",
                "-o", &parent.to_string_lossy(),
            ]);
            
            for file in chunk {
                cmd.arg(file);
            }

            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    for file in chunk {
                        let _ = fs::remove_file(file);
                    }
                } else {
                    failed_count.fetch_add(chunk.len(), std::sync::atomic::Ordering::Relaxed);
                }
            } else {
                failed_count.fetch_add(chunk.len(), std::sync::atomic::Ordering::Relaxed);
            }

            let c = completed.fetch_add(chunk.len(), std::sync::atomic::Ordering::Relaxed) + chunk.len();
            let pct = ((c as f32 / total as f32) * 100.0) as u8;
            emit_progress(&app, OptimizeProgress {
                mod_id: mod_info.id.clone(),
                status: "optimizing".into(),
                progress: pct,
                message: format!("Optimizing {}/{} textures...", c, total),
            });
        }
    });

    let failed = failed_count.load(std::sync::atomic::Ordering::Relaxed);
    
    emit_progress(&app, OptimizeProgress {
        mod_id: mod_info.id.clone(),
        status: if failed > 0 { "done_with_errors".into() } else { "done".into() },
        progress: 100,
        message: if failed > 0 {
            format!("Done! {} processed, {} failed.", total - failed, failed)
        } else {
            format!("Done! All {} textures processed.", total)
        },
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Revert: DDS → PNG (undo optimization)
// ---------------------------------------------------------------------------

pub fn revert_mod_textures(app: AppHandle, _paths: RimWorldPaths, mod_info: ModInfo) -> Result<()> {
    let mod_path = PathBuf::from(&mod_info.path);
    let textures_dir = mod_path.join("Textures");

    if !textures_dir.exists() {
        emit_progress(&app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "done".into(),
            progress: 100,
            message: "No Textures folder found.".into(),
        });
        return Ok(());
    }

    emit_progress(&app, OptimizeProgress {
        mod_id: mod_info.id.clone(),
        status: "scanning".into(),
        progress: 0,
        message: format!("Scanning {} for DDS files...", mod_info.name),
    });

    let mut dds_files = Vec::new();
    for entry in WalkDir::new(&textures_dir) {
        if let Ok(e) = entry {
            if e.path().is_file() {
                if let Some(ext) = e.path().extension() {
                    if ext.to_string_lossy().eq_ignore_ascii_case("dds") {
                        // Only revert DDS that don't have a corresponding PNG
                        let png_path = e.path().with_extension("png");
                        if !png_path.exists() {
                            dds_files.push(e.path().to_path_buf());
                        }
                    }
                }
            }
        }
    }

    if dds_files.is_empty() {
        emit_progress(&app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "done".into(),
            progress: 100,
            message: "No DDS files to revert.".into(),
        });
        return Ok(());
    }

    let total = dds_files.len();
    let completed = std::sync::atomic::AtomicUsize::new(0);
    let failed_count = std::sync::atomic::AtomicUsize::new(0);

    let texconv = texconv_path();
    dds_files.par_iter().for_each(|dds_path| {
        if revert_single_dds_to_png(&texconv, dds_path).is_err() {
            failed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }

        let c = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        if c % 5 == 0 || c == total {
            let pct = ((c as f32 / total as f32) * 100.0) as u8;
            emit_progress(&app, OptimizeProgress {
                mod_id: mod_info.id.clone(),
                status: "reverting".into(),
                progress: pct,
                message: format!("Reverting {}/{} textures...", c, total),
            });
        }
    });

    let failed = failed_count.load(std::sync::atomic::Ordering::Relaxed);

    emit_progress(&app, OptimizeProgress {
        mod_id: mod_info.id.clone(),
        status: if failed > 0 { "done_with_errors".into() } else { "done".into() },
        progress: 100,
        message: if failed > 0 {
            format!("Reverted {} textures, {} failed.", total - failed, failed)
        } else {
            format!("Reverted all {} textures back to PNG!", total)
        },
    });

    Ok(())
}

fn revert_single_dds_to_png(texconv: &Path, dds_path: &Path) -> Result<()> {
    let parent = dds_path.parent().context("No parent dir")?;

    let output = Command::new(texconv)
        .args([
            "-ft", "png",       // Output format PNG
            "-y",              // Overwrite
            "-vflip",          // Flip back to normal orientation
            "-o", &parent.to_string_lossy(),
        ])
        .arg(dds_path)
        .output()
        .context("Failed to run texconv.exe for revert")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("texconv revert failed: {}", stderr);
    }

    // Delete DDS after successful revert
    let _ = fs::remove_file(dds_path);

    Ok(())
}

// ---------------------------------------------------------------------------
// Smart Resize: Downscale textures to max resolution + DDS compress
// ---------------------------------------------------------------------------

/// Resize all textures in a mod to a max resolution and convert to DDS.
/// Handles both PNG and existing DDS files. texconv accepts both formats.
pub fn resize_mod_textures(
    app: AppHandle,
    _paths: RimWorldPaths,
    mod_info: ModInfo,
    max_res: u32,
) -> Result<()> {
    if mod_info.path.contains("workshop") {
        anyhow::bail!("Cannot resize Workshop mods directly. Please 'Copy to Local' first.");
    }

    let texconv = texconv_path();
    if !texconv.exists() {
        anyhow::bail!("texconv.exe not found. It will be downloaded automatically.");
    }

    let mod_path = PathBuf::from(&mod_info.path);
    let textures_dir = mod_path.join("Textures");

    if !textures_dir.exists() {
        emit_progress(&app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "done".into(),
            progress: 100,
            message: "No Textures folder found.".into(),
        });
        return Ok(());
    }

    emit_progress(&app, OptimizeProgress {
        mod_id: mod_info.id.clone(),
        status: "scanning".into(),
        progress: 0,
        message: format!("Scanning {} for oversized textures...", mod_info.name),
    });

    // Collect both PNG and DDS files
    let mut texture_files = Vec::new();
    for entry in WalkDir::new(&textures_dir) {
        if let Ok(e) = entry {
            if e.path().is_file() {
                if let Some(ext) = e.path().extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if ext_lower == "png" || ext_lower == "dds" {
                        texture_files.push(e.path().to_path_buf());
                    }
                }
            }
        }
    }

    if texture_files.is_empty() {
        emit_progress(&app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "done".into(),
            progress: 100,
            message: "No texture files to resize.".into(),
        });
        return Ok(());
    }

    let total = texture_files.len();
    let completed = std::sync::atomic::AtomicUsize::new(0);
    let resized_count = std::sync::atomic::AtomicUsize::new(0);
    let failed_count = std::sync::atomic::AtomicUsize::new(0);

    // Group files by parent directory
    let mut groups: std::collections::HashMap<PathBuf, Vec<PathBuf>> = std::collections::HashMap::new();
    for tex_path in texture_files {
        // SMART SKIP: If it's already a DDS, check if its dimensions are already within limit
        let ext = tex_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if ext == "dds" {
            if let Ok((w, h)) = get_dds_dimensions(&tex_path) {
                if w <= max_res && h <= max_res {
                    completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    continue;
                }
            }
        }
        if let Some(parent) = tex_path.parent() {
            groups.entry(parent.to_path_buf()).or_default().push(tex_path);
        }
    }

    let groups_vec: Vec<(PathBuf, Vec<PathBuf>)> = groups.into_iter().collect();
    let max_res_str = max_res.to_string();

    groups_vec.par_iter().for_each(|(parent, files)| {
        for chunk in files.chunks(50) {
            let mut cmd = Command::new(&texconv);
            cmd.args([
                "-f", "BC7_UNORM",
                "-y",
                "-vflip",
                "-w", &max_res_str,
                "-h", &max_res_str,
                "-aw", "4",
                "-ah", "4",
                "-m", "0",
                "-if", "FANT",
                "-gpu", "1",
                "-sepalpha",
                "-o", &parent.to_string_lossy(),
            ]);

            for file in chunk {
                cmd.arg(file);
            }

            if let Ok(output) = cmd.output() {
                if output.status.success() {
                    for file in chunk {
                        let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                        if ext == "png" {
                            let dds_path = file.with_extension("dds");
                            if dds_path.exists() {
                                let _ = fs::remove_file(file);
                            }
                        }
                    }
                    resized_count.fetch_add(chunk.len(), std::sync::atomic::Ordering::Relaxed);
                } else {
                    failed_count.fetch_add(chunk.len(), std::sync::atomic::Ordering::Relaxed);
                }
            } else {
                failed_count.fetch_add(chunk.len(), std::sync::atomic::Ordering::Relaxed);
            }

            let c = completed.fetch_add(chunk.len(), std::sync::atomic::Ordering::Relaxed) + chunk.len();
            let pct = ((c as f32 / total as f32) * 100.0) as u8;
            emit_progress(&app, OptimizeProgress {
                mod_id: mod_info.id.clone(),
                status: "resizing".into(),
                progress: pct,
                message: format!("Resizing {}/{} textures (max {}px)...", c, total, max_res_str),
            });
        }
    });

    let failed = failed_count.load(std::sync::atomic::Ordering::Relaxed);
    let actual_resized = resized_count.load(std::sync::atomic::Ordering::Relaxed);
 
    emit_progress(&app, OptimizeProgress {
        mod_id: mod_info.id.clone(),
        status: if failed > 0 { "done_with_errors".into() } else { "done".into() },
        progress: 100,
        message: if failed > 0 {
            format!("Done! {} processed, {} skipped/failed.", actual_resized, total - actual_resized)
        } else {
            format!("Done! {} resized, {} already within {}px.", actual_resized, total - actual_resized, max_res)
        },
    });

    Ok(())
}

/// Helper to quickly read DDS width/height from the 128-byte header
/// Offset 12: height (u32), Offset 16: width (u32)
fn get_dds_dimensions(path: &Path) -> Result<(u32, u32)> {
    use std::io::Read;
    let mut f = fs::File::open(path)?;
    let mut header = [0u8; 20];
    f.read_exact(&mut header)?;
    
    let h = u32::from_le_bytes([header[12], header[13], header[14], header[15]]);
    let w = u32::from_le_bytes([header[16], header[17], header[18], header[19]]);
    
    Ok((w, h))
}
