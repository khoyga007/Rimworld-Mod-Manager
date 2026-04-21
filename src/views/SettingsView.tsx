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
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, marginBottom: 24, color: "var(--color-accent)" }}>
        Settings
      </h2>

      {/* Game Directory */}
      <section className="glass-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>📂</span>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>RimWorld Game Directory</h3>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", margin: "0 0 12px" }}>
          Point this to your RimWorld installation folder (the one containing Data/, Mods/, and the game executable).
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input-field"
            value={paths?.game_dir || ""}
            readOnly
            placeholder="Not set — click Browse..."
            style={{ flex: 1 }}
          />
          <button className="btn-primary" onClick={browseGameDir}>Browse</button>
        </div>

        {paths?.game_dir && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-success)" }}>
            ✓ Directory set. Mods will be scanned from Data/, Mods/, and LinkNeverDie.Com-GSE/mods/.
          </div>
        )}
      </section>

      {/* Executable */}
      <section className="glass-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>🎮</span>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>RimWorld Executable</h3>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", margin: "0 0 12px" }}>
          Used for the "Launch RimWorld" button. Point this to RimWorldWin64.exe or similar.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input-field"
            value={exePath}
            readOnly
            placeholder="Not set — click Browse..."
            style={{ flex: 1 }}
          />
          <button className="btn-primary" onClick={browseExe}>Browse</button>
        </div>
      </section>

      {/* Config Info */}
      <section className="glass-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>📋</span>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Config Paths</h3>
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            <span style={{ color: "var(--color-text-dim)" }}>ModsConfig.xml: </span>
            <span
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => paths?.mods_config_path && invoke("open_path_or_url", { target: paths.mods_config_path })}
            >
              {paths?.mods_config_path || "N/A"}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--color-text-dim)" }}>Config Dir: </span>
            <span
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => paths?.config_dir && invoke("open_path_or_url", { target: paths.config_dir })}
            >
              {paths?.config_dir || "N/A"}
            </span>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="glass-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }}>ℹ</span>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>About</h3>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
          RimWorld Mod Manager v0.1.0 — Built with Tauri + React.
          <br />
          Manages your colony's mods with love. 🏠
        </p>
      </section>
    </div>
  );
}
