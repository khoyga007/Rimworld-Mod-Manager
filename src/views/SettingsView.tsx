import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { RimWorldPaths } from "../types";

interface Props {
  paths: RimWorldPaths | null;
  onPathsChange: (p: RimWorldPaths) => void;
  toast: (msg: string, type?: string) => void;
}

export default function SettingsView({ paths, onPathsChange, toast }: Props) {
  const [exePath, setExePath] = useState<string>("");
  const [loadingExe, setLoadingExe] = useState(false);

  // Load stored exe on mount
  useState(() => {
    invoke<string | null>("get_stored_exe_path").then((p) => {
      if (p) setExePath(p);
    });
  });

  const browseGameDir = async () => {
    const selected = await open({ directory: true, title: "Select RimWorld game folder" });
    if (selected) {
      try {
        const p = await invoke<RimWorldPaths>("set_user_dir", { path: selected });
        onPathsChange(p);
        toast("Game directory set!", "success");
      } catch (e: any) {
        toast(e?.toString() || "Failed to set directory", "error");
      }
    }
  };

  const browseExe = async () => {
    const selected = await open({
      filters: [{ name: "Executable", extensions: ["exe"] }],
      title: "Select RimWorld.exe",
    });
    if (selected) {
      try {
        await invoke("set_stored_exe_path", { path: selected });
        setExePath(selected as string);
        toast("Executable path saved!", "success");
      } catch (e: any) {
        toast(e?.toString() || "Failed", "error");
      }
    }
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: 800, margin: "0 auto" }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Settings</h1>
        <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>Configure RimWorld executable and mod directories</p>
      </div>

      {/* Game Directory */}
      <section className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255, 157, 0, 0.1)", color: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            📂
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Game Directory</h3>
            <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>Folder containing Data/, Mods/, and game executable</div>
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              className="input-field"
              value={paths?.game_dir || ""}
              readOnly
              placeholder="Not set — click Browse..."
              style={{ background: "rgba(0,0,0,0.2)", cursor: "default" }}
            />
            {paths?.game_dir && (
              <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-success)", fontSize: 14 }}>✓</span>
            )}
          </div>
          <button className="btn-primary" onClick={browseGameDir}>Browse Folder</button>
        </div>
      </section>

      {/* Executable */}
      <section className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(59, 130, 246, 0.1)", color: "var(--color-info)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            🎮
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>RimWorld Executable</h3>
            <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>Used for launching the game directly from the manager</div>
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              className="input-field"
              value={exePath}
              readOnly
              placeholder="Not set — click Browse..."
              style={{ background: "rgba(0,0,0,0.2)", cursor: "default" }}
            />
            {exePath && (
              <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--color-success)", fontSize: 14 }}>✓</span>
            )}
          </div>
          <button className="btn-primary" onClick={browseExe}>Browse .exe</button>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Config Info */}
        <section className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255, 255, 255, 0.05)", color: "var(--color-text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              📋
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>System Paths</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 8, border: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>ModsConfig.xml</div>
              <div 
                style={{ fontSize: 13, color: "var(--color-accent)", cursor: "pointer", wordBreak: "break-all" }}
                onClick={() => paths?.mods_config_path && invoke("open_path_or_url", { target: paths.mods_config_path })}
                title="Open file location"
              >
                {paths?.mods_config_path || "N/A"}
              </div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 8, border: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: 11, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Config Directory</div>
              <div 
                style={{ fontSize: 13, color: "var(--color-accent)", cursor: "pointer", wordBreak: "break-all" }}
                onClick={() => paths?.config_dir && invoke("open_path_or_url", { target: paths.config_dir })}
                title="Open directory"
              >
                {paths?.config_dir || "N/A"}
              </div>
            </div>
          </div>
        </section>

        {/* About */}
        <section className="glass-card" style={{ padding: 24, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, marginBottom: 16, boxShadow: "0 8px 16px rgba(0,0,0,0.2)" }}>
            🚀
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", color: "var(--color-accent)" }}>RIMSORT Pro</h3>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 12 }}>v1.0.0-PRO</div>
          <p style={{ fontSize: 13, color: "var(--color-text-dim)", margin: 0, lineHeight: 1.5 }}>
            Built with Rust + Tauri + React.<br/>
            Engineered for RimWorld modders.
          </p>
        </section>
      </div>
    </div>
  );
}
