/* PARKING AND STORAGE — what a project charges, every kind kept apart.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Boss 2026-09-03: *"i want separate fields for garage and for outdoor parking —
 * some projects have both, some none, some just one and prices differ even 50%
 * between the two types in the same project. and also in displaying wanna be
 * able to see it all separately next to each other."*
 *
 * He is right about the 50 %, and on the live data it is worse than that:
 *
 *     Evergreen              garage 16 122 €  ·  outdoor  7 854 €   (+105 %)
 *     Nová Nitra             garage 25 000 €  ·  outdoor 16 000 €   ( +56 %)
 *     Rezidencia Liptovská   garage 25 630 €  ·  outdoor 16 915 €   ( +52 %)
 *
 * A single merged "parking from X" would be wrong for one of the two every time,
 * so this component never merges. One column per kind, side by side, blank where
 * the project does not sell that kind.
 *
 * ── A PRICE IS NEVER SHOWN WITHOUT WHAT IT ASSUMES ────────────────────────
 * The same rule as priceBasis.jsx, for the same reason. Under each number:
 *   · the terms — POVINNÉ (you must buy it) · v cene bytu · voliteľné · na
 *     vyžiadanie. "Povinné" is the one that changes what the buyer pays.
 *   · the VAT basis, when the developer stated it.
 * And under the table, the developer's own sentence, verbatim, so the reader can
 * check us. A row nobody has confirmed against the live page says so.
 *
 * ── THREE EMPTY STATES, AND THEY ARE NOT THE SAME THING ───────────────────
 *   nobody has reviewed this project      → we say exactly that
 *   reviewed, developer publishes nothing → we say that instead
 *   this project sells no bay of THAT kind → the column is simply blank
 * Collapsing them would tell the reader something the developer never said.
 *
 * ── WHY THE PRICE IS NOT IN cena_s_dph ────────────────────────────────────
 * A bay is a separate product. Folding its price into the flat price or the €/m²
 * would corrupt every comparison on the platform, so it never happens: the number
 * lives here, and `projectSpecifics` puts a mark on the project when buying one
 * is compulsory.
 */
import { useEffect, useState } from "react";
import { supabaseData } from "./supabase";
import { moneyFromEur, moneySymbol } from "./money";
import { useCurrency } from "./useCurrency";
import { PARKING_KINDS, VAT, kindLabel, termsLabel, termsTone } from "./parkingTerms.js";
export { PARKING_KINDS, kindLabel, termsLabel, termsTone };

const sk = (lang) => lang === "sk";

/* ── the data ──────────────────────────────────────────────────────────────
 * One read of public.project_parking per project, cached at module level for the
 * session — same shape as usePriceSchedules / useProjectSpecificsData, so all
 * three are obvious to whoever reads them next.
 */
const _cache = new Map();

export function useProjectParking(projectId) {
  const [rows, setRows] = useState(() => _cache.get(projectId) || null);
  const [loading, setLoading] = useState(() => !_cache.has(projectId));
  useEffect(() => {
    if (!projectId) { setRows(null); setLoading(false); return; }
    if (_cache.has(projectId)) { setRows(_cache.get(projectId)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    supabaseData
      .from("project_parking")
      .select("kind,availability,vat_basis,price_min,price_max,currency,price_min_eur,"
              + "price_max_eur,capacity,evidence,note,confirmed,origin")
      .eq("project_id", projectId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error("[useProjectParking]", error); setRows([]); setLoading(false); return; }
        const out = data || [];
        _cache.set(projectId, out);
        setRows(out);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);
  return { rows, loading };
}

/** "od 25 000 €" / "25 000 – 30 000 €" in the viewer's chosen currency. */
function priceText(row) {
  if (row.price_min_eur == null) return null;
  const from = Math.round(moneyFromEur(Number(row.price_min_eur))).toLocaleString("sk-SK");
  const to = row.price_max_eur != null
    ? Math.round(moneyFromEur(Number(row.price_max_eur))).toLocaleString("sk-SK")
    : null;
  return to ? `${from} – ${to} ${moneySymbol()}` : `${from} ${moneySymbol()}`;
}

/** The developer's own figure, shown only when it is NOT what we just printed —
 *  i.e. a Czech project quoting Kč while the reader is looking at euro. */
function nativeText(row) {
  if (row.price_min == null || !row.currency) return null;
  const shown = Math.round(moneyFromEur(Number(row.price_min_eur ?? 0)));
  const native = Math.round(Number(row.price_min));
  if (shown === native) return null;
  return `${native.toLocaleString("sk-SK")} ${row.currency}`;
}

/**
 * ParkingCard — every kind this project sells, next to each other.
 *
 * @param projectId    which project
 * @param reviewed     projects.parking_reviewed — has anybody looked at all
 * @param lang         "sk" | "en"
 */
export default function ParkingCard({ projectId, reviewed, lang = "en" }) {
  useCurrency();                       // re-render when the currency switcher moves
  const { rows, loading } = useProjectParking(projectId);
  if (loading || !rows) return null;

  const byKind = new Map(rows.map((r) => [r.kind, r]));
  const present = PARKING_KINDS.filter((k) => byKind.has(k.key));

  // Nothing at all — say WHICH kind of nothing it is.
  if (present.length === 0) {
    return (
      <div className="rd-card rd-card--pad" style={{ marginBottom: "1rem" }}>
        <div className="rd-label">{sk(lang) ? "Parkovanie a kobky" : "Parking & storage"}</div>
        <div style={{ fontSize: "0.85rem", color: "var(--text-2)", marginTop: "0.4rem" }}>
          {reviewed
            ? (sk(lang)
                ? "Developer pri tomto projekte nezverejňuje cenu parkovania."
                : "The developer publishes no parking price for this project.")
            : (sk(lang)
                ? "Parkovanie sme pri tomto projekte ešte neprešli — nevieme, či ho developer zverejňuje."
                : "We haven't reviewed parking for this project yet — we don't know whether the developer publishes it.")}
        </div>
      </div>
    );
  }

  const quotes = [...new Set(present
    .map((k) => byKind.get(k.key))
    .map((r) => r.evidence || r.note)
    .filter(Boolean))];
  const anyUnconfirmed = present.some((k) => !byKind.get(k.key).confirmed);

  return (
    <div className="rd-card rd-card--pad" style={{ marginBottom: "1rem" }}>
      <div className="rd-label" style={{ marginBottom: "0.6rem" }}>
        {sk(lang) ? "Parkovanie a kobky" : "Parking & storage"}
      </div>

      {/* One column per kind — never merged, because a garage and an outdoor bay
          differ by 40–105 % in the same project. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))`,
        gap: "0.75rem",
      }}>
        {present.map(({ key }) => {
          const r = byKind.get(key);
          const price = priceText(r);
          const native = nativeText(r);
          const terms = termsLabel(r.availability, lang);
          const vat = VAT[r.vat_basis];
          const tone = termsTone(r.availability);
          return (
            <div key={key} style={{
              border: "1px solid var(--border)", borderRadius: 8,
              padding: "0.6rem 0.7rem", background: "var(--bg-2)",
            }}>
              <div style={{ fontSize: "0.7rem", color: "var(--text-2)", marginBottom: 4 }}>
                {kindLabel(key, lang)}
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)" }}>
                {price
                  ? (r.availability === "included"
                      // The buyer does not pay this on top — it is what the
                      // developer says the included bay is worth. Printing it like
                      // any other price would read as a surcharge.
                      ? <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                          {sk(lang) ? "hodnota " : "value "}{price}
                        </span>
                      : r.price_max_eur == null
                        ? <>{sk(lang) ? "od " : "from "}{price}</>
                        : price)
                  : <span style={{ color: "var(--text-2)", fontWeight: 400, fontSize: "0.85rem" }}>
                      {sk(lang) ? "cena nezverejnená" : "price not published"}
                    </span>}
              </div>
              {native && (
                <div style={{ fontSize: "0.7rem", color: "var(--text-2)", marginTop: 2 }}>
                  {sk(lang) ? "developer uvádza " : "developer quotes "}{native}
                </div>
              )}
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {terms && (
                  <span className={tone ? `rd-badge rd-badge--${tone}` : "rd-chip"}
                        style={{ fontSize: "0.65rem" }}>
                    {terms}
                  </span>
                )}
                {vat && (
                  <span className="rd-chip" style={{ fontSize: "0.65rem" }}>
                    {sk(lang) ? vat.sk : vat.en}
                  </span>
                )}
                {r.capacity > 0 && (
                  <span className="rd-chip" style={{ fontSize: "0.65rem" }}>
                    {r.capacity} {sk(lang) ? "miest" : "bays"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* The developer's own words, so the reader can check us. */}
      {quotes.length > 0 && (
        <div className="rd-note" style={{ marginTop: "0.7rem", fontSize: "0.75rem" }}>
          {quotes.map((q, i) => <div key={i}>„{q}"</div>)}
        </div>
      )}

      {anyUnconfirmed && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--text-2)" }}>
          {sk(lang)
            ? "Časť údajov sme ešte neoverili proti aktuálnej stránke developera."
            : "Some of this has not yet been re-checked against the developer's live page."}
        </div>
      )}
    </div>
  );
}
