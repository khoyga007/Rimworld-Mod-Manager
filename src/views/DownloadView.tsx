import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DownloadProgress } from "../types";

interface Props {
  downloads: Map<string, DownloadProgress>;
  toast: (msg: string, type?: string) => void;
}

export default function DownloadView({ downloads, toast }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const parseIds = (raw: string): string[] => {
    const ids: string[] = [];
    for (const part of raw.split(/[\s,;\n]+/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/(?:\?id=|filedetails\/\?id=|workshop\/content\/\d+\/)(\d+)/);
      if (match) { ids.push(match[1]); continue; }
      if (/^\d+$/.test(trimmed)) { ids.push(trimmed); continue; }
    }
    return [...new Set(ids)];
  };

  const handleDownload = async () => {
    const ids = parseIds(input);
    if (ids.length === 0) {
      toast("Enter valid Workshop IDs or URLs", "error");
      return;
    }
    setBusy(true);
    try {
      if (ids.length === 1) {
        await invoke("download_workshop_mod", { workshopId: ids[0] });
      } else {
        await invoke("download_workshop_mods_batch", { ids });
      }
      toast(`Queued ${ids.length} download(s)`, "info");
      setInput("");
    } catch (e: any) {
      toast(e?.toString() || "Download failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleCollection = async () => {
    const ids = parseIds(input);
    if (ids.length !== 1) {
      toast("Enter a single Workshop Collection URL or ID", "error");
      return;
    }
    setBusy(true);
    try {
      const itemIds = await invoke<string[]>("fetch_collection", { collectionId: ids[0] });
      toast(`Found ${itemIds.length} mods in collection. Downloading...`, "info");
      if (itemIds.length > 0) {
        await invoke("download_workshop_mods_batch", { ids: itemIds });
      }
    } catch (e: any) {
      toast(e?.toString() || "Collection fetch failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const downloadEntries = Array.from(downloads.entries()).sort((a, b) => {
    const order = { error: 0, downloading: 1, installing: 2, queued: 3, done: 4 };
    return (order[a[1].status as keyof typeof order] ?? 5) - (order[b[1].status as keyof typeof order] ?? 5);
  });

  const statusColor = (s: string) => {
    switch (s) {
      case "done": return "var(--color-success)";
      case "error": return "var(--color-danger)";
      case "downloading":
      case "installing": return "var(--color-info)";
      default: return "var(--color-text-dim)";
    }
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: 900, margin: "0 auto", paddingBottom: 60 }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Download Mods</h1>
        <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Download RimWorld mods directly from Steam Workshop</p>
      </div>

      {/* Input Form */}
      <div className="glass-card" style={{ padding: 24, marginBottom: 32, borderTop: "4px solid var(--color-info)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(59, 130, 246, 0.1)", color: "var(--color-info)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            🔗
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Workshop IDs or URLs</h3>
            <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>
              Paste one or more IDs or URLs (comma/newline separated)
            </div>
          </div>
        </div>

        <textarea
          className="input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={"https://steamcommunity.com/sharedfiles/filedetails/?id=2009463077\n2009463077, 1874644848"}
          rows={4}
          style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 13, marginBottom: 16, background: "rgba(0,0,0,0.2)" }}
        />

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={handleDownload} disabled={busy || !input.trim()} style={{ padding: "0 24px", height: 40 }}>
            ⬇ Download Mods
          </button>
          <button className="btn-secondary" onClick={handleCollection} disabled={busy || !input.trim()} style={{ height: 40 }}>
            📦 Import Collection
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                await invoke("open_path_or_url", { target: "https://steamcommunity.com/app/294100/workshop/" });
              } catch {
                window.open("https://steamcommunity.com/app/294100/workshop/", "_blank");
              }
            }}
            style={{ height: 40, background: "rgba(255,255,255,0.05)" }}
          >
            🌐 Browse Steam
          </button>
        </div>
      </div>

      {/* Download Queue */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
          Download Queue {downloadEntries.length > 0 ? `(${downloadEntries.length})` : ""}
        </h3>
        
        {downloadEntries.length === 0 ? (
          <div className="glass-card" style={{ textAlign: "center", padding: "60px 40px", borderStyle: "dashed" }}>
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.2 }}>💤</div>
            <h3 style={{ color: "var(--color-text-muted)", marginBottom: 8 }}>Queue is Empty</h3>
            <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Enter IDs above to start downloading mods.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {downloadEntries.map(([id, dl]) => {
              const isError = dl.status === "error";
              const isDone = dl.status === "done";
              const isActive = dl.status === "downloading" || dl.status === "installing" || dl.status === "restoring";
              
              return (
                <div
                  key={id}
                  className="glass-card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 20,
                    padding: "12px 16px",
                    background: isError ? "rgba(239, 68, 68, 0.05)" : isDone ? "rgba(16, 185, 129, 0.05)" : "var(--color-bg-card)",
                    borderLeft: `4px solid ${statusColor(dl.status)}`,
                    transition: "var(--transition)",
                  }}
                >
                  {/* Thumbnail / Preview */}
                  <div style={{ 
                    width: 80, 
                    height: 80, 
                    borderRadius: 8, 
                    background: "rgba(0,0,0,0.3)", 
                    overflow: "hidden", 
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid var(--color-border)"
                  }}>
                    {dl.preview_url ? (
                      <img src={dl.preview_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ fontSize: 24, opacity: 0.3 }}>📦</div>
                    )}
                  </div>
                  
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                      <span style={{ 
                        fontSize: 16, 
                        fontWeight: 700, 
                        color: isError ? "var(--color-danger)" : "var(--color-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>
                        {dl.title || `Mod ${id}`}
                      </span>
                      <span className="badge" style={{ 
                        background: `rgba(${isDone ? "16,185,129" : isError ? "239,68,68" : isActive ? "59,130,246" : "255,255,255"}, 0.1)`, 
                        color: statusColor(dl.status),
                        borderColor: `rgba(${isDone ? "16,185,129" : isError ? "239,68,68" : isActive ? "59,130,246" : "255,255,255"}, 0.2)`,
                        textTransform: "capitalize"
                      }}>
                        {dl.status}
                      </span>
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                       <span style={{ fontSize: 11, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.2)", padding: "2px 6px", borderRadius: 4 }}>
                        ID: {id}
                      </span>
                      <div style={{ fontSize: 13, color: isError ? "var(--color-danger)" : "var(--color-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {dl.message || (isDone ? "Download completed successfully" : isActive ? "Working..." : "Waiting in queue")}
                      </div>
                    </div>

                    {isActive && (
                      <div style={{ width: "100%" }}>
                        <div style={{ width: "100%", height: 6, background: "rgba(0,0,0,0.3)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${dl.progress}%`, height: "100%", background: "var(--color-info)", transition: "width 0.2s ease", borderRadius: 3 }} />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {isActive && (
                    <div style={{ minWidth: 50, textAlign: "right", color: "var(--color-info)", fontWeight: 700, fontSize: 14 }}>
                      {Math.round(dl.progress)}%
                    </div>
                  )}

                  {!isActive && isDone && (
                    <div style={{ color: "var(--color-success)", fontSize: 20 }}>✓</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
