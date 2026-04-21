import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModInfo } from "../types";

interface Props {
  mods: ModInfo[];
  onRefresh: () => void;
  toast: (msg: string, type?: string) => void;
}

export default function ModsView({ mods, onRefresh, toast }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<ModInfo[] | null>(null);
  const [dirty, setDirty] = useState(false);

  const baseMods = localOrder ?? mods;

  const filtered = baseMods.filter((m) => {
    if (filter === "enabled" && !m.enabled) return false;
    if (filter === "disabled" && m.enabled) return false;
    if (search) {
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.author.toLowerCase().includes(q);
    }
    return true;
  });

  const canDrag = !search && filter === "all";

  const toggleMod = async (id: string, enabled: boolean) => {
    try {
      await invoke("set_mod_enabled", { id, enabled });
      onRefresh();
      setLocalOrder(null);
      setDirty(false);
    } catch (e: any) {
      toast(e?.toString() || "Failed", "error");
    }
  };

  const enableAll = async () => {
    await invoke("set_all_mods_enabled", { enabled: true });
    onRefresh();
    setLocalOrder(null);
    toast("All mods enabled", "success");
  };

  const disableAll = async () => {
    await invoke("set_all_mods_enabled", { enabled: false });
    onRefresh();
    setLocalOrder(null);
    toast("All mods disabled", "info");
  };

  const deleteMod = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This removes the mod files permanently.`)) return;
    try {
      await invoke("delete_mod", { id });
      onRefresh();
      setLocalOrder(null);
      toast(`Deleted ${name}`, "info");
    } catch (e: any) {
      toast(e?.toString() || "Delete failed", "error");
    }
  };

  const autoSort = async () => {
    try {
      const result = await invoke<string[]>("apply_auto_sort");
      onRefresh();
      setLocalOrder(null);
      setDirty(false);
      toast(`Auto-sorted ${result.length} mods`, "success");
    } catch (e: any) {
      toast(e?.toString() || "Sort failed", "error");
    }
  };

  const saveOrder = async () => {
    if (!localOrder) return;
    try {
      const enabledIds = localOrder.filter((m) => m.enabled).map((m) => m.id);
      await invoke("set_load_order", { ids: enabledIds });
      onRefresh();
      setLocalOrder(null);
      setDirty(false);
      toast("Load order saved!", "success");
    } catch (e: any) {
      toast(e?.toString() || "Save failed", "error");
    }
  };

  const resetOrder = () => {
    setLocalOrder(null);
    setDirty(false);
  };

  // Drag handlers
  const handleDragStart = (idx: number) => {
    if (!canDrag) return;
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    if (!canDrag) return;
    e.preventDefault();
    setHoverIdx(idx);
  };

  const handleDrop = (idx: number) => {
    if (!canDrag || dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setHoverIdx(null);
      return;
    }
    const items = [...baseMods];
    const [moved] = items.splice(dragIdx, 1);
    items.splice(idx, 0, moved);
    setLocalOrder(items);
    setDirty(true);
    setDragIdx(null);
    setHoverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setHoverIdx(null);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input-field"
          placeholder="Search mods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />

        <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
          {(["all", "enabled", "disabled"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                background: filter === f ? "var(--color-accent)" : "var(--color-bg-card)",
                color: filter === f ? "#1a1612" : "var(--color-text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: filter === f ? 600 : 400,
                textTransform: "capitalize",
                transition: "all 0.15s",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {dirty && (
            <>
              <button className="btn-secondary" onClick={resetOrder}>↩ Reset</button>
              <button className="btn-primary" onClick={saveOrder}>💾 Save Order</button>
            </>
          )}
          <button className="btn-secondary" onClick={enableAll}>Enable All</button>
          <button className="btn-secondary" onClick={disableAll}>Disable All</button>
          <button className="btn-primary" onClick={autoSort}>⚡ Auto-Sort</button>
        </div>
      </div>

      {/* Unsaved changes */}
      {dirty && (
        <div style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-warning)",
          borderRadius: 8,
          padding: "8px 16px",
          marginBottom: 12,
          fontSize: 12,
          color: "var(--color-warning)",
        }}>
          ⚠ Drag order changed. Click <strong>Save Order</strong> to apply.
        </div>
      )}

      {/* Mod count + hint */}
      <div style={{ fontSize: 12, color: "var(--color-text-dim)", marginBottom: 12, display: "flex", justifyContent: "space-between" }}>
        <span>Showing {filtered.length} of {baseMods.length} mods</span>
        {canDrag && <span style={{ fontStyle: "italic" }}>💡 Drag mods to reorder</span>}
      </div>

      {/* Mod list */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: 60,
          color: "var(--color-text-dim)",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "var(--color-text-muted)" }}>
            {baseMods.length === 0 ? "No mods found" : "No mods match your filter"}
          </div>
          <div style={{ fontSize: 13 }}>
            {baseMods.length === 0
              ? "Set your RimWorld game directory in Settings to detect mods."
              : "Try adjusting your search or filter."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {filtered.map((mod, i) => {
            const globalIdx = baseMods.indexOf(mod);
            return (
              <div
                key={mod.id}
                draggable={canDrag}
                onDragStart={() => handleDragStart(globalIdx)}
                onDragOver={(e) => handleDragOver(e, globalIdx)}
                onDrop={() => handleDrop(globalIdx)}
                onDragEnd={handleDragEnd}
                className="glass-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 14px",
                  gap: 12,
                  transition: "all 0.15s ease",
                  opacity: mod.enabled ? 1 : 0.6,
                  cursor: canDrag ? "grab" : "default",
                  borderTop: hoverIdx === globalIdx && dragIdx !== null && dragIdx !== globalIdx
                    ? "2px solid var(--color-accent)"
                    : "2px solid transparent",
                  background: dragIdx === globalIdx
                    ? "var(--color-accent-glow)"
                    : "var(--color-bg-card)",
                }}
                onMouseEnter={(e) => {
                  if (dragIdx === null) {
                    e.currentTarget.style.background = "var(--color-bg-hover)";
                    e.currentTarget.style.borderColor = "var(--color-border-strong)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (dragIdx === null) {
                    e.currentTarget.style.background = "var(--color-bg-card)";
                    e.currentTarget.style.borderColor = "var(--color-border)";
                  }
                }}
              >
                {/* Drag handle */}
                {canDrag && (
                  <span style={{ color: "var(--color-text-dim)", fontSize: 12, cursor: "grab", userSelect: "none", flexShrink: 0 }}>
                    ⠿
                  </span>
                )}

                {/* Toggle */}
                <div
                  className={`toggle ${mod.enabled ? "active" : ""}`}
                  onClick={() => toggleMod(mod.id, !mod.enabled)}
                />

                {/* Preview image */}
                {mod.picture ? (
                  <img
                    src={mod.picture}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 40, height: 40, borderRadius: 4,
                    background: "var(--color-bg)", border: "1px solid var(--color-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, flexShrink: 0,
                  }}>📦</div>
                )}

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    color: mod.enabled ? "var(--color-text)" : "var(--color-text-muted)",
                  }}>
                    {mod.name}
                  </div>
                  <div style={{
                    fontSize: 11, color: "var(--color-text-dim)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {mod.author && <span>{mod.author} • </span>}
                    <span>{mod.id}</span>
                  </div>
                </div>

                {/* Size */}
                <div style={{ fontSize: 11, color: "var(--color-text-dim)", flexShrink: 0, minWidth: 50, textAlign: "right" }}>
                  {formatSize(mod.size_bytes)}
                </div>

                {/* Load order badge */}
                {mod.enabled && (
                  <div style={{
                    fontSize: 10, fontWeight: 700,
                    background: "var(--color-accent-glow)",
                    color: "var(--color-accent)",
                    padding: "2px 8px", borderRadius: 10,
                    flexShrink: 0,
                  }}>
                    #{mod.load_order + 1}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => invoke("open_path_or_url", { target: mod.path })}
                    title="Open folder"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--color-text-dim)", fontSize: 14,
                      padding: "4px 6px", borderRadius: 4,
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "var(--color-text)"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "var(--color-text-dim)"}
                  >
                    📂
                  </button>
                  <button
                    onClick={() => deleteMod(mod.id, mod.name)}
                    title="Delete mod"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--color-text-dim)", fontSize: 14,
                      padding: "4px 6px", borderRadius: 4,
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "var(--color-danger)"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "var(--color-text-dim)"}
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
