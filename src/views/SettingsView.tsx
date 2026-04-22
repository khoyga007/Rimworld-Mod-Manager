import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import type { AppSettings, PerformanceLevel, RimWorldPaths } from "../types";

interface Props {
  paths: RimWorldPaths | null;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onPathsChange: (p: RimWorldPaths) => void;
  toast: (msg: string, type?: string) => void;
}

export default function SettingsView({ paths, settings, onSettingsChange, onPathsChange, toast }: Props) {
  const { t } = useTranslation();
  const [exePath, setExePath] = useState<string>("");
  const performanceEnabled = settings.performanceLevel !== "normal";
  const ultraPerformance = settings.performanceLevel === "ultra";

  const updateSettings = (patch: Partial<AppSettings>, toastKey?: string) => {
    const next = { ...settings, ...patch };
    onSettingsChange(next);
    if (toastKey) {
      toast(t(toastKey), "success");
    }
  };

  // Load stored exe on mount
  useEffect(() => {
    invoke<string | null>("get_stored_exe_path").then((p) => {
      if (p) setExePath(p);
    });
  }, []);

  const browseGameDir = async () => {
    const selected = await open({ directory: true, title: t('settings.game_directory') });
    if (selected) {
      try {
        const p = await invoke<RimWorldPaths>("set_user_dir", { path: selected });
        onPathsChange(p);
        toast(t('mods.optimization_complete'), "success"); // Reuse or add new key
      } catch (e: any) {
        toast(e?.toString() || "Error", "error");
      }
    }
  };

  const browseExe = async () => {
    const selected = await open({
      filters: [{ name: "Executable", extensions: ["exe"] }],
      title: t('settings.rimworld_exe'),
    });
    if (selected) {
      try {
        await invoke("set_stored_exe_path", { path: selected });
        setExePath(selected as string);
        toast("OK!", "success");
      } catch (e: any) {
        toast(e?.toString() || "Error", "error");
      }
    }
  };

  return (
    <div className={`${ultraPerformance ? '' : 'animate-fade-in'} flex-1 overflow-y-auto custom-scrollbar p-8`} style={{ minHeight: 0 }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{t('settings.title')}</h1>
        <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>{t('settings.description')}</p>
      </div>

      {/* Game Directory */}
      <section className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255, 157, 0, 0.1)", color: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            📂
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('settings.game_directory')}</h3>
            <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>{t('settings.game_directory_desc')}</div>
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              className="input-field"
              value={paths?.game_dir || ""}
              readOnly
              placeholder="..."
              style={{ background: "rgba(0,0,0,0.2)", cursor: "default" }}
            />
            {paths?.game_dir && (
              <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-success)", fontSize: 14 }}>✓</span>
            )}
          </div>
          <button className="btn-primary" onClick={browseGameDir}>{t('common.browse')}</button>
        </div>
      </section>

      {/* Executable */}
      <section className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(59, 130, 246, 0.1)", color: "var(--color-info)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            🎮
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('settings.rimworld_exe')}</h3>
            <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>{t('settings.rimworld_exe_desc')}</div>
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              className="input-field"
              value={exePath}
              readOnly
              placeholder="..."
              style={{ background: "rgba(0,0,0,0.2)", cursor: "default" }}
            />
            {exePath && (
              <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-success)", fontSize: 14 }}>✓</span>
            )}
          </div>
          <button className="btn-primary" onClick={browseExe}>{t('common.browse_file')}</button>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <section className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(34, 197, 94, 0.12)", color: "#86efac", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              ⚡
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('settings.performance_level')}</h3>
              <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>{t('settings.performance_level_desc')}</div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {([
              ["normal", "settings.performance_normal", "settings.performance_normal_desc"],
              ["performance", "settings.performance_mode", "settings.performance_mode_desc"],
              ["ultra", "settings.ultra_performance", "settings.ultra_performance_desc"],
            ] as [PerformanceLevel, string, string][]).map(([level, titleKey, descKey]) => (
              <button
                key={level}
                type="button"
                onClick={() => updateSettings({
                  performanceLevel: level,
                  dismissedPerformanceSuggestion: level !== "normal" ? true : settings.dismissedPerformanceSuggestion,
                }, `settings.${level === "normal" ? "performance_normal_on" : level === "performance" ? "performance_mode_on" : "ultra_performance_on"}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: 14,
                  borderRadius: 12,
                  border: settings.performanceLevel === level ? "1px solid rgba(34,197,94,0.35)" : "1px solid var(--color-border)",
                  background: settings.performanceLevel === level ? "rgba(34, 197, 94, 0.08)" : "rgba(0,0,0,0.2)",
                  color: "var(--color-text)",
                }}
              >
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t(titleKey)}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-dim)", marginTop: 4 }}>{t(descKey)}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {settings.performanceLevel === level ? "ACTIVE" : ""}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('settings.performance_toggles')}</h3>
              <div style={{ fontSize: 13, color: "var(--color-text-dim)", marginTop: 6 }}>{t('settings.performance_toggles_desc')}</div>
            </div>

            <button
              type="button"
              onClick={() => updateSettings({ disableThumbnails: !settings.disableThumbnails }, settings.disableThumbnails ? 'settings.disable_thumbnails_off' : 'settings.disable_thumbnails_on')}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: 14,
                borderRadius: 12,
                border: `1px solid ${settings.disableThumbnails ? "rgba(59,130,246,0.35)" : "var(--color-border)"}`,
                background: settings.disableThumbnails ? "rgba(59,130,246,0.08)" : "rgba(0,0,0,0.2)",
                color: "var(--color-text)",
              }}
            >
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.disable_thumbnails')}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-dim)", marginTop: 4 }}>{t('settings.disable_thumbnails_desc')}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{settings.disableThumbnails ? "ON" : "OFF"}</div>
            </button>

            <button
              type="button"
              onClick={() => updateSettings({ autoSuggestPerformanceMode: !settings.autoSuggestPerformanceMode, dismissedPerformanceSuggestion: false }, settings.autoSuggestPerformanceMode ? 'settings.performance_suggestion_off' : 'settings.performance_suggestion_on')}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: 14,
                borderRadius: 12,
                border: `1px solid ${settings.autoSuggestPerformanceMode ? "rgba(168,85,247,0.35)" : "var(--color-border)"}`,
                background: settings.autoSuggestPerformanceMode ? "rgba(168,85,247,0.08)" : "rgba(0,0,0,0.2)",
                color: "var(--color-text)",
              }}
            >
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.auto_suggest_performance')}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-dim)", marginTop: 4 }}>{t('settings.auto_suggest_performance_desc')}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{settings.autoSuggestPerformanceMode ? "ON" : "OFF"}</div>
            </button>

            {performanceEnabled && (
              <div style={{ fontSize: 12, color: "var(--color-text-dim)", paddingTop: 6 }}>
                {t('settings.performance_mode_hint')}
              </div>
            )}
          </div>
        </section>

        {/* Config Info */}
        <section className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255, 255, 255, 0.05)", color: "var(--color-text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              📋
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('settings.system_paths')}</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 8, border: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>ModsConfig.xml</div>
              <div 
                style={{ fontSize: 13, color: "var(--color-accent)", cursor: "pointer", wordBreak: "break-all" }}
                onClick={() => paths?.mods_config_path && invoke("open_path_or_url", { target: paths.mods_config_path })}
                title="Open file location"
              >
                {paths?.mods_config_path || "N/A"}
              </div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 8, border: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Config Directory</div>
              <div 
                style={{ fontSize: 13, color: "var(--color-accent)", cursor: "pointer", wordBreak: "break-all" }}
                onClick={() => paths?.config_dir && invoke("open_path_or_url", { target: paths.config_dir })}
                title="Open directory"
              >
                {paths?.config_dir || "N/A"}
              </div>
            </div>
          </div>
        </section>

        {/* About */}
        <section className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, marginBottom: 16, boxShadow: "0 8px 16px rgba(0,0,0,0.2)" }}>
            🚀
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", color: "var(--color-accent)" }}>RIMPRO</h3>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12 }}>v1.0.0-PRO</div>
          <p style={{ fontSize: 13, color: "var(--color-text-dim)", margin: 0, lineHeight: 1.5 }}>
            Built with Rust + Tauri + React.<br/>
            Engineered for RimWorld modders.
          </p>
        </section>
      </div>
      </div>
    </div>
  );
}
