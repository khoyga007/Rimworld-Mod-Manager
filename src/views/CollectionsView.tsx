import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { ModInfo, Preset } from "../types";
import CustomDialog from "../components/CustomDialog";

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
  
  // Steam Collection State
  const [collectionUrl, setCollectionUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [collectionData, setCollectionData] = useState<{
    id: string;
    items: { id: string; title: string; preview?: string; installed: boolean }[];
  } | null>(null);

  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: "confirm" | "prompt";
    title: string;
    message: string;
    defaultValue?: string;
    onConfirm: (val?: string) => void;
  }>({
    isOpen: false,
    type: "confirm",
    title: "",
    message: "",
    onConfirm: () => {}
  });

  const loadPresets = async () => {
    try {
      const list = await invoke<Preset[]>("list_presets");
      setPresets(list);
    } catch (e) {
      console.error("list_presets:", e);
    }
  };

  useEffect(() => { loadPresets(); }, []);

  // Steam Collection Logic
  const fetchCollection = async () => {
    if (!collectionUrl.trim()) return;
    setIsFetching(true);
    try {
      // Extract ID from URL if needed
      let id = collectionUrl.trim();
      if (id.includes("id=")) {
        id = id.split("id=")[1].split("&")[0];
      }

      const itemIds = await invoke<string[]>("fetch_collection", { collectionId: id });
      const metasRaw = await invoke<[string, any][]>("fetch_workshop_metas", { ids: itemIds });
      const metasMap = Object.fromEntries(metasRaw);

      const items = itemIds.map(itemId => ({
        id: itemId,
        title: metasMap[itemId]?.title || `Mod ${itemId}`,
        preview: metasMap[itemId]?.preview_url,
        installed: mods.some(m => m.remote_file_id === itemId || m.id === itemId)
      }));

      setCollectionData({ id, items });
    } catch (e: any) {
      toast(t('collections.invalid_id'), "error");
    } finally {
      setIsFetching(false);
    }
  };

  const downloadMissing = async () => {
    if (!collectionData) return;
    const missingIds = collectionData.items.filter(i => !i.installed).map(i => i.id);
    if (missingIds.length === 0) {
      toast(t('common.all_good'), "success");
      return;
    }
    try {
      await invoke("download_workshop_mods_batch", { ids: missingIds });
      toast(t('nav.downloads'), "info");
    } catch (e: any) {
      toast(e?.toString() || t('common.error'), "error");
    }
  };

  const syncCollection = async () => {
    if (!collectionData) return;
    setDialog({
      isOpen: true,
      type: "confirm",
      title: t('collections.sync_mods'),
      message: t('collections.sync_confirm'),
      onConfirm: async () => {
        try {
          const modIdsInCollection = collectionData.items.map(i => i.id);
          // Map workshop IDs to internal mod IDs
          const internalIds = mods
            .filter(m => m.remote_file_id && modIdsInCollection.includes(m.remote_file_id))
            .map(m => m.id);
          
          await invoke("set_enabled_set", { ids: internalIds });
          onRefresh();
          toast(t('collections.apply_success', { name: collectionData.id }), "success");
          setDialog(prev => ({ ...prev, isOpen: false }));
        } catch (e: any) {
          toast(e?.toString() || t('common.error'), "error");
        }
      }
    });
  };

  const createPresetFromCollection = async () => {
    if (!collectionData) return;
    try {
      const modIdsInCollection = collectionData.items.map(i => i.id);
      const internalIds = mods
        .filter(m => m.remote_file_id && modIdsInCollection.includes(m.remote_file_id))
        .map(m => m.id);

      await invoke("create_preset", {
        name: `Steam: ${collectionData.id}`,
        modIds: internalIds,
        note: `Imported from Steam Collection ${collectionData.id}`
      });
      loadPresets();
      toast(t('collections.create_success', { name: collectionData.id, count: internalIds.length }), "success");
    } catch (e: any) {
      toast(e?.toString() || t('common.error'), "error");
    }
  };

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
    setDialog({
      isOpen: true,
      type: "confirm",
      title: t('common.delete'),
      message: t('collections.delete_confirm', { name: preset.name }),
      onConfirm: async () => {
        try {
          await invoke("delete_preset", { id: preset.id });
          if (selectedPresetId === preset.id) {
            setSelectedPresetId("");
          }
          loadPresets();
          toast(t('collections.delete_success', { name: preset.name }), "info");
          setDialog(prev => ({ ...prev, isOpen: false }));
        } catch (e: any) {
          toast(e?.toString() || t('common.error'), "error");
        }
      }
    });
  };

  const updatePreset = async (preset: Preset) => {
    const enabledIds = mods.filter((m) => m.enabled).map((m) => m.id);
    setDialog({
      isOpen: true,
      type: "confirm",
      title: t('collections.update'),
      message: t('collections.update_confirm', { name: preset.name, count: enabledIds.length }) || `Update "${preset.name}" with current ${enabledIds.length} mods?`,
      onConfirm: async () => {
        try {
          await invoke("update_preset", { id: preset.id, modIds: enabledIds });
          loadPresets();
          toast(t('collections.update_success', { name: preset.name, count: enabledIds.length }), "success");
          setDialog(prev => ({ ...prev, isOpen: false }));
        } catch (e: any) {
          toast(e?.toString() || t('common.error'), "error");
        }
      }
    });
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
        {/* Create new Local Preset */}
        <div className="glass-card" style={{ padding: 24, borderTop: "4px solid var(--color-accent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255, 157, 0, 0.1)", color: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              💾
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('collections.save_current')}</h3>
              <div style={{ fontSize: 12, color: "var(--color-text-dim)" }}>
                {t('collections.save_desc', { count: activeCount })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              className="input-field"
              placeholder={t('collections.preset_name_placeholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ fontSize: 14, padding: "12px 16px" }}
            />
            <input
              className="input-field"
              placeholder={t('collections.notes_placeholder')}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              style={{ fontSize: 13, background: "rgba(0,0,0,0.2)" }}
            />
            <button className="btn-primary" onClick={createPreset} style={{ width: "100%", padding: "12px", fontSize: 14 }}>{t('collections.save_preset')}</button>
          </div>
        </div>

        {/* Steam Collection Import */}
        <div className="glass-card" style={{ padding: 24, borderTop: "4px solid #171a21" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(23, 26, 33, 0.1)", color: "#66c0f4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              🌐
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t('collections.steam_workshop')}</h3>
              <div style={{ fontSize: 12, color: "var(--color-text-dim)" }}>
                {t('collections.steam_desc')}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input-field"
                placeholder={t('collections.url_placeholder')}
                value={collectionUrl}
                onChange={(e) => setCollectionUrl(e.target.value)}
                style={{ flex: 1, fontSize: 14, padding: "12px 16px" }}
              />
              <button 
                className="btn-secondary" 
                onClick={fetchCollection} 
                disabled={isFetching}
                style={{ padding: "0 20px" }}
              >
                {isFetching ? "..." : t('collections.fetch')}
              </button>
            </div>
            
            {collectionData && (
              <div className="animate-fade-in" style={{ padding: 12, background: "rgba(0,0,0,0.2)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                  <span>{t('collections.items_found', { count: collectionData.items.length })}</span>
                  <span style={{ color: "var(--color-success)" }}>
                    {collectionData.items.filter(i => i.installed).length}/{collectionData.items.length} {t('mod_hub.installed')}
                  </span>
                </div>
                
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-primary" onClick={downloadMissing} style={{ flex: 1, fontSize: 12, padding: "8px" }}>
                    📥 {t('collections.download_missing')}
                  </button>
                  <button className="btn-secondary" onClick={syncCollection} style={{ flex: 1, fontSize: 12, padding: "8px" }}>
                    🔄 {t('collections.sync_mods')}
                  </button>
                  <button className="btn-secondary" onClick={createPresetFromCollection} style={{ flex: 1, fontSize: 12, padding: "8px" }}>
                    📂 {t('collections.create_preset')}
                  </button>
                </div>
              </div>
            )}
          </div>
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
                  {preset.name.startsWith("Steam:") ? "🌐" : "📦"}
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

      <CustomDialog
        isOpen={dialog.isOpen}
        type={dialog.type}
        title={dialog.title}
        message={dialog.message}
        defaultValue={dialog.defaultValue}
        onConfirm={dialog.onConfirm}
        onCancel={() => setDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
