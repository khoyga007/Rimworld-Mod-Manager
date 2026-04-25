import { useTranslation } from 'react-i18next';

type View = "mods" | "hub" | "download" | "workshop" | "collections" | "loadorder" | "saves" | "logs" | "settings" | "guide" | "crash";

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
    { id: "workshop", icon: "🌐", label: t('nav.workshop_browser') },
    { id: "collections", icon: "📁", label: t('nav.collections') },
    { id: "loadorder", icon: "📊", label: t('nav.load_order') },
    { id: "saves", icon: "🏰", label: t('nav.save_games') },
    { id: "logs", icon: "📜", label: t('nav.logs') },
    { id: "crash", icon: "🩺", label: t('nav.crash_analyzer') },
    { id: "guide", icon: "📖", label: t('nav.guide') },
    { id: "settings", icon: "⚙", label: t('nav.settings') },
  ];

  const toggleLanguage = () => {
    const nextLng = i18n.language === 'en' ? 'vi' : 'en';
    i18n.changeLanguage(nextLng);
  };

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div style={{ padding: "0 12px 12px", flexShrink: 0 }}>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: 20,
          fontWeight: 700,
          color: "var(--color-text)",
          letterSpacing: "-0.03em",
        }}>
          RIM<span style={{ color: "var(--color-accent)" }}>PRO</span>
        </div>
        <div style={{
          fontSize: 10,
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
      <div className="glass-card sidebar-stats" style={{
        margin: "0 4px 10px",
        padding: "10px 12px",
        display: "flex",
        justifyContent: "space-around",
        background: "rgba(255,255,255,0.02)",
        flexShrink: 0,
      }}>
        <Stat label={t('common.total')} value={modCount} />
        <div style={{ width: 1, background: "var(--color-border)", margin: "2px 0" }}></div>
        <Stat label={t('common.active')} value={enabledCount} color="var(--color-success)" />
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
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

      {/* Footer: language + version compact */}
      <div style={{
        padding: "8px 4px 0",
        borderTop: "1px solid var(--color-border)",
        marginTop: 6,
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
      }}>
        <button
          onClick={toggleLanguage}
          className="btn-secondary"
          style={{
            flex: 1,
            fontSize: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "6px 8px",
          }}
          title={i18n.language === 'en' ? 'English' : 'Tiếng Việt'}
        >
          <span>🌐</span>
          <span>{i18n.language === 'en' ? 'EN' : 'VI'}</span>
        </button>
        <div style={{
          fontSize: 10,
          color: "var(--color-text-dim)",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}>
          v1.0.0
        </div>
      </div>
    </aside>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || "var(--color-text)", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 9, color: "var(--color-text-dim)", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
    </div>
  );
}
