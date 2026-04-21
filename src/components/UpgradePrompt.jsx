import { useCapabilities } from "../lib/useCapabilities";

/**
 * Zjednotený upgrade-message komponent. Auto-vyberie tón podľa tier-u.
 *
 * - anon → "Sign up for free"
 * - pending → "Waiting for approval"
 * - free → "Upgrade to paid"
 * - paid/admin → null (upgrade im netreba ukazovať)
 *
 * Props:
 *   feature: string — ľudský popis čo user odomkne (napr. "analytics", "CSV export")
 *   variant: "block" (default) | "inline" | "card"
 *   onLogin: () => void — pre anon tier, otvorí login modal
 *   onGoPricing: () => void — pre free tier, prechod na Pricing
 */
export default function UpgradePrompt({ feature, variant = "block", onLogin, onGoPricing, lang = "en" }) {
  const { can, tier } = useCapabilities();
  // Paid/admin nepotrebujú upgrade CTA — capability check pre budúcu udržateľnosť
  if (can("has_paid_access")) return null;

  const t = translations[lang] || translations.en;

  let config;
  if (tier === "anon") {
    config = {
      icon: "🔒",
      title: t.anon_title,
      body: feature ? t.anon_body(feature) : t.anon_body_generic,
      cta: t.anon_cta,
      onClick: onLogin,
    };
  } else if (tier === "pending") {
    config = {
      icon: "⏳",
      title: t.pending_title,
      body: t.pending_body,
      cta: null, // nothing to click, just wait
      onClick: null,
    };
  } else {
    // free
    config = {
      icon: "⭐",
      title: t.free_title,
      body: feature ? t.free_body(feature) : t.free_body_generic,
      cta: t.free_cta,
      onClick: onGoPricing,
    };
  }

  if (variant === "inline") {
    return (
      <span style={inlineStyle}>
        {config.icon} {config.title}
        {config.onClick && config.cta && (
          <> — <button onClick={config.onClick} style={linkBtn}>{config.cta}</button></>
        )}
      </span>
    );
  }

  // block / card
  const cardStyle = variant === "card" ? {
    padding: "2rem",
    textAlign: "center",
    border: "1px solid #222228",
    borderRadius: 12,
    background: "#16161a",
    maxWidth: 500,
    margin: "0 auto",
  } : {
    padding: "2rem 1rem",
    textAlign: "center",
    color: "#8a8a96",
  };

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>{config.icon}</div>
      <h3 style={{ fontSize: "1.15rem", fontWeight: 600, color: "#e8e8ed", marginBottom: "0.5rem" }}>{config.title}</h3>
      <p style={{ fontSize: "0.88rem", color: "#8a8a96", lineHeight: 1.55, marginBottom: "1.25rem" }}>{config.body}</p>
      {config.cta && config.onClick && (
        <button onClick={config.onClick} className="btn-p">{config.cta}</button>
      )}
    </div>
  );
}

const inlineStyle = { fontSize: "0.85rem", color: "#8a8a96" };
const linkBtn = { background: "none", border: "none", color: "#00e5a0", cursor: "pointer", padding: 0, fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline" };

const translations = {
  en: {
    anon_title: "Sign in to unlock this",
    anon_body: (f) => `Create a free account to access ${f} and more. Takes 30 seconds.`,
    anon_body_generic: "Create a free account to unlock full data. Takes 30 seconds.",
    anon_cta: "Get Access",
    pending_title: "Waiting for approval",
    pending_body: "Your account is under review. You'll get an email once approved (usually within a few hours).",
    free_title: "Paid feature",
    free_body: (f) => `${f} is part of the paid tier. Upgrade to unlock this and more.`,
    free_body_generic: "This is a paid feature. Upgrade to unlock it.",
    free_cta: "See pricing",
  },
  sk: {
    anon_title: "Prihlás sa aby si odomkol túto funkciu",
    anon_body: (f) => `Vytvor si free účet pre prístup k ${f} a ďalším. Trvá 30 sekúnd.`,
    anon_body_generic: "Vytvor si free účet pre prístup k plným dátam. Trvá 30 sekúnd.",
    anon_cta: "Získať prístup",
    pending_title: "Čakáš na schválenie",
    pending_body: "Tvoj účet je v procese schválenia. Dostaneš email po schválení (zvyčajne do pár hodín).",
    free_title: "Platená funkcia",
    free_body: (f) => `${f} je súčasťou paid tieru. Upgradni pre odomknutie.`,
    free_body_generic: "Toto je platená funkcia. Upgradni pre odomknutie.",
    free_cta: "Zobraziť cenník",
  },
};
