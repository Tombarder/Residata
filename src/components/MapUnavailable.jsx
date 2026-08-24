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
 *
 * Two shapes, and which one you get is not a style choice:
 *   • THERE IS NO MAP TO SEE (no WebGL, or the basemap never arrived) — take the
 *     whole area and explain. Nothing is being hidden, because nothing is there.
 *   • THE MAP MAY WELL BE THERE (we think the machine isn't painting it, or the
 *     graphics context died) — say so in a card the user can push aside, and NEVER
 *     paint over the map. That verdict is a deduction about someone else's
 *     hardware, and a wrong deduction must not cost them a working map.
 */
export default function MapUnavailable({ reason, detail, sk = true, onRetry }) {
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const t = (a, b) => (sk ? a : b);

  // `reason` comes from lib/webgl.js (the browser can't start a map), from
  // maplibre's own error event (the map started but the map DATA won't load), or
  // from lib/mapHealth.js (the map is running but this machine isn't drawing it).
  const noWebGL = reason === "no-webgl" || reason === "context-threw" || reason === "canvas-failed";
  // "gpu" = the map loaded and maplibre is running (the readouts above it update as
  // you pan) but the graphics card draws nothing or garbage. Different problem from
  // "no WebGL at all", and it needs the OPPOSITE advice: turn hardware acceleration
  // OFF, so the browser falls back to software rendering and draws correctly.
  const gpuDead = reason === "gpu";
  // "gpu-lost" = it WAS drawing and the browser then lost the graphics context —
  // the canvas goes black mid-session. Same advice, different story to tell.
  const gpuLost = reason === "gpu-lost";
  // A guess about the user's hardware never gets to hide the map.
  const soft = gpuDead || gpuLost;

  if (soft && dismissed) return null;

  const title = noWebGL
    ? t("Mapa sa v tomto prehliadači nedá zobraziť", "This browser can't display the map")
    : gpuLost
      ? t("Mapa zhasla — grafika prestala kresliť", "The map went black — your graphics stopped drawing it")
      : gpuDead
        ? t("Mapa sa načítala, ale grafika ju nevykreslila", "The map loaded, but your graphics didn't draw it")
        : t("Mapu sa nepodarilo načítať", "The map didn't load");

  const body = noWebGL
    ? t("Mapa potrebuje hardvérové zrýchlenie (WebGL). V tomto prehliadači je vypnuté alebo ho blokuje grafický ovládač. Zvyšok platformy funguje normálne — týka sa to len mapy.",
        "The map needs hardware acceleration (WebGL). It is switched off in this browser, or the graphics driver is blocking it. The rest of the platform works normally — this affects the map only.")
    : gpuLost
      ? t("Mapa chvíľu kreslila a potom prehliadač stratil spojenie s grafickou kartou — plátno stmavlo. Dáta ani pripojenie s tým nemajú nič spoločné, je to grafika tohto počítača.",
          "The map was drawing and then the browser lost its connection to the graphics card, so the canvas went dark. Nothing to do with the data or the connection — it is this computer's graphics.")
      : gpuDead
        ? t("Dáta mapy dorazili a mapa beží — čísla nad ňou sa menia, keď ňou pohneš. Nevykresľuje ju grafická karta tohto počítača (starý alebo chybný ovládač). Nie je to chyba dát ani pripojenia.",
            "The map data arrived and the map is running — the figures above it change as you move it. What isn't working is this computer's graphics drawing it (an old or faulty driver). It is not a data or connection problem.")
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
    : soft
      ? [
          t("Aktualizuj ovládač grafickej karty (Windows Update alebo stránka výrobcu) — toto je trvalé riešenie.",
            "Update the graphics driver (Windows Update, or the vendor's site) — this is the permanent fix."),
          t("Kým to spravíš, pomôže opak zvyčajnej rady: Chrome / Edge → Nastavenia → Systém → VYPNI „Použiť hardvérové zrýchlenie, ak je k dispozícii“ a reštartuj prehliadač. Mapu potom kreslí procesor — pomalšie, ale správne.",
            "Until then, the opposite of the usual advice helps: Chrome / Edge → Settings → System → turn OFF “Use hardware acceleration when available”, then restart the browser. The map is then drawn on the CPU — slower, but correct."),
          t("chrome://gpu ukáže, ktorý ovládač sa používa a či je na zozname problémových.",
            "chrome://gpu shows which driver is in use and whether it is on the blocklist."),
        ]
      : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mapDiagnostics({ reason: reason || "unknown", detail: detail || "—" }));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked — the text is on screen anyway */ }
  };

  const frame = soft
    ? { inset: "auto 1rem 1rem 1rem", display: "flex", justifyContent: "center", pointerEvents: "none" }
    : { inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", background: "var(--surface-2)" };

  return (
    <div style={{ position: "absolute", zIndex: 3, ...frame }}>
      <div
        className="rd-card rd-card--pad"
        style={{
          maxWidth: 520, textAlign: "left", pointerEvents: "auto",
          ...(soft ? { boxShadow: "0 12px 34px rgba(0,0,0,0.45)" } : null),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem" }}>
          <span aria-hidden="true" style={{ fontSize: "1.1rem" }}>🗺</span>
          <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--text)" }}>{title}</h3>
          {soft && (
            <button
              onClick={() => setDismissed(true)}
              aria-label={t("Zavrieť", "Dismiss")}
              style={{
                marginLeft: "auto", background: "none", border: "none", color: "var(--text-dim)",
                fontSize: "0.9rem", lineHeight: 1, cursor: "pointer", padding: "2px 4px",
              }}
            >
              ✕
            </button>
          )}
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
