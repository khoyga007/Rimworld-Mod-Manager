import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModInfo } from "../types";

interface CustomRule {
  load_after: string[];
  load_before: string[];
  load_top: boolean;
  load_bottom: boolean;
}

interface CustomRules {
  rules: Record<string, CustomRule>;
}

interface Props {
  mods: ModInfo[];
  onClose: () => void;
  toast: (msg: string, type?: string) => void;
}

const emptyRule = (): CustomRule => ({ load_after: [], load_before: [], load_top: false, load_bottom: false });

export default function CustomRulesModal({ mods, onClose, toast }: Props) {
  const [rules, setRules] = useState<Record<string, CustomRule>>({});
  const [selectedId, setSelectedId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<CustomRule>(emptyRule());

  const modById = useMemo(() => {
    const m = new Map<string, ModInfo>();
    for (const mod of mods) m.set(mod.id.toLowerCase(), mod);
    return m;
  }, [mods]);

  const enabledSorted = useMemo(
    () => mods.filter((m) => m.enabled).sort((a, b) => a.name.localeCompare(b.name)),
    [mods]
  );

  const filtered = useMemo(() => {
    if (!search) return enabledSorted;
    const q = search.toLowerCase();
    return enabledSorted.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [enabledSorted, search]);

  useEffect(() => {
    (async () => {
      try {
        const res = await invoke<CustomRules>("get_custom_rules");
        setRules(res.rules || {});
      } catch (e: any) {
        toast(e?.toString() || "Failed to load rules", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const key = selectedId.toLowerCase();
    setDraft(rules[key] ? { ...rules[key] } : emptyRule());
  }, [selectedId, rules]);

  const persist = async (next: Record<string, CustomRule>) => {
    setRules(next);
    try {
      await invoke("save_custom_rules", { rules: { rules: next } });
    } catch (e: any) {
      toast(e?.toString() || "Save failed", "error");
    }
  };

  const saveDraft = async () => {
    if (!selectedId) return;
    const key = selectedId.toLowerCase();
    const hasAny =
      draft.load_after.length > 0 || draft.load_before.length > 0 || draft.load_top || draft.load_bottom;
    const next = { ...rules };
    if (hasAny) next[key] = draft;
    else delete next[key];
    await persist(next);
    toast(hasAny ? "Rule saved" : "Rule cleared", "success");
  };

  const deleteRule = async (id: string) => {
    const next = { ...rules };
    delete next[id.toLowerCase()];
    await persist(next);
    if (selectedId.toLowerCase() === id.toLowerCase()) setDraft(emptyRule());
    toast("Rule removed", "info");
  };

  const parseList = (s: string): string[] =>
    s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

  const renderPackagePicker = (
    label: string,
    value: string[],
    onChange: (v: string[]) => void
  ) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--color-text-dim)" }}>
        {label} <span style={{ opacity: 0.6 }}>(comma or newline separated package_ids)</span>
      </div>
      <textarea
        className="input-field"
        rows={3}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
        value={value.join("\n")}
        onChange={(e) => onChange(parseList(e.target.value))}
        placeholder="e.g. brrainz.harmony"
      />
    </div>
  );

  const selectedMod = selectedId ? modById.get(selectedId.toLowerCase()) : null;
  const ruleEntries = Object.entries(rules);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card"
        style={{
          width: "min(960px, 100%)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          padding: 24,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>✏️ Custom Load Order Rules</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-dim)", margin: "4px 0 0" }}>
              Override community rules per mod. Applied on top during auto-sort.
            </p>
          </div>
          <button className="btn-secondary" onClick={onClose}>✕ Close</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.6 }}>Loading rules...</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, flex: 1, minHeight: 0 }}>
            {/* Mod list */}
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <input
                className="input-field"
                placeholder="Search mod..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <div style={{ overflowY: "auto", flex: 1, border: "1px solid var(--color-border)", borderRadius: 8 }} className="custom-scrollbar">
                {filtered.map((m) => {
                  const has = !!rules[m.id.toLowerCase()];
                  const active = selectedId.toLowerCase() === m.id.toLowerCase();
                  return (
                    <div
                      key={m.id}
                      onClick={() => setSelectedId(m.id)}
                      style={{
                        padding: "8px 12px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--color-border)",
                        background: active ? "rgba(251, 191, 36, 0.1)" : "transparent",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {m.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {m.id}
                        </div>
                      </div>
                      {has && <span title="Has custom rule" style={{ color: "var(--color-accent)", fontSize: 16 }}>●</span>}
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div style={{ padding: 16, textAlign: "center", opacity: 0.5, fontSize: 13 }}>No matches</div>
                )}
              </div>
            </div>

            {/* Editor */}
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }} className="custom-scrollbar">
              {!selectedMod ? (
                <div style={{ padding: 24, opacity: 0.6, textAlign: "center" }}>
                  Select a mod to edit its rule.
                  {ruleEntries.length > 0 && (
                    <div style={{ marginTop: 24, textAlign: "left" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.8 }}>
                        Existing rules ({ruleEntries.length}):
                      </div>
                      {ruleEntries.map(([id]) => {
                        const mod = modById.get(id);
                        return (
                          <div
                            key={id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "6px 10px",
                              borderBottom: "1px solid var(--color-border)",
                              gap: 8,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {mod?.name || id}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--color-text-dim)" }}>{id}</div>
                            </div>
                            <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setSelectedId(id)}>
                              Edit
                            </button>
                            <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: 11, color: "var(--color-error)" }} onClick={() => deleteRule(id)}>
                              🗑
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedMod.name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-dim)", fontFamily: "monospace" }}>{selectedMod.id}</div>
                  </div>

                  {renderPackagePicker(
                    "Load AFTER these mods",
                    draft.load_after,
                    (v) => setDraft({ ...draft, load_after: v })
                  )}
                  {renderPackagePicker(
                    "Load BEFORE these mods",
                    draft.load_before,
                    (v) => setDraft({ ...draft, load_before: v })
                  )}

                  <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={draft.load_top}
                        onChange={(e) => setDraft({ ...draft, load_top: e.target.checked, load_bottom: e.target.checked ? false : draft.load_bottom })}
                      />
                      Pin to top
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={draft.load_bottom}
                        onChange={(e) => setDraft({ ...draft, load_bottom: e.target.checked, load_top: e.target.checked ? false : draft.load_top })}
                      />
                      Pin to bottom
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
                    <button className="btn-primary" onClick={saveDraft}>💾 Save rule</button>
                    <button className="btn-secondary" onClick={() => setDraft(emptyRule())}>Clear fields</button>
                    {rules[selectedId.toLowerCase()] && (
                      <button
                        className="btn-secondary"
                        style={{ color: "var(--color-error)", marginLeft: "auto" }}
                        onClick={() => deleteRule(selectedId)}
                      >
                        🗑 Delete rule
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
