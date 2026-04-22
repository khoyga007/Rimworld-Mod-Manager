import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { SaveGameInfo, SaveAnalysis } from "../types";

interface Props {
  toast: (msg: string, type?: string) => void;
  onRefresh: () => void;
}

export default function SaveGameView({ toast, onRefresh }: Props) {
  const { t } = useTranslation();
  const [saves, setSaves] = useState<SaveGameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<SaveAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedSave, setSelectedSave] = useState<string | null>(null);

  const loadSaves = async () => {
    try {
      setLoading(true);
      const list = await invoke<SaveGameInfo[]>("list_save_games");
      setSaves(list);
    } catch (e: any) {
      toast(e?.toString() || t('save_games.failed_to_load'), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSaves(); }, []);

  const analyzeSave = async (fileName: string) => {
    try {
      setAnalyzing(true);
      setSelectedSave(fileName);
      const result = await invoke<SaveAnalysis>("analyze_save_game", { fileName });
      setAnalysis(result);
      if (result.missing_mods.length > 0) {
        toast(t('save_games.missing_mods_found', { count: result.missing_mods.length }), "warning");
      } else {
        toast(t('save_games.all_mods_present'), "success");
      }
    } catch (e: any) {
      toast(e?.toString() || t('common.error'), "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const enableMissing = async () => {
    if (!analysis) return;
    for (const mod of analysis.missing_mods) {
      try {
        await invoke("set_mod_enabled", { id: mod.id, enabled: true });
      } catch (_) { /* mod might not be installed */ }
    }
    onRefresh();
    toast(t('save_games.attempt_enable'), "info");
  };

  return (
    <div className="animate-fade-in p-8" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{t('save_games.title')}</h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>{t('save_games.subtitle')}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <button className="btn-secondary" onClick={loadSaves} title={t('save_games.refresh_title')} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>🔄</span> {t('save_games.refresh')}
          </button>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{saves.length}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 4 }}>{t('save_games.saves_found')}</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="glass-card" style={{ textAlign: "center", padding: "80px 40px", borderStyle: "dashed" }}>
          <div style={{ width: 40, height: 40, border: "4px solid var(--color-border)", borderTop: "4px solid var(--color-accent)", borderRadius: "50%", animation: "spin 1s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite", margin: "0 auto 20px" }} />
          <h3 style={{ color: "var(--color-text-muted)", marginBottom: 8 }}>{t('save_games.scanning')}</h3>
          <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>{t('save_games.scanning_desc')}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : saves.length === 0 ? (
        <div className="glass-card" style={{ textAlign: "center", padding: "80px 40px", borderStyle: "dashed" }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>🗺️</div>
          <h3 style={{ color: "var(--color-text-muted)", marginBottom: 8 }}>{t('save_games.no_saves')}</h3>
          <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>{t('save_games.no_saves_desc')}</p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 24, flex: 1, overflow: "hidden" }}>
          {/* Save list */}
          <div style={{ width: 340, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 8 }}>
            {saves.map((save) => (
              <div
                key={save.file_name}
                onClick={() => analyzeSave(save.file_name)}
                className="glass-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px",
                  cursor: "pointer",
                  background: selectedSave === save.file_name ? "var(--color-accent-glow)" : "var(--color-bg-card)",
                  borderLeft: selectedSave === save.file_name ? "4px solid var(--color-accent)" : "4px solid transparent",
                  transform: selectedSave === save.file_name ? "scale(1.01)" : "none",
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 8, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                  🏰
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: selectedSave === save.file_name ? "#fff" : "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
                    {save.colony_name || save.file_name.replace(".rws", "")}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-dim)", display: "flex", gap: 8 }}>
                    <span style={{ color: "var(--color-accent)", fontWeight: 500 }}>{t('save_games.mods_count', { count: save.mod_ids.length })}</span>
                    <span>•</span>
                    <span>{formatSize(save.file_size)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Analysis panel */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 24 }}>
            {analyzing ? (
              <div className="glass-card" style={{ padding: 60, textAlign: "center" }}>
                <div style={{ width: 40, height: 40, border: "4px solid var(--color-border)", borderTop: "4px solid var(--color-accent)", borderRadius: "50%", animation: "spin 1s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite", margin: "0 auto 20px" }} />
                <h3 style={{ color: "var(--color-text-muted)" }}>{t('save_games.analyzing')}</h3>
              </div>
            ) : analysis ? (
              <div className="animate-slide-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Save info header */}
                <div className="glass-card" style={{ padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 64, height: 64, borderRadius: 16, background: "rgba(255, 157, 0, 0.1)", color: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>
                      🏰
                    </div>
                    <div style={{ flex: 1 }}>
                      <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>
                        {analysis.save.colony_name || analysis.save.file_name}
                      </h2>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {analysis.save.game_version && <span className="badge">🎮 {t('save_games.version')} {analysis.save.game_version}</span>}
                        {analysis.save.seed && <span className="badge">🌱 {t('save_games.seed')}: {analysis.save.seed}</span>}
                        <span className="badge">💾 {formatSize(analysis.save.file_size)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                  <div className="glass-card" style={{ padding: 20, textAlign: "center", borderTop: "4px solid var(--color-border)" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>{analysis.save.mod_ids.length}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{t('save_games.total_mods')}</div>
                  </div>
                  <div className="glass-card" style={{ padding: 20, textAlign: "center", borderTop: "4px solid var(--color-success)", background: "linear-gradient(180deg, rgba(16, 185, 129, 0.05) 0%, transparent 100%)" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "var(--color-success)", marginBottom: 4 }}>{analysis.present_mods.length}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{t('save_games.present')}</div>
                  </div>
                  <div className="glass-card" style={{ padding: 20, textAlign: "center", borderTop: analysis.missing_mods.length > 0 ? "4px solid var(--color-danger)" : "4px solid var(--color-border)", background: analysis.missing_mods.length > 0 ? "linear-gradient(180deg, rgba(239, 68, 68, 0.05) 0%, transparent 100%)" : "transparent" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: analysis.missing_mods.length > 0 ? "var(--color-danger)" : "var(--color-text)", marginBottom: 4 }}>
                      {analysis.missing_mods.length}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{t('save_games.missing')}</div>
                  </div>
                </div>

                {/* Missing mods */}
                {analysis.missing_mods.length > 0 && (
                  <div className="glass-card" style={{ padding: 24, borderLeft: "4px solid var(--color-danger)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(239, 68, 68, 0.2)", color: "var(--color-danger)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✕</div>
                        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--color-danger)" }}>{t('save_games.missing_mods')}</h3>
                      </div>
                      <button className="btn-primary" onClick={enableMissing}>
                        {t('save_games.enable_installed')}
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {analysis.missing_mods.map((mod) => (
                        <div key={mod.id} style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "12px 16px", background: "rgba(0,0,0,0.2)", borderRadius: 8,
                          border: "1px solid rgba(239, 68, 68, 0.2)",
                        }}>
                          <span style={{ color: "var(--color-danger)", fontSize: 14 }}>✕</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>
                              {mod.name}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
                              {mod.id}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Present mods (collapsible) */}
                <details className="glass-card" style={{ padding: 24 }}>
                  <summary style={{ fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(16, 185, 129, 0.2)", color: "var(--color-success)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✓</div>
                    <span>{t('save_games.present_mods')} ({analysis.present_mods.length})</span>
                  </summary>
                  <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                    {analysis.present_mods.map((id) => (
                      <div key={id} style={{ fontSize: 12, padding: "8px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 6, border: "1px solid var(--color-border)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {id}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ) : (
              <div className="glass-card" style={{ padding: "100px 40px", textAlign: "center", borderStyle: "dashed" }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>👈</div>
                <h3 style={{ color: "var(--color-text-muted)", marginBottom: 8 }}>{t('save_games.select_save')}</h3>
                <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>{t('save_games.select_save_desc')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
