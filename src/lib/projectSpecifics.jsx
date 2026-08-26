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
 * ── TWO SCOPES, ONE VISUAL LANGUAGE (Boss 2026-08-26) ──────────────────────
 * A surface shows a PROJECT or it shows a UNIT, and they say different things:
 *
 *   project-level  (project lists, cards, rankings, map popups, project
 *                   reports)  → ONE amber `*` after the name, every specific
 *                   in its tooltip. All four rules apply.
 *   unit-level     (unit tables, a single flat's timeline, sold-unit lists)
 *                   → the marks that describe THIS price: `*` for a payment
 *                   schedule and the fit-out word beside the number. Coverage
 *                   and "no living area" are facts about the project, not
 *                   about this flat's price, so they are noise on a unit row
 *                   and unitSpecifics() leaves them out.
 *
 * That is why a project row never carries both a `*` and a fit-out pill: at
 * project level the `*` already stands for everything.
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
import { useEffect, useMemo, useState } from "react";
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
const SPECIFICS_COLUMNS =
  "id,name,price_schedule,coverage_mode,has_interior_area,fitout_level,total_units";

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
  ({ row, extra, lang }) => {
    // projectPriceLevel prefers the levels actually behind the project's average
    // (fitout_levels_priced). Some surfaces read a NARROW projects_live column
    // set that carries neither field — the homepage cards are one — so fall back
    // to the registry copy rather than silently dropping the specific there.
    const level = projectPriceLevel(row) || extra?.fitout_level;
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

/** Map keyed by BOTH project id and project name → the three extra fields.
 *
 * Both keys, because the surfaces split evenly: the project pages carry a row
 * with `id`, while Sales / Pivot / comparables / histogram drill-downs carry
 * only `project_name`. Same approach as usePriceSchedules in priceBasis.jsx.
 */
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
            const v = {
              id: r.id,
              price_schedule: r.price_schedule,
              coverage_mode: r.coverage_mode,
              has_interior_area: r.has_interior_area,
              fitout_level: r.fitout_level,
              total_units: r.total_units,
            };
            if (r.id) out[r.id] = v;
            if (r.name) out[r.name] = v;
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

/** The one hook a surface needs: `.project(x)` and `.unit(row)` both return a
 *  ready-to-render list, whether `x` is a full project row, an id or a name.
 *
 *  Every surface goes through this so none of them has to know which fields
 *  live on which table — and so a fifth specific reaches all of them at once.
 */
export function useSpecifics(lang) {
  const data = useProjectSpecificsData();
  return useMemo(() => {
    const extraOf = (x) => (x && typeof x === "object" ? (data[x.id] || data[x.name]) : data[x]);
    return {
      ready: Object.keys(data).length > 0,
      /** The raw map (id AND name keyed), for a caller that needs one field. */
      data,
      /** All four rules — for anything that names a PROJECT. */
      project(x) {
        if (!x) return [];
        const extra = extraOf(x);
        // A bare id/name has no projects_live row, so synthesise the fields the
        // rules read off one (fit-out level, unit count) from the registry copy.
        const row = (x && typeof x === "object") ? x : (extra || null);
        return projectSpecifics(row, extra, lang);
      },
      /** Price-composition only — for anything that shows ONE FLAT's price. */
      unit(unitRow, projectKey) {
        if (!unitRow) return [];
        const extra = extraOf(projectKey ?? unitRow.project_id ?? unitRow.project_name);
        return unitSpecifics(unitRow, extra, lang);
      },
    };
  }, [data, lang]);
}

/** The two specifics that describe ONE flat's price. The flat's own fit-out
 *  level always wins over the project's — developers do sell a shell unit
 *  inside an otherwise finished project (Nová Myslivna) and price 4+kk as
 *  shells while everything smaller is finished (Zelené kaskady). */
export function unitSpecifics(unitRow, extra, lang) {
  const out = [];
  const schedule = extra?.price_schedule;
  if (schedule && schedule !== ORDINARY.price_schedule) {
    out.push({
      key: "financing",
      text: sk(lang) ? `Financovanie ${schedule}, nie bežné 20/80`
                     : `${schedule} payment schedule, not the usual 20/80`,
      note: priceBasisNote(schedule, lang),
      schedule,
    });
  }
  const level = unitRow?.fitout_level || extra?.fitout_level;
  if (level && level !== ORDINARY.fitout_level) {
    out.push({
      key: "fitout",
      text: fitoutLabel(level, lang) || level,
      note: fitoutNote(level, lang),
      level,
    });
  }
  return out;
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
export function SpecificsMark({ items, lang, style }) {
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
        // Escape hatch for FLEX containers (the pivot's label cell truncates its
        // name with an ellipsis, so there the mark must be a `flex: none`
        // sibling or the ellipsis eats it).
        ...style,
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

/* ── The marks beside ONE FLAT's price ─────────────────────────────────────
 * Same visual language the unit database has used since the fit-out columns
 * shipped: a superscript `*` for a payment schedule, and the fit-out word in a
 * pill. Both are `white-space: nowrap` and sit AFTER the number with no space
 * in front of the `*`, so a money column never gains a wrapped orphan.
 */
export function UnitPriceMarks({ items, lang }) {
  if (!items?.length) return null;
  const sched = items.find((i) => i.key === "financing");
  const fit = items.find((i) => i.key === "fitout");
  return (
    <>
      {sched ? (
        <sup
          title={sched.note}
          style={{
            marginLeft: "0.1em", color: "var(--accent-2)", cursor: "help",
            fontSize: "0.72em", fontWeight: 700, lineHeight: 0,
          }}
        >*</sup>
      ) : null}
      {fit ? (
        <span
          title={fit.note}
          style={{
            marginLeft: "0.4em", cursor: "help", fontSize: "0.68em", fontWeight: 700,
            letterSpacing: "0.02em", textTransform: "lowercase", whiteSpace: "nowrap",
            padding: "0.1em 0.42em", borderRadius: "999px", verticalAlign: "middle",
            color: "var(--accent-2)", border: "1px solid var(--accent-2)", opacity: 0.9,
          }}
        >{fit.text}</span>
      ) : null}
    </>
  );
}

/* ── The footnote under a table ────────────────────────────────────────────
 * Names only what is actually on screen, so a table of ordinary projects
 * carries no legend at all. Returns "" when there is nothing to say — callers
 * render nothing rather than an empty box.
 */
export function specificsLegend(itemLists, lang) {
  const seen = new Map();
  for (const items of itemLists || []) {
    for (const it of items || []) if (!seen.has(it.text)) seen.set(it.text, it.note);
  }
  if (!seen.size) return "";
  const head = sk(lang) ? "* Špecifiká projektu" : "* Project specifics";
  return `${head} — ${[...seen.entries()].map(([t, n]) => (n ? `${t}: ${n}` : t)).join("  ")}`;
}

/** The footnote as a styled block. Never rendered when there is nothing to say. */
export function SpecificsLegend({ itemLists, lang }) {
  const txt = specificsLegend(itemLists, lang);
  if (!txt) return null;
  return (
    <p style={{
      margin: "0.6rem 0 0", fontSize: "0.7rem", lineHeight: 1.5,
      color: "var(--text-dim)", maxWidth: "80ch", overflowWrap: "anywhere",
    }}>{txt}</p>
  );
}

/* ── The note under an AGGREGATE average (Boss 2026-08-26, decision 1) ─────
 * A district's average €/m² blends every project inside it, shells included.
 * Boss chose a NOTE over excluding them: dropping projects would make the
 * district average disagree with the project list printed underneath it.
 * Counts only what actually distorts a price comparison — fit-out level and
 * payment schedule. Coverage and missing areas don't move an average.
 */
export function aggregateSpecificsNote(projects, data, lang) {
  let shell = 0, furnished = 0, sched = 0;
  for (const p of projects || []) {
    const extra = data?.[p?.id] || data?.[p?.name];
    const level = projectPriceLevel(p) || extra?.fitout_level;
    if (level === "holobyt") shell++;
    else if (level === "plne_zariadeny") furnished++;
    const s = extra?.price_schedule;
    if (s && s !== ORDINARY.price_schedule) sched++;
  }
  if (!shell && !furnished && !sched) return "";
  const parts = [];
  if (shell) parts.push(sk(lang) ? `${shell} s cenou za holobyt` : `${shell} priced as a shell`);
  if (furnished) parts.push(sk(lang) ? `${furnished} plne zariadených` : `${furnished} fully furnished`);
  if (sched) parts.push(sk(lang) ? `${sched} s iným splátkovým kalendárom`
                                 : `${sched} on a different payment schedule`);
  return sk(lang)
    ? `Priemer zahŕňa ${parts.join(", ")} — tieto ceny nekupujú to isté, takže priemer mieša odlišné produkty.`
    : `The average includes ${parts.join(", ")} — those prices don't buy the same thing, so it blends different products.`;
}

/** The aggregate note as a styled block. Renders nothing when there is nothing to say. */
export function AggregateSpecificsNote({ projects, data, lang, style }) {
  const txt = aggregateSpecificsNote(projects, data, lang);
  if (!txt) return null;
  return (
    <p style={{
      margin: "0.5rem 0 0", fontSize: "0.7rem", lineHeight: 1.5, color: "var(--text-dim)",
      maxWidth: "80ch", overflowWrap: "anywhere", ...style,
    }}>
      <span style={{ color: "var(--accent-2)", fontWeight: 700 }}>*&nbsp;</span>{txt}
    </p>
  );
}

/* ── The mark for a map popup ──────────────────────────────────────────────
 * MapLibre popups take an HTML STRING, not React, so the same mark has to
 * exist as markup. Escaped here rather than at every call site.
 */
const _esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

/** `<sup>` mark + a list of the specifics, as an HTML string. "" when ordinary. */
export function specificsHTML(items, lang) {
  if (!items?.length) return "";
  const head = sk(lang) ? "Špecifiká projektu" : "Project specifics";
  const rows = items.map((it) => (
    `<div style="display:flex;gap:6px;align-items:flex-start;margin-top:3px">`
    + `<span style="flex:none;color:#f5a623;font-weight:700">*</span>`
    + `<span style="min-width:0;overflow-wrap:anywhere">${_esc(it.text)}</span></div>`
  )).join("");
  return (
    `<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(245,166,35,0.35);`
    + `font-size:11px;line-height:1.4;color:#c4c4cc;max-width:260px">`
    + `<div style="font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:#f5a623">${_esc(head)}</div>`
    + rows + `</div>`
  );
}
