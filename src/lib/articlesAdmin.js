/**
 * The admin → Analýzy list's rules, kept out of the component so they are tested:
 * which articles a filter tab and the search box show, how many each tab counts,
 * and whether a new article's address is usable.
 */

/** The list's tabs, in order. */
export const ARTICLE_FILTERS = ["all", "published", "draft"];

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Does an article belong in the list under this tab and this search? The search
 * reads the title, standfirst and address in both languages, ignoring case and
 * accents — "kosice" finds "Košice", as anyone typing fast expects.
 */
export function articleMatches(a, filter = "all", query = "") {
  if (filter === "published" && !a.published) return false;
  if (filter === "draft" && a.published) return false;
  const q = fold(query).trim();
  if (!q) return true;
  const hay = fold([a.slug, a.title?.sk, a.title?.en, a.perex?.sk, a.perex?.en].join(" "));
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/** The number on each tab. */
export function articleCounts(articles = []) {
  const published = articles.filter((a) => a.published).length;
  return { all: articles.length, published, draft: articles.length - published };
}

/** What the address of a NEW article must be: the URL segment /analyzy/<slug>. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** null when usable, else why not: 'empty' | 'format' | 'taken'. */
export function slugProblem(slug, taken = []) {
  const s = String(slug ?? "").trim();
  if (!s) return "empty";
  if (!SLUG_RE.test(s)) return "format";
  if (taken.includes(s)) return "taken";
  return null;
}

/* ── Undo history ───────────────────────────────────────────────────────────
 * Typing used to push one history step per keystroke into a 20-step memory, so
 * ⌘Z could walk back about twenty characters — and a block deleted before a
 * sentence was typed was already out of reach. Now a burst of typing in one
 * field is ONE step (same key, under COALESCE_MS apart), structural edits
 * (add, move, delete) are always their own step, and 100 steps are kept. */

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1200;

/** { stack: [{ value, key, at }], at } → the state after recording `value`. */
export function historyPush(h, value, key = null, now = Date.now(), limit = HISTORY_LIMIT) {
  const kept = h.stack.slice(0, h.at + 1);            // a new edit drops the redo tail
  const top = kept[kept.length - 1];
  if (key && top && top.key === key && now - top.at < COALESCE_MS && kept.length > 1) {
    kept[kept.length - 1] = { value, key, at: now };
    return { stack: kept, at: kept.length - 1 };
  }
  const next = [...kept, { value, key, at: now }];
  const trimmed = next.length > limit ? next.slice(next.length - limit) : next;
  return { stack: trimmed, at: trimmed.length - 1 };
}

/* ── Blocks ─────────────────────────────────────────────────────────────── */

/** A copy of `blocks` with `block` inserted at `index` (clamped). */
export function insertBlockAt(blocks, index, block) {
  const i = Math.max(0, Math.min(index, blocks.length));
  return [...blocks.slice(0, i), block, ...blocks.slice(i)];
}

/** One line that says what a block holds — the collapsed view and the dialogs. */
export function blockSnippet(b, max = 90) {
  const pick = (v) => (v && typeof v === "object" ? (v.sk || v.en || "") : (v || ""));
  let s = "";
  if (b?.type === "bullets") s = (b.items || []).map(pick).filter(Boolean).join(" · ");
  else if (b?.type === "figure") s = pick(b.caption) || pick(b.alt) || b.src || "";
  else if (b?.type === "table") s = pick(b.caption) || (b.head?.sk || []).join(" | ");
  else s = pick(b?.text);
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/* ── Tables ─────────────────────────────────────────────────────────────────
 * The shape the public page draws (insightsView Table): `head` = { sk: [], en: [] },
 * `rows` = arrays of cells shared by both languages, a cell either a string or
 * a { sk, en } pair (a decimal mark that differs by language). Every edit keeps
 * that shape and keeps every row as wide as the table. */

export function tableWidth(b) {
  return Math.max(b.head?.sk?.length || 0, b.head?.en?.length || 0, ...(b.rows || []).map((r) => r.length), 1);
}

const pad = (arr, n, fill) => [...(arr || []), ...Array(Math.max(0, n - (arr || []).length)).fill(fill)].slice(0, n);

/** The table with every row and both headers exactly `tableWidth` wide. */
export function normalizeTable(b) {
  const n = tableWidth(b);
  return {
    ...b,
    head: { sk: pad(b.head?.sk, n, ""), en: pad(b.head?.en, n, "") },
    rows: (b.rows || []).map((r) => pad(r, n, "")),
  };
}

export function setHeadCell(b, lang, col, value) {
  const t = normalizeTable(b);
  const head = { ...t.head, [lang]: t.head[lang].map((h, i) => (i === col ? value : h)) };
  return { ...t, head };
}

/** `lang` matters only for a { sk, en } cell; a plain cell is one value for both. */
export function setCell(b, row, col, value, lang = null) {
  const t = normalizeTable(b);
  const rows = t.rows.map((r, ri) => (ri !== row ? r : r.map((c, ci) => {
    if (ci !== col) return c;
    if (c && typeof c === "object" && lang) return { ...c, [lang]: value };
    return value;
  })));
  return { ...t, rows };
}

export function addRow(b, at = null) {
  const t = normalizeTable(b);
  const i = at == null ? t.rows.length : at;
  return { ...t, rows: insertBlockAt(t.rows, i, Array(tableWidth(t)).fill("")) };
}

export function removeRow(b, row) {
  const t = normalizeTable(b);
  return { ...t, rows: t.rows.filter((_, i) => i !== row) };
}

export function moveRow(b, row, delta) {
  const t = normalizeTable(b);
  const j = row + delta;
  if (j < 0 || j >= t.rows.length) return t;
  const rows = t.rows.slice();
  [rows[row], rows[j]] = [rows[j], rows[row]];
  return { ...t, rows };
}

export function addColumn(b) {
  const t = normalizeTable(b);
  return {
    ...t,
    head: { sk: [...t.head.sk, ""], en: [...t.head.en, ""] },
    rows: t.rows.map((r) => [...r, ""]),
  };
}

export function removeColumn(b, col) {
  const t = normalizeTable(b);
  if (tableWidth(t) <= 1) return t;                 // a table keeps at least one column
  const drop = (arr) => arr.filter((_, i) => i !== col);
  return { ...t, head: { sk: drop(t.head.sk), en: drop(t.head.en) }, rows: t.rows.map(drop) };
}

/* ── Dates ──────────────────────────────────────────────────────────────────
 * The database speaks UTC; Boss reads Bratislava time. "2026-10-06T09:02:11Z"
 * was printed as "2026-10-06 09:02" — two hours off, and in a format nobody here
 * writes by hand. */

const TZ = "Europe/Bratislava";

/** "2026-10-06T09:02:11+00:00" → "6. 10. 2026 11:02" (Bratislava time). */
export function formatStamp(iso) {
  if (!iso) return "";
  // The API prints "2026-10-06 09:02:11.5+00": a space and an hour-only offset,
  // neither of which Date accepts.
  const d = new Date(String(iso).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${Number(p.day)}. ${Number(p.month)}. ${p.year} ${p.hour}:${p.minute}`;
}

/** "2026-09-30" → "30. 9. 2026" — a calendar date, no time zone involved. */
export function formatDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : String(day || "");
}
