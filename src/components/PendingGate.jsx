import { useEffect, useState } from "react";
import { liveT } from "../lib/liveLang";
import { useAuth } from "../lib/useAuth";

/**
 * Zobrazené namiesto Live/ProjectDetail/Analytics ak user je prihlásený
 * ale tier je stále 'pending' (čaká na admin approval).
 *
 * AUTO-REFRESH: každé 4 sekundy ticho pingneme Supabase cez reloadProfile.
 * Keď admin klikne "Approve" → DB sa zmení → náš nasledujúci poll to zachytí
 * → App.jsx re-renderuje → PendingGate unmount-uje, user vidí dashboard.
 * Bez tohto by user sedel navždy kým sám manuálne refreshne.
 */
export default function PendingGate({ setCurrent, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { reloadProfile } = useAuth();
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    // Neagresívne: 4-sekundový interval. Query je tiny (single row by id),
    // DB voľná. Keď user zavrie tab, interval sa vyčistí.
    const iv = setInterval(() => {
      reloadProfile();
      setPollCount(c => c + 1);
    }, 4000);
    return () => clearInterval(iv);
  }, [reloadProfile]);

  return (
    <main style={{ padding: "6rem 2rem 4rem", maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⏳</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.75rem", letterSpacing: "-0.02em" }}>
        {t.pending_title}
      </h1>
      <p style={{ color: "#8a8a96", fontSize: "0.95rem", lineHeight: 1.7, marginBottom: "1rem" }}>
        {t.pending_body}
      </p>
      <p style={{ color: "#8a8a96", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
        {t.pending_meanwhile}
      </p>

      {/* Live status indicator — reassures user that the page IS checking */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: "0.5rem",
        padding: "0.35rem 0.85rem",
        background: "rgba(0,229,160,0.08)",
        border: "1px solid rgba(0,229,160,0.25)",
        borderRadius: 999,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.7rem", color: "#00e5a0", fontWeight: 600,
        letterSpacing: "0.05em", textTransform: "uppercase",
        marginBottom: "1.5rem",
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: "#00e5a0",
          animation: "pg-pulse 1.4s ease-in-out infinite",
        }} />
        {lang === "sk" ? "Sledujeme schválenie · live" : "Watching for approval · live"}
        {pollCount > 0 && <span style={{ color: "#8a8a96", fontWeight: 400 }}>· checked {pollCount}×</span>}
      </div>

      <div>
        <button className="btn-p" onClick={() => setCurrent && setCurrent("Home")}>
          {t.pending_explore}
        </button>
      </div>

      <style>{`
        @keyframes pg-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
      `}</style>
    </main>
  );
}
