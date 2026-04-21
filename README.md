# RimWorld Mod Manager

A fast, modern mod manager for RimWorld — works with **both Steam and cracked/offline builds**. Downloads Workshop mods via SteamCMD anonymous login (with public-mirror fallback), manages load order, detects conflicts, and ships with a gorgeous dark UI.

*(English below — [Tiếng Việt](#tiếng-việt) bên dưới)*

![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-18-61DAFB?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript) ![Rust](https://img.shields.io/badge/Rust-stable-orange?logo=rust)

---

## Download

Grab the latest Windows installer from the [**Releases page**](https://github.com/khoyga007/Rimworld-Mod-Manager/releases/latest).

---

## Features

### 📦 Mod Management
- **Full mod library** — scans `Mods/`, `SW_mod/`, and Steam Workshop directories automatically.
- **Enable/Disable** — toggle mods with a single click. Core & DLC mods are protected from accidental disable.
- **Search & Filter** — find mods instantly by name, author, or package ID.
- **Delete mods** — remove unwanted mods directly from the app.

### 📊 Load Order
- **Drag-and-drop reorder** — intuitive drag handles to arrange your load order.
- **Auto-sort** — hybrid DAG + bucket topological sort using each mod's `loadAfter`, `loadBefore`, and `modDependencies`, with smart bucket classification (Harmony → Core → DLC → Libraries → General → Patches → Performance).
- **Cycle detection** — detects circular dependencies and reports them clearly instead of silently breaking.
- **Search in Load Order** — quickly locate any mod in a long list.

### ⬇ Downloads
- **SteamCMD anonymous** — first-try provider. No Steam account needed, no purchase required.
- **Batch mode** — download multiple mods in a single SteamCMD session for maximum speed.
- **Web-mirror fallback** — if SteamCMD fails, automatically tries `steamworkshop.download`, `steamworkshopdownloader.io`, and `smods.ru`.
- **Collection support** — paste a Workshop Collection URL, app fetches the list and queues everything.
- **Real-time progress** — live download progress with mod title resolved via Steam Workshop API.
- **Manual fallback** — built-in link to `steamworkshopdownloader.io` + zip import if all else fails.

### 🏰 Save Game Analyzer
- **List all saves** — scans your RimWorld save directory, shows colony name, mod count, game version, and file size.
- **Mod compatibility check** — click any save to instantly see which mods are missing from your current install.
- **One-click enable** — enable all missing mods that are already installed but inactive.

### 📜 Smart Game Logs
- **Filter by severity** — toggle between All / Errors / Warnings / Mod-related lines.
- **Search** — full-text search across the entire log.
- **Live Tail** — real-time log streaming while the game is running.
- **Color-coded** — errors in red, warnings in yellow, with severity icons.

### 📁 Presets
- **Save mod loadouts** — snapshot your current enabled mods as a named preset.
- **One-click restore** — switch between different mod configurations instantly.
- **Update presets** — overwrite an existing preset with your current mod list.

### 🛡️ Safety & Reliability
- **Atomic file writes** — `ModsConfig.xml` is written to a temp file first, then renamed. No more corrupted configs from crashes.
- **Mandatory mod protection** — Core and official DLCs cannot be accidentally disabled.
- **Automatic backups** — snapshots of `ModsConfig.xml` before every write.
- **Case-insensitive matching** — handles mixed-case package IDs correctly (e.g., `Mehni.PickUpAndHaul`).
- **Zip Slip protection** — malicious archive paths are rejected during extraction.

---

## Install & Run (Development)

```bash
# Prerequisites: Node 18+, npm, Rust stable, Windows
git clone https://github.com/khoyga007/Rimworld-Mod-Manager.git
cd Rimworld-Mod-Manager
npm install
npx tauri dev
```

Production build:

```bash
npx tauri build
# Installer → src-tauri/target/release/bundle/
```

---

## Networking Notes

SteamCMD talks to Steam's CM servers. Some ISPs block these connections — if SteamCMD fails with `No connection`, enable **Cloudflare WARP** (free) and retry. The app will auto-fall-back to web mirrors when SteamCMD is unavailable, but SteamCMD is significantly faster and more reliable.

---

## Architecture

| Layer       | Stack                                                        |
|-------------|--------------------------------------------------------------|
| Frontend    | React 18, TypeScript, Tailwind v4, Vanilla CSS               |
| Shell       | Tauri 2                                                      |
| Backend     | Rust (`reqwest`, `tokio`, `quick-xml`, `zip`, `anyhow`)      |
| Downloads   | SteamCMD subprocess + `reqwest` mirror clients               |
| Persistence | JSON files in `AppData/Roaming/RimWorldMM` + RimWorld `ModsConfig.xml` |

Key modules in `src-tauri/src/`:

| Module          | Purpose                                              |
|-----------------|------------------------------------------------------|
| `mods.rs`       | Mod scanning, enable/disable, `ModsConfig.xml` I/O   |
| `about.rs`      | `About.xml` parser (path-stack based, handles `<li>`) |
| `auto_sort.rs`  | Kahn's algorithm + bucket sort + cycle detection      |
| `workshop.rs`   | Meta fetching, mirror providers, zip extraction       |
| `steamcmd.rs`   | SteamCMD lifecycle, single and batch download         |
| `savegame.rs`   | Save file header parsing, missing mod detection       |
| `collections.rs`| Preset/playset persistence                            |
| `backups.rs`    | `ModsConfig.xml` snapshot management                  |
| `log_tail.rs`   | Real-time `Player.log` streaming                      |

---

<a name="tiếng-việt"></a>
# RimWorld Mod Manager *(Tiếng Việt)*

Trình quản lý mod RimWorld nhanh, hiện đại — **chạy được cho cả bản Steam lẫn bản crack/offline**. Tải mod Workshop qua SteamCMD anonymous (có fallback sang các mirror công khai), quản lý load order, phát hiện xung đột, giao diện dark đẹp.

## Tải về

Tải installer Windows mới nhất ở [**trang Releases**](https://github.com/khoyga007/Rimworld-Mod-Manager/releases/latest).

## Tính năng

### 📦 Quản lý Mod
- **Quét đầy đủ** — tự động quét `Mods/`, `SW_mod/`, và thư mục Steam Workshop.
- **Bật/Tắt mod** — 1 click. Core & DLC được bảo vệ không thể tắt nhầm.
- **Tìm kiếm** — tìm mod ngay lập tức theo tên, tác giả, hoặc package ID.

### 📊 Load Order
- **Kéo-thả** — sắp xếp thứ tự mod bằng cách kéo thả trực quan.
- **Sắp xếp tự động** — thuật toán DAG + bucket sort dựa trên `loadAfter`, `loadBefore`, `modDependencies`. Phân nhóm thông minh: Harmony → Core → DLC → Thư viện → Chung → Patch → Hiệu năng.
- **Phát hiện vòng lặp** — phát hiện và báo cáo circular dependency thay vì âm thầm sắp sai.

### ⬇ Tải mod
- **SteamCMD anonymous** — không cần tài khoản Steam hay mua game.
- **Chế độ batch** — tải nhiều mod trong 1 phiên SteamCMD duy nhất.
- **Fallback web mirror** — tự động thử các mirror khi SteamCMD fail.
- **Hỗ trợ Collection** — dán URL Collection, app tải hết.

### 🏰 Phân tích Save Game
- **Danh sách save** — hiển thị tên colony, số mod, phiên bản game, dung lượng.
- **Kiểm tra tương thích** — click vào save để xem mod nào đang thiếu.
- **Bật nhanh** — enable tất cả mod thiếu đã cài nhưng chưa bật.

### 📜 Game Logs thông minh
- **Lọc theo mức độ** — All / Errors / Warnings / Mod logs.
- **Tìm kiếm** — full-text search toàn bộ log.
- **Live Tail** — theo dõi log realtime khi game đang chạy.

### 🛡️ An toàn
- **Ghi file nguyên tử** — ghi vào file tạm rồi rename, không bao giờ hỏng config.
- **Bảo vệ mod bắt buộc** — Core và DLC không thể bị tắt nhầm.
- **Backup tự động** — snapshot `ModsConfig.xml` trước mỗi lần ghi.

## Cài đặt & Chạy (Dev)

```bash
git clone https://github.com/khoyga007/Rimworld-Mod-Manager.git
cd Rimworld-Mod-Manager
npm install
npx tauri dev
```

## Lưu ý mạng

SteamCMD kết nối đến Steam CM servers. Một số ISP tại Việt Nam chặn kết nối này — nếu SteamCMD báo `No connection`, **bật Cloudflare WARP** (miễn phí) rồi thử lại.

---

## License

Personal project — no license specified yet.
