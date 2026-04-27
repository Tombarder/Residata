/**
 * AiBetaBanner — slim notice strip telling users that the AI features
 * (in-app chat, Reports narratives) are in beta + asking for feedback.
 *
 * Behaviour:
 *   · Mounted at the top of the platform shell main area (PlatformShell),
 *     ABOVE the page content, BELOW the TopBar.
 *   · Dismissible. Dismissal is sticky for 7 days via localStorage;
 *     after the cooldown the banner reappears once so we keep gentle
 *     pressure on "this is beta, your feedback matters".
 *   · No animation on mount — banners that animate in feel pushy. It
 *     just appears and quietly waits to be dismissed.
 *   · Slovak + English; styled with the same palette + monofont as
 *     the rest of the platform.
 *
 * Why not a global toast: toasts are for transient state (saved!,
 * sync done, error). This is a persistent contextual disclosure that
 * the user should be able to read at their own pace.
 */
import { useEffect, useState } from "react";

const KEY = "residata_ai_beta_banner_dismissed_until";
const HIDE_DAYS = 7;

const green   = "#00e5a0";
const orange  = "#f5a623";
const dim     = "#8a8a96";
const text    = "#e8e8ed";
const border  = "#222228";
const mono    = "'JetBrains Mono', ui-monospace, Menlo, monospace";

function isDismissedNow() {
  try {
    const until = Number(localStorage.getItem(KEY) || 0);
    return Date.now() < until;
  } catch {
    return false;
  }
}

export default function AiBetaBanner({ lang = "sk" }) {
  // Default `true` so the banner doesn't briefly flash on mount
  // before the localStorage check resolves. The effect immediately
  // flips it to false if there's no active dismissal.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { setDismissed(isDismissedNow()); }, []);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      const until = Date.now() + HIDE_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(KEY, String(until));
    } catch (_) {}
    setDismissed(true);
  };

  const T = lang === "sk" ? {
    icon: "🧪",
    label: "BETA",
    msg: "AI funkcie (chat, narratívy v reportoch) sú v testovacom režime. Konverzácie ukladáme pre interný QA — bez tretích strán.",
    cta: "Spätná väzba",
    dismiss: "Skryť",
  } : {
    icon: "🧪",
    label: "BETA",
    msg: "AI features (chat, report narratives) are in testing mode. Conversations are stored for internal QA — no third parties.",
    cta: "Send feedback",
    dismiss: "Hide",
  };

  return (
    <div
      role="status"
      style={{
        background: "linear-gradient(90deg, rgba(245,166,35,0.10) 0%, rgba(245,166,35,0.04) 100%)",
        borderBottom: `1px solid ${orange}33`,
        padding: "0.55rem 1.25rem",
        display: "flex", alignItems: "center", flexWrap: "wrap",
        gap: "0.65rem", fontFamily: mono, fontSize: "0.78rem", color: text,
      }}
    >
      <span aria-hidden style={{ fontSize: "1rem", lineHeight: 1 }}>{T.icon}</span>
      <span style={{
        background: orange, color: "#0a0a0b",
        padding: "0.1rem 0.45rem", borderRadius: 3,
        fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em",
      }}>{T.label}</span>
      <span style={{ flex: 1, minWidth: 0, color: text, lineHeight: 1.45 }}>
        {T.msg}
      </span>
      <a
        href="mailto:tomas@residata.sk?subject=Residata%20AI%20feedback"
        style={{
          color: green, textDecoration: "none",
          padding: "0.25rem 0.55rem", border: `1px solid ${green}55`,
          borderRadius: 4, fontSize: "0.72rem", whiteSpace: "nowrap",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(0,229,160,0.10)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        {T.cta} →
      </a>
      <button
        onClick={dismiss}
        title={T.dismiss}
        aria-label={T.dismiss}
        style={{
          background: "transparent", border: `1px solid ${border}`,
          color: dim, cursor: "pointer", padding: "0.2rem 0.5rem",
          borderRadius: 4, fontSize: "0.72rem", fontFamily: "inherit",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = text; e.currentTarget.style.borderColor = dim; }}
        onMouseLeave={e => { e.currentTarget.style.color = dim;  e.currentTarget.style.borderColor = border; }}
      >
        ✕
      </button>
    </div>
  );
}
