import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { useTranslation } from "react-i18next";

const WORKSHOP_URL = "https://steamcommunity.com/app/294100/workshop/";
const LABEL = "workshop-browser";

interface Props {
  toast: (msg: string, type?: string) => void;
  active: boolean;
}

function parseWorkshopId(url: string): string | null {
  const m = url.match(/(?:\?id=|filedetails\/\?id=|workshop\/content\/\d+\/)(\d+)/);
  return m ? m[1] : null;
}

export default function WorkshopBrowserView({ toast, active }: Props) {
  const { t } = useTranslation();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Webview | null>(null);
  const windowRef = useRef(getCurrentWindow());
  const [currentUrl, setCurrentUrl] = useState(WORKSHOP_URL);
  const [urlInput, setUrlInput] = useState(WORKSHOP_URL);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(148);

  const getContainerMetrics = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();

    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, []);

  const syncBounds = useCallback(async () => {
    const wv = webviewRef.current;
    const metrics = getContainerMetrics();
    if (!wv || !metrics || metrics.width <= 0 || metrics.height <= 0) return;
    try {
      const dpr = window.devicePixelRatio || 1;
      await wv.setPosition(new PhysicalPosition(
        Math.round(metrics.x * dpr),
        Math.round(metrics.y * dpr),
      ));
      await wv.setSize(new PhysicalSize(
        Math.max(1, Math.round(metrics.width * dpr)),
        Math.max(1, Math.round(metrics.height * dpr)),
      ));
    } catch (e) {
      console.error("[workshop] syncBounds failed", e);
    }
  }, [getContainerMetrics]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const existing = await Webview.getByLabel(LABEL);
      if (existing) {
        try { await existing.close(); } catch {}
      }
      if (disposed) return;

      const r = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const wv = new Webview(windowRef.current, LABEL, {
        url: WORKSHOP_URL,
        x: Math.round(r.left * dpr),
        y: Math.round(r.top * dpr),
        width: Math.max(1, Math.round(r.width * dpr)),
        height: Math.max(1, Math.round(r.height * dpr)),
      });

      wv.once("tauri://created", () => {
        if (disposed) { wv.close().catch(() => {}); return; }
        webviewRef.current = wv;
        setReady(true);
        wv.show().catch(() => {});
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            syncBounds().catch(() => {});
          });
        });
      });
      wv.once("tauri://error", (e: any) => {
        console.error("workshop webview error", e);
        toast("Failed to create Workshop browser", "error");
      });
    })();

    return () => {
      disposed = true;
      const wv = webviewRef.current;
      webviewRef.current = null;
      setReady(false);
      if (wv) wv.close().catch(() => {});
    };
  }, [active, syncBounds, toast]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const updateToolbarHeight = () => {
      setToolbarHeight(toolbar.getBoundingClientRect().height);
    };

    updateToolbarHeight();
    const ro = new ResizeObserver(updateToolbarHeight);
    ro.observe(toolbar);
    window.addEventListener("resize", updateToolbarHeight);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateToolbarHeight);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    syncBounds();
    const ro = new ResizeObserver(() => syncBounds());
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", syncBounds);
    const timers = [50, 150, 400, 1000].map((ms) => setTimeout(syncBounds, ms));
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncBounds);
      timers.forEach(clearTimeout);
    };
  }, [ready, syncBounds]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    if (active) {
      wv.show().catch(() => {});
      requestAnimationFrame(() => {
        syncBounds().catch(() => {});
      });
    } else {
      wv.hide().catch(() => {});
    }
  }, [active, ready, syncBounds]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const u = await invoke<string>("workshop_webview_url", { label: LABEL });
        if (!cancelled && u && u !== currentUrl) {
          setCurrentUrl(u);
          setUrlInput(u);
        }
      } catch {}
    };
    const id = setInterval(tick, 700);
    tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [ready, currentUrl]);

  const navigateTo = async (url: string) => {
    if (!ready) return;
    try {
      await invoke("workshop_webview_navigate", { label: LABEL, url });
    } catch (e: any) {
      toast(e?.toString() || "Navigate failed", "error");
    }
  };

  const handleDownload = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const u = await invoke<string>("workshop_webview_url", { label: LABEL });
      const id = parseWorkshopId(u);
      if (!id) {
        toast(t("workshop_browser.not_a_mod_page") || "Open a mod detail page first", "error");
        return;
      }
      await invoke("download_workshop_mod", { workshopId: id });
      toast((t("workshop_browser.queued") || "Queued mod") + " " + id, "info");
    } catch (e: any) {
      toast(e?.toString() || "Download failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleReload = async () => {
    try { await invoke("workshop_webview_reload", { label: LABEL }); } catch {}
  };

  const handleBack = async () => {
    try { await invoke("workshop_webview_back", { label: LABEL }); } catch {}
  };

  const handleForward = async () => {
    try { await invoke("workshop_webview_forward", { label: LABEL }); } catch {}
  };

  const canDownload = ready && !!parseWorkshopId(currentUrl);

  return (
    <div style={{ height: "100%", position: "relative", overflow: "hidden" }}>
      <div ref={toolbarRef} style={{ padding: "16px 24px 12px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>
          {t("workshop_browser.title") || "Browse Workshop"}
        </h1>
        <p style={{ color: "var(--color-text-dim)", fontSize: 13, marginBottom: 12 }}>
          {t("workshop_browser.subtitle") || "Browse Steam Workshop and install mods with one click."}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn-secondary" onClick={handleBack} disabled={!ready} style={{ height: 36 }} title="Back">←</button>
          <button className="btn-secondary" onClick={handleForward} disabled={!ready} style={{ height: 36 }} title="Forward">→</button>
          <button className="btn-secondary" onClick={() => navigateTo(WORKSHOP_URL)} disabled={!ready} style={{ height: 36 }} title="Home">🏠</button>
          <button className="btn-secondary" onClick={handleReload} disabled={!ready} style={{ height: 36 }} title="Reload">🔄</button>
          <input
            className="input-field"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") navigateTo(urlInput); }}
            placeholder="https://steamcommunity.com/..."
            style={{ flex: 1, height: 36, fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
          <button
            className="btn-primary"
            onClick={handleDownload}
            disabled={busy || !canDownload}
            title={canDownload ? "" : (t("workshop_browser.not_a_mod_page") || "Open a mod detail page first")}
            style={{ height: 36, padding: "0 18px", whiteSpace: "nowrap" }}
          >
            ⬇ {t("workshop_browser.download_this") || "Download this mod"}
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          top: toolbarHeight + 8,
          bottom: 24,
          minHeight: 240,
          background: "rgba(0,0,0,0.4)",
          overflow: "hidden",
          borderRadius: 10,
          border: "1px solid var(--color-border)",
        }}
      >
        {!ready && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-dim)", fontSize: 13 }}>
            {t("common.loading") || "Loading..."}
          </div>
        )}
      </div>
    </div>
  );
}
