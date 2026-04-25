# RimPro — Roadmap

Living document. Track tech debt, feature ideas, and quality work that didn't fit into a release.

Status: as of v0.7.0 (2026-04-25)

---

## P0 — Stability & Quality (must-do before v1.0)

### Test coverage
- [ ] Unit tests for `auto_sort.rs` (DAG topo sort, cycle detection, anchor edges).
- [ ] Unit tests for `crash_analyzer.rs` (regex extraction against real Player.log fixtures).
- [ ] Unit tests for `mods.rs` About.xml parser (edge cases: missing tags, weird encoding, BOM).
- [ ] Integration tests for `steam_db.rs` lookup (mock JSON).
- [ ] Frontend: at least smoke tests for ModsView, LoadOrderView with React Testing Library.

### `lib.rs` refactor
Currently 1400+ lines, 60+ commands in one file. Split into:
- [ ] `commands/mods.rs` — list, enable, set_load_order, etc.
- [ ] `commands/workshop.rs` — webview lifecycle, navigation.
- [ ] `commands/optimize.rs` — texconv invocations.
- [ ] `commands/crash.rs` — analyze, AI passthrough.
- [ ] `commands/settings.rs` — paths, exe, backups.
- [ ] Keep `lib.rs` as registry only.

### State management
- [ ] Replace `Mutex<RimWorldPaths>` with `tokio::sync::RwLock` to avoid blocking command threads.
- [ ] Channel-based progress events instead of `app.emit` strings.

### Real Linux/Mac testing
- CI builds pass but no real user has booted them. Need:
- [ ] Linux: verify Player.log path on Flatpak/Snap install (different from native Steam).
- [ ] macOS: codesign + notarize the `.dmg` so Gatekeeper doesn't block.
- [ ] Confirm `texconv` swap (CPU encoder) on non-Windows since `texconv.exe` is Windows-only. Alternative: `compressonatorcli` (AMD) or pure-Rust `image_dds` crate (already in deps but not wired for optimize path).

### Version sync
- [ ] Sidebar hardcodes `v1.0.0-PRO` while `Cargo.toml` and `tauri.conf.json` say 0.7.0. Pull version from `package.json` at build time (`import.meta.env.PACKAGE_VERSION`) and inject.

---

## P1 — Feature Polish

### Crash Analyzer (Tier 1, just landed)
- [ ] Response cache by `hash(stacktrace)` to avoid re-burning Gemini quota on identical crashes.
- [ ] Auto-suggest disabling AI suspect mods with one click (toggle the heuristic suggestion into a real action).
- [ ] Save analysis history (`crash_history.json`) so user can review past sessions.
- [ ] Auto-detect when game crashes (file watch on Player.log) and show notification to open analyzer.
- [ ] Multi-language AI output: English + Vietnamese done, add Russian/Chinese/Korean (large RimWorld mod scenes).

### i18n hardening
- [ ] Audit views for hardcoded English fallback strings (`t('x') || 'English fallback'` pattern). Replace with proper keys.
- [ ] Lint rule that flags missing keys.
- [ ] Add zh-CN, ru, ko if community submits.

### Workshop browser
- [ ] Auto-close child webview after 30s on tab leave to free 80-150MB RAM (currently only `hide()`).
- [ ] Detect Steam login state, show "log in to subscribe" hint.
- [ ] Bookmark mod pages.

### Mod compatibility matrix
- [ ] Show "this mod conflicts with X" inline using community DB (already pulled, just need UI).
- [ ] Pairwise incompatibility highlighter in Load Order view.

### Save-game migration
- [ ] When user removes a mod from a save's mod list, scan `.rws` for references to that mod's defs/things and offer to:
  - Strip them (lossy, save loads but kills affected pawns/items).
  - Block save (warn user it will crash on load).

### Profile/preset sharing
- [ ] Export preset → JSON or modlist.txt (RimSort-compatible format).
- [ ] Import friend's preset, fetch missing Workshop IDs via SteamCMD.

### Auto-update
- [ ] Tauri updater plugin wired to GitHub Releases.
- [ ] Signature verification.

### Telemetry (opt-in)
- [ ] Anonymous crash reporter for the **app itself** (not the game).
- [ ] Opt-in only, off by default. Clear toggle in Settings.

### Cross-platform optimize fallback
- [ ] Wire `image_dds` Rust crate (already in `Cargo.toml`) for non-Windows, removing the `texconv.exe`-only restriction on Mac/Linux.
- [ ] CPU encoder toggle in Settings (`-gpu 0`) for users without DX11-capable GPUs.

---

## v1.0 ship checklist

When P0 + P1 = done → cut v1.0.

- [ ] All P0 boxes ticked.
- [ ] All P1 boxes ticked.
- [ ] Beta tested ≥2 weeks by ≥5 real users on each platform.
- [ ] Zero P0/P1 bugs in issue tracker.
- [ ] CHANGELOG.md complete back to 0.4.9.
- [ ] README.md screenshots updated.
- [ ] Release notes written.

---

## Notes & decisions

- **Why no Electron:** RAM cost. RimSort (PySide6) eats 500MB; we sit at 200MB. Tauri webview shares with Edge/WebKit2GTK already on system.
- **Why Gemini default for AI:** free tier 1500 req/day Flash, JSON mode native, no proxy needed. Claude required proxy + paid from day 1.
- **Why community rules over RimSort dependency:** they maintain the data, we consume — full credit to RimSort team. Closing the gap on resolution (numeric `publishedFileId` → `packageId`) was the missing piece, now done.
- **Why repo named `Rimworld-Mod-Manager` not `RimPro`:** historical, kept for SEO/links. Brand is RimPro everywhere user-facing.

---

Last updated: 2026-04-25

---

<details>
<summary><b>🔒 Post-1.0 ideas (parked — do NOT pull into 1.0 scope)</b></summary>

Kept here so we don't forget. Revisit after v1.0 ships and we have real telemetry.

### AI Tier 2 — smart-fix engine
- After AI identifies suspect, **execute** the fix automatically:
  - "Disable mod X" → toggle in `ModsConfig.xml`.
  - "Move mod Y above Z" → write `customRules.json` rule.
  - "Update mod" → trigger SteamCMD redownload.
- User confirms each step before exec (dry-run preview).
- **Why parked:** AI auto-execute is high-risk. Lỡ disable nhầm Core mod = user mất save. Need v1.0 telemetry to confirm AI accuracy >90% trước khi cho tự execute.

### AI Tier 2 — pre-launch lint
- Before launching RimWorld, run heuristic + cached AI analysis on current mod list.
- Surface "this combo crashed user X" via crowdsourced (anonymous) crash hashes.
- **Why parked:** needs backend service for crash hash sharing.

### AI Tier 2 — auto load-order suggestion
- When community rules + custom rules conflict, ask AI to propose resolution.
- Mod description embedding → semantic similarity → suggest mods you'd like.

### Local LLM polish
- Auto-detect Ollama running, populate model dropdown from `/api/tags`.
- One-click `ollama pull llama3.1` from Settings if Ollama installed but model missing.

### Mod authoring helpers
- About.xml validator + linter.
- Texture pre-flight (warn if mod ships uncompressed PNGs over 1024px).
- Patch operations syntax checker.
- **Why parked:** different audience (mod authors, not players). Tách repo riêng.

### Plugin/extension API
- Allow third-party Tauri commands or a simple JS plugin model so power users can extend without forking.
- **Why parked:** need stable v1.0 API surface trước khi cam kết extension contract.

### Cloud preset sync
- Cloud-sync user presets across devices.
- **Why parked:** needs backend, auth, ToS. Major scope.

</details>
