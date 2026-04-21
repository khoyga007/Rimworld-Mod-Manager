import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModInfo, RimWorldPaths, DownloadProgress } from "./types";
import Sidebar from "./components/Sidebar";
import ModsView from "./views/ModsView";
import SettingsView from "./views/SettingsView";
import LogsView from "./views/LogsView";
import LoadOrderView from "./views/LoadOrderView";
import DownloadView from "./views/DownloadView";
import CollectionsView from "./views/CollectionsView";
import SaveGameView from "./views/SaveGameView";

type View = "mods" | "download" | "collections" | "loadorder" | "saves" | "logs" | "settings";

export default function App() {
  const [view, setView] = useState<View>("mods");
  const [paths, setPaths] = useState<RimWorldPaths | null>(null);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Map<string, DownloadProgress>>(new Map());
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);

  const toast = useCallback((msg: string, type = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const refreshMods = useCallback(async () => {
    try {
      const list = await invoke<ModInfo[]>("list_mods");
      setMods(list);
    } catch (e: any) {
      console.error("list_mods failed:", e);
    }
  }, []);

  // Init: detect paths + load mods
  useEffect(() => {
    (async () => {
      try {
        const p = await invoke<RimWorldPaths>("detect_paths");
        setPaths(p);
        const list = await invoke<ModInfo[]>("list_mods");
        setMods(list);
      } catch (e: any) {
        setError(e?.toString() || "Failed to detect paths");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Listen download progress
  useEffect(() => {
    const unlisten = listen<DownloadProgress>("download-progress", (ev) => {
      setDownloads((prev) => {
        const next = new Map(prev);
        next.set(ev.payload.workshop_id, ev.payload);
        return next;
      });
      if (ev.payload.status === "done") {
        toast(`Mod ${ev.payload.workshop_id} installed!`, "success");
        refreshMods();
      } else if (ev.payload.status === "error") {
        toast(`Error: ${ev.payload.message}`, "error");
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [toast, refreshMods]);

  const enabledCount = mods.filter((m) => m.enabled).length;

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16 }}>
        <div style={{ width: 32, height: 32, border: "3px solid var(--color-border)", borderTop: "3px solid var(--color-accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <span style={{ color: "var(--color-text-muted)", fontSize: 14 }}>Detecting RimWorld...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar
        currentView={view}
        onNavigate={setView}
        modCount={mods.length}
        enabledCount={enabledCount}
        gameDirSet={!!paths?.game_dir}
      />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <header style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              {paths?.game_dir
                ? <span>📂 {paths.game_dir}</span>
                : <span style={{ color: "var(--color-warning)" }}>⚠ Game directory not set — go to Settings</span>
              }
            </span>
          </div>
          <button
            className="btn-primary"
            onClick={async () => {
              try { await invoke("launch_rimworld"); toast("RimWorld launched!", "success"); }
              catch (e: any) { toast(e?.toString() || "Launch failed", "error"); }
            }}
          >
            ▶ Launch RimWorld
          </button>
        </header>

        {/* View content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }} className="view-enter" key={view}>
          {error && !paths?.game_dir && view !== "settings" && (
            <div style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-warning)",
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
              fontSize: 13,
              color: "var(--color-warning)",
            }}>
              ⚠ Please set your RimWorld game directory in <button onClick={() => setView("settings")} style={{ color: "var(--color-accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>Settings</button> to load mods.
            </div>
          )}

          {view === "mods" && <ModsView mods={mods} onRefresh={refreshMods} toast={toast} />}
          {view === "download" && <DownloadView downloads={downloads} toast={toast} onRefresh={refreshMods} />}
          {view === "collections" && <CollectionsView mods={mods} toast={toast} onRefresh={refreshMods} />}
          {view === "loadorder" && <LoadOrderView mods={mods} toast={toast} onRefresh={refreshMods} />}
          {view === "saves" && <SaveGameView toast={toast} onRefresh={refreshMods} />}
          {view === "logs" && <LogsView />}
          {view === "settings" && <SettingsView paths={paths} onPathsChange={(p) => { setPaths(p); refreshMods(); }} toast={toast} />}
        </div>
      </main>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
