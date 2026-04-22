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

#[derive(Clone, Copy)]
struct DdsMetadata {
    width: u32,
    height: u32,
    mipmaps: u32,
    has_alpha: bool,
    is_block_compressed: bool,
}

fn texture_has_alpha_channel(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext == "dds" {
        return get_dds_metadata(path).map(|meta| meta.has_alpha).unwrap_or(true);
    }
    if ext == "jpg" || ext == "jpeg" {
        return false;
    }

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

fn align_bc_dimension(value: u32) -> u32 {
    value.max(4) / 4 * 4
}

fn should_fix_bc_4x4(path: &Path) -> bool {
    get_dds_metadata(path)
        .map(|meta| meta.is_block_compressed && (meta.width % 4 != 0 || meta.height % 4 != 0))
        .unwrap_or(false)
}

fn format_texconv_error(file: &Path, output: Option<&std::process::Output>) -> String {
    let file_name = file.file_name().and_then(|n| n.to_str()).unwrap_or("<unknown>");
    match output {
        Some(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("texconv exited with status {}", output.status)
            };
            format!("{} failed: {}", file_name, detail)
        }
        None => format!("{} failed: could not start texconv.exe", file_name),
    }
}

fn emit_texconv_error(app: &AppHandle, mod_info: &ModInfo, message: String) {
    emit_progress(app, OptimizeProgress {
        mod_id: mod_info.id.clone(),
        status: "error".into(),
        progress: 0,
        message,
    });
}

fn base_texconv_command(texconv: &Path, parent: &Path, format: &str) -> Command {
    let mut cmd = Command::new(texconv);
    cmd.args([
        "-f", format,
        "-y",
        "-vflip",
        "-m", "1",
        "-if", "FANT",
        "-gpu", "1",
        "-o", &parent.to_string_lossy(),
    ]);
    cmd
}

fn run_texconv_file(
    app: &AppHandle,
    mod_info: &ModInfo,
    texconv: &Path,
    parent: &Path,
    file: &Path,
    format: &str,
    resize: Option<(u32, u32)>,
    fit_pow2: bool,
) -> bool {
    let mut cmd = base_texconv_command(texconv, parent, format);

    if let Some((w, h)) = resize {
        let w = align_bc_dimension(w);
        let h = align_bc_dimension(h);
        cmd.args(["-w", &w.to_string(), "-h", &h.to_string()]);
    } else if fit_pow2 {
        cmd.arg("-pow2");
    }

    if should_fix_bc_4x4(file) {
        cmd.arg("--fix-bc-4x4");
    }

    cmd.arg(file);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if ext == "png" {
                let dds_path = file.with_extension("dds");
                if dds_path.exists() {
                    let _ = fs::remove_file(file);
                }
            }
            true
        }
        Ok(output) => {
            emit_texconv_error(app, mod_info, format_texconv_error(file, Some(&output)));
            false
        }
        Err(_) => {
            emit_texconv_error(app, mod_info, format_texconv_error(file, None));
            false
        }
    }
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
                        if let Ok(meta) = get_dds_metadata(e.path()) {
                            if meta.mipmaps > 1 {
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
                let (with_alpha, no_alpha): (Vec<_>, Vec<_>) = files.iter().partition(|f| texture_has_alpha_channel(f));
                if !with_alpha.is_empty() {
                    run_texconv_batch(&app, &mod_info, &texconv, parent, &with_alpha, "BC7_UNORM", &completed, &failed_count, total);
                }
                if !no_alpha.is_empty() {
                    run_texconv_batch(&app, &mod_info, &texconv, parent, &no_alpha, "BC1_UNORM", &completed, &failed_count, total);
                }
            }
            _ => {
                let (with_alpha, no_alpha): (Vec<_>, Vec<_>) = files.iter().partition(|f| texture_has_alpha_channel(f));
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
        let mut cmd = base_texconv_command(texconv, parent, format);
        cmd.arg("-pow2");
        
        for file in chunk {
            if should_fix_bc_4x4(file) {
                cmd.arg("--fix-bc-4x4");
            }
            cmd.arg(file);
        }

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                for file in chunk {
                    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                    if ext == "png" || ext == "jpg" || ext == "jpeg" {
                        let _ = fs::remove_file(file);
                    }
                }
            } else {
                let mut any_success = false;
                for file in chunk {
                    if run_texconv_file(app, mod_info, texconv, parent, file, format, None, true) {
                        any_success = true;
                    } else {
                        failed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                }
                if !any_success {
                    emit_texconv_error(app, mod_info, format!(
                        "Batch failed in {}: {}",
                        parent.display(),
                        format_texconv_error(chunk[0], Some(&output))
                    ));
                }
            }
        } else {
            for file in chunk {
                if !run_texconv_file(app, mod_info, texconv, parent, file, format, None, true) {
                    failed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
            }
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
            if let Ok(meta) = get_dds_metadata(&tex_path) {
                let bc_ready = !meta.is_block_compressed || (meta.width % 4 == 0 && meta.height % 4 == 0);
                if meta.width <= max_res && meta.height <= max_res && meta.mipmaps <= 1 && bc_ready {
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
        let (with_alpha, no_alpha): (Vec<_>, Vec<_>) = files.iter().partition(|f| texture_has_alpha_channel(f));

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
    if run_texconv_file(app, mod_info, texconv, parent, file, format, Some((nw, nh)), false) {
        resized_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
    if run_texconv_file(app, mod_info, texconv, parent, file, format, None, true) {
        resized_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
fn get_dds_metadata(path: &Path) -> Result<DdsMetadata> {
    use std::io::Read;
    let mut f = fs::File::open(path)?;
    let mut header = [0u8; 148];
    f.read_exact(&mut header)?;
    
    if &header[0..4] != b"DDS " {
        anyhow::bail!("Invalid DDS header");
    }

    let height = u32::from_le_bytes([header[12], header[13], header[14], header[15]]);
    let width = u32::from_le_bytes([header[16], header[17], header[18], header[19]]);
    let mipmaps = u32::from_le_bytes([header[28], header[29], header[30], header[31]]);
    let pf_flags = u32::from_le_bytes([header[80], header[81], header[82], header[83]]);
    let four_cc = &header[84..88];
    let alpha_mask = u32::from_le_bytes([header[104], header[105], header[106], header[107]]);

    let has_alpha = if pf_flags & 0x1 != 0 || pf_flags & 0x2 != 0 {
        true
    } else if pf_flags & 0x4 != 0 {
        match four_cc {
            b"DXT2" | b"DXT3" | b"DXT4" | b"DXT5" => true,
            b"DX10" => {
                let dxgi = u32::from_le_bytes([header[128], header[129], header[130], header[131]]);
                matches!(
                    dxgi,
                    2 | 10 | 11 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36
                        | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 74 | 75 | 77 | 78 | 97 | 98
                )
            }
            _ => false,
        }
    } else {
        alpha_mask != 0
    };

    let is_block_compressed = if pf_flags & 0x4 != 0 {
        match four_cc {
            b"DXT1" | b"DXT2" | b"DXT3" | b"DXT4" | b"DXT5" | b"ATI1" | b"ATI2" | b"BC4U"
            | b"BC4S" | b"BC5U" | b"BC5S" => true,
            b"DX10" => {
                let dxgi = u32::from_le_bytes([header[128], header[129], header[130], header[131]]);
                matches!(dxgi, 70..=84 | 94..=99)
            }
            _ => false,
        }
    } else {
        false
    };

    Ok(DdsMetadata {
        width,
        height,
        mipmaps,
        has_alpha,
        is_block_compressed,
    })
}

fn get_image_dimensions(path: &Path) -> Result<(u32, u32)> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext == "dds" {
        let meta = get_dds_metadata(path)?;
        return Ok((meta.width, meta.height));
    }
    
    let reader = image::ImageReader::open(path)?;
    let (w, h) = reader.into_dimensions()?;
    Ok((w, h))
}
