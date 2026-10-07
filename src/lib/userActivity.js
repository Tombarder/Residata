// Plain-language reading of one person's activity (admin → Users → a person).
// The numbers come from the DB in one call (admin_user_activity); this turns them
// into what Boss asked for — "what he's doing, when, how, how much" — as words.
// Pure functions, so src/lib/userActivity.test.mjs pins every rule. The Slovak text
// is worded without gender ("Aktivita v 6 dňoch", not "Bol aktívny") — the person
// may be anyone.

const L = (lang) => (sk, en) => (lang === "sk" ? sk : en);

/** "Chrome · macOS", "Safari · iPhone", "Script (Python)" — never the raw string. */
export function describeUserAgent(ua) {
  const s = String(ua || "");
  if (!s) return { label: "—", device: "unknown", script: false };
  const script = /python|curl|wget|node-fetch|axios|go-http|okhttp|java\/|residata-v2|postman|httpie/i.test(s) && !/mozilla/i.test(s);
  if (script) {
    const name = (s.match(/^([A-Za-z][\w.-]*)/) || [])[1] || "script";
    return { label: `Script (${name.split(/[/-]/)[0]})`, device: "script", script: true };
  }
  const os = /iPhone/.test(s) ? "iPhone"
    : /iPad/.test(s) ? "iPad"
    : /Android/.test(s) ? "Android"
    : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "macOS"
    : /CrOS/.test(s) ? "ChromeOS"
    : /Linux/.test(s) ? "Linux" : "";
  const browser = /Edg\//.test(s) ? "Edge"
    : /OPR\/|Opera/.test(s) ? "Opera"
    : /Firefox\//.test(s) ? "Firefox"
    : /Claude\//.test(s) ? "Claude app"
    : /SamsungBrowser/.test(s) ? "Samsung Internet"
    : /Chrome\//.test(s) ? "Chrome"
    : /Safari\//.test(s) ? "Safari" : "Browser";
  const device = /iPhone|Android.*Mobile/.test(s) ? "phone" : /iPad|Android/.test(s) ? "tablet" : "computer";
  return { label: os ? `${browser} · ${os}` : browser, device, script: false };
}

/** 134 → "2 h 14 min"; 0.4 → "< 1 min"; 0 → "0 min". */
export function fmtMinutes(min) {
  const m = Number(min) || 0;
  if (m <= 0) return "0 min";
  if (m < 1) return "< 1 min";
  const h = Math.floor(m / 60);
  const r = Math.round(m - h * 60);
  if (!h) return `${Math.round(m)} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Change vs the previous window, as a short line under a KPI: "▲ 4 (predtým 2)".
 *  `fmt` formats the values (time as "2 h 14 min"); the period is in the KPI's tooltip. */
export function deltaLine(cur, prev, lang = "en", fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10))) {
  const t = L(lang);
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (c === p) return { dir: "same", text: c ? t("rovnako ako predtým", "same as before") : t("ani predtým", "none before either") };
  const before = t(`predtým ${fmt(p)}`, `before: ${fmt(p)}`);
  return c > p
    ? { dir: "up", text: `▲ ${fmt(c - p)} (${before})` }
    : { dir: "down", text: `▼ ${fmt(p - c)} (${before})` };
}

/**
 * How engaged the person is in the window — one word Boss can sort by eye.
 * Measured on ACTIVE DAYS (a day with any event, sign-in or AI question), as a share
 * of the days they could have been active (the window, or less for a new account).
 */
export function engagementOf(data, now = new Date()) {
  const k = data?.kpis?.cur || {};
  const p = data?.person || {};
  const days = Number(data?.days) || 30;
  const active = Number(k.active_days) || 0;
  const created = p.created_at ? new Date(p.created_at) : null;
  const ageDays = created ? Math.max(1, Math.ceil((now - created) / 86400000)) : days;
  const possible = Math.max(1, Math.min(days, ageDays));
  const share = active / possible;
  const everUsed = Boolean(p.first_activity_at) || Number(data?.sign_ins?.total) > 1;
  if (!active) return everUsed
    ? { key: "dormant", sk: "Bez aktivity", en: "Dormant", tone: "warn" }
    : { key: "never", sk: "Ešte nepoužité", en: "Not used yet", tone: "warn" };
  if (active >= 3 && share >= 0.4) return { key: "power", sk: "Vysoká aktivita", en: "Power user", tone: "ok" };
  if (active >= 2 && share >= 0.15) return { key: "regular", sk: "Pravidelná aktivita", en: "Regular", tone: "ok" };
  return { key: "occasional", sk: "Občasná aktivita", en: "Occasional", tone: "" };
}

const DOW = {
  sk: ["", "po", "ut", "st", "št", "pi", "so", "ne"],
  en: ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
export const weekdayName = (dow, lang = "en") => (DOW[lang === "sk" ? "sk" : "en"][dow] || "");

/**
 * When they usually work: the busiest weekdays and the busiest 3-hour stretch, from
 * the weekday x hour counts. null when there is too little to say anything honest.
 */
export function usualTimes(heatmap, lang = "en") {
  const cells = (heatmap || []).filter((c) => c && c.n > 0);
  const total = cells.reduce((a, c) => a + c.n, 0);
  if (total < 5) return null;
  const byDow = new Map();
  const byHour = new Array(24).fill(0);
  for (const c of cells) {
    byDow.set(c.dow, (byDow.get(c.dow) || 0) + c.n);
    byHour[c.hour] += c.n;
  }
  const topDays = [...byDow.entries()].sort((a, b) => b[1] - a[1]);
  // every weekday holding at least 60 % of the busiest one, in calendar order
  const keep = topDays.filter(([, n]) => n >= topDays[0][1] * 0.6).map(([d]) => d).sort((a, b) => a - b).slice(0, 4);
  // the window starts on an hour they were actually there, so "9:00–12:00" is never
  // "8:00–11:00" padded with an empty hour in front
  let best = 0, bestAt = 0;
  for (let h = 0; h < 24; h++) {
    if (!byHour[h]) continue;
    const n = byHour[h] + byHour[(h + 1) % 24] + byHour[(h + 2) % 24];
    if (n > best) { best = n; bestAt = h; }
  }
  return {
    days: keep.map((d) => weekdayName(d, lang)).join(", "),
    hours: `${bestAt}:00–${(bestAt + 3) % 24}:00`,
    weekend: (byDow.get(6) || 0) + (byDow.get(7) || 0) > total * 0.25,
  };
}

/** Names of feature events, for the "what they do" list. Unknown ones stay readable. */
const EVENT_NAMES = {
  project_view: ["Detail projektu", "Opened a project"],
  csv_exported: ["Stiahnutie CSV", "Downloaded a CSV"],
  xlsx_exported: ["Stiahnutie Excelu", "Downloaded an Excel file"],
  data_export: ["Export vlastných údajov (GDPR)", "Exported own account data (GDPR)"],
  data_copied: ["Kopírovanie tabuľky do Excelu", "Copied a table for Excel"],
  chat_question: ["Otázka AI asistentovi", "Asked the AI assistant"],
  chat_answer: ["Odpoveď AI", "Got an AI answer"],
  chat_feedback: ["Hodnotenie odpovede AI", "Rated an AI answer"],
  chat_error: ["Chyba AI asistenta", "AI assistant failed"],
  chat_cleared: ["Vymazanie chatu", "Cleared the chat"],
  checkout_started: ["Klik na predplatenie", "Pressed Subscribe"],
  checkout_refused: ["Platbu sa nepodarilo spustiť", "Checkout could not start"],
  checkout_returned: ["Návrat z platby", "Came back from checkout"],
  billing_portal_opened: ["Správa platby", "Opened billing management"],
  trial_popup_shown: ["Zobrazená ponuka trialu", "Saw the trial offer"],
  trial_popup_clicked: ["Klik na ponuku trialu", "Clicked the trial offer"],
  trial_popup_dismissed: ["Zatvorená ponuka trialu", "Closed the trial offer"],
  trial_banner_clicked: ["Klik na pásik trialu", "Clicked the trial banner"],
  trial_banner_dismissed: ["Zatvorený pásik trialu", "Closed the trial banner"],
  country_switched: ["Zmena krajiny", "Switched country"],
  currency_switched: ["Zmena meny", "Switched currency"],
  language_switched: ["Zmena jazyka", "Switched language"],
  settings_saved: ["Uložené nastavenia", "Saved settings"],
  profile_completed: ["Dokončený profil", "Completed the profile"],
  login_code_requested: ["Vyžiadaný prihlasovací kód", "Requested a sign-in code"],
  login_code_success: ["Prihlásenie kódom", "Signed in with a code"],
  login_code_error: ["Zlý prihlasovací kód", "Wrong sign-in code"],
  flat_sort_applied: ["Zoradenie bytov", "Sorted the flats"],
  scatter_dot_clicked: ["Klik na bod v grafe", "Clicked a chart point"],
  platform_crash: ["Pád stránky", "A page crashed"],
  account_deleted: ["Vymazanie účtu", "Deleted the account"],
};
export function eventName(event, lang = "en") {
  const hit = EVENT_NAMES[event];
  if (hit) return lang === "sk" ? hit[0] : hit[1];
  return String(event || "").replace(/_/g, " ");
}

const EXPORT_NAMES = {
  units: ["Databáza bytov", "Unit database"],
  flats: ["Exporty — byty", "Exports — flats"],
  projects: ["Exporty — projekty", "Exports — projects"],
  pivot_table: ["Pivot — tabuľka", "Pivot — table"],
  pivot_records: ["Pivot — záznamy", "Pivot — records"],
  sales: ["Predaje", "Sales"],
  map_projects: ["Trhový radar — projekty", "Market Radar — projects"],
  report_projects: ["Report — projekty", "Report — projects"],
  competitive_profile: ["Report — konkurencia", "Report — competitive profile"],
  comparable_transactions: ["Report — porovnateľné", "Report — comparables"],
  unit_timeline: ["Byt v čase", "Unit timeline"],
};
export function exportName(what, lang = "en") {
  const hit = EXPORT_NAMES[what];
  if (hit) return lang === "sk" ? hit[0] : hit[1];
  return what ? String(what).replace(/_/g, " ") : (lang === "sk" ? "Export" : "Export");
}

/**
 * The paragraph at the top of the page: the whole picture in two or three sentences.
 * `pageName` turns a page key into its title (lib/pageTitles.js).
 */
export function summarize(data, { lang = "en", now = new Date(), pageName = (k) => k } = {}) {
  const t = L(lang);
  if (!data?.person) return "";
  const k = data.kpis?.cur || {};
  const days = Number(data.days) || 30;
  const out = [];
  const active = Number(k.active_days) || 0;
  if (!active) {
    const last = data.person.last_active_at ? new Date(data.person.last_active_at) : null;
    out.push(last
      ? t(`Za posledných ${days} dní žiadna aktivita. Naposledy ${relDays(last, now, lang)}.`,
          `No activity in the last ${days} days. Last active ${relDays(last, now, lang)}.`)
      : t("Od registrácie bez použitia platformy.", "Has not used the platform since signing up."));
  } else {
    const time = Number(k.active_min) > 0 ? t(`, spolu ${fmtMinutes(k.active_min, lang)} aktívnej práce`, `, ${fmtMinutes(k.active_min, lang)} of active use in total`) : "";
    out.push(t(`Aktivita v ${active} z posledných ${days} dní${time}.`, `Active on ${active} of the last ${days} days${time}.`));
    const top = (data.sections || []).filter((s) => s.page && (s.active_min > 0 || s.visits > 0)).slice(0, 2).map((s) => pageName(s.page));
    const when = usualTimes(data.heatmap, lang);
    const bits = [];
    if (top.length) bits.push(t(`najviac ${top.join(" a ")}`, `mostly ${top.join(" and ")}`));
    if (when) bits.push(t(`zvyčajne ${when.days}, ${when.hours}`, `usually ${when.days}, ${when.hours}`));
    if (bits.length) out.push(cap(bits.join(t("; ", "; "))) + ".");
  }
  const acts = [];
  const si = Number(k.sign_ins) || 0;
  if (si) acts.push(lang === "sk" ? `${si} ${si === 1 ? "prihlásenie" : si < 5 ? "prihlásenia" : "prihlásení"}` : `${si} sign-in${si === 1 ? "" : "s"}`);
  if (Number(k.project_views)) acts.push(t(`${k.project_views}× detail projektu`, `${k.project_views} project views`));
  if (Number(k.exports)) acts.push(t(`${k.exports}× stiahnutie dát`, `${k.exports} downloads`));
  if (Number(k.ai_questions)) acts.push(t(`${k.ai_questions} otázok AI asistentovi`, `${k.ai_questions} AI questions`));
  if (acts.length) out.push(cap(acts.join(", ")) + ".");
  const tried = (data.features || []).find((f) => f.event === "checkout_started");
  const paid = data.person.has_stripe_subscription;
  if (tried && !paid) out.push(t(`Predplatenie spustené (${tried.n}×), ale predplatné zatiaľ nie je.`, `Pressed Subscribe (${tried.n}×) but has no subscription.`));
  if (data.person.analytics_consent === false) {
    out.push(t("Analytické cookies odmietnuté — stránky a kliky nevidíme, len prihlásenia, AI otázky a uložené veci.",
               "Declined analytics cookies — pages and clicks are not recorded, only sign-ins, AI questions and saved items."));
  }
  return out.join(" ");
}

export function relDays(date, now = new Date(), lang = "en") {
  const t = L(lang);
  // calendar days, not 24-hour blocks: Monday noon seen on Wednesday morning is
  // "2 days ago", not "yesterday"
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const d = Math.round((midnight(now) - midnight(date)) / 86400000);
  if (d <= 0) {
    const h = Math.floor((now - date) / 3600000);
    if (h <= 0) return t("pred chvíľou", "just now");
    return t(`pred ${h} h`, `${h} h ago`);
  }
  if (d === 1) return t("včera", "yesterday");
  if (d < 31) return t(`pred ${d} dňami`, `${d} days ago`);
  const m = Math.round(d / 30);
  return t(`pred ${m} mes.`, `${m} mo ago`);
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
