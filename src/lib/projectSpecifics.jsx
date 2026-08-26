/* PROJECT SPECIFICS — what makes THIS project different from the ordinary one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Boss 2026-08-26: a project that departs from the ordinary case gets a small
 * `*` on the Projects list, and the departures spelled out beside its name on
 * the project detail page.
 *
 * "Ordinary" is defined ONCE, in ORDINARY below. Four things are checked today:
 *
 *      payment schedule   ordinary = ordinary terms, or the market-default 20/80
 *      fit-out level      ordinary = the developer's own standard finish
 *      coverage           ordinary = the site lists SOLD units as well as free
 *      living area        ordinary = we hold obytná plocha, so a price per m²
 *                                    can be computed
 *
 * A price that assumes something unusual, shown without saying so, is a wrong
 * price — that is the whole point (see lib/priceBasis.jsx for the case that
 * started it: a bare-shell price shown next to finished flats made a project
 * look 7% cheaper than it is).
 *
 * ── ADDING A FIFTH SPECIFIC ────────────────────────────────────────────────
 * One entry in RULES below. Nothing else changes: the `*`, the tooltip, the
 * detail panel and the ordering all read from that list. If the new specific
 * needs a column the frontend doesn't have yet, add it to `public.projects`
 * (migration v2/migrations/2026-08-26_projects_view_specifics.sql shows how)
 * and to SPECIFICS_COLUMNS below.
 *
 * The prose for the two price-composition specifics is NOT written here — it
 * is reused from lib/priceBasis.jsx, which is the single source of truth for
 * how a schedule and a fit-out level are explained across the whole platform.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useState } from "react";
import { supabasePublic } from "./supabase";
import { priceBasisNote, fitoutNote, fitoutLabel, projectPriceLevel } from "./priceBasis";

/** The ordinary case. Anything else is a specific worth showing. */
export const ORDINARY = {
  price_schedule: "20/80",   // …or none at all (98.6% of flats)
  fitout_level: "standard",
  coverage_mode: "full",     // the developer publishes sold units too
  has_interior_area: true,
};

/** Columns `public.projects` must serve for the rules below to work. */
const SPECIFICS_COLUMNS = "id,price_schedule,coverage_mode,has_interior_area";

const sk = (lang) => lang === "sk";

/* ── The rules ─────────────────────────────────────────────────────────────
 * Each returns null when the project is ordinary on that dimension, or
 * { key, text, note }: `text` is the few-word line the user reads, `note` the
 * one sentence they get on hover. Order here is the order on screen — price
 * composition first, because it changes what a number MEANS; coverage and
 * missing areas after, because they change what we can measure.
 */
const RULES = [
  // 1 · Payment schedule — WHEN you pay changes the price.
  ({ row, extra, lang }) => {
    const s = extra?.price_schedule ?? row?.price_schedule;
    if (!s || s === ORDINARY.price_schedule) return null;
    return {
      key: "financing",
      text: sk(lang) ? `Financovanie ${s}, nie bežné 20/80`
                     : `${s} payment schedule, not the usual 20/80`,
      note: priceBasisNote(s, lang),
    };
  },

  // 2 · Fit-out level — WHAT the price buys.
  ({ row, lang }) => {
    const level = projectPriceLevel(row);
    if (!level || level === ORDINARY.fitout_level) return null;
    const text = level === "holobyt"
      ? (sk(lang) ? "Cena za holobyt, nie za štandard" : "Shell price, not standard finish")
      : level === "plne_zariadeny"
        ? (sk(lang) ? "Cena za plne zariadený byt" : "Fully furnished price, above standard")
        : level === "mixed"
          ? (sk(lang) ? "Rôzny štandard v rámci projektu" : "Mixed finish across the project")
          // A level we have not written a line for yet: name it rather than drop it.
          : (sk(lang) ? `Štandard: ${fitoutLabel(level, lang) || level}`
                      : `Finish: ${fitoutLabel(level, lang) || level}`);
    return { key: "fitout", text, note: fitoutNote(level, lang) };
  },

  // 3 · Coverage — does the developer publish what they've already sold?
  ({ extra, lang }) => {
    if (extra?.coverage_mode !== "available_only") return null;
    return {
      key: "coverage",
      text: sk(lang) ? "Developer zverejňuje len voľné byty"
                     : "Developer lists only available units",
      note: sk(lang)
        ? "Na stránke developera sú len byty, ktoré sú ešte v ponuke. Vypredanosť "
          + "projektu preto vieme merať až odkedy ho sledujeme, nie od jeho spustenia."
        : "The developer's site lists only units still for sale, so this project's "
          + "sell-through is measured from the day we began tracking it, not from launch.",
    };
  },

  // 4 · Living area — without it there is no price per m².
  ({ row, extra, lang }) => {
    if (extra?.has_interior_area !== false) return null;
    // A project with no units in the current snapshot at all (paused, or sold
    // out and delisted) has no areas simply because it has no rows — that is
    // not a statement about what the developer publishes, so say nothing.
    if (!(row?.total_units > 0)) return null;
    return {
      key: "interior_area",
      text: sk(lang) ? "Bez obytnej plochy — cenu za m² nevieme spočítať"
                     : "No living area published — price per m² unavailable",
      note: sk(lang)
        ? "Developer pri tomto projekte nezverejňuje obytné plochy bytov, takže cenu "
          + "za m² ani porovnanie s inými projektami pri ňom neponúkame."
        : "The developer doesn't publish living areas for this project, so no price "
          + "per m² — and no €/m² comparison against other projects — is offered for it.",
    };
  },
];

/**
 * Everything unusual about one project, ready to render.
 *
 * @param row   a project row from `projects_live` (carries fitout_level +
 *              fitout_levels_priced, the per-flat truth behind its average)
 * @param extra that project's entry from useProjectSpecificsData() — the three
 *              fields projects_live doesn't carry. Safe to pass undefined:
 *              every rule then simply reports nothing on its dimension.
 */
export function projectSpecifics(row, extra, lang) {
  if (!row) return [];
  const out = [];
  for (const rule of RULES) {
    const hit = rule({ row, extra, lang });
    if (hit) out.push(hit);
  }
  return out;
}

/* ── The data projects_live doesn't carry ──────────────────────────────────
 * One small read of `public.projects` (4 columns, ~400 rows), cached at module
 * level for the session, shared by every surface. Mirrors how usePriceSchedules
 * works in priceBasis.jsx — deliberately the same shape so both are obvious.
 */
let _cache = null;
let _promise = null;

/** Map of project id → { price_schedule, coverage_mode, has_interior_area }. */
export function useProjectSpecificsData() {
  const [map, setMap] = useState(_cache || {});
  useEffect(() => {
    if (_cache) { setMap(_cache); return; }
    if (!_promise) {
      _promise = supabasePublic
        .from("projects")
        .select(SPECIFICS_COLUMNS)
        .then(({ data, error }) => {
          if (error) { console.error("[projectSpecifics]", error); return {}; }
          const out = {};
          for (const r of data || []) {
            if (!r?.id) continue;
            out[r.id] = {
              price_schedule: r.price_schedule,
              coverage_mode: r.coverage_mode,
              has_interior_area: r.has_interior_area,
            };
          }
          _cache = out;
          return out;
        });
    }
    let alive = true;
    _promise.then((out) => { if (alive) setMap(out); });
    return () => { alive = false; };
  }, []);
  return map;
}

/* ── The mark on a list row ────────────────────────────────────────────────
 * Two rules make this safe in a table cell:
 *
 *   · `display: inline` — NOT inline-block. An atomic inline box is a line-break
 *     opportunity, so an inline-block mark gets pushed onto a line of its own
 *     after a name that fills the column ("Albatros Kbely 5" / "*"). As plain
 *     inline text with no whitespace in front of it there is no break
 *     opportunity at all, so the `*` stays welded to the last character.
 *   · rendered on EVERY row, hidden rather than omitted when the project is
 *     ordinary, so the Project column measures the same either way and no name
 *     shifts when a filter changes which projects are on screen.
 */
export function SpecificsMark({ items, lang }) {
  const n = items?.length || 0;
  const tip = n
    ? `${sk(lang) ? "Špecifiká projektu" : "Project specifics"}: ${items.map((i) => i.text).join(" · ")}`
    : undefined;
  return (
    <span
      title={tip}
      aria-hidden={n === 0 ? "true" : undefined}
      style={{
        display: "inline", marginLeft: "0.15em", color: "var(--accent-2)",
        fontWeight: 700, userSelect: "none",
        cursor: n ? "help" : "default",
        visibility: n ? "visible" : "hidden",
      }}
    >
      *
      {n ? <span className="sr-only">{tip}</span> : null}
    </span>
  );
}

/* ── The panel beside a project's name ─────────────────────────────────────
 * Sits in the detail header as a flex sibling of the title block. It is
 * `flex: 0 1 clamp(...)` so it takes at most ~340px, shrinks before it
 * overflows, and drops onto its own full-width line on a narrow screen —
 * it can never sit on top of the project name.
 */
export function SpecificsPanel({ items, lang }) {
  if (!items?.length) return null;
  return (
    <aside
      aria-label={sk(lang) ? "Špecifiká projektu" : "Project specifics"}
      style={{
        flex: "0 1 clamp(240px, 100%, 340px)", minWidth: 0, maxWidth: "100%",
        // Hug the content, don't stretch to the title block's height — with a
        // single specific a stretched panel is mostly empty box.
        alignSelf: "flex-start",
        border: "1px solid var(--border-soft)", borderRadius: "var(--r-md, 8px)",
        background: "color-mix(in srgb, var(--accent-2) 7%, var(--surface))",
        padding: "0.7rem 0.85rem 0.75rem",
      }}
    >
      <div style={{
        fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.6rem",
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: "var(--accent-2)", marginBottom: "0.5rem",
      }}>
        {sk(lang) ? "Špecifiká projektu" : "Project specifics"}
      </div>
      <ul style={{
        listStyle: "none", margin: 0, padding: 0,
        display: "flex", flexDirection: "column", gap: "0.4rem",
      }}>
        {items.map((it) => (
          <li
            key={it.key}
            title={it.note || undefined}
            style={{
              display: "flex", gap: "0.45rem", alignItems: "flex-start",
              fontSize: "0.78rem", lineHeight: 1.4, color: "var(--text-2)",
              cursor: it.note ? "help" : "default",
            }}
          >
            <span style={{ flex: "none", color: "var(--accent-2)", fontWeight: 700, lineHeight: 1.35 }}>*</span>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{it.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
