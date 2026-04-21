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
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--color-accent)", marginBottom: 20 }}>
        Mod Presets
      </h2>

      {/* Create new */}
      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>💾 Save Current Mods as Preset</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            className="input-field"
            placeholder="Preset name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn-primary" onClick={createPreset}>Save</button>
        </div>
        <input
          className="input-field"
          placeholder="Notes (optional)"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
        />
        <div style={{ fontSize: 11, color: "var(--color-text-dim)", marginTop: 8 }}>
          This will save all {mods.filter((m) => m.enabled).length} currently active mods.
        </div>
      </div>

      {/* Preset list */}
      {presets.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--color-text-dim)" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>No presets yet</div>
          <div style={{ fontSize: 12 }}>Save your current mod list above to create your first preset.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {presets.map((preset) => (
            <div key={preset.id} className="glass-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{preset.name}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-dim)", marginTop: 2 }}>
                    {preset.mod_ids.length} mods • {formatDate(preset.updated_at)}
                  </div>
                  {preset.note && (
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4, fontStyle: "italic" }}>
                      {preset.note}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn-primary" onClick={() => applyPreset(preset)}>Apply</button>
                  <button className="btn-secondary" onClick={() => updatePreset(preset)}>Update</button>
                  <button className="btn-danger" onClick={() => deletePreset(preset)}>🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
