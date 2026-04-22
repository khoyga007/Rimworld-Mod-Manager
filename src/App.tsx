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
import { ModHubView } from "./views/ModHubView";
import { useTranslation } from 'react-i18next';

type View = "mods" | "hub" | "download" | "collections" | "loadorder" | "saves" | "logs" | "settings";

export default function App() {
  const { t } = useTranslation();
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
      setError(null);
    } catch (e: any) {
      console.error("list_mods failed:", e);
      toast("Failed to load mods: " + (e?.toString() || "Unknown error"), "error");
    }
  }, [toast]);

  // Init: detect paths + load mods (separated so one failure doesn't block the other)
  useEffect(() => {
    (async () => {
      try {
        const p = await invoke<RimWorldPaths>("detect_paths");
        setPaths(p);
      } catch (e: any) {
        console.error("detect_paths failed:", e);
        setError(e?.toString() || "Failed to detect paths");
        setLoading(false);
        return;
      }

      try {
        const list = await invoke<ModInfo[]>("list_mods");
        setMods(list);
      } catch (e: any) {
        console.error("list_mods failed:", e);
        setError("Mod loading failed: " + (e?.toString() || "Unknown error. Check your game directory in Settings."));
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
        <span style={{ color: "var(--color-text-muted)", fontSize: 14 }}>{t('common.detecting_game')}</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error && !paths) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 24, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 64 }}>👽</div>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: "var(--color-danger)" }}>RimWorld Detection Failed</h2>
          <p style={{ color: "var(--color-text-dim)", maxWidth: 500, margin: "0 auto 24px", lineHeight: 1.6 }}>
            {error}. This usually happens if the app can't access your RimWorld configuration or AppData folder.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button className="btn-primary" onClick={() => window.location.reload()}>🔄 Retry Initialization</button>
            <button className="btn-secondary" onClick={() => { setError(null); setView("settings"); }}>⚙ Open Settings</button>
          </div>
        </div>
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
          <div className="flex items-center gap-16">
            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider uppercase">{t('common.status_online')}</span>
            </div>
          </div>
        </header>

        {/* View content */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="main-view animate-slide-up h-full flex flex-col overflow-hidden" key={view}>
            {error && view !== "settings" && (
              <div className="glass-card" style={{
                padding: "20px 24px",
                marginBottom: 32,
                borderLeft: `4px solid ${paths?.game_dir ? 'var(--color-danger)' : 'var(--color-warning)'}`,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}>
                <span style={{ fontSize: 24 }}>{paths?.game_dir ? '❌' : '⚠'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: paths?.game_dir ? "var(--color-danger)" : "var(--color-warning)", marginBottom: 2 }}>
                    {paths?.game_dir ? "Mod Loading Error" : "Initial Setup Required"}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    {paths?.game_dir
                      ? <>{error}. Try checking your game folder or <button onClick={() => setView("settings")} style={{ color: "var(--color-accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0 }}>reconfigure in Settings</button>.</>
                      : <>Please set your RimWorld game directory in <button onClick={() => setView("settings")} style={{ color: "var(--color-accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Settings</button> to enable mod management.</>
                    }
                  </div>
                </div>
                {paths?.game_dir && (
                  <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => { refreshMods(); }}>🔄 Retry</button>
                )}
              </div>
            )}

            {view === "mods" && <ModsView mods={mods} onRefresh={refreshMods} toast={toast} />}
            {view === "hub" && <ModHubView installedMods={mods} onRefresh={refreshMods} toast={toast} />}
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
