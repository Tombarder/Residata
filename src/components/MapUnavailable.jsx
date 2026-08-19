import { useState } from "react";
import { mapDiagnostics } from "../lib/webgl";

/**
 * MapUnavailable — what stands in the map's place when the map cannot run.
 *
 * A blank rectangle is the worst possible failure: it looks identical whether the
 * browser can't do WebGL, the basemap is down, or we shipped a bug — and the reader
 * has no idea which, so they refresh forever. (That is exactly what happened on
 * 2026-08-19: one machine blank, one machine fine, and no way to tell why from the
 * screen.) This says what is wrong, what to do about it, and offers the technical
 * detail as one copyable block for support.
 */
export default function MapUnavailable({ reason, detail, sk = true, onRetry }) {
  const [copied, setCopied] = useState(false);
  const t = (a, b) => (sk ? a : b);

  // `reason` comes from lib/webgl.js (the browser can't start a map) or from
  // maplibre's own error event (the map started but the map DATA won't load).
  const noWebGL = reason === "no-webgl" || reason === "context-threw" || reason === "canvas-failed";

  const title = noWebGL
    ? t("Mapa sa v tomto prehliadači nedá zobraziť", "This browser can't display the map")
    : t("Mapu sa nepodarilo načítať", "The map didn't load");

  const body = noWebGL
    ? t("Mapa potrebuje hardvérové zrýchlenie (WebGL). V tomto prehliadači je vypnuté alebo ho blokuje grafický ovládač. Zvyšok platformy funguje normálne — týka sa to len mapy.",
        "The map needs hardware acceleration (WebGL). It is switched off in this browser, or the graphics driver is blocking it. The rest of the platform works normally — this affects the map only.")
    : t("Podkladová mapa sa nenačítala. Býva to dočasný výpadok siete alebo poskytovateľa mapy.",
        "The base map didn't load. This is usually a temporary network or map-provider outage.");

  const steps = noWebGL
    ? [
        t("Chrome / Edge: Nastavenia → Systém → zapni „Použiť hardvérové zrýchlenie, ak je k dispozícii“, potom reštartuj prehliadač.",
          "Chrome / Edge: Settings → System → turn on “Use hardware acceleration when available”, then restart the browser."),
        t("Ak je už zapnuté, otvor chrome://gpu — ukáže, či ovládač WebGL blokuje.",
          "If it is already on, open chrome://gpu — it shows whether the driver is blocking WebGL."),
        t("Firefox: about:config → gfx.webrender.all = true, alebo skús iný prehliadač.",
          "Firefox: about:config → gfx.webrender.all = true, or try another browser."),
      ]
    : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mapDiagnostics({ reason: reason || "unknown", detail: detail || "—" }));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked — the text is on screen anyway */ }
  };

  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
      padding: "1.5rem", background: "var(--surface-2)", zIndex: 1,
    }}>
      <div className="rd-card rd-card--pad" style={{ maxWidth: 520, textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem" }}>
          <span aria-hidden="true" style={{ fontSize: "1.1rem" }}>🗺</span>
          <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--text)" }}>{title}</h3>
        </div>
        <p style={{ margin: "0 0 0.8rem", fontSize: "0.84rem", lineHeight: 1.6, color: "var(--text-dim)" }}>{body}</p>

        {steps.length > 0 && (
          <ol style={{ margin: "0 0 0.9rem", paddingLeft: "1.1rem", fontSize: "0.8rem", lineHeight: 1.6, color: "var(--text-2)" }}>
            {steps.map((s, i) => <li key={i} style={{ marginBottom: "0.3rem" }}>{s}</li>)}
          </ol>
        )}

        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {onRetry && (
            <button className="rd-btn rd-btn--sm" onClick={onRetry}>
              {t("Skúsiť znova", "Try again")}
            </button>
          )}
          <button className="rd-btn rd-btn--sm" onClick={copy}>
            {copied ? t("Skopírované ✓", "Copied ✓") : t("Skopírovať detaily", "Copy details")}
          </button>
        </div>

        <pre style={{
          margin: "0.8rem 0 0", padding: "0.6rem 0.7rem", background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: "0.66rem", lineHeight: 1.5,
          color: "var(--text-faint)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflow: "auto",
        }}>{mapDiagnostics({ reason: reason || "unknown", detail: detail || "—" })}</pre>
      </div>
    </div>
  );
}
