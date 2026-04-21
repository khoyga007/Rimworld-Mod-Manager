import { useState, useRef } from "react";
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
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--color-accent)", margin: 0 }}>
          Load Order
        </h2>
        <input
          className="input-field"
          placeholder="Search load order..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280, marginLeft: 12 }}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {dirty && (
            <>
              <button className="btn-secondary" onClick={resetOrder}>↩ Reset</button>
              <button className="btn-primary" onClick={saveManualOrder}>💾 Save Order</button>
            </>
          )}
          <button className="btn-secondary" onClick={analyzeOrder} disabled={loading}>
            🔍 Analyze
          </button>
          <button className="btn-secondary" onClick={previewSort} disabled={loading}>
            👁 Preview Sort
          </button>
          <button className="btn-primary" onClick={applySort}>
            ⚡ Apply Auto-Sort
          </button>
        </div>
      </div>

      {/* Unsaved changes banner */}
      {dirty && (
        <div style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-warning)",
          borderRadius: 8,
          padding: "10px 16px",
          marginBottom: 16,
          fontSize: 13,
          color: "var(--color-warning)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          ⚠ You have unsaved changes. Click <strong>Save Order</strong> to apply.
        </div>
      )}

      {/* Analysis issues */}
      {analysis && analysis.issues.length > 0 && (
        <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--color-warning)" }}>
            ⚠ {analysis.issues.length} Issue{analysis.issues.length > 1 ? "s" : ""} Found
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analysis.issues.slice(0, 15).map((issue, i) => (
              <div key={i} style={{
                padding: "8px 12px",
                background: "var(--color-bg)",
                borderRadius: 6,
                fontSize: 12,
                borderLeft: `3px solid ${issue.kind === "MissingDependency" ? "var(--color-danger)" : "var(--color-warning)"}`,
              }}>
                {issue.kind === "MissingDependency" && (
                  <span>❌ <strong>{issue.mod_name}</strong> requires missing dependency: <code style={{ color: "var(--color-accent)" }}>{issue.missing}</code></span>
                )}
                {issue.kind === "OutOfOrder" && (
                  <span>↕ <strong>{issue.mod_name}</strong> is at position {issue.current_index + 1}, should be at {issue.suggested_index + 1}</span>
                )}
                {issue.kind === "Cycle" && (
                  <span>🔄 Circular dependency: {issue.mod_names.join(" → ")}</span>
                )}
              </div>
            ))}
            {analysis.issues.length > 15 && (
              <div style={{ fontSize: 12, color: "var(--color-text-dim)", padding: 4 }}>
                ...and {analysis.issues.length - 15} more issues
              </div>
            )}
          </div>
        </div>
      )}

      {analysis && analysis.issues.length === 0 && (
        <div className="glass-card" style={{ padding: 16, marginBottom: 16, borderLeft: "3px solid var(--color-success)" }}>
          <span style={{ fontSize: 13, color: "var(--color-success)" }}>✓ No load order issues detected!</span>
        </div>
      )}

      {/* Preview diff */}
      {preview && (
        <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Sort Preview</h3>
            <button className="btn-secondary" onClick={() => setPreview(null)} style={{ fontSize: 11, padding: "4px 10px" }}>✕ Close</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-text-dim)", marginBottom: 8, fontWeight: 600 }}>Current</div>
              {preview.current.map((id, i) => (
                <div key={id} style={{ fontSize: 12, padding: "3px 0", color: "var(--color-text-muted)" }}>
                  {i + 1}. {getModName(id)}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--color-accent)", marginBottom: 8, fontWeight: 600 }}>Suggested</div>
              {preview.suggested.map((id, i) => {
                const moved = preview.current.indexOf(id) !== i;
                return (
                  <div key={id} style={{
                    fontSize: 12, padding: "3px 0",
                    color: moved ? "var(--color-accent)" : "var(--color-text-muted)",
                    fontWeight: moved ? 600 : 400,
                  }}>
                    {i + 1}. {getModName(id)} {moved && "↕"}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Manual Load Order with Drag & Drop */}
      <div className="glass-card" style={{ padding: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
          Current Load Order ({enabledMods.length} active mods)
        </h3>
        <p style={{ fontSize: 11, color: "var(--color-text-dim)", margin: "0 0 12px" }}>
          Drag to reorder, or use ▲▼ buttons. Click <strong>Save Order</strong> when done.
        </p>

        {enabledMods.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--color-text-dim)", padding: 20, textAlign: "center" }}>
            No active mods. Enable some mods first.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
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
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: canDrag ? "grab" : "default",
                  transition: "all 0.15s ease",
                  background: dragIdx === i
                    ? "var(--color-accent-glow)"
                    : hoverIdx === i
                      ? "var(--color-bg-hover)"
                      : i % 2 === 0
                        ? "transparent"
                        : "var(--color-bg)",
                  borderLeft: dragIdx === i ? "2px solid var(--color-accent)" : "2px solid transparent",
                  opacity: dragIdx === i ? 0.6 : 1,
                  borderTop: hoverIdx === i && dragIdx !== null && dragIdx !== i
                    ? "2px solid var(--color-accent)"
                    : "2px solid transparent",
                }}
              >
                {/* Drag handle */}
                {canDrag && (
                  <span style={{ color: "var(--color-text-dim)", fontSize: 10, cursor: "grab", userSelect: "none" }}>
                    ⠿
                  </span>
                )}

                {/* Position number */}
                <span style={{
                  color: "var(--color-text-dim)",
                  fontFamily: "var(--font-mono)",
                  width: 28,
                  textAlign: "right",
                  flexShrink: 0,
                }}>
                  {i + 1}
                </span>

                {/* Mod name */}
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {mod.name}
                </span>

                {/* ID */}
                <span style={{ color: "var(--color-text-dim)", fontSize: 10, flexShrink: 0, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {mod.id}
                </span>

                {/* Move buttons */}
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  <button
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    style={{
                      background: "none",
                      border: "1px solid var(--color-border)",
                      borderRadius: 3,
                      color: i === 0 ? "var(--color-text-dim)" : "var(--color-text-muted)",
                      cursor: i === 0 ? "default" : "pointer",
                      fontSize: 10,
                      padding: "2px 5px",
                      opacity: i === 0 ? 0.3 : 1,
                    }}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveDown(i)}
                    disabled={i === enabledMods.length - 1}
                    style={{
                      background: "none",
                      border: "1px solid var(--color-border)",
                      borderRadius: 3,
                      color: i === enabledMods.length - 1 ? "var(--color-text-dim)" : "var(--color-text-muted)",
                      cursor: i === enabledMods.length - 1 ? "default" : "pointer",
                      fontSize: 10,
                      padding: "2px 5px",
                      opacity: i === enabledMods.length - 1 ? 0.3 : 1,
                    }}
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
