/**
 * company — THE single source of truth for who legally operates Residata.
 *
 * Every surface that names the operator reads from here: the Imprint, the Terms
 * (contracting party), the Privacy policy (data controller), the site footer,
 * the structured data in index.html, and — once it exists — invoicing. There is
 * no second place where a company detail is written down, so the six surfaces
 * cannot drift apart, and a change is a one-line edit here.
 *
 * ─── THE EMPTY FIELDS ARE DELIBERATE ────────────────────────────────────────
 * `dic`, `icDph`, `iban` and `bankName` are empty strings on purpose. They are
 * facts that do not exist yet:
 *
 *   dic     — the tax office issues it within 60 days of incorporation
 *   icDph   — issued on VAT registration (§ 7a first, § 4 at the turnover
 *             threshold); we are NOT VAT-registered today
 *   iban    — the company bank account is not open yet
 *
 * Every renderer below treats an empty field as "do not display this line".
 * The moment a value is filled in here, it appears everywhere it belongs AND
 * the VAT wording across the site flips by itself (see vatNotice). That is the
 * point: the site is built as a fully-equipped company site, and the fields
 * light up as reality catches up — without anyone claiming something untrue in
 * the meantime. Never fill one of these in "in advance": a website that
 * announces a VAT number it does not have is a tax problem, not a shortcut.
 *
 * ─── SOURCE OF THE DATA ─────────────────────────────────────────────────────
 * Everything below is copied from the company's own entry in the Slovak
 * Commercial Register (orsr.sk, IČO 57849471, read 2026-09-03 — the day of
 * incorporation). It is not typed from memory. If any of it is ever edited,
 * check it against the register first.
 *
 * § 3a of the Commercial Code requires a registered company to state, on its
 * website: business name, registered seat, legal form, IČO, and the register
 * together with the section and insert number. `statutoryWebsiteData()` returns
 * exactly that set, which is why the Imprint renders from it rather than from
 * hand-written lines someone could quietly drop.
 */

export const COMPANY = {
  // ── identity (Commercial Register) ──────────────────────────────────────
  legalName: "Kamhal & Co. s. r. o.",
  tradeName: "Residata",
  legalFormSk: "Spoločnosť s ručením obmedzeným",
  legalFormEn: "Limited liability company (s. r. o.)",

  // ── registered seat ─────────────────────────────────────────────────────
  street: "Krasovského 13",
  postalCode: "851 01",
  citySk: "Bratislava – mestská časť Petržalka",
  cityEn: "Bratislava – Petržalka",
  countrySk: "Slovenská republika",
  countryEn: "Slovak Republic",
  countryCode: "SK",

  // ── identifiers ─────────────────────────────────────────────────────────
  ico: "57 849 471",        // display form, with the customary spacing
  icoPlain: "57849471",     // machine form — structured data, APIs, invoices
  dic: "",                  // ← tax office, ≤ 60 days from incorporation
  icDph: "",                // ← on VAT registration; empty = not VAT-registered

  // ── register entry ──────────────────────────────────────────────────────
  registerSk: "Obchodný register Mestského súdu Bratislava III",
  // Slovak needs the locative here ("zapísaná v Obchodnom registri…"), and no
  // amount of string-joining produces it from the nominative above.
  registerSkLocative: "Obchodnom registri Mestského súdu Bratislava III",
  registerEn: "Commercial Register of the Municipal Court Bratislava III",
  registerSection: "Sro",
  registerInsert: "203519/B",
  incorporatedOn: "2026-09-03",

  // ── people and contact ──────────────────────────────────────────────────
  director: "Tomáš Kamhal",
  email: "info@residata.eu",
  privacyEmail: "info@residata.eu",
  phone: "+421 911 963 909",
  phoneHref: "+421911963909",

  // ── banking ─────────────────────────────────────────────────────────────
  // 🔴 THE BANK ACCOUNT IS DELIBERATELY NOT HERE, and must never be added.
  // This file is imported by the React app, so anything in it is bundled into
  // the browser and downloadable by anyone — and this repository is PUBLIC, so
  // it would also be permanent in git history. A published account number is
  // the raw material for invoice-redirection fraud: someone copies our invoice
  // layout, swaps the number, and emails "your invoice" to our customers.
  //
  // The IBAN lives in public.app_secrets (RLS on, ZERO policies, so no client
  // can read it) and is fetched server-side by the Stripe webhook when it
  // writes the supplier block onto an invoice. See bankDetailsFromSecrets()
  // in api/stripe.js.

  /**
   * How the displayed price relates to VAT ONCE `icDph` is filled in. Until
   * then it is unused, because a non-VAT-registered company charges no VAT.
   *
   *   "gross" — the price shown already includes VAT (the customer keeps
   *             paying the same number; our margin absorbs the tax)
   *   "net"   — the price shown is before VAT, and VAT is added at checkout
   *             (the customer's total goes UP by the VAT rate)
   *
   * This is a commercial decision, not a technical one, which is why it is an
   * explicit setting rather than something the code guesses on the day the
   * VAT number lands.
   */
  pricesVatMode: "gross",

  /** Slovak VAT rate, for the day we are registered. */
  vatRatePct: 23,
};

// ─────────────────────────────────────────────────────────────────────────
// derived views — every consumer uses these, nobody re-assembles the fields
// ─────────────────────────────────────────────────────────────────────────

/** True once the company actually holds a VAT number. Never hardcode this. */
export function isVatRegistered() {
  return Boolean(COMPANY.icDph);
}

/** The registered seat, as lines. Same order Slovak addresses are written in. */
export function addressLines(lang = "sk") {
  const isSK = lang === "sk";
  return [
    COMPANY.street,
    `${COMPANY.postalCode} ${isSK ? COMPANY.citySk : COMPANY.cityEn}`,
    isSK ? COMPANY.countrySk : COMPANY.countryEn,
  ];
}

/** One-line address, for structured data and anywhere a block won't fit. */
export function addressOneLine(lang = "sk") {
  return addressLines(lang).join(", ");
}

/**
 * The § 3a register sentence. Slovak companies write this verbatim on
 * invoices, contracts and websites, so it is assembled once, here.
 */
export function registrationLine(lang = "sk") {
  return lang === "sk"
    ? `Zapísaná v ${COMPANY.registerSkLocative}, oddiel: ${COMPANY.registerSection}, vložka č. ${COMPANY.registerInsert}`
    : `Registered in the ${COMPANY.registerEn}, section: ${COMPANY.registerSection}, insert no. ${COMPANY.registerInsert}`;
}

/**
 * Identification numbers as label/value pairs, with the ones we do not have
 * yet simply absent — never rendered as an empty row or a placeholder dash.
 */
export function identifiers(lang = "sk") {
  const isSK = lang === "sk";
  const out = [{ label: "IČO", value: COMPANY.ico }];
  if (COMPANY.dic) out.push({ label: "DIČ", value: COMPANY.dic });
  if (COMPANY.icDph) out.push({ label: "IČ DPH", value: COMPANY.icDph });
  else out.push({
    label: isSK ? "DPH" : "VAT",
    value: isSK ? "Nie sme platiteľmi DPH" : "Not registered for VAT",
  });
  return out;
}

/**
 * The sentence that tells a buyer what the price does and does not contain.
 * A business buyer assumes a price carries reclaimable VAT; today it does not.
 * When `icDph` is filled this switches by itself to the correct VAT wording
 * for whichever `pricesVatMode` was chosen.
 */
export function vatNotice(lang = "sk") {
  const isSK = lang === "sk";
  if (!isVatRegistered()) {
    return isSK
      ? "Nie sme platiteľmi DPH. Uvedená cena je konečná a neobsahuje DPH."
      : "We are not registered for VAT. The price shown is final and contains no VAT.";
  }
  if (COMPANY.pricesVatMode === "net") {
    return isSK
      ? `Uvedená cena je bez DPH. K cene sa účtuje DPH v sadzbe ${COMPANY.vatRatePct} %. Pre podnikateľov z iných členských štátov EÚ s platným IČ DPH sa uplatňuje prenesenie daňovej povinnosti.`
      : `The price shown is exclusive of VAT. VAT at ${COMPANY.vatRatePct} % is added at checkout. For businesses in other EU member states with a valid VAT number the reverse-charge mechanism applies.`;
  }
  return isSK
    ? `Uvedená cena je vrátane DPH v sadzbe ${COMPANY.vatRatePct} %. Pre podnikateľov z iných členských štátov EÚ s platným IČ DPH sa uplatňuje prenesenie daňovej povinnosti.`
    : `The price shown includes VAT at ${COMPANY.vatRatePct} %. For businesses in other EU member states with a valid VAT number the reverse-charge mechanism applies.`;
}

/**
 * Exactly the data § 3a of the Commercial Code requires on the website, as
 * label/value pairs in the order a Slovak imprint states them. The Imprint
 * renders this list rather than hand-written lines, so none of the six can be
 * lost in a future edit.
 */
export function statutoryWebsiteData(lang = "sk") {
  const isSK = lang === "sk";
  return [
    { label: isSK ? "Obchodné meno" : "Business name", value: COMPANY.legalName },
    { label: isSK ? "Sídlo" : "Registered seat", value: addressOneLine(lang) },
    { label: isSK ? "Právna forma" : "Legal form", value: isSK ? COMPANY.legalFormSk : COMPANY.legalFormEn },
    ...identifiers(lang),
    { label: isSK ? "Zápis v registri" : "Register entry", value: registrationLine(lang) },
  ];
}

/**
 * How the operator is named in running prose — in Terms, Privacy and anywhere
 * a sentence needs it. Includes the seat, because a contracting party in a
 * contract is identified by name AND seat, not by name alone.
 */
export function operatorInSentence(lang = "sk") {
  return lang === "sk"
    ? `${COMPANY.legalName}, so sídlom ${addressOneLine("sk")}, IČO: ${COMPANY.ico}`
    : `${COMPANY.legalName}, with its registered seat at ${addressOneLine("en")}, company ID (IČO): ${COMPANY.ico}`;
}

/**
 * The seller block that goes on every invoice.
 *
 * Stripe prints the seller from the ACCOUNT's business profile, which is a
 * dashboard setting and — until the account is moved to the company — still
 * says a private individual. This is set on the customer's invoice footer from
 * our own code instead, so the legally required identification is on the
 * document regardless of what the dashboard says, and it gains the DIČ and the
 * IBAN by itself the day those exist.
 *
 * Plain text: Stripe renders the footer without markup.
 *
 * `bank` is passed in by the caller — it comes from public.app_secrets and is
 * only ever available server-side. Called without it, the footer is still a
 * complete and correct supplier identification; it simply has no payment line,
 * which is right for anything that is not an invoice.
 */
export function invoiceSellerFooter(lang = "sk", bank = {}) {
  const isSK = lang === "sk";
  const ids = [`IČO: ${COMPANY.ico}`];
  if (COMPANY.dic) ids.push(`DIČ: ${COMPANY.dic}`);
  if (COMPANY.icDph) ids.push(`IČ DPH: ${COMPANY.icDph}`);

  const lines = [
    isSK ? "Dodávateľ:" : "Supplier:",
    `${COMPANY.legalName}, ${addressOneLine(lang)}`,
    ids.join(" · "),
    registrationLine(lang),
  ];
  if (bank.iban) {
    lines.push(isSK
      ? `Bankové spojenie: ${bank.iban}${bank.bankName ? ` (${bank.bankName})` : ""}`
      : `Bank: ${bank.iban}${bank.bankName ? ` (${bank.bankName})` : ""}`);
  }
  lines.push(vatNotice(lang));
  return lines.join("\n");
}

/** The Slovak data-protection authority — where a GDPR complaint is filed. */
export const DPA_AUTHORITY = {
  nameSk: "Úrad na ochranu osobných údajov Slovenskej republiky",
  nameEn: "Office for Personal Data Protection of the Slovak Republic",
  address: "Hraničná 12, 820 07 Bratislava 27",
  url: "https://dataprotection.gov.sk",
};

/**
 * The Slovak trade-inspection authority. A properly-run Slovak business site
 * names its supervisory body; ours is the Bratislava regional inspectorate,
 * matching the registered seat.
 */
export const TRADE_AUTHORITY = {
  nameSk: "Inšpektorát SOI pre Bratislavský kraj",
  nameEn: "Slovak Trade Inspection, Bratislava Region Inspectorate",
  address: "Bajkalská 21/A, P. O. BOX č. 5, 820 07 Bratislava",
  email: "ba@soi.sk",
  url: "https://www.soi.sk",
};
