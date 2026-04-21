use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct LogChunk {
    pub content: String,
    pub truncated: bool,
}

pub struct LogTailer {
    pub running: Arc<AtomicBool>,
}

impl LogTailer {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    pub fn start(&self, app: AppHandle, log_path: PathBuf) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let running = self.running.clone();
        std::thread::spawn(move || {
            let mut last_size: u64 = 0;
            if let Ok(meta) = std::fs::metadata(&log_path) {
                last_size = meta.len();
                if let Ok(mut f) = std::fs::File::open(&log_path) {
                    let start = last_size.saturating_sub(64 * 1024);
                    if f.seek(SeekFrom::Start(start)).is_ok() {
                        let mut buf = String::new();
                        let _ = f.read_to_string(&mut buf);
                        let _ = app.emit(
                            "log-chunk",
                            LogChunk {
                                content: buf,
                                truncated: start > 0,
                            },
                        );
                    }
                }
            }
            while running.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(600));
                let Ok(meta) = std::fs::metadata(&log_path) else {
                    continue;
                };
                let size = meta.len();
                if size < last_size {
                    last_size = 0;
                }
                if size > last_size {
                    if let Ok(mut f) = std::fs::File::open(&log_path) {
                        if f.seek(SeekFrom::Start(last_size)).is_ok() {
                            let mut buf = String::new();
                            if f.read_to_string(&mut buf).is_ok() && !buf.is_empty() {
                                let _ = app.emit(
                                    "log-chunk",
                                    LogChunk {
                                        content: buf,
                                        truncated: false,
                                    },
                                );
                            }
                        }
                    }
                    last_size = size;
                }
            }
        });
    }
}

