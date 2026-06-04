// PERF Step 5 (LivePages split): extracted from pages/LivePages.jsx so the
// marketing landing can render this tiny badge WITHOUT pulling in the whole
// ~254 KB LivePages module. All deps come from lib/ (zero LivePages coupling):
//   liveT/ll → lib/liveLang · useCapabilities → lib/useCapabilities ·
//   useEarlyAccessStats → lib/useData. Behaviour is byte-identical to the
//   original; only its home changed. (The copy still in LivePages.jsx is now
//   dead — safe to remove in a later cleanup.)
import { liveT, ll } from "../lib/liveLang";
import { useCapabilities } from "../lib/useCapabilities";
import { useEarlyAccessStats } from "../lib/useData";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";

export default function EarlyAccessBadge({ lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { can } = useCapabilities();
  const { remaining_slots } = useEarlyAccessStats();
  // Hide for paid/admin — they don't need the "early access" marketing.
  if (!can("see_early_access_badge")) return null;
  if (remaining_slots <= 0) return null;
  const tmpl = remaining_slots === 1 ? t.ea_badge_one : t.ea_badge;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "0.5rem",
      padding: "0.4rem 0.9rem", background: "rgba(0,229,160,0.1)",
      border: "1px solid rgba(0,229,160,0.3)", borderRadius: 999,
      fontFamily: mono, fontSize: "0.7rem", color: green, fontWeight: 600,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: green }}></span>
      {ll(tmpl, { n: remaining_slots })}
    </div>
  );
}
