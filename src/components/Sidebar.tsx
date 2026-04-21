import type { ReactNode } from "react";

type View = "mods" | "download" | "collections" | "loadorder" | "saves" | "logs" | "settings";

interface Props {
  currentView: View;
  onNavigate: (v: View) => void;
  modCount: number;
  enabledCount: number;
  gameDirSet: boolean;
}

const NAV: { id: View; icon: string; label: string }[] = [
  { id: "mods", icon: "📦", label: "Mods" },
  { id: "download", icon: "⬇", label: "Download" },
  { id: "collections", icon: "📁", label: "Presets" },
  { id: "loadorder", icon: "📊", label: "Load Order" },
  { id: "saves", icon: "🏰", label: "Save Games" },
  { id: "logs", icon: "📜", label: "Game Logs" },
  { id: "settings", icon: "⚙", label: "Settings" },
];

export default function Sidebar({ currentView, onNavigate, modCount, enabledCount, gameDirSet }: Props) {
  return (
    <aside style={{
      width: 200,
      background: "var(--color-sidebar)",
      borderRight: "1px solid var(--color-border)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      height: "100vh",
    }}>
      {/* Brand */}
      <div style={{
        padding: "20px 16px 16px",
        borderBottom: "1px solid var(--color-border)",
      }}>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: 16,
          fontWeight: 700,
          color: "var(--color-accent)",
          letterSpacing: "0.5px",
        }}>
          RimWorld
        </div>
        <div style={{
          fontSize: 11,
          color: "var(--color-text-dim)",
          marginTop: 2,
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}>
          Mod Manager
        </div>
      </div>

      {/* Stats */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex",
        gap: 12,
      }}>
        <Stat label="Total" value={modCount} />
        <Stat label="Active" value={enabledCount} color="var(--color-success)" />
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              border: "none",
              background: currentView === item.id ? "var(--color-sidebar-active)" : "transparent",
              color: currentView === item.id ? "var(--color-accent)" : "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: currentView === item.id ? 600 : 400,
              textAlign: "left",
              transition: "all 0.15s ease",
              borderLeft: currentView === item.id ? "2px solid var(--color-accent)" : "2px solid transparent",
            }}
            onMouseEnter={(e) => {
              if (currentView !== item.id) e.currentTarget.style.background = "var(--color-sidebar-hover)";
            }}
            onMouseLeave={(e) => {
              if (currentView !== item.id) e.currentTarget.style.background = "transparent";
            }}
          >
            <span style={{ fontSize: 15 }}>{item.icon}</span>
            {item.label}
            {item.id === "settings" && !gameDirSet && (
              <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "var(--color-warning)" }} />
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--color-border)",
        fontSize: 10,
        color: "var(--color-text-dim)",
      }}>
        v0.1.0 • Made for colonists
      </div>
    </aside>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "var(--color-text)" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--color-text-dim)", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}
