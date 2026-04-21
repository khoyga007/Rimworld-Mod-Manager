
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
    <aside className="sidebar">
      {/* Brand */}
      <div style={{ padding: "0 16px 24px" }}>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 700,
          color: "var(--color-text)",
          letterSpacing: "-0.03em",
        }}>
          RIM<span style={{ color: "var(--color-accent)" }}>SORT</span>
        </div>
        <div style={{
          fontSize: 11,
          color: "var(--color-text-dim)",
          marginTop: 2,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 600
        }}>
          Mod Manager Pro
        </div>
      </div>

      {/* Stats Summary */}
      <div className="glass-card" style={{ 
        margin: "0 8px 24px", 
        padding: "16px", 
        display: "flex", 
        justifyContent: "space-around",
        background: "rgba(255,255,255,0.02)"
      }}>
        <Stat label="Total" value={modCount} />
        <div style={{ width: 1, background: "var(--color-border)", margin: "4px 0" }}></div>
        <Stat label="Active" value={enabledCount} color="var(--color-success)" />
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`nav-item ${currentView === item.id ? "active" : ""}`}
            style={{ 
              background: "none", 
              border: "none", 
              width: "100%", 
              textAlign: "left",
              fontFamily: "inherit"
            }}
          >
            <span style={{ fontSize: 18, opacity: currentView === item.id ? 1 : 0.7 }}>{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.id === "settings" && !gameDirSet && (
              <span className="pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-warning)" }} />
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div style={{
        padding: "16px",
        fontSize: 11,
        color: "var(--color-text-dim)",
        textAlign: "center",
        borderTop: "1px solid var(--color-border)",
        marginTop: "auto"
      }}>
        <div style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>v1.0.0-PRO</div>
        <div>Ready for A17+</div>
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
