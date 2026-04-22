# 🚀 RIMPRO

A high-performance, professional-grade mod manager for RimWorld. Engineered with **Rust** and **Tauri** for maximum safety, reliability, and speed. Works seamlessly with both Steam and offline/non-Steam builds.

![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18-61DAFB?logo=react) ![Rust](https://img.shields.io/badge/Rust-stable-orange?logo=rust) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript) ![Performance](https://img.shields.io/badge/Performance-Ultra--Fast-success)

---

## ⚡ Key Highlights (v0.2.x)

- **GPU Accelerated Texture Optimization**: Convert PNGs to high-quality DDS using `texconv` with hardware acceleration. Transform compression time from **hours to seconds**.
- **Smart VRAM Analysis**: Instantly identify "heavy" mods with high texture density. Highlights mods consuming >100MB of VRAM to help prioritize optimization.
- **Incremental Incremental Logic**: Built-in skip logic that detects already-optimized textures, making subsequent runs near-instant.
- **Instant Loading Cache**: Powered by a thread-safe Rust backend cache. Manage thousands of mods with **zero lag**.
- **Smart Mod Attribution**: Automatically categorizes mods by source (**Official**, **Workshop**, **Local**, **Other**) with a clear UI identification system.
- **Atomic Reliability**: Guaranteed integrity for `ModsConfig.xml` using atomic write operations and automatic backups.

---

## 📦 Main Features

### 🎮 Mod Management & Optimization
- **Smart Resize Wizard**: Target specific heavy mods for downscaling (512px, 1024px, 2048px). Reduces VRAM footprint by up to 80% while maintaining visual fidelity.
- **Texture Optimizer**: GPU-based PNG to DDS conversion. Fixes flipped textures, generates mipmaps, and drastically reduces game load times.
- **VRAM Badge System**: View real-time texture size metrics on every mod card to identify performance bottlenecks.
- **Source Badges**: Instantly identify where your mods came from for better organization.
- **Batch Actions**: Enable, disable, optimize, or backup entire libraries in seconds.
- **Protection Layer**: Core and DLC mods are protected from accidental modifications.

### 📊 Advanced Load Order
- **Smart Sort Engine**: Hybrid DAG + bucket topological sort based on RimPy-compatible community rules. Handles complex dependencies, load-after/before logic, and automatic category grouping (Harmony → Core → Libraries → Patches).
- **Conflict Detection**: Real-time analysis of missing dependencies, circular cycles, and load order issues.
- **Drag & Drop**: Intuitive management of your active mod list.

### ⬇️ Workshop Downloader
- **SteamCMD Integration**: Download mods anonymously without needing a Steam account.
- **Mirror Fallbacks**: Automatic fallback to web mirrors if SteamCMD is restricted by your ISP.
- **Collection Importer**: One-click download for entire Workshop collections.

### 🏰 Save & Log Tools
- **Save Analyzer**: Detect missing mods in your save files and enable them instantly.
- **Live Logs**: Real-time `Player.log` viewer with severity filtering and search.

---

## 📥 Download

Grab the latest release from the [**GitHub Releases**](https://github.com/khoyga007/Rimworld-Mod-Manager/releases/latest) page. Just download the `.exe` and run!

---

## 🛠️ Development (Quick Start)

The easiest way to get started is to use our **Quick Start helper**:
1. **Clone** the repository.
2. **Run `QuickStart.bat`**. It will automatically check for Node.js/Rust, install dependencies, and launch the app in dev mode.

Alternatively, via CLI:
```bash
# Prerequisites: Node 20+, Rust stable
git clone https://github.com/khoyga007/Rimworld-Mod-Manager.git
cd Rimworld-Mod-Manager
npm install
npm run tauri dev
```

---

<a name="tiếng-việt"></a>
# 🇻🇳 RIMPRO (Tiếng Việt)

Trình quản lý Mod chuyên nghiệp, hiệu năng cao dành cho RimWorld. Được xây dựng dựa trên nền tảng **Rust** và **Tauri**, mang lại sự an toàn tuyệt đối cho file cấu hình và tốc độ xử lý vượt trội.

### ✨ Những tính năng nổi bật
*   **Tối ưu ảnh bằng GPU**: Sử dụng sức mạnh card đồ họa để nén ảnh mod sang chuẩn DDS. Rút ngắn thời gian từ hàng tiếng đồng hồ xuống còn **vài giây**.
*   **Phân tích & Tối ưu VRAM**: Hệ thống quét dung lượng ảnh thông minh, tự động cảnh báo các Mod "ngốn" VRAM (>100MB) để anh em dễ dàng Resize và giải phóng bộ nhớ card đồ họa.
*   **Resize "đánh trọng điểm"**: Cho phép Resize lẻ từng Mod theo độ phân giải (512px, 1024px, 2048px). Giảm đến 80% dung lượng ảnh mà vẫn giữ được độ sắc nét.
*   **Xử lý gia tăng (Incremental)**: Tự động phát hiện và bỏ qua các file đã được tối ưu, giúp các lần chạy sau diễn ra gần như tức thì.
*   **Hệ thống Cache siêu tốc**: Danh sách mod nạp lên ngay lập tức nhờ bộ nhớ đệm thông minh.

### 🚀 Tải về
Vào trang [**Releases**](https://github.com/khoyga007/Rimworld-Mod-Manager/releases/latest) và tải file `.exe` mới nhất để sử dụng ngay.

## 🛠️ Dành cho Developer (Chạy bản nguồn)

Cách nhanh nhất để chạy bản nguồn là dùng file hỗ trợ cài đặt tự động:
1. **Clone** repository về máy.
2. **Chạy file `QuickStart.bat`**. Nó sẽ tự kiểm tra môi trường (Node.js, Rust), cài thư viện và khởi động app cho bạn.

---

## 📜 License & Credits
- **Author**: Yang (khoyga007)
- **Tech**: Built with Tauri, React, and Rust.
- **Sorting Rules**: Compatible with community-driven rulesets.

---
*RimWorld is a trademark of Ludeon Studios. This tool is not affiliated with Ludeon Studios.*
