import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

interface ExceptionBlock {
  header: string;
  stacktrace: string;
  hits: number;
}
interface ModSuspect {
  mod_id: string;
  mod_name: string;
  confidence: number;
  reason: string;
  hit_count: number;
}
interface CrashReport {
  log_path: string;
  log_excerpt: string;
  exception_count: number;
  exceptions: ExceptionBlock[];
  suspects: ModSuspect[];
  mods_mentioned: string[];
  harmony_patches: string[];
}
interface AiSuspect {
  name: string;
  confidence: number;
  reason: string;
}
interface AiAnalysis {
  provider: string;
  model: string;
  root_cause: string;
  fix_steps: string[];
  suspect_mods: AiSuspect[];
  raw: string;
}

interface Props {
  toast: (msg: string, type?: string) => void;
}

export default function CrashAnalyzerView({ toast }: Props) {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<CrashReport | null>(null);
  const [ai, setAi] = useState<AiAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [customPath, setCustomPath] = useState("");

  const runAnalyze = async () => {
    setLoading(true);
    setReport(null);
    setAi(null);
    try {
      const r = await invoke<CrashReport>("analyze_crash_log", {
        customPath: customPath || null,
      });
      setReport(r);
      if (r.exception_count === 0) {
        toast(t("crash.no_exceptions") || "No exceptions found in log", "info");
      } else {
        toast(
          t("crash.found_exceptions", { count: r.exception_count }) ||
            `Found ${r.exception_count} exception(s)`,
          "success"
        );
      }
    } catch (e: any) {
      toast(e?.toString() || "Analyze failed", "error");
    } finally {
      setLoading(false);
    }
  };

  const runAi = async () => {
    if (!report) return;
    setAiLoading(true);
    try {
      const a = await invoke<AiAnalysis>("analyze_crash_with_ai", { report, lang: i18n.language });
      setAi(a);
      toast(t("crash.ai_done") || "AI analysis complete", "success");
    } catch (e: any) {
      toast(e?.toString() || "AI failed", "error");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="animate-fade-in p-8" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>
            🩺 {t("crash.title") || "Crash Analyzer"}
          </h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: 14 }}>
            {t("crash.subtitle") ||
              "Parse Player.log, surface culprit mods, optionally call AI for a fix plan."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-primary" onClick={runAnalyze} disabled={loading}>
            {loading ? "⏳ " + (t("crash.analyzing") || "Analyzing...") : "🔍 " + (t("crash.analyze") || "Analyze Player.log")}
          </button>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--color-text-dim)", display: "block", marginBottom: 6 }}>
          {t("crash.custom_path") || "Custom log path (optional)"}
        </label>
        <input
          className="input-field"
          placeholder="C:/path/to/Player.log"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      {!report && !loading && (
        <div className="glass-card" style={{ padding: 40, textAlign: "center", color: "var(--color-text-dim)" }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>🩺</div>
          {t("crash.empty_hint") ||
            "Click Analyze to scan Player.log. We auto-detect the default location across Win/Linux/Mac."}
        </div>
      )}

      {report && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <Stat label={t("crash.exceptions") || "Exceptions"} value={report.exception_count} color="var(--color-danger)" />
            <Stat label={t("crash.unique_blocks") || "Unique blocks"} value={report.exceptions.length} />
            <Stat label={t("crash.suspects") || "Heuristic suspects"} value={report.suspects.length} color="var(--color-warning)" />
            <Stat label={t("crash.harmony") || "Harmony refs"} value={report.harmony_patches.length} />
            <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11, color: "var(--color-text-dim)", fontFamily: "var(--font-mono)" }}>
              {report.log_path}
            </div>
          </div>

          {/* AI block */}
          <div className="glass-card" style={{ padding: 16, marginBottom: 16, borderLeft: "4px solid #8b5cf6" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>🤖 {t("crash.ai_section") || "AI Deep Analysis"}</div>
              <button className="btn-primary" onClick={runAi} disabled={aiLoading}>
                {aiLoading ? "⏳ " + (t("crash.ai_running") || "Asking AI...") : "✨ " + (t("crash.ai_run") || "Run AI Analysis")}
              </button>
            </div>
            {!ai && !aiLoading && (
              <div style={{ fontSize: 13, color: "var(--color-text-dim)" }}>
                {t("crash.ai_hint") ||
                  "Sends excerpt + heuristic suspects to your configured provider (Gemini BYOK or local Ollama). Configure in Settings."}
              </div>
            )}
            {ai && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: "var(--color-text-dim)", marginBottom: 8 }}>
                  {ai.provider} · {ai.model}
                </div>
                {ai.root_cause && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      {t("crash.root_cause") || "Root cause"}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--color-text)" }}>{ai.root_cause}</div>
                  </div>
                )}
                {ai.fix_steps?.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      {t("crash.fix_steps") || "Fix steps"}
                    </div>
                    <ol style={{ paddingLeft: 22, fontSize: 13, lineHeight: 1.7 }}>
                      {ai.fix_steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {ai.suspect_mods?.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                      {t("crash.ai_suspects") || "AI suspects"}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {ai.suspect_mods.map((s, i) => (
                        <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6 }}>
                          <ConfidenceBadge value={s.confidence} />
                          <div style={{ fontWeight: 600 }}>{s.name}</div>
                          <div style={{ fontSize: 12, color: "var(--color-text-dim)", flex: 1 }}>{s.reason}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Heuristic suspects */}
          {report.suspects.length > 0 && (
            <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {t("crash.heuristic_suspects") || "Heuristic Suspects"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {report.suspects.map((s) => (
                  <div key={s.mod_id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6 }}>
                    <ConfidenceBadge value={s.confidence} />
                    <div style={{ fontWeight: 600 }}>{s.mod_name}</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-dim)", flex: 1 }}>{s.reason}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-dim)" }}>{s.hit_count} hits</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Exceptions */}
          {report.exceptions.length > 0 && (
            <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {t("crash.exception_blocks") || "Exception Blocks"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {report.exceptions.map((e, i) => (
                  <details key={i} style={{ background: "rgba(0,0,0,0.25)", borderRadius: 6, padding: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                      <span style={{ color: "var(--color-danger)" }}>✕</span> {e.header}
                      <span style={{ float: "right", color: "var(--color-text-dim)", fontSize: 11 }}>×{e.hits}</span>
                    </summary>
                    <pre style={{ marginTop: 8, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-dim)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                      {e.stacktrace}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* Raw excerpt */}
          <details className="glass-card" style={{ padding: 16 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>
              {t("crash.raw_excerpt") || "Raw log excerpt"}
            </summary>
            <pre style={{ marginTop: 12, fontSize: 11, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 400, overflow: "auto" }}>
              {report.log_excerpt}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="glass-card" style={{ padding: "10px 16px", flex: "0 0 auto" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--color-text)" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const color = value >= 70 ? "#ef4444" : value >= 40 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{
      minWidth: 44,
      padding: "2px 8px",
      borderRadius: 999,
      background: color + "33",
      color,
      fontWeight: 700,
      fontSize: 12,
      textAlign: "center",
    }}>
      {value}%
    </div>
  );
}
