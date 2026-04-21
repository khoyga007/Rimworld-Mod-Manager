import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DownloadProgress } from "../types";

interface Props {
  downloads: Map<string, DownloadProgress>;
  toast: (msg: string, type?: string) => void;
  onRefresh: () => void;
}

export default function DownloadView({ downloads, toast, onRefresh }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const parseIds = (raw: string): string[] => {
    const ids: string[] = [];
    // Support: workshop URL, ?id=xxx, plain number, comma/newline separated
    for (const part of raw.split(/[\s,;\n]+/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Extract ID from URL
      const match = trimmed.match(/(?:\?id=|filedetails\/\?id=|workshop\/content\/\d+\/)(\d+)/);
      if (match) { ids.push(match[1]); continue; }
      // Plain number
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
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--color-accent)", marginBottom: 20 }}>
        Download Mods
      </h2>

      {/* Input */}
      <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Workshop ID or URL
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", margin: "0 0 12px" }}>
          Paste one or more Steam Workshop URLs or IDs (separated by commas, spaces, or newlines).
        </p>
        <textarea
          className="input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={"https://steamcommunity.com/sharedfiles/filedetails/?id=2009463077\n2009463077, 1874644848"}
          rows={3}
          style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn-primary" onClick={handleDownload} disabled={busy || !input.trim()}>
            ⬇ Download Mod(s)
          </button>
          <button className="btn-secondary" onClick={handleCollection} disabled={busy || !input.trim()}>
            📦 Import Collection
          </button>
        </div>
      </div>

      {/* Download Queue */}
      {downloadEntries.length > 0 && (
        <div className="glass-card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            Downloads ({downloadEntries.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {downloadEntries.map(([id, dl]) => (
              <div
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 12px",
                  background: "var(--color-bg)",
                  borderRadius: 6,
                  borderLeft: `3px solid ${statusColor(dl.status)}`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    Workshop #{id}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-dim)", marginTop: 2 }}>
                    {dl.message}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {dl.status !== "done" && dl.status !== "error" && (
                    <div style={{
                      width: 60, height: 4, background: "var(--color-bg-card)",
                      borderRadius: 2, overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${dl.progress}%`, height: "100%",
                        background: "var(--color-accent)",
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                  )}
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: statusColor(dl.status),
                    textTransform: "uppercase",
                    minWidth: 70,
                    textAlign: "right",
                  }}>
                    {dl.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
