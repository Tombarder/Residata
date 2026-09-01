/* What a published price ASSUMES — and how to say so on screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 TWO THINGS CHANGE WHAT A PRICE MEANS. THIS FILE HANDLES ONE OF THEM.
 *
 *   1. PAYMENT SCHEDULE (implemented below) — WHEN you pay. A price valid only
 *      under 90/10 is cheaper than one on ordinary terms.
 *   2. FIT-OUT LEVEL (implemented below, 2026-08-21) — WHAT you get. The same
 *      flat has one price as a bare shell (`holobyt`), another with the
 *      developer's finish (`standard`), another above that (`plne_zariadeny`).
 *
 * The scraper already stores all of it. Every unit row carries:
 *      fitout_level          'holobyt' | 'standard' | 'plne_zariadeny' | null
 *      cena_holobyt          each level the developer publishes, so a project
 *      cena_standard         selling several keeps them all
 *      cena_plne_zariadeny
 *      cena_s_dph            the ONE price to display — already chosen by the
 *                            scraper (standard → holobyt → plne_zariadeny)
 *
 * HOW IT IS MARKED: a non-standard price carries its level, the same way a
 * payment schedule carries its asterisk. Boss 2026-08-19: "the two except
 * standard then will get a small note or sign displayed everywhere on the
 * website platform etc explaining that these are different than others, that
 * this price is actually ... (holobyt/plne zariadeny)."
 *
 * `standard` is the baseline — 319 of 371 projects — and carries no mark, because
 * marking the normal case is noise. Only the 41 shells and 4 furnished projects
 * are called out.
 *
 *      242 928 € · holobyt        ← a shell price, marked
 *      303 879 €                  ← standard, the baseline, no mark needed
 *
 * WHY IT MATTERS: on 17 Aug 2026 the platform showed Zion flat 2.03 at
 * 283 854 € — the BARE SHELL price — beside rivals' finished-flat prices, which
 * made the project look ~7% cheaper than it is. A non-standard price shown
 * without its mark is a wrong price.
 *
 * Full spec: novostavby/v2/docs/FITOUT_LEVELS.md
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Almost every developer quotes one price on ordinary terms: 98.6% of the flats
 * we hold (37 216 of 37 753) carry no payment schedule at all, so that is the
 * baseline and it needs no explanation.
 *
 * A handful price differently. FINEP and Creditas print a single price per flat
 * and state on every row that it holds only "pri využití splátkového kalendára
 * 90/10" — pay 90% within days of signing, 10% after handover. That is the
 * cheapest way to buy, so those flats look better value than neighbours quoting
 * standard terms, and nothing on screen said so. This module is what says so.
 *
 * The schedule itself comes from the database (public.projects.price_schedule),
 * never from a list in here — ten projects today, a different ten tomorrow.
 */
import { useEffect, useState } from "react";
import { supabasePublic } from "./supabase";

let _cache = null;
let _promise = null;

/** Map of project name -> schedule label ("90/10"), for the few that have one. */
export function usePriceSchedules() {
  const [map, setMap] = useState(_cache || {});
  useEffect(() => {
    if (_cache) { setMap(_cache); return; }
    if (!_promise) {
      _promise = supabasePublic
        .from("projects")
        .select("id,name,price_schedule")
        .not("price_schedule", "is", null)
        .then(({ data, error }) => {
          if (error) { console.error("[priceBasis]", error); return {}; }
          const out = {};
          for (const r of data || []) {
            if (r.name) out[r.name] = r.price_schedule;
            if (r.id) out[r.id] = r.price_schedule;
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

/** "90/10" -> the instalments in words, so the number means something. */
function instalments(schedule, lang) {
  const parts = String(schedule || "").split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const sk = lang === "sk";
  const first = sk ? `${parts[0]} % pri podpise` : `${parts[0]}% on signing`;
  const last = sk ? `${parts[parts.length - 1]} % po kolaudácii`
                  : `${parts[parts.length - 1]}% after handover`;
  const middle = parts.slice(1, -1).map((p) => (sk ? `${p} % počas výstavby` : `${p}% during construction`));
  return [first, ...middle, last].join(", ");
}

/** One sentence a buyer can act on. */
export function priceBasisNote(schedule, lang) {
  if (!schedule) return "";
  const detail = instalments(schedule, lang);
  return lang === "sk"
    ? `Cena platí pri splátkovom kalendári ${schedule} (${detail}). Pri inom spôsobe úhrady je cena dohodnutá individuálne a spravidla vyššia.`
    : `This price applies under the ${schedule} payment schedule (${detail}). Any other arrangement is agreed individually and is usually higher.`;
}

/** The short thing that sits beside a price. Deliberately one character wide so
 *  it cannot disturb a right-aligned money column. */
export function PriceBasisMark({ schedule, lang }) {
  if (!schedule) return null;
  return (
    <sup
      title={priceBasisNote(schedule, lang)}
      style={{ marginLeft: "0.15em", color: "var(--accent, #d68910)", cursor: "help",
               fontSize: "0.72em", fontWeight: 600, lineHeight: 0 }}
    >
      *
    </sup>
  );
}

/** The legend under a table: names every schedule actually on screen. */
export function priceBasisLegend(schedules, lang) {
  const uniq = [...new Set(schedules.filter(Boolean))].sort();
  if (!uniq.length) return "";
  const head = lang === "sk"
    ? "* Cena tohto bytu platí pri konkrétnom splátkovom kalendári"
    : "* This flat's price applies under a specific payment schedule";
  return `${head} — ${uniq.map((s) => `${s} (${instalments(s, lang)})`).join("; ")}.`;
}


/* ═══════════════════════════════════════════════════════════════════════════
 * FIT-OUT LEVEL — what the price BUYS.
 *
 * The level is recorded per project (public.projects.fitout_level) and, where a
 * developer states it per flat, on the unit row itself (fitout_level). The unit
 * always wins: Nová Myslivna sells one Shell&Core unit inside a standard project,
 * and Zelené kaskady sells 4+kk and 5+kk as shells and everything smaller
 * finished. So a caller passes the unit's own level when it has one and falls
 * back to the project's.
 * ═══════════════════════════════════════════════════════════════════════════ */

let _fitCache = null;
let _fitPromise = null;

/** Map of project name/id -> fit-out level, for the ones that are not standard. */
export function useProjectFitout() {
  const [map, setMap] = useState(_fitCache || {});
  useEffect(() => {
    if (_fitCache) { setMap(_fitCache); return; }
    if (!_fitPromise) {
      _fitPromise = supabasePublic
        .from("projects")
        .select("id,name,fitout_level")
        .not("fitout_level", "is", null)
        .neq("fitout_level", "standard")
        .then(({ data, error }) => {
          if (error) { console.error("[priceBasis/fitout]", error); return {}; }
          const out = {};
          for (const r of data || []) {
            if (r.name) out[r.name] = r.fitout_level;
            if (r.id) out[r.id] = r.fitout_level;
          }
          _fitCache = out;
          return out;
        });
    }
    let alive = true;
    _fitPromise.then((out) => { if (alive) setMap(out); });
    return () => { alive = false; };
  }, []);
  return map;
}

/** What to mark beside a PROJECT's average price.
 *
 * The average is built from priced, for-sale flats, so the mark has to describe
 * those flats. A project's own recorded level is the wrong answer twice over: it
 * is empty for a project whose parser labels every flat individually (PANORÁMA
 * Košice has no project level and 241 of its 260 flats are shells), and it says
 * one word for a project that sells two things (Žít Braník prices shells and
 * finished flats side by side). projects_live carries both, so prefer the levels
 * actually behind the number and fall back to the recorded one.
 */
export function projectPriceLevel(row) {
  const behind = (row?.fitout_levels_priced || []).filter(Boolean);
  if (behind.length > 1) return "mixed";
  if (behind.length === 1) return behind[0];
  return row?.fitout_level || "";
}

/** The word that goes beside the price. Empty for standard — the baseline. */
export function fitoutLabel(level, lang) {
  const sk = lang === "sk";
  if (level === "holobyt") return sk ? "holobyt" : "shell";
  if (level === "plne_zariadeny") return sk ? "zariadený" : "furnished";
  if (level === "mixed") return sk ? "rôzny štandard" : "mixed finish";
  return "";
}

/** One sentence a buyer can act on. */
export function fitoutNote(level, lang) {
  const sk = lang === "sk";
  if (level === "holobyt") {
    return sk
      ? "Cena je za HOLOBYT — byt bez podláh, obkladov, interiérových dverí a sanity. "
        + "Dokončenie do štandardu si kupujúci platí sám, takže táto cena nie je "
        + "porovnateľná s cenami dokončených bytov."
      : "This is a SHELL price — the flat has no floor coverings, tiles, interior "
        + "doors or sanitary ware. Finishing it is the buyer's own cost, so this "
        + "price is not comparable with finished flats.";
  }
  if (level === "plne_zariadeny") {
    return sk
      ? "Cena je za PLNE ZARIADENÝ byt — nad rámec bežného štandardu developera "
        + "(napr. kuchyňa so spotrebičmi, nábytok). Preto je vyššia než ceny "
        + "porovnateľných bytov v štandarde."
      : "This price is for a FULLY FURNISHED flat — above the developer's ordinary "
        + "standard (a fitted kitchen with appliances, furniture). It is therefore "
        + "higher than comparable flats sold at standard finish.";
  }
  if (level === "mixed") {
    return sk
      ? "Tento projekt predáva byty v rôznych stupňoch dokončenia (holobyt aj "
        + "štandard), takže priemerná cena mieša dva odlišné produkty."
      : "This project sells flats at different finish levels (a bare shell and a "
        + "finished flat), so its average price mixes two different products.";
  }
  return "";
}

/** The mark that sits beside a price. Compact enough not to disturb a money column. */
export function FitoutMark({ level, lang }) {
  const label = fitoutLabel(level, lang);
  if (!label) return null;
  const shell = level === "holobyt";
  return (
    <span
      title={fitoutNote(level, lang)}
      style={{
        marginLeft: "0.4em", cursor: "help", fontSize: "0.68em", fontWeight: 700,
        letterSpacing: "0.02em", textTransform: "lowercase", whiteSpace: "nowrap",
        padding: "0.1em 0.42em", borderRadius: "999px", verticalAlign: "middle",
        color: shell ? "var(--warn, #b45309)" : "var(--accent, #6d28d9)",
        border: `1px solid ${shell ? "var(--warn, #b45309)" : "var(--accent, #6d28d9)"}`,
        opacity: 0.9,
      }}
    >
      {label}
    </span>
  );
}

/** The legend under a table: explains every level actually on screen. */
export function fitoutLegend(levels, lang) {
  const uniq = [...new Set((levels || []).filter((l) => l && l !== "standard"))].sort();
  if (!uniq.length) return "";
  return uniq.map((l) => `${fitoutLabel(l, lang)} — ${fitoutNote(l, lang)}`).join(" ");
}
