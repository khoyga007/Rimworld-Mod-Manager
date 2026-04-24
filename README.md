# RimPro — RimWorld Mod Manager

A modern, performance-focused mod manager for RimWorld. Built with Rust (Tauri 2) + React 19.

Windows, Linux, and macOS (universal) installers are published on every release.

![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![Rust](https://img.shields.io/badge/Rust-stable-orange?logo=rust) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

> Repo slug is `Rimworld-Mod-Manager` for history reasons. The app brand is **RimPro**.

---

## Highlights

### In-app Steam Workshop browser *(new in 0.7.0)*
- **Native embedded browser** — a dedicated "Duyệt Workshop" tab loads `steamcommunity.com/app/294100/workshop/` inside the app window via a Tauri child webview. No external browser, no `X-Frame-Options` issues.
- **1-click download** — the "Tải mod này" / "Download this mod" button reads the current URL, extracts the Workshop ID, and queues the mod through the existing SteamCMD pipeline. Auto-disables when you're not on a mod detail page.
- **Full navigation** — Back / Forward / Home / Reload buttons plus an editable URL bar. History controls are wired through `history.back()/forward()` via Tauri's `webview.eval`.
- **Session reused** — webview closes when you switch tabs (frees RAM) and recreates on re-entry.

### Load order
- **Community-rules auto-sort** — pulls the same `communityRules.json` that RimSort uses, runs a full DAG topological sort (Kahn's algorithm), honors bucket ordering (Harmony → Core → DLCs → Libraries → Total Conversion → Map/Biomes → Race → General → Animation → UI → Patch → Performance), and enforces anchor edges.
- **Steam Workshop DB integration** — fetches RimSort's `steamDB.json` and resolves dependencies declared by numeric `publishedFileId` to the correct `packageId` before sorting. Closes the last resolution gap vs. RimSort.
- **Custom rules editor** — per-mod `loadAfter` / `loadBefore` / pin-to-top / pin-to-bottom overrides. Saved to `customRules.json`, merged on top of the community rules so your overrides always win.
- **Alphabetical mode** — one-click A-Z sort with Core + DLCs pinned at the top.
- **Dependency analyzer** — missing deps, cycles, incompatibilities, and out-of-order mods are all surfaced with fixable suggestions.
- **Auto-install missing** — resolves every missing `packageId` against the Steam DB, queues the matching Workshop IDs through SteamCMD. Reports what it couldn't find.
- **Manual drag-and-drop** with local-edit / save / discard flow.

### Mod library
- **Deep thumbnail search** — scans `About/`, `Textures/`, etc. for any image containing `preview` in the name, so third-party mods that don't ship a `Preview.png` still get thumbnails.
- **Mod Hub** — browse + install from curated manifests, with robust installed-state detection (normalized name + ID comparison).
- **Size analysis** — visual breakdown of every mod's on-disk footprint, highlights VRAM-heavy texture mods.
- **Tags, notes, per-mod preview override**.
- **Bulk enable/disable with local-edit buffer** — nothing is written to `ModsConfig.xml` until you Save.

### Texture optimization
`texconv.exe` (Microsoft DirectXTex) is invoked in parallel via `rayon` to transcode PNGs to DDS. Mip generation is forced off (`-m 1`) and BC block compression cuts VRAM 4–8×.

Three formats in the toolbar dropdown:

| Format | Compression | VRAM vs. raw PNG | Quality |
|--------|-------------|------------------|---------|
| **BC1** | Fixed 6:1 | 1/8 | Good for opaque textures |
| **BC7** | Fixed 4:1 | 1/4 | Best; same size as BC3, better quality |
| **SMART** (default) | Per-file heuristic | Varies | **Auto-picks** |

Smart mode resolves per file:
- `_normal`, `_nrm`, `_norm`, `normalmap` in the filename → **BC5** (two-channel, clean normals)
- Has alpha channel → **BC7** (best quality)
- Opaque → **BC1** (half the VRAM of BC7)

Applies equally to per-mod **Optimize** and batch **Optimize All** / **Resize All**. Textures are flipped with `-vflip` so Unity / RimWorld orientation is correct (fixes the classic upside-down tree bug).

### Saves & backups
- **Save-game analyzer** — parses `.rws` files, lists mods referenced by the save, flags missing ones.
- **ModsConfig backups** — every destructive action auto-backs up. Restore via Settings.

### Performance
- **React virtualization** (`react-window`) on every long list.
- **Debounced search** for large libraries.
- **Thumbnail prefetch follows visible rows only** — no more eager loading 1000+ images.
- **Performance Mode toggle** + separate **Disable Thumbnails** option for low-end PCs. Auto-suggested when a very large library is detected.

---

## Install

### Pre-built binaries (recommended)

Grab the installer for your platform from [Releases](../../releases/latest):

| Platform | Installer |
|----------|-----------|
| Windows  | `.msi` or `.exe` (NSIS) |
| Linux    | `.deb`, `.rpm`, or `.AppImage` |
| macOS    | `.dmg` (universal: Intel + Apple Silicon) |

### Linux runtime deps

Ubuntu/Debian:
```bash
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libappindicator3-1 librsvg2-2
```

---

## Build from source

Requires Rust (stable), Node 20+, and platform-specific Tauri prerequisites: <https://tauri.app/start/prerequisites/>.

```bash
git clone https://github.com/khoyga007/Rimworld-Mod-Manager.git
cd Rimworld-Mod-Manager
npm ci --legacy-peer-deps
npm run tauri dev      # hot-reload dev build
npm run tauri build    # production installer into src-tauri/target/release/bundle
```

Linux extras:
```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
                 patchelf libgtk-3-dev libssl-dev build-essential curl wget file
```

---

## How auto-sort works (short version)

1. Load all mods, keep the ones that are either enabled or are Core/DLCs.
2. Load community rules from `communityRules.json` (RimSort feed), custom rules from `customRules.json`, and the Steam DB for numeric-ID resolution.
3. For each mod, collect hard dependencies → emit `MissingDependency` if the target isn't installed, otherwise add a DAG edge.
4. Collect soft `loadAfter` / `loadBefore` edges from the mod's About.xml **plus** both rule sources. Numeric `publishedFileId` references are resolved to `packageId` via the Steam DB before matching.
5. Enforce anchor edges (Core before every DLC, DLCs in Ludeon's canonical order).
6. Kahn's algorithm: pull zero-in-degree mods, tie-break by bucket order → DLC weight → original load order → alphabetical name.
7. Anything with residual in-degree is stuck in a cycle — emit `Cycle` issue and append at the end.

Total runtime on a 500-mod list: sub-second.

---

## Project layout

```
src/              # React 19 + TypeScript frontend
  components/     # Reusable UI (CustomRulesModal, CustomDialog, etc.)
  views/          # Top-level pages (ModsView, LoadOrderView, SaveGamesView, ...)
  types/          # Shared TS types mirrored from Rust structs
src-tauri/
  src/
    auto_sort.rs      # DAG topo sort, bucket classification, anchor edges
    custom_rules.rs   # User-authored rule persistence
    steam_db.rs       # pfid <-> packageId resolution
    steamcmd.rs       # SteamCMD integration for Workshop downloads
    optimize.rs       # texconv pipeline, Smart format heuristic
    mods.rs           # About.xml parsing, ModsConfig read/write
    savegame.rs       # .rws analyzer
    ...
  tauri.conf.json
  Cargo.toml
.github/workflows/release.yml  # matrix CI: Windows + Linux + macOS
```

---

## Release / CI

Pushing to `main` with a bumped version triggers `.github/workflows/release.yml`:

1. **Prepare** — verifies `package.json` version matches `tauri.conf.json`, checks whether a release for that tag already exists, creates the git tag if not.
2. **Build matrix** — `windows-latest`, `ubuntu-22.04`, `macos-latest` run in parallel. Each invokes `tauri-action`, which compiles, packages, and uploads its installer to the same GitHub Release.

To cut a release, bump the three version fields (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`), commit, push. The rest is automatic.

---

## Credits

- **[RimSort](https://github.com/RimSort/RimSort)** — the community rules and Steam Workshop DB feeds this app consumes are maintained by the RimSort team. Full credit to them for the data.
- **[Tauri](https://tauri.app/)** — Rust + webview app shell.
- **[DirectXTex / texconv](https://github.com/microsoft/DirectXTex)** — BC block compression pipeline.

See [CHANGELOG.md](CHANGELOG.md) for the full version history.
