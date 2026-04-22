# Changelog

All notable changes to this project will be documented in this file.

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
