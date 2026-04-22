import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { ModInfo, Preset } from "../types";

interface Props {
  mods: ModInfo[];
  toast: (msg: string, type?: string) => void;
  onRefresh: () => void;
  selectedPresetId: string;
  setSelectedPresetId: (id: string) => void;
}

export default function CollectionsView({ mods, toast, onRefresh, selectedPresetId, setSelectedPresetId }: Props) {
  const { t } = useTranslation();
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
    if (!newName.trim()) { toast(t('collections.enter_name_error'), "error"); return; }
    const enabledIds = mods.filter((m) => m.enabled).map((m) => m.id);
    if (enabledIds.length === 0) { toast(t('collections.no_active_error'), "error"); return; }
    try {
      await invoke("create_preset", {
        name: newName.trim(),
        modIds: enabledIds,
        note: newNote.trim() || null,
      });
      setNewName("");
      setNewNote("");
      loadPresets();
      toast(t('collections.create_success', { name: newName, count: enabledIds.length }), "success");
    } catch (e: any) {
      toast(e?.toString() || t('common.error'), "error");
    }
  };

  const applyPreset = async (preset: Preset) => {
    try {
      await invoke("apply_preset", { id: preset.id });
      setSelectedPresetId(preset.id);
      onRefresh();
      toast(t('collections.apply_success', { name: preset.name }), "success");
    } catch (e: any) {
      toast(e?.toString() || t('common.error'), "error");
    }
  };

  const deletePreset = async (preset: Preset) => {
    if (!confirm(t('collections.delete_confirm', { name: preset.name }))) return;
    try {
      await invoke("delete_preset", { id: preset.id });
      if (selectedPresetId === preset.id) {
        setSelectedPresetId("");
      }
      loadPresets();
      toast(t('collections.delete_success', { name: preset.name }), "info");
    } catch (e: any) {
      toast(e?.toString() || t('common.error'), "error");
    }
  };

  const updatePreset = async (preset: Preset) => {
    const enabledIds = mods.filter((m) => m.enabled).map((m) => m.id);
    try {
      await invoke("update_preset", { id: preset.id, modIds: enabledIds });
      loadPresets();
      toast(t('collections.update_success', { name: preset.name, count: enabledIds.length }), "success");
    } catch (e: any) {
      toast(e?.toString() || t('common.error'), "error");
    }
  };

  const formatDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const activeCount = mods.filter((m) => m.enabled).length;

  return (
    <div className="animate-fade-in p-8 overflow-y-auto" style={{ height: "100%" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{t('collections.title')}</h1>
        <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>{t('collections.subtitle')}</p>
      </div>

      {/* Create new */}
      <div className="glass-card" style={{ padding: 24, marginBottom: 32, borderTop: "4px solid var(--color-accent)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255, 157, 0, 0.1)", color: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            💾
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('collections.save_current')}</h3>
            <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>
              {t('collections.save_desc', { count: activeCount })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <input
              className="input-field"
              placeholder={t('collections.preset_name_placeholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1, fontSize: 14, padding: "12px 16px" }}
            />
            <button className="btn-primary" onClick={createPreset} style={{ padding: "0 24px", fontSize: 14 }}>{t('collections.save_preset')}</button>
          </div>
          <input
            className="input-field"
            placeholder={t('collections.notes_placeholder')}
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            style={{ fontSize: 13, background: "rgba(0,0,0,0.2)" }}
          />
        </div>
      </div>

      {/* Preset list */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
          {t('collections.saved_presets', { count: presets.length })}
        </h3>
        
        {presets.length === 0 ? (
          <div className="glass-card" style={{ textAlign: "center", padding: "80px 40px", borderStyle: "dashed" }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>📁</div>
            <h3 style={{ color: "var(--color-text-muted)", marginBottom: 8 }}>{t('collections.no_presets')}</h3>
            <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>{t('collections.no_presets_desc')}</p>
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
                    {selectedPresetId === preset.id && (
                      <span className="badge" style={{ background: "rgba(16, 185, 129, 0.1)", color: "var(--color-success)", borderColor: "rgba(16, 185, 129, 0.2)" }}>
                        {t('common.active') || 'ACTIVE'}
                      </span>
                    )}
                    <span className="badge" style={{ background: "rgba(255, 157, 0, 0.1)", color: "var(--color-accent)", borderColor: "rgba(255, 157, 0, 0.2)" }}>
                      {t('collections.mods_count', { count: preset.mod_ids.length })}
                    </span>
                  </div>
                  
                  {preset.note && (
                    <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8, fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      "{preset.note}"
                    </div>
                  )}
                  
                  <div style={{ fontSize: 11, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
                    {t('collections.updated')}: {formatDate(preset.updated_at)}
                  </div>
                </div>
                
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button 
                    className="btn-secondary" 
                    onClick={() => updatePreset(preset)}
                    title={t('collections.update_title')}
                  >
                    🔄 {t('collections.update')}
                  </button>
                  <button 
                    className="btn-primary" 
                    onClick={() => applyPreset(preset)}
                    style={{ background: "linear-gradient(135deg, var(--color-success), #059669)", color: "white" }}
                  >
                    ▶ {t('collections.apply')}
                  </button>
                  <button 
                    className="btn-secondary" 
                    onClick={() => deletePreset(preset)}
                    style={{ padding: "8px 12px", color: "var(--color-danger)", borderColor: "rgba(239, 68, 68, 0.2)" }}
                    title={t('collections.delete_title')}
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
