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

#[derive(serde::Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CompressionFormat {
    Smart,
    Bc7,
    Bc1,
}

impl CompressionFormat {
    pub fn to_texconv_format(&self, has_alpha: bool) -> &'static str {
        match self {
            CompressionFormat::Bc7 => "BC7_UNORM",
            CompressionFormat::Bc1 => if has_alpha { "BC3_UNORM" } else { "BC1_UNORM" },
            CompressionFormat::Smart => if has_alpha { "BC7_UNORM" } else { "BC1_UNORM" },
        }
    }
}

fn has_alpha_channel(path: &Path) -> bool {
    // Optimization: Read only the IHDR chunk of PNG to check color type
    // PNG Color Types: 4 (Gray+Alpha) and 6 (RGBA) have alpha channels.
    if let Ok(mut file) = fs::File::open(path) {
        use std::io::Read;
        let mut header = [0u8; 33]; // PNG signature (8) + IHDR chunk (25)
        if file.read_exact(&mut header).is_ok() {
            if &header[0..8] == b"\x89PNG\r\n\x1a\n" {
                // IHDR starts at byte 12 (length: 4, type: 4, width: 4, height: 4, bit depth: 1, color type: 1)
                // Color type is at byte 25
                let color_type = header[25];
                return color_type == 4 || color_type == 6;
            }
        }
    }
    true // Default to true (safe bet for non-PNG or read failure)
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

pub fn optimize_mod_textures(app: AppHandle, _paths: RimWorldPaths, mod_info: ModInfo, format: CompressionFormat) -> Result<()> {
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
                if let Some(ext) = e.path().extension().and_then(|s| s.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    if ext_lower == "png" {
                        png_files.push(e.path().to_path_buf());
                    } else if ext_lower == "dds" {
                        // Include DDS if it has mipmaps
                        if let Ok((_, _, mips)) = get_dds_dimensions(e.path()) {
                            if mips > 1 {
                                png_files.push(e.path().to_path_buf());
                            }
                        }
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
            message: "No textures need optimization.".into(),
        });
        return Ok(());
    }

    let total = png_files.len();
    let completed = std::sync::atomic::AtomicUsize::new(0);
    let failed_count = std::sync::atomic::AtomicUsize::new(0);

    // Group files by their parent directory to batch texconv calls
    let mut groups: std::collections::HashMap<PathBuf, Vec<PathBuf>> = std::collections::HashMap::new();
    for tex_path in png_files {
        let ext = tex_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        
        if ext == "png" || ext == "jpg" || ext == "jpeg" {
            let dds_path = tex_path.with_extension("dds");
            // Skip if DDS exists and is newer than original
            if dds_path.exists() {
                if let (Ok(m_orig), Ok(m_dds)) = (fs::metadata(&tex_path), fs::metadata(&dds_path)) {
                    if let (Ok(t_orig), Ok(t_dds)) = (m_orig.modified(), m_dds.modified()) {
                        if t_dds >= t_orig {
                            // If original is PNG and DDS is newer, we can safely remove PNG
                            let _ = fs::remove_file(&tex_path);
                            completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            continue;
                        }
                    }
                }
            }
        }
        
        if let Some(parent) = tex_path.parent() {
            groups.entry(parent.to_path_buf()).or_default().push(tex_path);
        }
    }

    let groups_vec: Vec<(PathBuf, Vec<PathBuf>)> = groups.into_iter().collect();
    
    groups_vec.par_iter().for_each(|(parent, files)| {
        match format {
            CompressionFormat::Smart => {
                let (with_alpha, no_alpha): (Vec<_>, Vec<_>) = files.iter().partition(|f| has_alpha_channel(f));
                if !with_alpha.is_empty() {
                    run_texconv_batch(&app, &mod_info, &texconv, parent, &with_alpha, "BC7_UNORM", &completed, &failed_count, total);
                }
                if !no_alpha.is_empty() {
                    run_texconv_batch(&app, &mod_info, &texconv, parent, &no_alpha, "BC1_UNORM", &completed, &failed_count, total);
                }
            }
            _ => {
                let (with_alpha, no_alpha): (Vec<_>, Vec<_>) = files.iter().partition(|f| has_alpha_channel(f));
                if !with_alpha.is_empty() {
                    run_texconv_batch(&app, &mod_info, &texconv, parent, &with_alpha, format.to_texconv_format(true), &completed, &failed_count, total);
                }
                if !no_alpha.is_empty() {
                    run_texconv_batch(&app, &mod_info, &texconv, parent, &no_alpha, format.to_texconv_format(false), &completed, &failed_count, total);
                }
            }
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

fn run_texconv_batch(
    app: &AppHandle,
    mod_info: &ModInfo,
    texconv: &Path,
    parent: &Path,
    files: &[&PathBuf],
    format: &str,
    completed: &std::sync::atomic::AtomicUsize,
    failed_count: &std::sync::atomic::AtomicUsize,
    total: usize,
) {
    for chunk in files.chunks(50) {
        let mut cmd = Command::new(texconv);
        cmd.args([
            "-f", format,
            "-y",
            "-vflip",
            "-pow2",
            "-m", "1",
            "-if", "FANT",
            "-gpu", "1",
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
        emit_progress(app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "optimizing".into(),
            progress: pct,
            message: format!("Optimizing {}/{} textures...", c, total),
        });
    }
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
    format: CompressionFormat,
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
            if let Ok((w, h, mips)) = get_dds_dimensions(&tex_path) {
                if w <= max_res && h <= max_res && mips <= 1 {
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

    groups_vec.par_iter().for_each(|(parent, files)| {
        let (with_alpha, no_alpha): (Vec<_>, Vec<_>) = files.iter().partition(|f| has_alpha_channel(f));

        let process_group = |list: Vec<&PathBuf>, is_alpha: bool| {
            if list.is_empty() { return; }
            
            let f_str = match format {
                CompressionFormat::Smart => if is_alpha { "BC7_UNORM" } else { "BC1_UNORM" },
                _ => format.to_texconv_format(is_alpha),
            };

            // To maintain aspect ratio, we can't batch files with different aspect ratios
            // using the same -w -h. 
            // So we process them individually or in small sub-groups if they need resize.
            for f in list {
                if let Ok((w, h)) = get_image_dimensions(f) {
                    if w > max_res || h > max_res {
                        // Calculate new dimensions preserving aspect ratio
                        let (nw, nh) = if w > h {
                            (max_res, (h * max_res) / w)
                        } else {
                            ((w * max_res) / h, max_res)
                        };
                        
                        run_single_texconv_resize(&app, &mod_info, &texconv, parent, f, f_str, nw, nh, &completed, &failed_count, &resized_count, total);
                    } else {
                        // Just compress
                        run_single_texconv_compress(&app, &mod_info, &texconv, parent, f, f_str, &completed, &failed_count, &resized_count, total);
                    }
                } else {
                    failed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
            }
        };

        process_group(with_alpha, true);
        process_group(no_alpha, false);
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

fn run_single_texconv_resize(
    app: &AppHandle,
    mod_info: &ModInfo,
    texconv: &Path,
    parent: &Path,
    file: &Path,
    format: &str,
    nw: u32,
    nh: u32,
    completed: &std::sync::atomic::AtomicUsize,
    failed_count: &std::sync::atomic::AtomicUsize,
    resized_count: &std::sync::atomic::AtomicUsize,
    total: usize,
) {
    let mut cmd = Command::new(texconv);
    cmd.args([
        "-f", format,
        "-y",
        "-vflip",
        "-w", &nw.to_string(),
        "-h", &nh.to_string(),
        "-pow2",
        "-m", "1",
        "-if", "FANT",
        "-gpu", "1",
        "-o", &parent.to_string_lossy(),
    ]);
    cmd.arg(file);

    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if ext == "png" {
                let dds_path = file.with_extension("dds");
                if dds_path.exists() {
                    let _ = fs::remove_file(file);
                }
            }
            resized_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        } else {
            failed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    } else {
        failed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    let c = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if c % 5 == 0 || c == total {
        let pct = ((c as f32 / total as f32) * 100.0) as u8;
        emit_progress(app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "resizing".into(),
            progress: pct,
            message: format!("Resizing {}/{} textures...", c, total),
        });
    }
}

fn run_single_texconv_compress(
    app: &AppHandle,
    mod_info: &ModInfo,
    texconv: &Path,
    parent: &Path,
    file: &Path,
    format: &str,
    completed: &std::sync::atomic::AtomicUsize,
    failed_count: &std::sync::atomic::AtomicUsize,
    resized_count: &std::sync::atomic::AtomicUsize,
    total: usize,
) {
    let mut cmd = Command::new(texconv);
    cmd.args([
        "-f", format,
        "-y",
        "-vflip",
        "-pow2",
        "-m", "1",
        "-if", "FANT",
        "-gpu", "1",
        "-o", &parent.to_string_lossy(),
    ]);
    cmd.arg(file);

    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if ext == "png" {
                let dds_path = file.with_extension("dds");
                if dds_path.exists() {
                    let _ = fs::remove_file(file);
                }
            }
            resized_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        } else {
            failed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    } else {
        failed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    let c = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if c % 5 == 0 || c == total {
        let pct = ((c as f32 / total as f32) * 100.0) as u8;
        emit_progress(app, OptimizeProgress {
            mod_id: mod_info.id.clone(),
            status: "optimizing".into(),
            progress: pct,
            message: format!("Optimizing {}/{} textures...", c, total),
        });
    }
}


/// Helper to quickly read DDS width/height from the 128-byte header
/// Offset 12: height (u32), Offset 16: width (u32)
fn get_dds_dimensions(path: &Path) -> Result<(u32, u32, u32)> {
    use std::io::Read;
    let mut f = fs::File::open(path)?;
    let mut header = [0u8; 32];
    f.read_exact(&mut header)?;
    
    let h = u32::from_le_bytes([header[12], header[13], header[14], header[15]]);
    let w = u32::from_le_bytes([header[16], header[17], header[18], header[19]]);
    let mips = u32::from_le_bytes([header[28], header[29], header[30], header[31]]);
    
    Ok((w, h, mips))
}

fn get_image_dimensions(path: &Path) -> Result<(u32, u32)> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext == "dds" {
        let (w, h, _) = get_dds_dimensions(path)?;
        return Ok((w, h));
    }
    
    let reader = image::ImageReader::open(path)?;
    let (w, h) = reader.into_dimensions()?;
    Ok((w, h))
}
