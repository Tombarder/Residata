import { liveT } from "../lib/liveLang";

/**
 * Zobrazené namiesto Live/ProjectDetail/Analytics ak user je prihlásený
 * ale tier je stále 'pending' (čaká na admin approval).
 */
export default function PendingGate({ setCurrent, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
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
      <button className="btn-p" onClick={() => setCurrent && setCurrent("Home")}>
        {t.pending_explore}
      </button>
    </main>
  );
}
