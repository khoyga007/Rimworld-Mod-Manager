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
    <div className="app-container">
      <Sidebar
        currentView={view}
        onNavigate={setView}
        modCount={mods.length}
        enabledCount={enabledCount}
        gameDirSet={!!paths?.game_dir}
      />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", position: "relative", overflow: "hidden" }}>
        {/* Top bar */}
        <header style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 32px",
          borderBottom: "1px solid var(--color-border)",
          background: "rgba(10, 11, 13, 0.8)",
          backdropFilter: "blur(20px)",
          flexShrink: 0,
          zIndex: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              background: "rgba(255,255,255,0.03)",
              padding: "6px 12px",
              borderRadius: "20px",
              border: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              {paths?.game_dir
                ? <><span className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-success)" }}></span> 📂 {paths.game_dir}</>
                : <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-warning)" }}></span> ⚠ Path not set</>
              }
            </div>
          </div>
          <button
            className="btn-primary"
            onClick={async () => {
              try { await invoke("launch_rimworld"); toast("RimWorld launched!", "success"); }
              catch (e: any) { toast(e?.toString() || "Launch failed", "error"); }
            }}
          >
            <span style={{ fontSize: 16 }}>▶</span> Launch RimWorld
          </button>
        </header>

        {/* View content */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div className="main-view animate-slide-up" key={view}>
            {error && !paths?.game_dir && view !== "settings" && (
              <div className="glass-card" style={{
                padding: "20px 24px",
                marginBottom: 32,
                borderLeft: "4px solid var(--color-warning)",
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}>
                <span style={{ fontSize: 24 }}>⚠</span>
                <div>
                  <div style={{ fontWeight: 600, color: "var(--color-warning)", marginBottom: 2 }}>Initial Setup Required</div>
                  <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    Please set your RimWorld game directory in <button onClick={() => setView("settings")} style={{ color: "var(--color-accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Settings</button> to enable mod management.
                  </div>
                </div>
              </div>
            )}

            {view === "mods" && <ModsView mods={mods} onRefresh={refreshMods} toast={toast} />}
            {view === "download" && <DownloadView downloads={downloads} toast={toast} />}
            {view === "collections" && <CollectionsView mods={mods} toast={toast} onRefresh={refreshMods} />}
            {view === "loadorder" && <LoadOrderView mods={mods} toast={toast} onRefresh={refreshMods} />}
            {view === "saves" && <SaveGameView toast={toast} onRefresh={refreshMods} />}
            {view === "logs" && <LogsView />}
            {view === "settings" && <SettingsView paths={paths} onPathsChange={(p) => { setPaths(p); refreshMods(); }} toast={toast} />}
          </div>
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
