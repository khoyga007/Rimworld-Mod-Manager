import { useTranslation } from 'react-i18next';

type View = "mods" | "hub" | "download" | "collections" | "loadorder" | "saves" | "logs" | "settings";

interface Props {
  currentView: View;
  onNavigate: (v: View) => void;
  modCount: number;
  enabledCount: number;
  gameDirSet: boolean;
}

export default function Sidebar({ currentView, onNavigate, modCount, enabledCount, gameDirSet }: Props) {
  const { t, i18n } = useTranslation();

  const NAV: { id: View; icon: string; label: string }[] = [
    { id: "mods", icon: "📦", label: t('nav.mods') },
    { id: "hub", icon: "✨", label: t('nav.mod_hub') },
    { id: "download", icon: "⬇", label: t('nav.downloads') },
    { id: "collections", icon: "📁", label: t('nav.collections') },
    { id: "loadorder", icon: "📊", label: t('nav.load_order') },
    { id: "saves", icon: "🏰", label: t('nav.save_games') },
    { id: "logs", icon: "📜", label: t('nav.logs') },
    { id: "settings", icon: "⚙", label: t('nav.settings') },
  ];

  const toggleLanguage = () => {
    const nextLng = i18n.language === 'en' ? 'vi' : 'en';
    i18n.changeLanguage(nextLng);
  };

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
          RIM<span style={{ color: "var(--color-accent)" }}>PRO</span>
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
        <Stat label={t('common.total')} value={modCount} />
        <div style={{ width: 1, background: "var(--color-border)", margin: "4px 0" }}></div>
        <Stat label={t('common.active')} value={enabledCount} color="var(--color-success)" />
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

      {/* Language Switcher */}
      <div style={{ padding: "8px", borderTop: "1px solid var(--color-border)", marginTop: "auto" }}>
        <button 
          onClick={toggleLanguage}
          className="btn-secondary"
          style={{ 
            width: "100%", 
            fontSize: 11, 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            gap: 8,
            padding: "8px"
          }}
        >
          <span>🌐</span>
          <span>{i18n.language === 'en' ? 'ENGLISH' : 'TIẾNG VIỆT'}</span>
        </button>
      </div>

      {/* Footer */}
      <div style={{
        padding: "16px",
        fontSize: 11,
        color: "var(--color-text-dim)",
        textAlign: "center",
        borderTop: "1px solid var(--color-border)"
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
