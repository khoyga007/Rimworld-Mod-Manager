import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LogPayload } from "../types";

type LogFilter = "all" | "errors" | "warnings" | "mods";

export default function LogsView() {
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
    { id: "all", label: "All", icon: "📋" },
    { id: "errors", label: `Errors (${stats.errors})`, icon: "🔴" },
    { id: "warnings", label: `Warnings (${stats.warnings})`, icon: "🟡" },
    { id: "mods", label: "Mod Logs", icon: "📦" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--color-accent)", margin: 0 }}>
          Game Logs
        </h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={scrollToBottom} style={{ fontSize: 12, padding: "6px 10px" }}>⬇ Bottom</button>
          <button className="btn-secondary" onClick={loadLog}>🔄 Refresh</button>
          <button
            className={tailing ? "btn-danger" : "btn-primary"}
            onClick={toggleTail}
          >
            {tailing ? "⏹ Stop Tail" : "▶ Live Tail"}
          </button>
        </div>
      </div>

      {/* Toolbar: Filters + Search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {filterButtons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => setFilter(btn.id)}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: filter === btn.id ? 600 : 400,
              background: filter === btn.id ? "var(--color-bg-active)" : "var(--color-bg-card)",
              border: filter === btn.id ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
              borderRadius: 6,
              color: filter === btn.id ? "var(--color-accent)" : "var(--color-text-muted)",
              cursor: "pointer",
              transition: "all 0.15s ease",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 11 }}>{btn.icon}</span>
            {btn.label}
          </button>
        ))}

        <input
          className="input-field"
          placeholder="Search logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: "auto", width: 220, fontSize: 12, padding: "5px 10px" }}
        />
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 11, color: "var(--color-text-dim)" }}>
        {log && <span>📄 {log.path}</span>}
        <span style={{ marginLeft: "auto" }}>
          Showing {filteredLines.length} / {stats.total} lines
          {stats.errors > 0 && <span style={{ color: "var(--color-danger)", marginLeft: 8 }}>● {stats.errors} errors</span>}
          {stats.warnings > 0 && <span style={{ color: "var(--color-warning)", marginLeft: 8 }}>● {stats.warnings} warnings</span>}
        </span>
      </div>

      {/* Log content */}
      <div
        className="glass-card"
        style={{
          flex: 1,
          overflow: "auto",
          padding: 12,
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {loading ? (
          <span style={{ color: "var(--color-text-dim)" }}>Loading log...</span>
        ) : filteredLines.length > 0 ? (
          <>
            {filteredLines.map((line) => (
              <div key={line.num} style={{ color: levelColors[line.level], minHeight: "1.3em" }}>
                <span style={{ color: "var(--color-text-dim)", marginRight: 8, userSelect: "none", display: "inline-block", width: 40, textAlign: "right" }}>
                  {line.num}
                </span>
                {line.level === "error" && <span style={{ color: "var(--color-danger)", marginRight: 4, fontWeight: 700 }}>✕</span>}
                {line.level === "warning" && <span style={{ color: "var(--color-warning)", marginRight: 4 }}>⚠</span>}
                {line.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        ) : (
          <span style={{ color: "var(--color-text-dim)" }}>
            {lines.length === 0
              ? "No log data found. Launch RimWorld to generate logs."
              : "No lines match current filter."
            }
          </span>
        )}
      </div>
    </div>
  );
}
