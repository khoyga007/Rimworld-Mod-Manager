import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { LogPayload } from "../types";

type LogFilter = "all" | "errors" | "warnings" | "mods";

export default function LogsView() {
  const { t } = useTranslation();
  const [log, setLog] = useState<LogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tailing, setTailing] = useState(false);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadLog = async () => {
    try {
      setLoading(true);
      const data = await invoke<LogPayload>("read_rimworld_log");
      setLog(data);
    } catch (e) {
      console.error("read_rimworld_log:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLog(); }, []);

  const toggleTail = async () => {
    try {
      if (tailing) {
        await invoke("stop_log_tail");
        setTailing(false);
      } else {
        await invoke("start_log_tail");
        setTailing(true);
      }
    } catch (e) {
      console.error("log tail:", e);
    }
  };

  const lines = useMemo(() => {
    if (!log?.content) return [];
    return log.content.split("\n").map((text, i) => {
      const lower = text.toLowerCase();
      let level: "error" | "warning" | "mod" | "normal" = "normal";
      if (lower.includes("error") || lower.includes("exception") || lower.includes("stacktrace")) {
        level = "error";
      } else if (lower.includes("warning") || lower.includes("warn")) {
        level = "warning";
      } else if (lower.includes("[mod]") || lower.includes("loaded mod") || lower.includes("loading mod")) {
        level = "mod";
      }
      return { text, level, num: i + 1 };
    });
  }, [log?.content]);

  const filteredLines = useMemo(() => {
    let result = lines;
    if (filter === "errors") result = result.filter((l) => l.level === "error");
    if (filter === "warnings") result = result.filter((l) => l.level === "warning" || l.level === "error");
    if (filter === "mods") result = result.filter((l) => l.level === "mod");
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((l) => l.text.toLowerCase().includes(q));
    }
    return result;
  }, [lines, filter, search]);

  const stats = useMemo(() => ({
    total: lines.length,
    errors: lines.filter((l) => l.level === "error").length,
    warnings: lines.filter((l) => l.level === "warning").length,
  }), [lines]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const levelColors: Record<string, string> = {
    error: "var(--color-danger)",
    warning: "var(--color-warning)",
    mod: "var(--color-info)",
    normal: "var(--color-text-muted)",
  };

  const filterButtons: { id: LogFilter; label: string; icon: string }[] = [
    { id: "all", label: t('logs.all'), icon: "📋" },
    { id: "errors", label: `${t('logs.errors')} (${stats.errors})`, icon: "🔴" },
    { id: "warnings", label: `${t('logs.warnings')} (${stats.warnings})`, icon: "🟡" },
    { id: "mods", label: t('logs.mod_logs'), icon: "📦" },
  ];

  return (
    <div className="animate-fade-in p-8" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{t('logs.title')}</h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>{t('logs.subtitle')}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {log && <span style={{ fontSize: 11, color: "var(--color-text-dim)", marginRight: 8, fontFamily: "var(--font-mono)" }}>{log.path}</span>}
          <button className="btn-secondary" onClick={scrollToBottom} style={{ fontSize: 13, padding: "6px 12px" }}>⬇ {t('logs.bottom')}</button>
          <button className="btn-secondary" onClick={loadLog} style={{ fontSize: 13, padding: "6px 12px" }}>🔄 {t('logs.refresh')}</button>
          <button
            className={tailing ? "btn-danger" : "btn-primary"}
            onClick={toggleTail}
            style={{ fontSize: 13, padding: "6px 16px" }}
          >
            {tailing ? `⏹ ${t('logs.stop_tail')}` : `▶ ${t('logs.live_tail')}`}
          </button>
        </div>
      </div>

      {/* Toolbar: Filters + Search */}
      <div className="glass-card" style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", padding: "12px 16px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          {filterButtons.map((btn) => (
            <button
              key={btn.id}
              onClick={() => setFilter(btn.id)}
              style={{
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: filter === btn.id ? 600 : 500,
                background: filter === btn.id ? "var(--color-bg-active)" : "rgba(0,0,0,0.2)",
                border: filter === btn.id ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                borderRadius: 8,
                color: filter === btn.id ? "var(--color-accent)" : "var(--color-text)",
                cursor: "pointer",
                transition: "var(--transition)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>{btn.icon}</span>
              {btn.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }}>🔍</span>
          <input
            className="input-field"
            placeholder={t('logs.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", paddingLeft: 36, background: "rgba(0,0,0,0.2)" }}
          />
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12, color: "var(--color-text-dim)", padding: "0 8px" }}>
        <span style={{ fontWeight: 600, color: "var(--color-text)" }}>
          {t('logs.showing', { count: filteredLines.length, total: stats.total })}
        </span>
        <div style={{ display: "flex", gap: 16, marginLeft: "auto" }}>
          {stats.errors > 0 && <span style={{ color: "var(--color-danger)", display: "flex", alignItems: "center", gap: 4 }}><div style={{width:6,height:6,borderRadius:"50%",background:"var(--color-danger)"}}/> {t('logs.errors_count', { count: stats.errors })}</span>}
          {stats.warnings > 0 && <span style={{ color: "var(--color-warning)", display: "flex", alignItems: "center", gap: 4 }}><div style={{width:6,height:6,borderRadius:"50%",background:"var(--color-warning)"}}/> {t('logs.warnings_count', { count: stats.warnings })}</span>}
        </div>
      </div>

      {/* Log content */}
      <div
        className="glass-card"
        style={{
          flex: 1,
          overflow: "auto",
          padding: 16,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          background: "rgba(10, 10, 15, 0.7)",
          border: "1px solid var(--color-border)",
          boxShadow: "inset 0 2px 10px rgba(0,0,0,0.2)",
        }}
      >
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--color-text-dim)", padding: 20 }}>
            <div style={{ width: 20, height: 20, border: "2px solid var(--color-border)", borderTop: "2px solid var(--color-accent)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
            {t('logs.loading')}
          </div>
        ) : filteredLines.length > 0 ? (
          <>
            {filteredLines.map((line) => (
              <div key={line.num} style={{ 
                color: levelColors[line.level], 
                padding: "2px 0",
                display: "flex",
                background: line.level === "error" ? "rgba(239, 68, 68, 0.05)" : line.level === "warning" ? "rgba(245, 158, 11, 0.05)" : "transparent",
              }}>
                <span style={{ color: "var(--color-text-dim)", opacity: 0.5, marginRight: 16, userSelect: "none", display: "inline-block", width: 44, textAlign: "right", flexShrink: 0 }}>
                  {line.num}
                </span>
                <span style={{ flex: 1 }}>
                  {line.level === "error" && <span style={{ color: "var(--color-danger)", marginRight: 8, fontWeight: 700 }}>✕</span>}
                  {line.level === "warning" && <span style={{ color: "var(--color-warning)", marginRight: 8 }}>⚠</span>}
                  {line.text}
                </span>
              </div>
            ))}
            <div ref={bottomRef} style={{ height: 1 }} />
          </>
        ) : (
          <div style={{ textAlign: "center", padding: 60, color: "var(--color-text-dim)" }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.2 }}>📄</div>
            {lines.length === 0
              ? t('logs.no_data')
              : t('logs.no_match')
            }
          </div>
        )}
      </div>
    </div>
  );
}
