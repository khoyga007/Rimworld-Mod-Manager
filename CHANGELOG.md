# Changelog

All notable changes to this project will be documented in this file.

## [0.5.9] - 2026-04-24

### Fixed
- **Steam DB Duplicate Field Parse Error**: v0.5.8 added `serde(alias)` to accept both `packageId` and `packageid`, but most entries in RimSort's Steam DB contain BOTH keys on the same object. Serde treats aliases as duplicates of the same field and aborted parsing of the entire 44MB file, leaving the reverse map empty and Auto-Install Missing reporting every dependency as unresolved. Split into two separate optional fields (`packageId` + `packageid`) and merge at lookup time.

## [0.5.8] - 2026-04-24

### Fixed
- **Steam DB Field Name**: The `SteamEntry` deserializer was keyed on `packageid` (all lowercase). RimSort's Steam Workshop Database actually uses `packageId` (camelCase) on the vast majority of entries, so the reverse map came out empty and Auto-Install Missing reported every dependency as unresolved. The field now accepts both spellings via `serde(alias)`.

## [0.5.7] - 2026-04-24

### Added
- **Auto-Install Missing Dependencies**: When the Load Order analyzer detects missing dependencies, a new "Auto-Install Missing" button resolves each `packageId` against the cached Steam DB, feeds the matching Workshop IDs to SteamCMD, and reports any entries that could not be resolved. Closes the loop between dependency detection and fixing.

## [0.5.6] - 2026-04-24

### Added
- **Steam Workshop DB Integration**: RimPro now downloads and uses the RimSort Steam Workshop Database to resolve dependency references that point at numeric `publishedFileId` values. This closes the last gap in dependency resolution versus RimSort and means auto-sort correctly orders mods that declare their dependencies by Steam Workshop ID instead of `packageId`.
- **Steam DB Button**: New button in the Load Order toolbar to fetch/refresh the Steam DB cache on demand.

## [0.5.5] - 2026-04-24

### Added
- **Compression Format Selector**: New toolbar dropdown in the Mods view lets you pick `SMART`, `BC7`, or `BC1` for both Optimize and Resize. The selection now applies to per-mod buttons as well as the batch "Optimize All" / "Resize All" actions.

### Changed
- **Smart Compression Is Actually Smart**: The `smart` format now resolves per-file instead of falling through to BC1. It detects normal maps by filename (`_normal`, `_nrm`, `_norm`, `normalmap`) and encodes them as BC5, uses BC7 for textures with alpha (best quality, same VRAM as BC3), and keeps BC1 for opaque textures (half the VRAM of BC7). Behaviour is now consistent between Optimize and Resize paths.

## [0.5.2] - 2026-04-22

### Added
- **Performance Mode Options**: Added a dedicated Settings toggle for Performance Mode, a separate Disable Thumbnails option, and automatic suggestions when very large mod libraries are detected.

### Changed
- **Low-End Library Handling**: Added debounced search for large mod lists and large Mod Hub manifests to keep typing responsive on older PCs.
- **Thumbnail Loading Strategy**: Thumbnail prefetch now follows the visible virtualized rows instead of eagerly queuing the whole list.

### Fixed
- **Dependency Guard Reliability**: Hub installs now identify the newly installed mod more robustly before reporting missing dependencies.
- **NEW Tag Regression**: Restored automatic NEW badges for recently discovered mods.
- **Settings Scrolling**: Fixed the Settings page so mouse-wheel scrolling works when the content is taller than the window.
- **Disable Thumbnails Behavior**: Thumbnail rendering is now fully suppressed when the option is enabled, including thumbnails that were already cached.
- **Mods View Save Semantics**: Enable/disable actions now stay local until Save, instead of partially persisting immediately.
- **Large Library Performance**: Reduced avoidable O(n^2) work in backend load-order rebuilds and in frontend Mod Hub installed-state checks.

## [0.5.1] - 2026-04-22

### Added
- **Community-Verified Auto-Sort**: Added a "Magic Wand" button to automatically sort active mods based on community-recommended load order rules.
- **Mod Size Analysis**: Integrated a visual breakdown of mod sizes on disk, helping users identify VRAM-heavy textures.
- **Glassmorphism UI Polish**: Implemented a professional, semi-transparent layout with custom `ResizeObserver` logic for perfectly fitted virtual lists.

### Fixed
- **Texture Flip Fix**: Added mandatory `-vflip` flag to `texconv` operations. This ensures textures (especially trees) are oriented correctly for Unity/RimWorld during optimization.
- **Stability Improvements**: Resolved "black screen" rendering issues by replacing problematic external layout libraries with native browser APIs.
- **Case-Sensitive Compatibility**: Fixed a bug where forcing mod IDs to lowercase prevented the game from recognizing some mods; original casing is now preserved in `ModsConfig.xml`.
- **Command Sync**: Synchronized frontend invocations with Rust backend command registry to prevent `InvokeError`.

## [0.5.0] - 2026-04-22

### Added
- **Deep Thumbnail Search**: Improved preview image discovery logic that scans subdirectories (`About/`, `Textures/`, etc.) for image files containing "preview" in their name. This fixes missing thumbnails for many local and third-party mods.
- **Manual Refresh Button**: Added a dedicated "Refresh" button in the ModsView action bar to allow users to force a full mod list rescan and clear the internal cache.
- **CI/CD Reliability**: Added `.npmrc` with `legacy-peer-deps=true` to handle React 19 compatibility during automated builds.

### Changed
- **Major UI/UX Overhaul**: Standardized layout padding (`p-8`), scroll behavior (`overflow-y-auto`), and card styling across all views (Load Order, Save Games, Mod Hub, etc.).
- **Mod Hub Intelligence**: 
    - Improved "Installed" state detection using robust normalized name and ID comparisons.
    - Implemented automatic UI refresh after a mod is successfully installed from the Hub.
- **Standardized Navigation**: Consistent header alignment and professional-grade spacing across the entire application.
- **Upgraded Tech Stack**: Full support for React 19 and Tauri 2.0 features.

### Fixed
- Fixed a bug where switching tabs in the Mod Hub would lose the "Installed" button state.
- Fixed layout breakage in the Logs and Save Game views due to inconsistent padding.
- Fixed missing Lucide icon imports and unused variable warnings during production builds.
- Fixed a compilation error in the Rust backend regarding the `list_presets` command signature.

## [0.4.9] - 2026-04-21
- Initial release with GPU Texture Optimization (texconv) and basic Load Order management.
- SteamCMD integration for anonymous mod downloads.
