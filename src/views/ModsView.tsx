import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModInfo } from "../types";

// Global cache — survives component remounts (tab switches)
const _imgCache: Record<string, string> = {};
const _imgLoading = new Set<string>();

// Queue for lazy-loading images in batches
const IMG_BATCH_SIZE = 8;
let _imgQueue: { id: string; path: string }[] = [];
let _imgProcessing = false;

function processImgQueue(onLoaded: () => void) {
  if (_imgProcessing || _imgQueue.length === 0) return;
  _imgProcessing = true;
  const batch = _imgQueue.splice(0, IMG_BATCH_SIZE);
  let remaining = batch.length;
  for (const item of batch) {
    invoke<string>("read_mod_image", { path: item.path })
      .then((dataUrl) => {
        _imgCache[item.id] = dataUrl;
      })
      .catch(() => {})
      .finally(() => {
        remaining--;
        if (remaining === 0) {
          _imgProcessing = false;
          onLoaded();
          processImgQueue(onLoaded);
        }
      });
  }
}

interface Props {
  mods: ModInfo[];
  onRefresh: () => void;
  toast: (msg: string, type?: string) => void;
}

const ROW_HEIGHT = 72;
const OVERSCAN = 5;

export default function ModsView({ mods, onRefresh, toast }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<ModInfo[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [imgVer, setImgVer] = useState(0);
  const [batchStatus, setBatchStatus] = useState<{
    active: boolean;
    currentModName: string;
    progress: number;
    modIndex: number;
    totalMods: number;
    title: string;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  const bumpImgVer = useCallback(() => setImgVer((v) => v + 1), []);

  const queueImages = useCallback(
    (visMods: ModInfo[]) => {
      let queued = false;
      for (const m of visMods) {
        if (m.picture && !_imgCache[m.id] && !_imgLoading.has(m.id)) {
          _imgLoading.add(m.id);
          _imgQueue.push({ id: m.id, path: m.picture });
          queued = true;
        }
      }
      if (queued) processImgQueue(bumpImgVer);
    },
    [bumpImgVer]
  );

  useEffect(() => {
    let unlisten: any;
    async function setup() {
      unlisten = await listen<any>("optimize-progress", (event) => {
        const { progress, message } = event.payload;
        setBatchStatus((prev) => {
          if (!prev) return null;
          return { ...prev, currentModName: message, progress };
        });
      });
    }
    setup();
    return () => { if (unlisten) unlisten(); };
  }, []);

  const baseMods = localOrder ?? mods;

  const filtered = useMemo(() => {
    return baseMods.filter((m) => {
      if (filter === "enabled" && !m.enabled) return false;
      if (filter === "disabled" && m.enabled) return false;
      if (search) {
        const q = search.toLowerCase();
        return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.author.toLowerCase().includes(q);
      }
      return true;
    });
  }, [baseMods, filter, search]);

  const canDrag = !search && filter === "all";

  const totalHeight = filtered.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(filtered.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleMods = filtered.slice(startIdx, endIdx);
  const offsetY = startIdx * ROW_HEIGHT;

  useEffect(() => {
    queueImages(visibleMods);
  }, [startIdx, endIdx, queueImages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, []);

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
    onRefresh(); setLocalOrder(null);
    toast("All mods enabled", "success");
  };

  const disableAll = async () => {
    await invoke("set_all_mods_enabled", { enabled: false });
    onRefresh(); setLocalOrder(null);
    toast("All mods disabled", "info");
  };

  const deleteMod = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This removes the mod files permanently.`)) return;
    try {
      await invoke("delete_mod", { id });
      onRefresh(); setLocalOrder(null);
      toast(`Deleted ${name}`, "info");
    } catch (e: any) {
      toast(e?.toString() || "Delete failed", "error");
    }
  };

  const autoSort = async () => {
    try {
      const result = await invoke<string[]>("apply_auto_sort");
      onRefresh(); setLocalOrder(null); setDirty(false);
      toast(`Auto-sorted ${result.length} mods`, "success");
    } catch (e: any) {
      toast(e?.toString() || "Sort failed", "error");
    }
  };

  const batchOptimize = async () => {
    const localMods = mods.filter(m => !m.path.includes("workshop"));
    if (localMods.length === 0) { toast("No local mods to optimize", "info"); return; }
    if (!confirm(`Optimize textures (PNG → DDS) for ${localMods.length} local mods?`)) return;
    const hasTexconv = await invoke<boolean>("check_texconv");
    if (!hasTexconv) {
      setBatchStatus({ active: true, currentModName: "Downloading texconv.exe...", progress: 0, modIndex: 0, totalMods: localMods.length, title: "⬇️ Downloading texconv.exe" });
      try { await invoke("download_texconv"); } catch (e: any) { toast(e?.toString() || "Failed to download texconv", "error"); setBatchStatus(null); return; }
    }
    setBatchStatus({ active: true, currentModName: "Starting optimization...", progress: 0, modIndex: 0, totalMods: localMods.length, title: "Optimizing Mod Textures (via texconv)" });
    try { await invoke("optimize_all_local_mods"); toast("Batch optimization finished!", "success"); } catch (e: any) { toast(e?.toString() || "Batch optimization failed", "error"); } finally { setBatchStatus(null); onRefresh(); }
  };

  const batchRevert = async () => {
    const localMods = mods.filter(m => !m.path.includes("workshop"));
    if (localMods.length === 0) { toast("No local mods found", "info"); return; }
    if (!confirm(`Revert all DDS textures back to PNG for ${localMods.length} local mods?`)) return;
    setBatchStatus({ active: true, currentModName: "Starting revert...", progress: 0, modIndex: 0, totalMods: localMods.length, title: "Reverting Textures to PNG" });
    try { await invoke("revert_all_local_mods"); toast("All textures reverted to PNG!", "success"); } catch (e: any) { toast(e?.toString() || "Revert failed", "error"); } finally { setBatchStatus(null); onRefresh(); }
  };

  const saveOrder = async () => {
    if (!localOrder) return;
    try {
      const enabledIds = localOrder.filter((m) => m.enabled).map((m) => m.id);
      await invoke("set_load_order", { ids: enabledIds });
      onRefresh(); setLocalOrder(null); setDirty(false);
      toast("Load order saved!", "success");
    } catch (e: any) { toast(e?.toString() || "Save failed", "error"); }
  };

  const resetOrder = () => { setLocalOrder(null); setDirty(false); };

  const handleDragStart = (idx: number) => { if (!canDrag) return; setDragIdx(idx); };
  const handleDragOver = (e: React.DragEvent, _idx: number) => { if (!canDrag) return; e.preventDefault(); };
  const handleDrop = (idx: number) => {
    if (!canDrag || dragIdx === null || dragIdx === idx) { setDragIdx(null); return; }
    const items = [...baseMods];
    const [moved] = items.splice(dragIdx, 1);
    items.splice(idx, 0, moved);
    setLocalOrder(items); setDirty(true); setDragIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="animate-fade-in" style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Installed Mods</h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Manage and organize your RimWorld mod library</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{filtered.length}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Mods Filtered</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="glass-card" style={{ padding: "16px 20px", marginBottom: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 250 }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }}>🔍</span>
          <input className="input-field" placeholder="Search by name, author, or ID..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", paddingLeft: 40 }} />
        </div>
        <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", padding: 4, borderRadius: 10, border: "1px solid var(--color-border)" }}>
          {(["all", "enabled", "disabled"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: filter === f ? "var(--color-bg-hover)" : "transparent", color: filter === f ? "var(--color-accent)" : "var(--color-text-muted)", cursor: "pointer", fontSize: 12, fontWeight: 600, textTransform: "capitalize", transition: "var(--transition)" }}>{f}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" style={{ padding: "10px" }} onClick={onRefresh} title="Refresh" disabled={!!batchStatus}>🔄</button>
          <button className="btn-secondary" onClick={batchRevert} title="Revert DDS back to PNG" style={{ color: "var(--color-warning)" }} disabled={!!batchStatus}>🔄 Revert DDS</button>
          <button className="btn-secondary" onClick={batchOptimize} title="Optimize PNG to DDS" disabled={!!batchStatus}>⚡ Optimize</button>
          <button className="btn-primary" onClick={autoSort} disabled={!!batchStatus}>⚡ Auto-Sort</button>
        </div>
        {batchStatus && (
          <div style={{ width: "100%", marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.05)", animation: "slide-down 0.3s ease-out" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, animation: "pulse 1.5s infinite" }}>⚡</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)" }}>{batchStatus.title}</span>
                <span style={{ fontSize: 12, color: "var(--color-text-dim)", marginLeft: 8 }}>{batchStatus.currentModName}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-accent)" }}>{batchStatus.progress}%</span>
            </div>
            <div style={{ width: "100%", height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${batchStatus.progress}%`, height: "100%", background: "var(--color-accent)", boxShadow: "0 0 15px var(--color-accent)", transition: "width 0.3s ease" }} />
            </div>
          </div>
        )}
      </div>

      {/* Global Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, justifyContent: "flex-end", flexShrink: 0 }}>
        {dirty && (
          <div style={{ marginRight: "auto", display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={resetOrder}>↩ Reset</button>
            <button className="btn-primary" onClick={saveOrder}>💾 Save Order</button>
          </div>
        )}
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={enableAll}>Enable All</button>
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={disableAll}>Disable All</button>
      </div>

      {/* Mod list — Virtualized */}
      {filtered.length === 0 ? (
        <div className="glass-card" style={{ textAlign: "center", padding: "80px 40px", borderStyle: "dashed" }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>📦</div>
          <h3 style={{ color: "var(--color-text-muted)", marginBottom: 8 }}>No Mods Found</h3>
          <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Try a different search term or check your game path.</p>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ height: totalHeight, position: "relative" }}>
            <div style={{ position: "absolute", top: offsetY, left: 0, right: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleMods.map((mod) => {
                const globalIdx = baseMods.indexOf(mod);
                return (
                  <div
                    key={`${mod.id}-${imgVer}`}
                    draggable={canDrag}
                    onDragStart={() => handleDragStart(globalIdx)}
                    onDragOver={(e) => handleDragOver(e, globalIdx)}
                    onDrop={() => handleDrop(globalIdx)}
                    onDragEnd={handleDragEnd}
                    className="glass-card"
                    style={{
                      display: "flex", alignItems: "center", padding: "12px 16px", gap: 16,
                      height: ROW_HEIGHT - 8, boxSizing: "border-box",
                      opacity: mod.enabled ? 1 : 0.7,
                      cursor: canDrag ? "grab" : "default",
                      borderLeft: mod.enabled ? "4px solid var(--color-accent)" : "4px solid transparent",
                      background: dragIdx === globalIdx ? "var(--color-accent-glow)" : "",
                      transform: dragIdx === globalIdx ? "scale(1.01)" : "none",
                    }}
                  >
                    <div className={`toggle ${mod.enabled ? "active" : ""}`} onClick={() => toggleMod(mod.id, !mod.enabled)} />
                    <div style={{ position: "relative" }}>
                      {_imgCache[mod.id] ? (
                        <img src={_imgCache[mod.id]} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 8, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📦</div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: mod.enabled ? "#fff" : "var(--color-text-muted)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mod.name}</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-dim)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 9, textTransform: "uppercase", padding: "1px 6px", borderRadius: 4, background: mod.source === 'workshop' ? 'rgba(52, 152, 219, 0.15)' : mod.source === 'local' ? 'rgba(46, 204, 113, 0.15)' : mod.source === 'official' ? 'rgba(230, 126, 34, 0.15)' : 'rgba(149, 165, 166, 0.15)', color: mod.source === 'workshop' ? '#3498db' : mod.source === 'local' ? '#2ecc71' : mod.source === 'official' ? '#e67e22' : '#95a5a6', border: `1px solid ${mod.source === 'workshop' ? '#3498db' : mod.source === 'local' ? '#2ecc71' : mod.source === 'official' ? '#e67e22' : '#95a5a6'}33`, fontWeight: 800, letterSpacing: "0.02em" }}>{mod.source}</span>
                        <span style={{ color: "var(--color-accent)", fontWeight: 500 }}>{mod.author || "Unknown Author"}</span>
                        <span style={{ opacity: 0.3 }}>•</span>
                        <span style={{ opacity: 0.6 }}>{mod.id}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      {mod.enabled && <div style={{ fontSize: 10, color: "var(--color-accent)", fontWeight: 800, marginBottom: 4 }}>ORDER #{mod.load_order + 1}</div>}
                      <div style={{ fontSize: 11, color: "var(--color-text-dim)" }}>{formatSize(mod.size_bytes)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {mod.source === 'workshop' && (
                        <button className="btn-secondary" style={{ padding: "6px 8px", color: "var(--color-info)" }} onClick={async () => { try { await invoke("backup_mod_to_local", { id: mod.id }); onRefresh(); toast(`Backed up "${mod.name}"`, "success"); } catch (e: any) { toast(e?.toString() || "Failed", "error"); } }} title="Copy to Local Mods">💾</button>
                      )}
                      {mod.source === 'local' && (
                        <button className="btn-secondary" style={{ padding: "6px 8px", color: "var(--color-success)" }} onClick={async () => { try { setBatchStatus({ active: true, currentModName: `Optimizing "${mod.name}"...`, progress: 0, modIndex: 0, totalMods: 1, title: "⚡ Optimizing Textures" }); await invoke("optimize_mod_textures", { id: mod.id }); toast(`Optimized "${mod.name}"`, "success"); } catch (e: any) { toast(e?.toString() || "Failed", "error"); } finally { setBatchStatus(null); } }} title="Optimize Textures">⚡</button>
                      )}
                      <button className="btn-secondary" style={{ padding: "6px 8px" }} onClick={() => invoke("open_path_or_url", { target: mod.path })} title="Open folder">📂</button>
                      <button className="btn-secondary" style={{ padding: "6px 8px", color: "var(--color-danger)" }} onClick={() => deleteMod(mod.id, mod.name)} title="Delete">🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
