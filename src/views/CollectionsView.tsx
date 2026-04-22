import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModInfo, Preset } from "../types";

interface Props {
  mods: ModInfo[];
  toast: (msg: string, type?: string) => void;
  onRefresh: () => void;
}

export default function CollectionsView({ mods, toast, onRefresh }: Props) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");

  const loadPresets = async () => {
    try {
      const list = await invoke<Preset[]>("list_presets");
      setPresets(list);
    } catch (e) {
      console.error("list_presets:", e);
    }
  };

  useEffect(() => { loadPresets(); }, []);

  const createPreset = async () => {
    if (!newName.trim()) { toast("Enter a preset name", "error"); return; }
    const enabledIds = mods.filter((m) => m.enabled).map((m) => m.id);
    if (enabledIds.length === 0) { toast("No active mods to save", "error"); return; }
    try {
      await invoke("create_preset", {
        name: newName.trim(),
        modIds: enabledIds,
        note: newNote.trim() || null,
      });
      setNewName("");
      setNewNote("");
      loadPresets();
      toast(`Preset "${newName}" created with ${enabledIds.length} mods`, "success");
    } catch (e: any) {
      toast(e?.toString() || "Failed to create preset", "error");
    }
  };

  const applyPreset = async (preset: Preset) => {
    try {
      await invoke("apply_preset", { id: preset.id });
      onRefresh();
      toast(`Applied preset "${preset.name}"`, "success");
    } catch (e: any) {
      toast(e?.toString() || "Failed to apply preset", "error");
    }
  };

  const deletePreset = async (preset: Preset) => {
    if (!confirm(`Delete preset "${preset.name}"?`)) return;
    try {
      await invoke("delete_preset", { id: preset.id });
      loadPresets();
      toast(`Deleted "${preset.name}"`, "info");
    } catch (e: any) {
      toast(e?.toString() || "Failed to delete", "error");
    }
  };

  const updatePreset = async (preset: Preset) => {
    const enabledIds = mods.filter((m) => m.enabled).map((m) => m.id);
    try {
      await invoke("update_preset", { id: preset.id, modIds: enabledIds });
      loadPresets();
      toast(`Updated "${preset.name}" with ${enabledIds.length} mods`, "success");
    } catch (e: any) {
      toast(e?.toString() || "Failed to update", "error");
    }
  };

  const formatDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="animate-fade-in p-8 overflow-y-auto" style={{ height: "100%" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Mod Presets</h1>
        <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Save and switch between different mod configurations</p>
      </div>

      {/* Create new */}
      <div className="glass-card" style={{ padding: 24, marginBottom: 32, borderTop: "4px solid var(--color-accent)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255, 157, 0, 0.1)", color: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            💾
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Save Current Config</h3>
            <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>
              Save all <strong style={{ color: "var(--color-text)" }}>{mods.filter((m) => m.enabled).length}</strong> active mods as a preset
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <input
              className="input-field"
              placeholder="Preset Name (e.g. 'Vanilla Expanded Run', 'Hardcore SK')"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1, fontSize: 14, padding: "12px 16px" }}
            />
            <button className="btn-primary" onClick={createPreset} style={{ padding: "0 24px", fontSize: 14 }}>Save Preset</button>
          </div>
          <input
            className="input-field"
            placeholder="Notes (optional) — describe what this preset is for..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            style={{ fontSize: 13, background: "rgba(0,0,0,0.2)" }}
          />
        </div>
      </div>

      {/* Preset list */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
          Saved Presets ({presets.length})
        </h3>
        
        {presets.length === 0 ? (
          <div className="glass-card" style={{ textAlign: "center", padding: "80px 40px", borderStyle: "dashed" }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>📁</div>
            <h3 style={{ color: "var(--color-text-muted)", marginBottom: 8 }}>No Presets Yet</h3>
            <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Save your current mod list above to create your first preset.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {presets.map((preset) => (
              <div key={preset.id} className="glass-card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 16, transition: "var(--transition)" }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
                  📦
                </div>
                
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                    <h4 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--color-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {preset.name}
                    </h4>
                    <span className="badge" style={{ background: "rgba(255, 157, 0, 0.1)", color: "var(--color-accent)", borderColor: "rgba(255, 157, 0, 0.2)" }}>
                      {preset.mod_ids.length} Mods
                    </span>
                  </div>
                  
                  {preset.note && (
                    <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8, fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      "{preset.note}"
                    </div>
                  )}
                  
                  <div style={{ fontSize: 11, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
                    Updated: {formatDate(preset.updated_at)}
                  </div>
                </div>
                
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button 
                    className="btn-secondary" 
                    onClick={() => updatePreset(preset)}
                    title="Overwrite with current active mods"
                  >
                    🔄 Update
                  </button>
                  <button 
                    className="btn-primary" 
                    onClick={() => applyPreset(preset)}
                    style={{ background: "linear-gradient(135deg, var(--color-success), #059669)", color: "white" }}
                  >
                    ▶ Apply
                  </button>
                  <button 
                    className="btn-secondary" 
                    onClick={() => deletePreset(preset)}
                    style={{ padding: "8px 12px", color: "var(--color-danger)", borderColor: "rgba(239, 68, 68, 0.2)" }}
                    title="Delete Preset"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
