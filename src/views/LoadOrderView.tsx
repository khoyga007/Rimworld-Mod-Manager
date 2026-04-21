import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModInfo, SortPreview, LoadOrderAnalysis } from "../types";

interface Props {
  mods: ModInfo[];
  toast: (msg: string, type?: string) => void;
  onRefresh: () => void;
}

export default function LoadOrderView({ mods, toast, onRefresh }: Props) {
  const [preview, setPreview] = useState<SortPreview | null>(null);
  const [analysis, setAnalysis] = useState<LoadOrderAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");

  // Drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<ModInfo[] | null>(null);

  const allEnabled = localOrder ?? mods.filter((m) => m.enabled).sort((a, b) => a.load_order - b.load_order);
  const enabledMods = search 
    ? allEnabled.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()))
    : allEnabled;

  const canDrag = !search;

  const previewSort = async () => {
    try {
      setLoading(true);
      const p = await invoke<SortPreview>("preview_auto_sort");
      setPreview(p);
    } catch (e: any) {
      toast(e?.toString() || "Preview failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const applySort = async () => {
    try {
      await invoke<string[]>("apply_auto_sort");
      onRefresh();
      setLocalOrder(null);
      setDirty(false);
      toast("Load order applied!", "success");
      setPreview(null);
    } catch (e: any) {
      toast(e?.toString() || "Apply failed", "error");
    }
  };

  const analyzeOrder = async () => {
    try {
      setLoading(true);
      const a = await invoke<LoadOrderAnalysis>("analyze_load_order");
      setAnalysis(a);
    } catch (e: any) {
      toast(e?.toString() || "Analysis failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const updateCommunityRules = async () => {
    try {
      setLoading(true);
      toast("Downloading community rules...", "info");
      await invoke("update_community_rules");
      toast("Community rules updated successfully!", "success");
      if (analysis) analyzeOrder();
    } catch (e: any) {
      toast(e?.toString() || "Failed to update rules", "error");
    } finally {
      setLoading(false);
    }
  };

  const saveManualOrder = async () => {
    if (!localOrder) return;
    try {
      const ids = localOrder.map((m) => m.id);
      await invoke("set_load_order", { ids });
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
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setHoverIdx(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setHoverIdx(null);
      return;
    }
    const items = [...enabledMods];
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

  // Move buttons
  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const items = [...enabledMods];
    [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
    setLocalOrder(items);
    setDirty(true);
  };

  const moveDown = (idx: number) => {
    if (idx >= enabledMods.length - 1) return;
    const items = [...enabledMods];
    [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
    setLocalOrder(items);
    setDirty(true);
  };

  const getModName = (id: string) => mods.find((m) => m.id === id)?.name || id;

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Load Order</h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Analyze, sort, and manage your mod load order</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{enabledMods.length}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Active Mods</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="glass-card" style={{ padding: "16px 20px", marginBottom: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 250 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }}>🔍</span>
          <input
            className="input-field"
            placeholder="Search load order..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", paddingLeft: 40 }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={analyzeOrder} disabled={loading} title="Check for missing dependencies and conflicts">
            🔍 Analyze
          </button>
          <button className="btn-secondary" onClick={previewSort} disabled={loading} title="See what Auto-Sort would do without applying">
            👁 Preview Sort
          </button>
          <button className="btn-secondary" onClick={updateCommunityRules} disabled={loading} title="Download latest RimPy community sorting rules">
            🌐 Update Rules
          </button>
          <button className="btn-primary" onClick={applySort} disabled={loading}>
            ⚡ Apply Auto-Sort
          </button>
        </div>
      </div>

      {/* Global Actions */}
      {dirty && (
        <div className="glass-card glow-accent" style={{ 
          padding: "16px 20px", 
          marginBottom: 24, 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          borderColor: "var(--color-accent)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>⚠</span>
            <div>
              <div style={{ fontWeight: 600, color: "var(--color-accent)", marginBottom: 2 }}>Unsaved Changes</div>
              <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>You have modified the load order manually.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={resetOrder}>↩ Discard</button>
            <button className="btn-primary" onClick={saveManualOrder}>💾 Save Order</button>
          </div>
        </div>
      )}

      {/* Analysis issues */}
      {analysis && analysis.issues.length > 0 && (
        <div className="glass-card" style={{ padding: 24, marginBottom: 24, borderLeft: "4px solid var(--color-warning)" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "var(--color-warning)", display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠</span> {analysis.issues.length} Issue{analysis.issues.length > 1 ? "s" : ""} Found
          </h3>
          <div style={{ display: "grid", gap: 10 }}>
            {analysis.issues.slice(0, 15).map((issue, i) => (
              <div key={i} style={{
                padding: "12px 16px",
                background: "rgba(0,0,0,0.2)",
                borderRadius: 8,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 12,
                border: "1px solid rgba(255,255,255,0.05)"
              }}>
                {issue.kind === "MissingDependency" && (
                  <>
                    <span className="badge danger">Missing</span>
                    <span><strong>{issue.mod_name}</strong> requires <code style={{ color: "var(--color-accent)", background: "rgba(255,157,0,0.1)", padding: "2px 6px", borderRadius: 4 }}>{issue.missing}</code></span>
                  </>
                )}
                {issue.kind === "OutOfOrder" && (
                  <>
                    <span className="badge warning">Order</span>
                    <span><strong>{issue.mod_name}</strong> is at pos <strong>{issue.current_index + 1}</strong>, should be at <strong>{issue.suggested_index + 1}</strong></span>
                  </>
                )}
                {issue.kind === "Cycle" && (
                  <>
                    <span className="badge danger">Cycle</span>
                    <span>Circular dependency: {issue.mod_names.join(" → ")}</span>
                  </>
                )}
                {issue.kind === "Incompatible" && (
                  <>
                    <span className="badge danger">Conflict</span>
                    <span><strong>{issue.mod_name}</strong> is incompatible with <strong>{issue.conflicting_name}</strong></span>
                  </>
                )}
              </div>
            ))}
            {analysis.issues.length > 15 && (
              <div style={{ fontSize: 13, color: "var(--color-text-dim)", textAlign: "center", padding: 8 }}>
                ...and {analysis.issues.length - 15} more issues
              </div>
            )}
          </div>
        </div>
      )}

      {analysis && analysis.issues.length === 0 && (
        <div className="glass-card" style={{ padding: "16px 24px", marginBottom: 24, borderLeft: "4px solid var(--color-success)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(16, 185, 129, 0.2)", color: "var(--color-success)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✓</div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--color-success)" }}>All Good!</div>
            <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>No load order issues detected.</div>
          </div>
        </div>
      )}

      {/* Preview diff */}
      {preview && (
        <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <span>👁</span> Sort Preview
            </h3>
            <button className="btn-secondary" onClick={() => setPreview(null)}>✕ Close Preview</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: 16, border: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: 12, color: "var(--color-text-dim)", marginBottom: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Current Order</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {preview.current.map((id, i) => (
                  <div key={id} style={{ fontSize: 13, padding: "6px 8px", background: "rgba(255,255,255,0.02)", borderRadius: 6, color: "var(--color-text-muted)" }}>
                    <span style={{ opacity: 0.5, marginRight: 8, fontFamily: "var(--font-mono)" }}>{(i+1).toString().padStart(3, '0')}</span> {getModName(id)}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: 16, border: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: 12, color: "var(--color-accent)", marginBottom: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Suggested Order</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {preview.suggested.map((id, i) => {
                  const moved = preview.current.indexOf(id) !== i;
                  return (
                    <div key={id} style={{
                      fontSize: 13, padding: "6px 8px",
                      background: moved ? "var(--color-accent-glow)" : "rgba(255,255,255,0.02)",
                      borderRadius: 6,
                      color: moved ? "var(--color-accent)" : "var(--color-text-muted)",
                      fontWeight: moved ? 600 : 400,
                      borderLeft: moved ? "2px solid var(--color-accent)" : "2px solid transparent"
                    }}>
                      <span style={{ opacity: 0.5, marginRight: 8, fontFamily: "var(--font-mono)" }}>{(i+1).toString().padStart(3, '0')}</span> {getModName(id)}
                      {moved && <span style={{ float: "right" }}>↕</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Load Order with Drag & Drop */}
      <div>
        {enabledMods.length === 0 ? (
          <div className="glass-card" style={{ textAlign: "center", padding: "60px 40px", borderStyle: "dashed" }}>
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.2 }}>📚</div>
            <h3 style={{ color: "var(--color-text-muted)", marginBottom: 8 }}>No Active Mods</h3>
            <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Enable some mods in the Mods tab to arrange their load order.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {enabledMods.map((mod, i) => (
              <div
                key={mod.id}
                draggable={canDrag}
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                className="glass-card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "10px 16px",
                  cursor: canDrag ? "grab" : "default",
                  background: dragIdx === i ? "var(--color-accent-glow)" : "var(--color-bg-card)",
                  transform: dragIdx === i ? "scale(1.01)" : "none",
                  borderLeft: dragIdx === i ? "4px solid var(--color-accent)" : "4px solid transparent",
                  opacity: dragIdx === i ? 0.7 : 1,
                  boxShadow: hoverIdx === i && dragIdx !== null && dragIdx !== i ? "inset 0 2px 0 var(--color-accent)" : "none",
                }}
              >
                {/* Drag handle */}
                {canDrag && (
                  <span style={{ color: "var(--color-text-dim)", fontSize: 16, cursor: "grab", userSelect: "none", opacity: 0.5 }}>
                    ⠿
                  </span>
                )}

                {/* Position number */}
                <div style={{
                  color: "var(--color-accent)",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 14,
                  width: 32,
                  textAlign: "center",
                  background: "var(--color-bg)",
                  padding: "4px 0",
                  borderRadius: 6,
                  flexShrink: 0,
                }}>
                  {i + 1}
                </div>

                {/* Mod Info */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {mod.name}
                  </span>
                  <span style={{ color: "var(--color-text-dim)", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {mod.author || "Unknown Author"} • {mod.id}
                  </span>
                </div>

                {/* Move buttons */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    className="btn-secondary"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    style={{ padding: "6px 10px", opacity: i === 0 ? 0.3 : 1 }}
                    title="Move Up"
                  >
                    ▲
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => moveDown(i)}
                    disabled={i === enabledMods.length - 1}
                    style={{ padding: "6px 10px", opacity: i === enabledMods.length - 1 ? 0.3 : 1 }}
                    title="Move Down"
                  >
                    ▼
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
