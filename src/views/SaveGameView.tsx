import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SaveGameInfo, SaveAnalysis } from "../types";

interface Props {
  toast: (msg: string, type?: string) => void;
  onRefresh: () => void;
}

export default function SaveGameView({ toast, onRefresh }: Props) {
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
      toast(e?.toString() || "Failed to load saves", "error");
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
        toast(`Found ${result.missing_mods.length} missing mod(s)`, "warning");
      } else {
        toast("All mods present! Save is compatible ✓", "success");
      }
    } catch (e: any) {
      toast(e?.toString() || "Analysis failed", "error");
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
    toast("Attempted to enable all missing mods", "info");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--color-accent)", margin: 0 }}>
          Save Games
        </h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={loadSaves}>🔄 Refresh</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--color-text-dim)" }}>
          <div style={{ width: 28, height: 28, border: "3px solid var(--color-border)", borderTop: "3px solid var(--color-accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
          Scanning saves...
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : saves.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--color-text-dim)" }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>🗺️</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>No save games found</div>
          <div style={{ fontSize: 12 }}>Start a colony in RimWorld to create save files.</div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16, flex: 1, overflow: "hidden" }}>
          {/* Save list */}
          <div style={{ width: 340, flexShrink: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {saves.map((save) => (
              <button
                key={save.file_name}
                onClick={() => analyzeSave(save.file_name)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: 14,
                  background: selectedSave === save.file_name ? "var(--color-bg-active)" : "var(--color-bg-card)",
                  border: selectedSave === save.file_name ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  color: "var(--color-text)",
                }}
                onMouseEnter={(e) => {
                  if (selectedSave !== save.file_name) e.currentTarget.style.background = "var(--color-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (selectedSave !== save.file_name) e.currentTarget.style.background = "var(--color-bg-card)";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>🏰</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {save.colony_name || save.file_name.replace(".rws", "")}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-dim)", marginTop: 2, display: "flex", gap: 8 }}>
                      <span>{save.mod_ids.length} mods</span>
                      <span>•</span>
                      <span>{formatSize(save.file_size)}</span>
                      {save.game_version && (
                        <>
                          <span>•</span>
                          <span>v{save.game_version.split(" ")[0]}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Analysis panel */}
          <div style={{ flex: 1, overflow: "auto" }}>
            {analyzing ? (
              <div className="glass-card" style={{ padding: 40, textAlign: "center", color: "var(--color-text-dim)" }}>
                <div style={{ width: 28, height: 28, border: "3px solid var(--color-border)", borderTop: "3px solid var(--color-accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                Analyzing save file...
              </div>
            ) : analysis ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Save info header */}
                <div className="glass-card" style={{ padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 32 }}>🏰</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--color-accent)" }}>
                        {analysis.save.colony_name || analysis.save.file_name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-dim)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        {analysis.save.game_version && <span>🎮 {analysis.save.game_version}</span>}
                        {analysis.save.seed && <span>🌱 Seed: {analysis.save.seed}</span>}
                        <span>📦 {analysis.save.mod_ids.length} mods</span>
                        <span>💾 {formatSize(analysis.save.file_size)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div className="glass-card" style={{ padding: 14, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text)" }}>{analysis.save.mod_ids.length}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Mods</div>
                  </div>
                  <div className="glass-card" style={{ padding: 14, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--color-success)" }}>{analysis.present_mods.length}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Present</div>
                  </div>
                  <div className="glass-card" style={{ padding: 14, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: analysis.missing_mods.length > 0 ? "var(--color-danger)" : "var(--color-success)" }}>
                      {analysis.missing_mods.length}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Missing</div>
                  </div>
                </div>

                {/* Missing mods */}
                {analysis.missing_mods.length > 0 && (
                  <div className="glass-card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 15 }}>⚠️</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-warning)" }}>Missing Mods</span>
                      <button className="btn-primary" style={{ marginLeft: "auto", fontSize: 11, padding: "4px 10px" }} onClick={enableMissing}>
                        Enable All Installed
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {analysis.missing_mods.map((mod) => (
                        <div key={mod.id} style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "8px 10px", background: "var(--color-bg)", borderRadius: 6,
                          border: "1px solid rgba(176, 64, 64, 0.3)",
                        }}>
                          <span style={{ color: "var(--color-danger)", fontSize: 13 }}>✕</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {mod.name}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
                              {mod.id}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Present mods (collapsible) */}
                <details className="glass-card" style={{ padding: 16 }}>
                  <summary style={{ fontSize: 14, fontWeight: 600, cursor: "pointer", color: "var(--color-success)", display: "flex", alignItems: "center", gap: 8 }}>
                    <span>✓</span> Present Mods ({analysis.present_mods.length})
                  </summary>
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                    {analysis.present_mods.map((id) => (
                      <div key={id} style={{ fontSize: 12, padding: "4px 8px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                        {id}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ) : (
              <div className="glass-card" style={{ padding: 60, textAlign: "center", color: "var(--color-text-dim)" }}>
                <div style={{ fontSize: 42, marginBottom: 12 }}>👈</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-muted)" }}>Select a save file</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Click a save on the left to check mod compatibility</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
