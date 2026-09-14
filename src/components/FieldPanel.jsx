/* FieldPanel — the right-hand panel shared by the analytics pages.
 *
 * It exists as one component because the two pages must BEHAVE identically: Boss built a
 * filter on the Unit database, went to Sales, and found a different idea of what a filter
 * is. A copy would have drifted the first time either page changed.
 *
 * The rule it encodes, learned the hard way on 2026-09-14: ONE LIST AT A TIME, ONE SCROLL,
 * FULL HEIGHT. The first version stacked the filter cards and the field palette in two
 * scroll boxes inside one narrow column, so with four filters the cards were clipped
 * mid-card and ran into the palette below. Adding a filter is a STEP that borrows the whole
 * panel and gives it straight back.
 *
 * The panel knows nothing about where values come from: `useValues(key, enabled)` is passed
 * in, so the Unit database can read its distincts from the pivot grain and Sales from its
 * own live facets, while the control they draw is the same one.
 */
import Picker from "./Picker";
import { field as sharedField } from "../lib/controls";
import DateField from "./DateField";
import { accent as green, accentInk, orange, dim, border, bg, surfacePanel as panelHi, text } from "../lib/theme";
import { EMPTY_SENTINEL, MODE_LABEL, isFilterActive } from "../lib/filterModel";

const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const panel = "var(--surface-2)";

function FilterCard({ f, field, caps, unit, lang, sel, useValues, onPatch, onRemove, unavailableNote }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const wantsValues = f.mode === "in" || f.mode === "not_in";
  /* EVERY hook runs before the early return below. The dead-field card used to return
     first, so a card whose field disappeared (a sale-only filter + the Rezervácie tab, or
     a currency switch) rendered one hook fewer than the render before it and React threw.
     A disabled fetch costs nothing; an unstable hook order costs the page. */
  const distinct = useValues(f.key, caps.valued && wantsValues && !!f.key);
  /* A saved filter can name a field the registry no longer has — renamed, disabled, gone.
     An operator picker with no operators is a dead card that can neither be set nor
     understood, so it says what happened and offers the only useful action. */
  if (!caps.modes.length) {

  return (
      <div style={{ background: bg, border: `1px solid ${orange}`, borderRadius: 6, padding: "0.45rem", marginBottom: "0.4rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: "0.74rem", color: text, overflow: "hidden", textOverflow: "ellipsis" }}>
            {field ? (lang === "sk" ? field.label_sk : field.label_en) : f.key}
          </span>
          <button onClick={onRemove} aria-label={lang === "sk" ? "Odstrániť filter" : "Remove filter"}
            style={{ border: "none", background: "transparent", color: dim, cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
        </div>
        <div style={{ fontSize: "0.66rem", color: dim, marginTop: "0.2rem", lineHeight: 1.4 }}>
          {unavailableNote || (lang === "sk" ? "Toto pole sa už nedá filtrovať — odstráň filter." : "This field can no longer be filtered — remove the filter.")}
        </div>
      </div>
    );
  }

  const isDate = field?.type === "date";
  const L = MODE_LABEL[lang === "sk" ? "sk" : "en"];
  const active = isFilterActive(f);
  const label = field ? (lang === "sk" ? field.label_sk : field.label_en) : f.key;

  const chip = {
    display: "inline-flex", alignItems: "center", gap: "0.25rem", cursor: "pointer",
    background: "color-mix(in srgb, var(--accent) 16%, var(--surface-2))",
    color: "var(--text)", border: `1px solid ${green}`, borderRadius: 4,
    padding: "0.08rem 0.34rem", fontSize: "0.7rem", fontWeight: 500, whiteSpace: "nowrap",
  };
  const labelOfValue = (v) => {
    if (v === EMPTY_SENTINEL) return t("(prázdne)", "(empty)");
    const hit = (distinct.values || []).find((o) => o && typeof o === "object" && o.value === v);
    return hit ? hit.label : v;
  };
  const vLabel = labelOfValue;

  return (
    <div style={{
      background: bg, border: `1px solid ${active ? green : border}`, borderRadius: 6,
      padding: "0.4rem 0.45rem 0.45rem", marginBottom: "0.4rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.35rem" }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: "0.76rem", fontWeight: 600, color: text,
                       overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <button onClick={onRemove} title={t("Odstrániť filter", "Remove filter")} aria-label={t("Odstrániť filter", "Remove filter")}
          style={{ border: "none", background: "transparent", color: dim, cursor: "pointer", fontSize: "0.8rem", lineHeight: 1, padding: "0.1rem 0.2rem" }}>✕</button>
      </div>

      <Picker value={f.mode} onChange={(v) => onPatch({ mode: v })} ariaLabel={t("operátor", "operator")} width="100%"
        options={caps.modes.map((m) => ({ value: m, label: L[m] }))} />

      {wantsValues && caps.valued && (
        <div style={{ marginTop: "0.35rem" }}>
          <Picker value="" width="100%" searchable
            placeholder={distinct.loading ? t("načítavam…", "loading…") : t("+ hodnota", "+ value")}
            ariaLabel={t("hodnota", "value")}
            /* 🔴 "(empty)" is EXCLUSIVE under "is". "city is Nitra OR blank" is an OR, and the
               engine's spec is a conjunction — there is no way to say it. The first cut just
               dropped the "(empty)" on the way out, which answers a narrower question than
               the one on screen. Under "is not" it is an AND ("not Nitra AND not blank") and
               both halves are sent, so no exclusion is needed there. */
            onChange={(v) => {
              if (!v || (f.values || []).includes(v)) return;
              const exclusive = f.mode === "in";
              if (exclusive && v === EMPTY_SENTINEL) return onPatch({ values: [EMPTY_SENTINEL] });
              const kept = exclusive ? (f.values || []).filter((x) => x !== EMPTY_SENTINEL) : (f.values || []);
              onPatch({ values: [...kept, v] });
            }}
            options={[
              /* "(empty)" is offered as a value because that is how a person thinks about
                 it, and turned into a presence test on the way to the engine — but ONLY
                 where the engine HAS one. Sales filters are plain in-lists; offering the
                 sentinel there would send a value nothing can match and silently return an
                 empty page. The capability list decides, as it does for every other mode. */
              ...(caps.modes.includes("empty") && !(f.values || []).includes(EMPTY_SENTINEL)
                    ? [{ value: EMPTY_SENTINEL, label: t("(prázdne)", "(empty)") }] : []),
              /* A value source may hand back plain strings or {value,label} pairs. The label
                 exists because the stored value is not always the readable one: a sale
                 signal is "marked", and a numeric room count comes back as "2.0" — nobody
                 asks for a 2.0-room flat. The VALUE sent to the engine is never touched. */
              ...(distinct.values || []).map((v) => (v && typeof v === "object" ? v : { value: v, label: String(v) }))
                   .filter((o) => !(f.values || []).includes(o.value)),
            ]} />
          {(f.values || []).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.22rem", marginTop: "0.3rem" }}>
              {(f.values || []).map((v) => (
                <span key={v} style={chip} title={t("Odstrániť", "Remove")}
                  onClick={() => onPatch({ values: f.values.filter((x) => x !== v) })}>
                  {vLabel(v)}<span style={{ color: dim }}>✕</span>
                </span>
              ))}
              {(f.values || []).length > 1 && (
                <span onClick={() => onPatch({ values: [] })} style={{ ...chip, background: "transparent", borderColor: border, color: dim }}>
                  {t("vyčistiť", "clear")}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {wantsValues && f.mode === "in" && (f.values || []).includes(EMPTY_SENTINEL) && (
        <div style={{ marginTop: "0.3rem", fontSize: "0.66rem", color: dim, lineHeight: 1.4 }}>
          {t("„(prázdne)“ sa pýta len na chýbajúcu hodnotu, preto stojí samo. Ak chceš „toto alebo prázdne“, filter zmaž.",
             "“(empty)” asks only for the missing value, so it stands alone. For “this or empty”, remove the filter.")}
        </div>
      )}

      {f.mode === "between" && (
        <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.35rem" }}>
          {isDate ? (<>
            <DateField value={f.min} onChange={(e) => onPatch({ min: e.target.value })} width="100%" title={t("od", "from")} />
            <DateField value={f.max} onChange={(e) => onPatch({ max: e.target.value })} width="100%" title={t("do", "to")} />
          </>) : (<>
            {/* The unit is on the box. Without it a price band is two bare numbers and the
                reader cannot tell € from Kč from m² — and the money boxes follow the
                currency toggle, so the answer genuinely changes with it. */}
            <input type="text" inputMode="decimal" value={f.min} placeholder={unit ? `${t("od", "from")} ${unit}` : t("od", "from")}
              onChange={(e) => onPatch({ min: e.target.value })} style={{ ...sel, width: "50%", minWidth: 0, boxSizing: "border-box" }} />
            <input type="text" inputMode="decimal" value={f.max} placeholder={unit ? `${t("do", "to")} ${unit}` : t("do", "to")}
              onChange={(e) => onPatch({ max: e.target.value })} style={{ ...sel, width: "50%", minWidth: 0, boxSizing: "border-box" }} />
          </>)}
        </div>
      )}

      {(f.mode === "empty" || f.mode === "not_empty") && (
        <div style={{ marginTop: "0.3rem", fontSize: "0.68rem", color: dim, fontStyle: "italic" }}>
          {f.mode === "empty" ? t("len byty bez tejto hodnoty", "only units missing this value")
                              : t("len byty, ktoré túto hodnotu majú", "only units that have this value")}
        </div>
      )}
    </div>
  );
}

/**
 * @param fields      [{key, label_sk, label_en, type}] — everything the page can show/filter
 * @param catOf       (key) => category key, for grouping the list
 * @param catOrder    ordered category keys
 * @param catLabel    {sk:{cat:label}, en:{…}}
 * @param capsOf      (key) => {modes[], valued, ranged, isDate}
 * @param unitOf      (key) => "€" | "m²" | ""
 * @param useValues   hook (key, enabled) => {values[], loading}
 * @param columns     null to hide the columns tab entirely
 */
  /* THE PANEL — rebuilt 2026-09-14 after Boss used the first one.
          It had TWO scrolling lists stacked inside one narrow column: the filter cards
          in a 42vh box, and under them the whole field palette in another. With four
          filters the cards were clipped mid-card and ran straight into the palette, so
          the thing you were editing and the thing you were browsing shared a border and
          neither had room. "How the fuck should I use this" is the correct reaction.

          One list at a time now. The panel shows your filters, full height, one scroll.
          Adding one is a STEP — the field list takes the whole panel until you pick,
          then gives it back. Columns are the other tab and own the panel outright.
          Wider (340), sticky, so it stays put while the table scrolls. */
export default function FieldPanel({
  /* `sel` is the shared control box. It defaults to the kit's own rather than being
     required from the caller: Sales passed {} and its range inputs came out as raw browser
     boxes — white, 2px inset grey, 22px tall — inside a dark panel. A component that draws
     controls should not depend on every page remembering to hand it their styling. */
  lang = "sk", sel = sharedField, tab, setTab, adding, setAdding, search, setSearch,
  fields, catOf, catOrder, catLabel, capsOf, unitOf, useValues,
  filters, onAdd, onPatch, onRemove,
  cols = [], onToggleCol, onSetCols, defaultCols = [], showColumns = true,
  emptyHint, unavailableNote,
}) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const palette = (() => {
    const q = (search || "").trim().toLowerCase();
    const groups = {};
    for (const f of fields) {
      if (q && !(lang === "sk" ? f.label_sk : f.label_en).toLowerCase().includes(q)) continue;
      const g = catOf(f.key) || "other";
      (groups[g] = groups[g] || []).push(f);
    }
    return groups;
  })();
  const typeBadge = (ty) => (ty === "numeric" ? "#" : ty === "date" || ty === "month" ? "📅" : "T");
  const typeColor = (ty) => (ty === "numeric" ? orange : green);

  return (
        <aside className="rd-workbench__panel" style={{
          background: panel, border: `1px solid ${border}`, borderRadius: 10,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* tabs */}
          <div style={{ display: "flex", borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
            {[["filters", t("FILTRE", "FILTERS"), filters.length || null],
              ...(showColumns ? [["cols", t("STĹPCE", "COLUMNS"), cols.length]] : [])].map(([key, label, badge]) => {
              const on = tab === key;
              return (
                <button key={key} onClick={() => { setTab(key); setAdding(false); }}
                  style={{
                    flex: 1, border: "none", background: on ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                    color: on ? text : dim, cursor: "pointer", padding: "0.7rem 0.4rem",
                    fontFamily: mono, fontSize: "0.68rem", letterSpacing: "0.09em", fontWeight: on ? 700 : 500,
                    borderBottom: `2px solid ${on ? green : "transparent"}`,
                  }}>
                  {label}{badge ? <span style={{ marginLeft: "0.4rem", color: on ? accentInk : dim }}>{badge}</span> : null}
                </button>
              );
            })}
          </div>

          {/* ── FILTERS: your filters, or the field list while you add one ── */}
          {tab === "filters" && !adding && (
            <>
              <div style={{ padding: "0.6rem 0.65rem", borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                <button onClick={() => setAdding(true)}
                  style={{ width: "100%", padding: "0.55rem", borderRadius: 6, cursor: "pointer",
                           background: green, color: "#04130d", border: `1px solid ${green}`,
                           fontFamily: mono, fontSize: "0.74rem", fontWeight: 700, letterSpacing: "0.04em" }}>
                  + {t("Pridať filter", "Add a filter")}
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.65rem" }}>
                {filters.length === 0 ? (
                  <div style={{ color: dim, fontSize: "0.78rem", lineHeight: 1.55, textAlign: "center", padding: "2rem 0.5rem" }}>
                    {t("Zatiaľ žiadne filtre.", "No filters yet.")}<br />
                    <span style={{ fontSize: "0.74rem" }}>{emptyHint || t("Pridaj filter tlačidlom vyššie.", "Add one with the button above.")}</span>
                  </div>
                ) : filters.map((f) => (
                  <FilterCard key={f.id} f={f} field={fields.find((x) => x.key === f.key)} caps={capsOf(f.key)}
                    unit={unitOf(f.key)} lang={lang} sel={sel} useValues={useValues}
                    unavailableNote={typeof unavailableNote === "function" ? unavailableNote(f.key) : unavailableNote}
                    onPatch={(patch) => onPatch(f.id, patch)} onRemove={() => onRemove(f.id)} />
                ))}
              </div>
            </>
          )}

          {/* ── the field list: adding a filter, or choosing columns ── */}
          {(adding || tab === "cols") && (() => {
            const picking = adding;                       // true = add a filter, false = toggle columns
            return (
              <>
                <div style={{ padding: "0.6rem 0.65rem 0.5rem", borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                  {picking && (
                    <button onClick={() => setAdding(false)}
                      style={{ ...sel, width: "100%", marginBottom: "0.45rem", cursor: "pointer", color: dim, fontFamily: mono, fontSize: "0.7rem" }}>
                      ← {t("Späť na filtre", "Back to filters")}
                    </button>
                  )}
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.45rem" }}>
                    <span style={{ fontFamily: mono, fontSize: "0.62rem", color: picking ? accentInk : dim, letterSpacing: "0.09em", textTransform: "uppercase" }}>
                      {picking ? t("Vyber pole na filtrovanie", "Pick a field to filter on") : t("Zobrazené stĺpce", "Shown columns")}
                    </span>
                    <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: "0.62rem", color: dim }}>
                      {picking ? fields.length : `${cols.length}/${fields.length}`}
                    </span>
                  </div>
                  {!picking && (
                    <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.45rem" }}>
                      <button onClick={() => onSetCols(defaultCols)} style={{ ...sel, flex: 1, cursor: "pointer", color: dim, fontFamily: mono, fontSize: "0.68rem" }}>
                        ↺ {t("predvolené", "default")}
                      </button>
                      <button onClick={() => onSetCols([])} disabled={!cols.length}
                        style={{ ...sel, flex: 1, cursor: cols.length ? "pointer" : "default", color: dim, fontFamily: mono, fontSize: "0.68rem", opacity: cols.length ? 1 : 0.5 }}>
                        ✕ {t("žiadne", "none")}
                      </button>
                    </div>
                  )}
                  <div style={{ position: "relative" }}>
                    <input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus={picking}
                      placeholder={t("Hľadať pole…", "Search fields…")}
                      style={{ width: "100%", padding: "0.5rem 0.65rem 0.5rem 2rem", background: bg, border: `1px solid ${border}`, borderRadius: 6, color: text, fontSize: "0.8rem", fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
                    <span style={{ position: "absolute", left: "0.65rem", top: "50%", transform: "translateY(-50%)", color: dim, fontSize: "0.85rem", pointerEvents: "none" }}>🔍</span>
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.35rem 0.5rem 0.6rem" }}>
                  {catOrder.filter((g) => palette[g]?.length).concat(palette.other ? ["other"] : []).map((g) => (
                    <div key={g} style={{ marginBottom: "0.4rem" }}>
                      <div style={{ fontFamily: mono, fontSize: "0.58rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0.45rem 0.4rem 0.2rem" }}>{catLabel[lang === "sk" ? "sk" : "en"][g]}</div>
                      {palette[g].map((f) => {
                        const caps = picking ? capsOf(f.key) : null;
                        const unavailable = picking && caps.modes.length === 0;
                        const already = picking && filters.some((x) => x.key === f.key);
                        const on = picking ? already : cols.includes(f.key);
                        const act = () => {
                          if (picking) { if (!unavailable && !already) { onAdd(f.key); setAdding(false); setSearch(""); } }
                          else onToggleCol(f.key);
                        };
                        const inert = unavailable || already;
                        return (
                          <div key={f.key} role={picking ? "button" : "checkbox"} aria-checked={picking ? undefined : on}
                            aria-disabled={inert || undefined} tabIndex={inert ? -1 : 0}
                            onClick={act}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } }}
                            title={unavailable ? t("Toto pole sa nedá filtrovať", "This field cannot be filtered")
                              : already ? t("Filter na toto pole už máš", "You already have a filter on this field")
                              : picking ? t("Klikni a pridaj filter", "Click to add a filter")
                              : (on ? t("Klikni a skry stĺpec", "Click to hide the column") : t("Klikni a zobraz stĺpec", "Click to show the column"))}
                            style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.42rem 0.55rem", borderRadius: 5,
                                     color: inert ? dim : (on ? text : "var(--text-2)"), fontSize: "0.8rem",
                                     cursor: inert ? "default" : "pointer", userSelect: "none",
                                     opacity: unavailable ? 0.45 : 1,
                                     borderLeft: `2px solid ${on ? green : "transparent"}`,
                                     background: on ? "color-mix(in srgb, var(--accent) 7%, transparent)" : "transparent" }}
                            onMouseEnter={(e) => { if (!on && !inert) e.currentTarget.style.background = panelHi; }}
                            onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                            <span style={{ fontFamily: mono, fontSize: "0.64rem", width: 16, textAlign: "center", color: typeColor(f.type), fontWeight: 700 }}>{typeBadge(f.type)}</span>
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lang === "sk" ? f.label_sk : f.label_en}</span>
                            {on && <span style={{ fontFamily: mono, fontSize: "0.64rem", color: accentInk }}>{picking ? "•" : "✓"}</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {fields.length > 0 && Object.keys(palette).length === 0 && (
                    <div style={{ padding: "1.2rem 0.5rem", color: dim, fontSize: "0.76rem", textAlign: "center", fontStyle: "italic" }}>{t("Žiadne zhody.", "No matches.")}</div>
                  )}
                </div>
              </>
            );
          })()}
        </aside>
  );
}
