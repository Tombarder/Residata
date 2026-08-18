/* What a published price ASSUMES — and how to say so on screen.
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
