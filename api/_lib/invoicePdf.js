/**
 * invoicePdf — the invoice Kamhal & Co. issues for a Residata subscription (2026-10-08).
 *
 * Boss, 8 Oct 2026, looking at the invoices we send: "why is it different for Residata and for
 * KamhalCo? completely different, a different system, everything different — both go through
 * Stripe … and the design and the texts: total trash." Until today the customer got Stripe's own
 * invoice template, set up differently on the two Stripe accounts: English labels on a Slovak
 * company's document, "€x due … Pay online" printed on an invoice that was already paid, and our
 * internal coupon name on the face of the document.
 *
 * Now Stripe stays the source of the NUMBERS (invoice number, amounts, period, buyer — a finalized
 * Stripe invoice never changes) and we draw the document ourselves. Three layers:
 *
 *   model(inv, …)   Stripe invoice → what the invoice says (dates in Bratislava time)
 *   layout(model)   model → a list of drawing commands (text, rect, line, page) — PURE
 *   render(ops)     commands → PDF bytes (pdf-lib)
 *
 * 🔴 ONE INVOICE FOR BOTH PRODUCTS. `layout` is, line for line, `faktura_pdf.rozloz` in faktury-mvp,
 * and both measure text with the same glyph-width table (./invoiceFonts.js ← faktury-mvp/fonts/).
 * ./__fixtures__/faktura_vzor.json is the SAME file in both repositories; the test checks that this
 * `layout` reproduces it exactly. Change the layout on one side only and that test goes red.
 *
 * 🔴 VAT. A VAT payer's invoice needs base, rate and tax and is called a tax document — this
 * template cannot do that. While the company is not VAT-registered (company.js `isVatRegistered`)
 * it says so; once that changes, `model` REFUSES (no document beats a document with a false VAT
 * sentence) and the e-mail falls back to Stripe's PDF until the template learns VAT.
 */
import { COMPANY, isVatRegistered, registrationLine } from "../../src/lib/company.js";
import { METRICS as FONT_METRICS } from "./invoiceFonts.js";

export class InvoiceUnavailable extends Error {}

export const BRANDS = {
  kamhalco: { meno: "Kamhal & Co.", znak: "K", farba: "#103a5e", znak_farba: "#ffffff",
    nazov_farba: "#103a5e", web: "kamhalco.eu", email: "info@kamhalco.eu" },
  residata: { meno: "Residata", znak: "R", farba: "#00e5a0", znak_farba: "#0a0a0b",
    nazov_farba: "#0a0a0b", web: "residata.eu", email: "info@residata.eu" },
};

export const TEXTS = {
  sk: {
    faktura: "Faktúra", cislo: "č.", dodavatel: "Dodávateľ", odberatel: "Odberateľ",
    vystavena: "Dátum vystavenia", dodanie: "Dátum dodania", splatnost: "Dátum splatnosti",
    forma: "Forma úhrady",
    popis: "Popis", mnozstvo: "Množstvo", cena: "Cena", spolu: "Spolu", obdobie: "Obdobie",
    medzisucet: "Medzisúčet", zlava: "Zľava", zostatok: "Uplatnený zostatok na účte",
    celkom: "Celkom", k_platbe: "K úhrade", uhradene: "Uhradené {d}", uhradene_bez: "Uhradené",
    k_uhrade: "Zostáva uhradiť",
    sposoby: { card: "Platobná karta", link: "Link", sepa_debit: "SEPA inkaso", paypal: "PayPal",
      revolut_pay: "Revolut Pay", bank_transfer: "Bankový prevod", customer_balance: "Bankový prevod",
      zostatok: "Zostatok na účte", ina: "Iná", online: "Online platba", ziadna: "—" },
    stav: { paid: "Uhradená", open: "Na úhradu", void: "Stornovaná", uncollectible: "Neuhradená" },
    dph: "Dodávateľ nie je platiteľom DPH.",
    predplatne: "Predplatné {p}", nevyuzite: "Nevyužitá časť – {p}", pomerne: "Pomerná časť – {p}",
  },
  en: {
    faktura: "Invoice", cislo: "No.", dodavatel: "Supplier", odberatel: "Bill to",
    vystavena: "Issue date", dodanie: "Supply date", splatnost: "Due date",
    forma: "Payment method",
    popis: "Description", mnozstvo: "Qty", cena: "Unit price", spolu: "Amount", obdobie: "Period",
    medzisucet: "Subtotal", zlava: "Discount", zostatok: "Applied account balance",
    celkom: "Total", k_platbe: "Amount due", uhradene: "Paid on {d}", uhradene_bez: "Paid",
    k_uhrade: "Amount remaining",
    sposoby: { card: "Card", link: "Link", sepa_debit: "SEPA Direct Debit", paypal: "PayPal",
      revolut_pay: "Revolut Pay", bank_transfer: "Bank transfer", customer_balance: "Bank transfer",
      zostatok: "Account balance", ina: "Other", online: "Online payment", ziadna: "—" },
    stav: { paid: "Paid", open: "Due", void: "Void", uncollectible: "Unpaid" },
    dph: "The supplier is not registered for VAT.",
    predplatne: "{p} subscription", nevyuzite: "Unused time – {p}", pomerne: "Remaining time – {p}",
  },
};

const COUNTRIES = {
  sk: { SK: "Slovenská republika", CZ: "Česká republika", AT: "Rakúsko", DE: "Nemecko", HU: "Maďarsko",
    PL: "Poľsko", GB: "Spojené kráľovstvo", US: "Spojené štáty", IE: "Írsko", NL: "Holandsko",
    FR: "Francúzsko", IT: "Taliansko", ES: "Španielsko", BE: "Belgicko", LU: "Luxembursko",
    DK: "Dánsko", SE: "Švédsko", FI: "Fínsko", PT: "Portugalsko", GR: "Grécko", SI: "Slovinsko",
    HR: "Chorvátsko", RO: "Rumunsko", BG: "Bulharsko", EE: "Estónsko", LV: "Lotyšsko",
    LT: "Litva", CY: "Cyprus", MT: "Malta", CH: "Švajčiarsko", NO: "Nórsko", UA: "Ukrajina" },
  en: { SK: "Slovakia", CZ: "Czech Republic", AT: "Austria", DE: "Germany", HU: "Hungary",
    PL: "Poland", GB: "United Kingdom", US: "United States", IE: "Ireland", NL: "Netherlands",
    FR: "France", IT: "Italy", ES: "Spain", BE: "Belgium", LU: "Luxembourg", DK: "Denmark",
    SE: "Sweden", FI: "Finland", PT: "Portugal", GR: "Greece", SI: "Slovenia", HR: "Croatia",
    RO: "Romania", BG: "Bulgaria", EE: "Estonia", LV: "Latvia", LT: "Lithuania", CY: "Cyprus",
    MT: "Malta", CH: "Switzerland", NO: "Norway", UA: "Ukraine" },
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Unix seconds → "YYYY-MM-DD" in Bratislava (an invoice paid at 0:30 belongs to that day). */
function day(ts) {
  if (!ts) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Number(ts) * 1000));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// ─── 1. model ──────────────────────────────────────────────────────────────
const isProration = (l) => {
  const det = l?.parent?.subscription_item_details || {};
  return Boolean("proration" in det ? det.proration : l?.proration);
};

function productName(l, products) {
  let pid = l?.pricing?.price_details?.product ?? (l?.price && typeof l.price === "object" ? l.price.product : null);
  if (pid && typeof pid === "object") return pid.name || null;
  if (pid && products && products[pid]) return products[pid];
  // fallback: Stripe's line text ("1 × Residata Premium (at €279.99 / month)",
  // "Unused time on Residata Premium after 08 Oct 2026")
  const d = l?.description || "";
  const m = d.match(/^\s*\d+\s*×\s*(.+?)\s*(?:\(|$)/) || d.match(/time on (.+?) after /);
  return m ? m[1] : null;
}

function unitPrice(l) {
  let dec = l?.pricing?.unit_amount_decimal;
  if (dec == null && l?.price && typeof l.price === "object") dec = l.price.unit_amount_decimal ?? l.price.unit_amount;
  const q = Number(l?.quantity || 1) || 1;
  if (dec != null && !isProration(l)) return Math.floor(Number(dec) + 0.5);
  const a = Number(l?.amount || 0);
  return a % q === 0 ? a / q : null;          // 3 pcs for −10,01 € have no per-unit price in cents
}

const PAYMENT_TYPES = ["card", "link", "sepa_debit", "paypal", "revolut_pay", "bank_transfer", "customer_balance"];

/** How it was (or will be) paid — the payment method type `loadInvoice` adds (`_sposob_uhrady`).
 *  Nothing charged → the account balance or "—"; unknown → "Online payment", never an invented card. */
function paymentMethod(inv, zostatok) {
  if (inv.paid_out_of_band) return "ina";
  const typ = inv._sposob_uhrady;
  if (Number(inv.amount_paid || 0) > 0 || inv.status !== "paid") return PAYMENT_TYPES.includes(typ) ? typ : "online";
  return zostatok < 0 ? "zostatok" : "ziadna";
}

/** The first character the invoice font lacks (Cyrillic, emoji…), or null. */
function missingChar(texts) {
  for (const t of texts) {
    for (const c of String(t ?? "")) {
      const k = String(c.codePointAt(0));
      if (!(k in METRICS.r) || !(k in METRICS.b)) return c;
    }
  }
  return null;
}

/** Was the company a VAT payer on that day? (COMPANY.vatFrom "YYYY-MM-DD" — set it when registering:
 *  an invoice issued BEFORE the registration stays a non-payer's invoice.) */
const vatPayerOn = (d) => isVatRegistered() && !(COMPANY.vatFrom && d && d < COMPANY.vatFrom);

const couponOf = (d) => {
  const c = d?.coupon || d?.source?.coupon;
  return c && typeof c === "object" ? c : {};
};

/** The supplier from company.js — Residata's single source of company facts (KamhalCo: firma.py). */
export function supplier(lang = "sk") {
  const sk = lang === "sk";
  const reg = registrationLine(lang);
  const cisla = [[sk ? "IČO" : "Company ID", COMPANY.ico]];
  if (COMPANY.dic) cisla.push([sk ? "DIČ" : "Tax ID", COMPANY.dic]);
  if (COMPANY.icDph) cisla.push([sk ? "IČ DPH" : "VAT ID", COMPANY.icDph]);
  return {
    nazov: COMPANY.legalName,
    riadky: [COMPANY.street, `${COMPANY.postalCode} ${sk ? COMPANY.citySk : COMPANY.cityEn}`, sk ? COMPANY.countrySk : COMPANY.countryEn],
    cisla,
    register: `${COMPANY.legalName}, ${reg.slice(0, 1).toLowerCase()}${reg.slice(1)}`,
  };
}

/** The postal code as written in Slovakia and Czechia ("811 01"); Stripe returns what the customer typed. */
function psc(code, kraj) {
  const s = String(code ?? "").trim();
  const bare = s.replace(/ /g, "");
  return (kraj === "SK" || kraj === "CZ") && /^\d{5}$/.test(bare) ? `${bare.slice(0, 3)} ${bare.slice(3)}` : s;
}

export function model(inv, { brand = "residata", products = null, lang = "sk", dodavatel = null } = {}) {
  const T = TEXTS[lang];
  if (!inv?.number || !inv?.status || inv.status === "draft") throw new InvoiceUnavailable("invoice not finalized (draft without a number)");
  const tr = inv.status_transitions || {};
  const vystavena = day(tr.finalized_at || inv.created);
  if (vatPayerOn(vystavena)) throw new InvoiceUnavailable("VAT-registered — the template has no VAT breakdown (see header)");
  if ((inv.total_taxes || []).some((t) => Number(t?.amount || 0)) || Number(inv.tax || 0)) throw new InvoiceUnavailable("tax on the invoice — no VAT breakdown in the template");
  if (String(inv.currency || "eur").toLowerCase() !== "eur") throw new InvoiceUnavailable("the invoice is not in euro");
  if (Number(inv.total || 0) < 0) throw new InvoiceUnavailable("negative invoice (a credit to the balance) — the template is an invoice only");
  const lines = inv.lines?.data || [];
  const polozky = [];
  let dodanie = null;
  for (const l of lines) {
    const meno = productName(l, products);
    const amount = Number(l.amount || 0);
    const per = l.period || {};
    const obdobie = per.start && per.end && per.start !== per.end ? [day(per.start), day(per.end)] : null;
    let popis;
    if (!meno) popis = l.description || "—";
    else if (isProration(l)) popis = (amount < 0 ? T.nevyuzite : T.pomerne).replace("{p}", meno);
    else if ((l.parent?.type || "subscription_item_details") === "subscription_item_details") {
      popis = T.predplatne.replace("{p}", meno);
      if (obdobie && !dodanie) dodanie = obdobie[0];
    } else popis = l.description || meno;
    polozky.push({ popis, obdobie, mnozstvo: Number(l.quantity || 1), cena: unitPrice(l), spolu: amount });
  }

  // discounts: the amount from the invoice, the percentage from the coupon — NEVER the coupon's
  // name (it is our internal label; on 7 Oct 2026 it was printed on KamhalCo's invoice)
  const byId = Object.fromEntries((inv.discounts || []).filter((d) => d && typeof d === "object").map((d) => [d.id, d]));
  const zlavy = [];
  for (const tda of inv.total_discount_amounts || []) {
    const s = Number(tda.amount || 0);
    if (!s) continue;
    const did = typeof tda.discount === "string" ? tda.discount : tda.discount?.id;
    const kup = couponOf(byId[did] || (tda.discount && typeof tda.discount === "object" ? tda.discount : {}));
    const pct = kup.percent_off;
    zlavy.push({ percent: pct == null ? null : Number(pct), suma: s });
  }

  const total = Number(inv.total || 0);
  const amountDue = inv.amount_due != null ? Number(inv.amount_due) : total;
  const stav = inv.status;
  const adr = inv.customer_address || {};
  const kraj = adr.country;
  const odbRiadky = [adr.line1, adr.line2, [psc(adr.postal_code, kraj), adr.city].filter(Boolean).join(" "),
    kraj ? (COUNTRIES[lang][kraj] || kraj) : null].filter(Boolean);
  const odbCisla = [];
  for (const cf of inv.custom_fields || []) {
    if (/i[cč]o|company/i.test(String(cf?.name || "")) && cf?.value) odbCisla.push([lang === "sk" ? "IČO" : "Company ID", String(cf.value).trim()]);
  }
  for (const t of inv.customer_tax_ids || []) {
    if (t?.value) {
      const nazov = String(t.type || "").endsWith("_vat") ? (lang === "sk" ? "IČ DPH" : "VAT ID") : (lang === "sk" ? "DIČ" : "Tax ID");
      odbCisla.push([nazov, String(t.value).trim()]);
    }
  }

  const zostatok = amountDue - total;
  const odberatel = { nazov: inv.customer_name || inv.customer_email || "—", riadky: odbRiadky, cisla: odbCisla, email: inv.customer_email || "" };
  // no invoice at all (the caller sends Stripe's PDF) beats a buyer's name full of question marks
  const bad = missingChar([odberatel.nazov, odberatel.email, ...odbRiadky, ...odbCisla.map(([, v]) => v), ...polozky.map((p) => p.popis)]);
  if (bad !== null) throw new InvoiceUnavailable(`the invoice font has no ${JSON.stringify(bad)}`);

  return {
    lang,
    znacka: { ...BRANDS[brand] },
    cislo: inv.number,
    stav: T.stav[stav] ? stav : "open",
    vystavena,
    dodanie: dodanie || vystavena,
    splatnost: day(inv.due_date) || vystavena,
    uhradena: stav === "paid" ? day(tr.paid_at) : null,
    dodavatel: dodavatel || supplier(lang),
    odberatel,
    sposob: paymentMethod(inv, zostatok),
    polozky,
    medzisucet: Number(inv.subtotal || 0),
    zlavy,
    celkom: total,
    zostatok,                       // − credit from the balance, + debt carried over (Stripe: amount_due − total)
    k_platbe: amountDue,
    uhradene: Number(inv.amount_paid || 0),
    k_uhrade: stav === "void" ? 0 : Number(inv.amount_remaining || 0),
    mena: String(inv.currency || "eur").toLowerCase(),
  };
}

// ─── 2. layout ─────────────────────────────────────────────────────────────
// Points, A4, coordinates from the TOP (y grows downwards; for text, y is the baseline).
const W = 595.28, H = 841.89, M = 48, R = W - M;
const INK = "#0c1622", MUTED = "#5b6577", LINE = "#e6ebf0", LINE2 = "#c9d1da", BOX = "#f6f8fa";
const PILL = { paid: ["#e4f3ec", "#0f6b4f"], open: ["#fff4e0", "#8a5300"], void: ["#f1f3f5", "#5b6577"], uncollectible: ["#fde8e7", "#a3201a"] };

const METRICS = FONT_METRICS;
/** Kept for callers from before the metrics were a static import. */
export async function loadMetrics() {
  return METRICS;
}

/** Rounding to hundredths exactly as faktura_pdf._r2 (Python's round() is banker's rounding). */
const r2 = (x) => Math.floor(x * 100 + 0.5) / 100;

function clean(text) {
  const tab = METRICS.r;
  let out = "";
  for (const c of String(text)) out += String(c.codePointAt(0)) in tab ? c : "?";
  return out;
}

export function width(text, size, face = "r") {
  const tab = METRICS[face];
  let units = 0;
  for (const c of String(text)) units += tab[String(c.codePointAt(0))] ?? tab["63"];
  return units * size / METRICS.upm;
}

/** Word wrap (a long word by characters). Same algorithm as faktura_pdf.zalom. */
export function wrap(text, size, face, maxWidth) {
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (let s of words) {
    const tryLine = cur === "" ? s : `${cur} ${s}`;
    if (width(tryLine, size, face) <= maxWidth) { cur = tryLine; continue; }
    if (cur !== "") lines.push(cur);
    cur = "";
    let chars = Array.from(s);
    while (width(chars.join(""), size, face) > maxWidth && chars.length > 1) {
      let n = chars.length;
      while (n > 1 && width(chars.slice(0, n).join(""), size, face) > maxWidth) n -= 1;
      lines.push(chars.slice(0, n).join(""));
      chars = chars.slice(n);
    }
    s = chars.join("");
    cur = s;
  }
  if (cur !== "" || !lines.length) lines.push(cur);
  return lines;
}

const group = (n, sep) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);

export function money(cents, currency, lang) {
  const c = Math.trunc(Number(cents));
  const sign = c < 0 ? "−" : "";
  const whole = Math.floor(Math.abs(c) / 100), rest = Math.abs(c) % 100;
  const m = String(currency || "eur").toLowerCase();
  if (lang === "sk") return `${sign}${group(whole, "\u00a0")},${String(rest).padStart(2, "0")}\u00a0${m === "eur" ? "€" : m.toUpperCase()}`;
  return `${sign}${m === "eur" ? "€" : `${m.toUpperCase()}\u00a0`}${group(whole, ",")}.${String(rest).padStart(2, "0")}`;
}

export function date(iso, lang) {
  if (!iso) return "—";
  const [r, m, d] = iso.split("-").map(Number);
  return lang === "sk" ? `${d}. ${m}. ${r}` : `${d} ${MONTHS_EN[m - 1]} ${r}`;
}

/** Model → commands. Requires loadMetrics() to have run. */
export function layout(m) {
  const L = TEXTS[m.lang];
  const lang = m.lang;
  const z = m.znacka;
  const ops = [];

  const text = (x, y, v, face, color, t) => ops.push({ op: "text", x: r2(x), y: r2(y), size: v, font: face, color, text: clean(t) });
  const right = (x, y, v, face, color, t) => text(x - width(clean(t), v, face), y, v, face, color, t);
  const rect = (x, y, w, h, r, fill) => ops.push({ op: "rect", x: r2(x), y: r2(y), w: r2(w), h: r2(h), r, fill });
  const line = (x1, y1, x2, color = LINE, w = 0.75) => ops.push({ op: "line", x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y1), color, width: w });

  const footer = () => {
    const yf = H - 92;
    line(M, yf, R);
    text(M, yf + 20, 8.5, "b", INK, L.dph);
    let y = yf + 34;
    for (const row of wrap(clean(m.dodavatel.register || ""), 8, "r", R - M)) {
      text(M, y, 8, "r", MUTED, row);
      y += 11;
    }
    text(M, y, 8, "r", MUTED, `${z.email}  ·  ${z.web}`);
  };

  // ── header ──
  rect(0, 0, W, 4, 0, z.farba);
  rect(M, 44, 26, 26, 6, z.farba);
  text(M + 13 - width(z.znak, 14, "b") / 2, 62.5, 14, "b", z.znak_farba, z.znak);
  text(M + 36, 62, 15, "b", z.nazov_farba, z.meno);
  right(R, 62, 20, "b", INK, L.faktura);
  right(R, 79, 9.5, "r", MUTED, `${L.cislo} ${m.cislo}`);
  const st = L.stav[m.stav];
  const pw = width(st, 8, "b") + 16;
  const [pillBg, pillFg] = PILL[m.stav];
  rect(R - pw, 88, pw, 17, 8.5, pillBg);
  text(R - pw + 8, 99.6, 8, "b", pillFg, st);
  line(M, 128, R);

  // ── supplier / customer ──
  const party = (x, y, heading, s) => {
    const sw = 230;
    text(x, y, 7, "b", MUTED, heading.toUpperCase());
    y += 17;
    for (const row of wrap(clean(s.nazov), 10.5, "b", sw)) { text(x, y, 10.5, "b", INK, row); y += 14; }
    y += 1;
    for (const r of s.riadky) for (const row of wrap(clean(r), 9.5, "r", sw)) { text(x, y, 9.5, "r", INK, row); y += 13.5; }
    if (s.cisla && s.cisla.length) {
      y += 4;
      const indent = Math.max(46, ...s.cisla.map(([k]) => width(clean(`${k}:`), 9.5, "r") + 8));
      for (const [k, v] of s.cisla) {
        text(x, y, 9.5, "r", MUTED, `${k}:`);
        text(x + indent, y, 9.5, "r", INK, v);
        y += 13.5;
      }
    }
    if (s.email) {
      y += 4;
      for (const row of wrap(clean(s.email), 9.5, "r", sw)) { text(x, y, 9.5, "r", MUTED, row); y += 13.5; }
    }
    return y;
  };
  const yl = party(M, 152, L.dodavatel, m.dodavatel);
  const yr = party(M + 262, 152, L.odberatel, m.odberatel);
  let y = Math.max(yl, yr) + 14;

  // ── dates ──
  rect(M, y, R - M, 48, 6, BOX);
  const cells = [[L.vystavena, date(m.vystavena, lang)], [L.dodanie, date(m.dodanie, lang)],
    [L.splatnost, date(m.splatnost, lang)], [L.forma, L.sposoby[m.sposob]]];
  const cw = (R - M) / 4;
  cells.forEach(([heading, value], i) => {
    const x = M + 14 + i * cw;
    text(x, y + 19, 7, "b", MUTED, heading.toUpperCase());
    text(x, y + 35, 10, "b", INK, value);
  });
  y += 48 + 32;

  // ── items ──
  const xq = R - 200, xc = R - 100;
  const itemsHeader = (y0) => {
    text(M, y0, 7, "b", MUTED, L.popis.toUpperCase());
    right(xq, y0, 7, "b", MUTED, L.mnozstvo.toUpperCase());
    right(xc, y0, 7, "b", MUTED, L.cena.toUpperCase());
    right(R, y0, 7, "b", MUTED, L.spolu.toUpperCase());
    line(M, y0 + 8, R, LINE2);
    return y0 + 8;
  };
  /** Continued on the next page: the footer here, the invoice number there (no page without it). */
  const newPage = () => {
    footer();
    ops.push({ op: "page" });
    text(M, 40, 8.5, "r", MUTED, `${L.faktura} ${L.cislo} ${m.cislo}`);
    return 66;
  };
  y = itemsHeader(y);
  for (const p of m.polozky) {
    const rows = wrap(clean(p.popis), 10, "r", xq - 60 - M);
    const h = 20 + (rows.length - 1) * 13 + (p.obdobie ? 14 : 0) + 12;
    if (y + h > H - 250) y = itemsHeader(newPage());
    const yb = y + 20;
    rows.forEach((row, i) => text(M, yb + i * 13, 10, "r", INK, row));
    right(xq, yb, 10, "r", INK, String(p.mnozstvo));
    right(xc, yb, 10, "r", INK, p.cena === null ? "—" : money(p.cena, m.mena, lang));
    right(R, yb, 10, "r", INK, money(p.spolu, m.mena, lang));
    let yy = yb + (rows.length - 1) * 13;
    if (p.obdobie) {
      yy += 14;
      text(M, yy, 8.5, "r", MUTED, `${L.obdobie} ${date(p.obdobie[0], lang)} – ${date(p.obdobie[1], lang)}`);
    }
    y = yy + 12;
    line(M, y, R);
  }

  // ── totals — in Stripe's order: subtotal, discounts, TOTAL, applied balance, amount due, paid,
  //    remaining. (Until 9 Oct 2026 the balance sat ABOVE "Total" and the sums did not add up.)
  const xl = R - 230;
  const rows = [[L.medzisucet, m.medzisucet]];
  for (const zl of m.zlavy) {
    const pct = zl.percent;
    const heading = pct == null ? L.zlava : lang === "sk" ? `${L.zlava} ${String(pct).replace(".", ",")}\u00a0%` : `${L.zlava} ${pct}%`;
    rows.push([heading, -zl.suma]);
  }
  const need = 24 + 18 * rows.length + 32 + (m.zostatok ? 36 : 0) + (m.uhradene > 0 ? 18 : 0);
  if (y + need > H - 110) y = newPage();     // the totals must not run into the footer → all on the next page
  y += 24;
  for (const [heading, value] of rows) {
    text(xl, y, 9.5, "r", MUTED, heading);
    right(R, y, 9.5, "r", INK, money(value, m.mena, lang));
    y += 18;
  }
  line(xl, y - 8, R, LINE2);
  y += 10;
  text(xl, y, 11.5, "b", INK, L.celkom);
  right(R, y, 11.5, "b", INK, money(m.celkom, m.mena, lang));
  y += 22;
  if (m.zostatok) {
    text(xl, y, 9.5, "r", MUTED, L.zostatok);
    right(R, y, 9.5, "r", INK, money(m.zostatok, m.mena, lang));
    y += 18;
    text(xl, y, 9.5, "r", MUTED, L.k_platbe);
    right(R, y, 9.5, "r", INK, money(m.k_platbe, m.mena, lang));
    y += 18;
  }
  if (m.uhradene > 0) {
    text(xl, y, 9.5, "r", MUTED, m.uhradena ? L.uhradene.replace("{d}", date(m.uhradena, lang)) : L.uhradene_bez);
    right(R, y, 9.5, "r", INK, money(-m.uhradene, m.mena, lang));
    y += 18;
  }
  text(xl, y, 10, "b", INK, L.k_uhrade);
  right(R, y, 10, "b", INK, money(m.k_uhrade, m.mena, lang));

  footer();
  return ops;
}

// ─── 3. PDF ────────────────────────────────────────────────────────────────
const rgbOf = (h, rgb) => {
  const s = h.replace("#", "");
  return rgb(parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255);
};

/** Rounded rectangle as an SVG path, origin at the rect's top-left (pdf-lib draws SVG y-down). */
function roundedPath(w, h, r) {
  if (!r) return `M0,0 H${w} V${h} H0 Z`;
  r = Math.min(r, w / 2, h / 2);
  return `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 0,${h - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
}

export async function render(ops, { title = "", author = "" } = {}) {
  const [{ PDFDocument, rgb }, fontkit, fonts] = await Promise.all([
    import("pdf-lib"), import("@pdf-lib/fontkit").then((m) => m.default || m), import("./invoiceFonts.js")]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const opts = { subset: true, features: { liga: false, calt: false, kern: false } };
  const face = {
    r: await doc.embedFont(Buffer.from(fonts.INTER_REGULAR_B64, "base64"), opts),
    b: await doc.embedFont(Buffer.from(fonts.INTER_SEMIBOLD_B64, "base64"), opts),
  };
  let page = doc.addPage([W, H]);
  for (const o of ops) {
    if (o.op === "page") page = doc.addPage([W, H]);
    else if (o.op === "rect") page.drawSvgPath(roundedPath(o.w, o.h, o.r), { x: o.x, y: H - o.y, color: rgbOf(o.fill, rgb), borderWidth: 0 });
    else if (o.op === "line") page.drawLine({ start: { x: o.x1, y: H - o.y1 }, end: { x: o.x2, y: H - o.y2 }, thickness: o.width, color: rgbOf(o.color, rgb) });
    else if (o.op === "text") page.drawText(o.text, { x: o.x, y: H - o.y, size: o.size, font: face[o.font], color: rgbOf(o.color, rgb) });
  }
  doc.setTitle(title); doc.setAuthor(author); doc.setCreator(author); doc.setProducer(author);
  return Buffer.from(await doc.save());
}

/** Stripe invoice → { pdf: Buffer, number }. Throws InvoiceUnavailable when it cannot be drawn truthfully. */
export async function invoicePdf(inv, { brand = "residata", products = null, lang = "sk" } = {}) {
  await loadMetrics();
  const m = model(inv, { brand, products, lang });
  return { pdf: await render(layout(m), { title: `${TEXTS[lang].faktura} ${m.cislo}`, author: COMPANY.legalName }), number: m.cislo };
}

/**
 * Load a Stripe invoice the way the template needs it — coupon (for the percentage), product
 * names of the lines, and the buyer's IČO from the customer when the invoice predates it (the FIRST
 * invoice is created during checkout, before the webhook copies the IČO onto the customer).
 */
const hasIco = (inv) => (inv.custom_fields || []).some((c) => /i[cč]o|company/i.test(String(c?.name || "")) && c?.value);

/** The IČO the buyer typed at checkout (custom field `companyid`, text or numeric), or null. */
export function icoFromSession(session) {
  for (const f of session?.custom_fields || []) {
    if (f?.key === "companyid") return String(f.numeric?.value || f.text?.value || "").trim() || null;
  }
  return null;
}

/** A Stripe or network outage — worth retrying (the webhook answers 500, Stripe redelivers). Anything
 *  else is a fault of the invoice: the caller sends Stripe's PDF (a true document) and says so. */
export function isTransient(e) {
  if (!e) return false;
  if (["StripeConnectionError", "StripeRateLimitError"].includes(e.type)) return true;
  if (e.type === "StripeAPIError" && Number(e.statusCode || 500) >= 500) return true;
  return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(e.code) || e.name === "AbortError";
}

export async function loadInvoice(stripe, invoiceId) {
  const inv = await stripe.invoices.retrieve(invoiceId, { expand: ["discounts.source.coupon"] });
  if (inv?.lines?.has_more) {
    const all = [];
    for await (const l of stripe.invoices.listLineItems(invoiceId, { limit: 100 })) all.push(l);
    inv.lines = { data: all };
  }
  if (!hasIco(inv) && typeof inv.customer === "string") {
    try {
      const c = await stripe.customers.retrieve(inv.customer);
      inv.custom_fields = [...(inv.custom_fields || []), ...((c?.invoice_settings?.custom_fields) || [])];
    } catch { /* an invoice without the buyer's IČO beats no invoice */ }
  }
  // …and when it is not on the customer YET (the checkout webhook comes later — review 9 Oct 2026:
  // the welcome e-mail's invoice went out without it), straight from the subscription's checkout
  const sub = inv?.parent?.subscription_details?.subscription;
  if (!hasIco(inv) && inv.billing_reason === "subscription_create" && typeof sub === "string" && stripe.checkout?.sessions?.list) {
    try {
      for await (const s of stripe.checkout.sessions.list({ subscription: sub, limit: 3 })) {
        const ico = icoFromSession(s);
        if (ico) { inv.custom_fields = [...(inv.custom_fields || []), { name: "IČO", value: ico }]; break; }
      }
    } catch { /* as above */ }
  }
  // how it was paid: the payment method type of the actual payment (card, SEPA, Link…) — not "card" by default
  if (Number(inv.amount_paid || 0) > 0 && !inv.paid_out_of_band && stripe.invoicePayments?.list) {
    try {
      for await (const p of stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 })) {
        if (p?.status !== "paid") continue;
        let pi = p?.payment?.payment_intent;
        pi = pi && typeof pi === "object" ? pi.id : pi;
        if (pi) {
          const intent = await stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] });
          inv._sposob_uhrady = intent?.latest_charge?.payment_method_details?.type || null;
          break;
        }
      }
    } catch { /* unknown → "Online payment", not an invented card */ }
  }
  const products = {};
  for (const l of inv.lines?.data || []) {
    const pid = l?.pricing?.price_details?.product;
    if (typeof pid === "string" && !(pid in products)) {
      try { products[pid] = (await stripe.products.retrieve(pid))?.name || null; } catch { products[pid] = null; }
    }
  }
  return { inv, products };
}
