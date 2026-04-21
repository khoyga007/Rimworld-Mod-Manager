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

    // Sort files by size (largest first) to balance parallel workload
    png_files.sort_by_key(|f| std::cmp::Reverse(fs::metadata(f).map(|m| m.len()).unwrap_or(0)));

    let total = png_files.len();
    let completed = std::sync::atomic::AtomicUsize::new(0);

    // Process each PNG via texconv (parallelism handled by rayon)
    let results: Vec<Result<()>> = png_files.par_iter().map(|png_path| {
        let result = convert_png_with_texconv(&texconv, png_path);

        let c = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        if c % 10 == 0 || c == total {
            let pct = ((c as f32 / total as f32) * 100.0) as u8;
            emit_progress(&app, OptimizeProgress {
                mod_id: mod_info.id.clone(),
                status: "optimizing".into(),
                progress: pct,
                message: format!("Optimizing {}/{} textures...", c, total),
            });
        }

        result
    }).collect();

    let failed = results.iter().filter(|r| r.is_err()).count();

    emit_progress(&app, OptimizeProgress {
        mod_id: mod_info.id.clone(),
        status: if failed > 0 { "done_with_errors".into() } else { "done".into() },
        progress: 100,
        message: if failed > 0 {
            format!("Done! {} optimized, {} failed.", total - failed, failed)
        } else {
            format!("Done! All {} textures optimized.", total)
        },
    });

    Ok(())
}

fn convert_png_with_texconv(texconv: &Path, png_path: &Path) -> Result<()> {
    let parent = png_path.parent().context("No parent dir")?;

    // Run texconv.exe with BC7 compression (same as RimPy):
    //   -f BC7_UNORM   : BC7 format, widely supported, great quality
    //   -y             : overwrite existing output
    //   -sepalpha      : separate alpha for better quality
    //   -o <dir>       : output to same directory
    let output = Command::new(texconv)
        .args([
            "-f", "BC7_UNORM",
            "-y",
            "-vflip",
            "-m", "0",          // Generate full mipmap chain
            "-if", "FANT",      // High quality mipmap filter
            "-gpu", "0",        // Use GPU for compression
            "-sepalpha",
            "-o", &parent.to_string_lossy(),
        ])
        .arg(png_path)
        .output()
        .context("Failed to run texconv.exe")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        anyhow::bail!("texconv failed: {} {}", stdout, stderr);
    }

    // Verify DDS was created and has content before deleting PNG
    let dds_path = png_path.with_extension("dds");
    if dds_path.exists() {
        let meta = fs::metadata(&dds_path)?;
        if meta.len() > 0 {
            let _ = fs::remove_file(png_path);
        }
    }

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

    let results: Vec<Result<()>> = dds_files.par_iter().map(|dds_path| {
        let result = revert_single_dds_to_png(dds_path);

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

        result
    }).collect();

    let failed = results.iter().filter(|r| r.is_err()).count();

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

fn revert_single_dds_to_png(dds_path: &Path) -> Result<()> {
    let mut reader = std::io::BufReader::new(fs::File::open(dds_path)?);
    let dds = image_dds::ddsfile::Dds::read(&mut reader).context("Failed to read DDS")?;
    drop(reader);

    let rgba_img = image_dds::image_from_dds(&dds, 0).context("Failed to decode DDS")?;

    let png_path = dds_path.with_extension("png");
    rgba_img.save(&png_path).context("Failed to save PNG")?;

    let _ = fs::remove_file(dds_path);

    Ok(())
}
