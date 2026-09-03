/**
 * Privacy Policy + Terms + Imprint pages — EN + SK.
 *
 * The operator is Kamhal & Co. s. r. o. (incorporated 2026-09-03). NOTHING
 * about the company is written on this page: the operator's name, seat, IČO,
 * register entry, VAT status and contact all come from lib/company, which is
 * the single source for all six surfaces that name it. To change a company
 * detail, edit lib/company — not this file.
 *
 * The VAT wording is not written here either. `vatNotice()` says "not VAT
 * registered" while COMPANY.icDph is empty and switches to the correct VAT
 * sentence by itself when it is filled in. Do not hand-write either version.
 *
 * Not lawyer-reviewed. Revise when:
 *   - Any new third-party data processor is added → update the Privacy list
 *   - The service stops being business-only → consumer withdrawal rights,
 *     a complaints procedure and an ODR link all become mandatory
 *
 * Third parties currently disclosed (each verified against the running system,
 * not against an earlier version of this list):
 *   - Supabase (data hosting + authentication — EU region, Frankfurt)
 *   - Vercel (web hosting — global CDN, primary region EU)
 *   - Anthropic (AI assistant — sends user prompts to the US)
 *   - Resend (sending transactional email — DKIM/SPF on residata.eu)
 *   - Forward Email (receiving mail to info@residata.eu — the domain's MX)
 *   - Google (the operator's own mailbox, where forwarded mail lands)
 *   - Stripe (subscription billing — processes payment + billing data)
 */

import { useEffect } from "react";
import { usePricing } from "../lib/pricing";
import { FALLBACK_MONTHLY_DISPLAY, FALLBACK_ANCHOR_DISPLAY } from "../lib/pricingDefaults";
import {
  COMPANY, DPA_AUTHORITY, TRADE_AUTHORITY,
  statutoryWebsiteData, bankDetails, operatorInSentence, vatNotice,
  addressOneLine, registrationLine,
} from "../lib/company";

// Shared layout shell for both legal pages.
//
// Top padding = 9rem to clear the fixed Nav (~72px) + Ticker (~36px) +
// optional Trial banner (~36px). Without this the H1 sits behind the
// Ticker (verified live on first deploy — Boss flagged the clip).
function LegalPageShell({ title, children }) {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "9rem 2rem 6rem" }}>
        <div style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.7rem",
          color: "var(--accent)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: "0.8rem",
        }}>
          Residata
        </div>
        <h1 style={{
          fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          margin: "0 0 2rem 0",
          lineHeight: 1.15,
          color: "var(--text)",
        }}>{title}</h1>
        <div style={{ fontSize: "0.95rem", lineHeight: 1.75, color: "#c5c5cc" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Set <title> + <meta description> on mount.
// Lightweight — no need for the heavier applySeo() helper since these
// pages don't need open-graph cards or twitter cards.
function useDocumentTitle(title, description) {
  useEffect(() => {
    const prevTitle = document.title;
    const metaDesc = document.querySelector('meta[name="description"]');
    const prevDesc = metaDesc?.getAttribute("content");
    document.title = title;
    if (metaDesc && description) metaDesc.setAttribute("content", description);
    return () => {
      document.title = prevTitle;
      if (metaDesc && prevDesc != null) metaDesc.setAttribute("content", prevDesc);
    };
  }, [title, description]);
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: "2.25rem" }}>
      <h2 style={{
        fontSize: "1.1rem",
        fontWeight: 600,
        color: "var(--text)",
        margin: "0 0 0.85rem 0",
        letterSpacing: "-0.01em",
      }}>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PRIVACY POLICY
// ─────────────────────────────────────────────────────────────────────

export function PrivacyPage({ lang }) {
  const isSK = lang === "sk";
  const lastUpdated = isSK ? "Posledná aktualizácia: 3. september 2026" : "Last updated: 3 September 2026";

  useDocumentTitle(
    isSK ? "Ochrana osobných údajov · Residata" : "Privacy Policy · Residata",
    isSK
      ? "Aké osobné údaje Residata spracúva, prečo, komu ich sprístupňujeme a vaše práva podľa GDPR."
      : "What personal data Residata processes, why, with whom we share it, and your rights under GDPR.",
  );

  return (
    <LegalPageShell title={isSK ? "Zásady ochrany osobných údajov" : "Privacy Policy"}>
      <p style={{ marginTop: 0, fontSize: "0.82rem", color: "var(--text-dim)", marginBottom: "2rem" }}>
        {lastUpdated}
      </p>

      <Section title={isSK ? "1. Kto sme" : "1. Who we are"}>
        {isSK ? (
          <>
            <p>
              Prevádzkovateľom osobných údajov v zmysle čl. 4 ods. 7 GDPR je
              spoločnosť <strong>{COMPANY.legalName}</strong>, so sídlom{" "}
              {addressOneLine("sk")}, IČO: {COMPANY.ico},{" "}
              {registrationLine("sk").charAt(0).toLowerCase() + registrationLine("sk").slice(1)}
              {" "}(ďalej len „prevádzkovateľ“, „my“).
            </p>
            <p>
              Prevádzkovateľ prevádzkuje službu <strong>Residata</strong>{" "}
              dostupnú na residata.eu. Nemenovali sme zodpovednú osobu (DPO),
              pretože nespĺňame podmienky čl. 37 GDPR; vo všetkých otázkach
              ochrany údajov nás kontaktujte priamo na adrese nižšie.
            </p>
          </>
        ) : (
          <>
            <p>
              The controller of personal data within the meaning of Art. 4(7)
              GDPR is <strong>{COMPANY.legalName}</strong>, with its registered
              seat at {addressOneLine("en")}, company ID (IČO): {COMPANY.ico},{" "}
              {registrationLine("en").charAt(0).toLowerCase() + registrationLine("en").slice(1)}
              {" "}(“the controller”, “we”).
            </p>
            <p>
              The controller operates the <strong>Residata</strong> service at
              residata.eu. We have not appointed a Data Protection Officer, as
              we do not meet the conditions of Art. 37 GDPR; for any data
              protection matter contact us directly at the address below.
            </p>
          </>
        )}
        <p>
          {isSK ? "Kontakt vo veciach ochrany osobných údajov:" : "Privacy contact:"} {" "}
          <a href="mailto:info@residata.eu" style={{ color: "var(--accent)" }}>
            info@residata.eu
          </a>
        </p>
      </Section>

      <Section title={isSK ? "2. Aké údaje spracúvame" : "2. What data we process"}>
        {isSK ? (
          <>
            <p>Pri používaní Residata spracúvame nasledovné kategórie osobných údajov:</p>
            <ul>
              <li><strong>Identifikačné a kontaktné údaje:</strong> e-mailová adresa (povinné pri vytvorení účtu cez prihlasovací odkaz), meno, telefónne číslo, názov spoločnosti, pracovná pozícia, prepojenie na LinkedIn — všetky tieto polia okrem e-mailu sú voliteľné.</li>
              <li><strong>Údaje o používaní:</strong> ktoré stránky a funkcie ste navštívili, otázky položené nášmu AI asistentovi, exporty súborov a podobné záznamy interakcií s platformou.</li>
              <li><strong>Technické údaje:</strong> IP adresa, typ prehliadača a podobné prevádzkové údaje, ktoré sa generujú pri prístupe na akúkoľvek webovú službu.</li>
              <li><strong>Údaje o predplatnom:</strong> stav skúšobnej doby, dátum začiatku a konca platnosti, stav platby a identifikátory zákazníka/predplatného u platobnej brány — relevantné pre používateľov na platenom pláne.</li>
            </ul>
            <p>
              <strong>Nepoužívame žiadne nástroje na sledovanie tretích strán</strong>
              (Google Analytics, Facebook Pixel, Hotjar a pod.). Všetky záznamy o používaní zostávajú v našej databáze.
            </p>
          </>
        ) : (
          <>
            <p>When you use Residata we process the following categories of personal data:</p>
            <ul>
              <li><strong>Identity and contact data:</strong> email address (required to create an account via magic link), name, phone number, company, position, LinkedIn URL — all of these except email are optional.</li>
              <li><strong>Usage data:</strong> which pages and features you visited, queries you sent to our AI assistant, exports you generated, and similar interaction records.</li>
              <li><strong>Technical data:</strong> IP address, browser type, and similar operational data automatically generated by any web service.</li>
              <li><strong>Subscription data:</strong> trial status, start/end dates, payment status, and customer/subscription identifiers held at our payment processor — relevant for users on a paid plan.</li>
            </ul>
            <p>
              <strong>We do not use any third-party tracking tools</strong>
              (Google Analytics, Facebook Pixel, Hotjar etc.). All usage records remain in our own database.
            </p>
          </>
        )}
      </Section>

      <Section title={isSK ? "3. Účel a právny základ" : "3. Purpose and legal basis"}>
        {isSK ? (
          <ul>
            <li><strong>Poskytovanie služby</strong> (čl. 6 ods. 1 písm. b GDPR — plnenie zmluvy / opatrenia pred jej uzavretím): autentifikácia, zobrazovanie dát relevantných pre váš účet, podpora.</li>
            <li><strong>Súhlas</strong> (čl. 6 ods. 1 písm. a GDPR): voliteľné polia v profile, prijímanie informačných e-mailov (ak ich v budúcnosti zavedieme).</li>
            <li><strong>Oprávnený záujem</strong> (čl. 6 ods. 1 písm. f GDPR): zabezpečenie a stabilita služby, prevencia zneužitia, vývoj a vylepšovanie produktu na základe agregovaných údajov o používaní.</li>
            <li><strong>Zákonné povinnosti</strong> (čl. 6 ods. 1 písm. c GDPR): vedenie účtovných a daňových záznamov k platenej službe (faktúry, DPH podľa právnej formy prevádzkovateľa).</li>
          </ul>
        ) : (
          <ul>
            <li><strong>Service provision</strong> (Art. 6(1)(b) GDPR — performance of a contract / pre-contractual steps): authentication, displaying data relevant to your account, support.</li>
            <li><strong>Consent</strong> (Art. 6(1)(a) GDPR): optional profile fields, opt-in to informational emails (if we introduce them).</li>
            <li><strong>Legitimate interest</strong> (Art. 6(1)(f) GDPR): keeping the service secure and stable, preventing abuse, developing and improving the product based on aggregated usage data.</li>
            <li><strong>Legal obligations</strong> (Art. 6(1)(c) GDPR): keeping accounting and tax records for the paid service (invoices, VAT as applicable to the operator's legal form).</li>
          </ul>
        )}
      </Section>

      <Section title={isSK ? "4. Komu údaje sprístupňujeme" : "4. Who we share data with"}>
        {isSK ? (
          <>
            <p>Aby sme mohli službu prevádzkovať, využívame nasledovné sprostredkovateľov:</p>
            <ul>
              <li><strong>Supabase Inc.</strong> — databázové hostovanie a autentifikácia. Údaje sú uložené v regióne Európskej únie (Frankfurt, Nemecko). <a href="https://supabase.com/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Supabase</a>.</li>
              <li><strong>Vercel Inc.</strong> — hosting webovej aplikácie. Globálna CDN sieť s primárnym regiónom v EÚ. <a href="https://vercel.com/legal/privacy-policy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Vercel</a>.</li>
              <li><strong>Anthropic PBC</strong> — náš AI asistent posiela vaše otázky modelu Claude na spracovanie. Spracovanie prebieha v USA. Otázky sa nepoužívajú na trénovanie modelu. <a href="https://www.anthropic.com/legal/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Anthropic</a>.</li>
              <li><strong>Resend (Plus Five Five, Inc.)</strong> — odosielanie transakčných e-mailov (prihlasovacie odkazy, systémové oznámenia) z domény residata.eu. <a href="https://resend.com/legal/privacy-policy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Resend</a>.</li>
              <li><strong>Forward Email LLC</strong> — doručovanie e-mailov zaslaných na adresu info@residata.eu (MX záznamy domény). <a href="https://forwardemail.net/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Forward Email</a>.</li>
              <li><strong>Google LLC</strong> — poštová schránka prevádzkovateľa, do ktorej sa preposiela korešpondencia zaslaná na info@residata.eu. <a href="https://policies.google.com/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Google</a>.</li>
              <li><strong>Stripe Payments Europe, Ltd.</strong> — spracovanie platieb a správa predplatného. Spracúva platobné a fakturačné údaje; údaje o platobných kartách uchováva Stripe, nie my. <a href="https://stripe.com/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Stripe</a>.</li>
            </ul>
            <p>
              Vaše osobné údaje nepredávame ani neposkytujeme tretím stranám
              na ich vlastné marketingové účely. Prenos údajov mimo EÚ
              (Anthropic, Resend, Forward Email, Google) sa uskutočňuje na
              základe štandardných zmluvných doložiek EÚ.
            </p>
          </>
        ) : (
          <>
            <p>To operate the service we rely on the following processors:</p>
            <ul>
              <li><strong>Supabase Inc.</strong> — database hosting and authentication. Data is stored in an EU region (Frankfurt, Germany). <a href="https://supabase.com/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Supabase Privacy Policy</a>.</li>
              <li><strong>Vercel Inc.</strong> — web application hosting. Global CDN with primary EU region. <a href="https://vercel.com/legal/privacy-policy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Vercel Privacy Policy</a>.</li>
              <li><strong>Anthropic PBC</strong> — our AI assistant sends your queries to the Claude model for processing. Processing happens in the United States. Queries are not used to train the model. <a href="https://www.anthropic.com/legal/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Anthropic Privacy Policy</a>.</li>
              <li><strong>Resend (Plus Five Five, Inc.)</strong> — sends transactional email (login links, system notifications) from the residata.eu domain. <a href="https://resend.com/legal/privacy-policy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Resend Privacy Policy</a>.</li>
              <li><strong>Forward Email LLC</strong> — delivers mail sent to info@residata.eu (the domain's MX provider). <a href="https://forwardemail.net/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Forward Email Privacy Policy</a>.</li>
              <li><strong>Google LLC</strong> — the operator's own mailbox, where correspondence sent to info@residata.eu is forwarded. <a href="https://policies.google.com/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.</li>
              <li><strong>Stripe Payments Europe, Ltd.</strong> — payment processing and subscription management. Processes payment + billing data; card details are held by Stripe, not by us. <a href="https://stripe.com/privacy" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">Stripe Privacy Policy</a>.</li>
            </ul>
            <p>
              We do not sell or share your personal data with third parties
              for their own marketing purposes. Transfers outside the EU
              (Anthropic, Resend, Forward Email, Google) happen under EU
              Standard Contractual Clauses.
            </p>
          </>
        )}
      </Section>

      <Section title={isSK ? "5. Doba uchovávania" : "5. Retention"}>
        {isSK ? (
          <ul>
            <li><strong>Údaje účtu</strong> — uchovávame ich, kým máte aktívny účet. Po žiadosti o zmazanie účtu sa údaje vymažú do 30 dní.</li>
            <li><strong>Záznamy o používaní</strong> — agregované a anonymizované údaje sa uchovávajú časovo neobmedzene; údaje viazané na konkrétneho používateľa sa vymažú do 90 dní od zrušenia účtu.</li>
            <li><strong>Otázky pre AI asistenta</strong> — uchovávame ich pre potreby zlepšovania a kontroly kvality, najviac však 12 mesiacov.</li>
            <li><strong>Účtovné záznamy</strong> — faktúry a súvisiace daňové doklady sa uchovávajú 10 rokov podľa slovenského zákona o účtovníctve.</li>
          </ul>
        ) : (
          <ul>
            <li><strong>Account data</strong> — retained while you have an active account. After an account deletion request, data is removed within 30 days.</li>
            <li><strong>Usage records</strong> — aggregated and anonymized data is retained indefinitely; user-linked records are deleted within 90 days of account closure.</li>
            <li><strong>AI assistant queries</strong> — retained for product improvement and quality control, maximum 12 months.</li>
            <li><strong>Accounting records</strong> — invoices and related tax documents are retained for 10 years under Slovak accounting law.</li>
          </ul>
        )}
      </Section>

      <Section title={isSK ? "6. Vaše práva" : "6. Your rights"}>
        {isSK ? (
          <>
            <p>V zmysle GDPR máte právo:</p>
            <ul>
              <li>žiadať <strong>prístup</strong> k vašim údajom a kópiu spracúvaných údajov,</li>
              <li>žiadať <strong>opravu</strong> nepresných alebo neúplných údajov,</li>
              <li>žiadať <strong>vymazanie</strong> vašich údajov („právo na zabudnutie"),</li>
              <li>žiadať <strong>obmedzenie spracúvania</strong>,</li>
              <li>získať vaše údaje v štruktúrovanom strojovo čitateľnom formáte (<strong>prenosnosť</strong>),</li>
              <li><strong>namietať</strong> proti spracúvaniu na základe oprávneného záujmu,</li>
              <li>kedykoľvek <strong>odvolať súhlas</strong>, ktorý ste predtým udelili,</li>
              <li>podať <strong>sťažnosť</strong> u dozorného orgánu — Úrad na ochranu osobných údajov SR, Hraničná 12, 820 07 Bratislava, <a href="https://dataprotection.gov.sk" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">dataprotection.gov.sk</a>.</li>
            </ul>
            <p>
              Pre uplatnenie ktoréhokoľvek z týchto práv nám napíšte na
              {" "}<a href="mailto:info@residata.eu" style={{ color: "var(--accent)" }}>info@residata.eu</a>.
              Odpovieme do 30 dní.
            </p>
          </>
        ) : (
          <>
            <p>Under GDPR you have the right to:</p>
            <ul>
              <li>request <strong>access</strong> to your data and a copy of what we process,</li>
              <li>request <strong>correction</strong> of inaccurate or incomplete data,</li>
              <li>request <strong>erasure</strong> of your data ("right to be forgotten"),</li>
              <li>request <strong>restriction</strong> of processing,</li>
              <li>receive your data in a structured machine-readable format (<strong>portability</strong>),</li>
              <li><strong>object</strong> to processing based on legitimate interest,</li>
              <li><strong>withdraw consent</strong> at any time,</li>
              <li>lodge a <strong>complaint</strong> with the supervisory authority — Office for Personal Data Protection of the Slovak Republic, Hraničná 12, 820 07 Bratislava, <a href="https://dataprotection.gov.sk" style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">dataprotection.gov.sk</a>.</li>
            </ul>
            <p>
              To exercise any of these rights, write to
              {" "}<a href="mailto:info@residata.eu" style={{ color: "var(--accent)" }}>info@residata.eu</a>.
              We will respond within 30 days.
            </p>
          </>
        )}
      </Section>

      <Section title={isSK ? "7. Cookies a podobné technológie" : "7. Cookies and similar technologies"}>
        {isSK ? (
          <>
            <p>Používame nasledovné kategórie cookies:</p>
            <ul>
              <li><strong>Nevyhnutné cookies</strong> — potrebné na fungovanie prihlasovania a relácie (Supabase). Tieto cookies nemožno odmietnuť, pretože bez nich služba nefunguje.</li>
              <li><strong>Analytické / prvostranné údaje o používaní</strong> — používame vlastnú prvostrannú analytiku používania (žiadne nástroje tretích strán). Spúšťa sa <strong>len s vaším súhlasom</strong> — v lište cookies ju môžete odmietnuť a vaše rozhodnutie rešpektujeme.</li>
            </ul>
            <p>
              Svoje preferencie cookies môžete kedykoľvek upraviť cez odkaz
              „Nastavenia cookies" v päte stránky.
            </p>
          </>
        ) : (
          <>
            <p>We use the following cookie categories:</p>
            <ul>
              <li><strong>Essential cookies</strong> — required for login and session functionality (Supabase). These cannot be rejected because the service does not work without them.</li>
              <li><strong>Analytics / first-party usage</strong> — we use our own first-party usage analytics (no third-party tools). These run <strong>only with your consent</strong> — you can reject them in the cookie banner and we honor that choice.</li>
            </ul>
            <p>
              You can update your cookie preferences at any time via the
              "Cookie settings" link in the site footer.
            </p>
          </>
        )}
      </Section>

      <Section title={isSK ? "8. Zmeny týchto zásad" : "8. Changes to this policy"}>
        {isSK ? (
          <p>
            Tieto zásady môžeme z času na čas aktualizovať. Aktuálna verzia je
            vždy dostupná na tejto stránke a dátum poslednej aktualizácie je
            uvedený hore. Pri podstatných zmenách vás upozorníme e-mailom alebo
            výrazným oznámením na webe.
          </p>
        ) : (
          <p>
            We may update this policy from time to time. The current version
            is always available on this page with the last-updated date shown
            at the top. For material changes, we will notify you by email or
            a prominent notice on the website.
          </p>
        )}
      </Section>
    </LegalPageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TERMS OF SERVICE
// NOTE (for the operator): this is a conservative, protective starting draft.
// The disclaimers (informational-only / no-advice, data-accuracy, liability cap,
// "as is") are the key protections for a market-data product. Have it reviewed by
// a Slovak lawyer before relying on it commercially, and align the entity details
// with your final legal form.
// ─────────────────────────────────────────────────────────────────────

export function TermsPage({ lang }) {
  const isSK = lang === "sk";
  const lastUpdated = isSK ? "Účinné od: 3. september 2026" : "Effective: 3 September 2026";
  // DB-driven price (public.pricing_config) so a price change in the admin
  // editor propagates here too; falls back to the launch price if not loaded.
  const pricing = usePricing(lang);
  const priceStr = pricing.priceDisplay || FALLBACK_MONTHLY_DISPLAY;
  const anchorStr = pricing.ready ? pricing.anchorDisplay : FALLBACK_ANCHOR_DISPLAY;

  useDocumentTitle(
    isSK ? "Obchodné podmienky · Residata" : "Terms of Service · Residata",
    isSK
      ? "Podmienky používania platformy Residata — predmet služby, dáta, predplatné, zodpovednosť a rozhodné právo."
      : "Terms governing the use of Residata — service scope, data, subscription, liability, and governing law.",
  );

  return (
    <LegalPageShell title={isSK ? "Obchodné podmienky" : "Terms of Service"}>
      <p style={{ marginTop: 0, fontSize: "0.82rem", color: "var(--text-dim)", marginBottom: "2rem" }}>{lastUpdated}</p>

      <Section title={isSK ? "1. Úvod a súhlas" : "1. Introduction and acceptance"}>
        <p>{isSK
          ? `Tieto obchodné podmienky upravujú prístup k službe Residata a jej používanie („Služba“). Poskytovateľom Služby a zmluvnou stranou je ${operatorInSentence("sk")}, ${registrationLine("sk").charAt(0).toLowerCase() + registrationLine("sk").slice(1)} („my“, „poskytovateľ“). Vytvorením účtu alebo používaním Služby potvrdzujete, že ste si tieto podmienky prečítali a súhlasíte s nimi. Ak s nimi nesúhlasíte, Službu nepoužívajte.`
          : `These Terms govern access to and use of the Residata service (the “Service”). The provider of the Service and your contracting party is ${operatorInSentence("en")}, ${registrationLine("en").charAt(0).toLowerCase() + registrationLine("en").slice(1)} (“we”, “the provider”). By creating an account or using the Service you confirm that you have read and agree to these Terms. If you do not agree, do not use the Service.`}</p>
      </Section>

      <Section title={isSK ? "2. Predmet služby" : "2. What the Service provides"}>
        <p>{isSK
          ? "Residata je nástroj trhovej inteligencie pre novostavby na bývanie. Zhromažďuje, normalizuje a prezentuje verejne dostupné údaje o rezidenčných projektoch (ceny, dostupnosť, absorpcia, trendy) do jednotného prehľadu, dashboardu, analytiky a exportov. Služba je určená na profesionálne/obchodné použitie."
          : "Residata is a market-intelligence tool for new-build residential real estate. It collects, normalizes and presents publicly available information about residential projects (pricing, availability, absorption, trends) into a unified overview, dashboard, analytics and exports. The Service is intended for professional/business use."}</p>
      </Section>

      <Section title={isSK ? "3. Povaha dát — informatívna, nie poradenstvo" : "3. Nature of the data — informational, not advice"}>
        <p style={{ marginTop: 0 }}>{isSK
          ? "Dáta v Službe pochádzajú prevažne z verejných zdrojov (najmä webových stránok developerov) a sú spracované automatizovane. Vynakladáme primeranú snahu o ich presnosť a aktuálnosť, avšak NEZARUČUJEME úplnosť, presnosť, aktuálnosť ani vhodnosť dát na konkrétny účel. Zdroje sa môžu meniť, byť dočasne nedostupné alebo obsahovať chyby."
          : "The data in the Service comes largely from public sources (primarily developer websites) and is processed automatically. We make reasonable efforts toward accuracy and timeliness, but we DO NOT warrant the completeness, accuracy, currency, or fitness of the data for any particular purpose. Sources may change, be temporarily unavailable, or contain errors."}</p>
        <p>{isSK
          ? "Služba a jej výstupy majú výlučne informatívny charakter a NEPREDSTAVUJÚ investičné, finančné, právne, daňové ani znalecké poradenstvo. Akékoľvek rozhodnutia (nákupné, investičné, oceňovacie, obchodné) robíte na vlastnú zodpovednosť a odporúčame ich overiť u primárneho zdroja a u odborného poradcu."
          : "The Service and its outputs are for information only and DO NOT constitute investment, financial, legal, tax, or valuation advice. Any decisions (purchase, investment, valuation, commercial) are made at your own responsibility, and we recommend verifying them against the primary source and a qualified professional advisor."}</p>
      </Section>

      <Section title={isSK ? "4. Účet a oprávnenie" : "4. Account and eligibility"}>
        <p>{isSK
          ? "Na časti Služby je potrebná registrácia. Zaväzujete sa poskytnúť pravdivé údaje, chrániť svoje prihlasovacie údaje a nezdieľať prístup s tretími osobami. Za aktivitu na svojom účte zodpovedáte vy."
          : "Parts of the Service require registration. You agree to provide truthful information, keep your credentials secure, and not share access with third parties. You are responsible for activity on your account."}</p>

        <p>{isSK
          ? "Služba je určená výlučne osobám starším ako 18 rokov konajúcim v rámci svojej podnikateľskej alebo profesijnej činnosti. Objednaním platenej úrovne potvrdzujete, že konáte ako podnikateľ a nie ako spotrebiteľ; preto pri objednávke uvádzate obchodné meno, sídlo a IČO. Službu neponúkame spotrebiteľom."
          : "The Service is intended solely for persons over 18 acting in the course of their business or profession. By ordering a paid tier you confirm that you are acting as a business and not as a consumer, which is why the order asks for your business name, registered seat and company registration number. We do not offer the Service to consumers."}</p>
      </Section>

      <Section title={isSK ? "5. Predplatné, skúšobná verzia a platby" : "5. Subscription, trial and payment"}>
        <p>{isSK
          ? `Služba sa poskytuje vo viacerých úrovniach (bezplatná, skúšobná a platená). Bezplatná skúšobná verzia (spravidla 7 dní) poskytuje rozšírený prístup bez nutnosti platobnej karty. Platená úroveň sa poskytuje za priebežný poplatok (aktuálne ${priceStr} / mesiac${anchorStr ? ` — úvodná cena, bežne ${anchorStr}` : ""}), fakturovaný mesačne cez náš online checkout (Stripe); predplatné môžete kedykoľvek zrušiť v sekcii fakturácie. Už zaplatené obdobie sa spravidla nevracia, ak nie je dohodnuté inak.`
          : `The Service is offered in several tiers (free, trial, and paid). The free trial (typically 7 days) provides extended access without requiring a payment card. The paid tier is provided for a recurring fee (currently ${priceStr} / month${anchorStr ? ` — launch price, regularly ${anchorStr}` : ""}), billed monthly via our online checkout (Stripe); you can cancel anytime in the billing section. An already-paid period is generally non-refundable unless agreed otherwise.`}</p>

        <p>{isSK
          ? `${vatNotice("sk")} Ku každej platbe vystavíme faktúru (daňový doklad) elektronicky; sprístupňujeme ju v sekcii fakturácie a zasielame na e-mail uvedený v účte. Ak objednávate ako podnikateľ, uveďte pri objednávke obchodné meno, sídlo a IČO — bez týchto údajov nevieme vystaviť faktúru použiteľnú pre vaše účtovníctvo.`
          : `${vatNotice("en")} We issue an invoice (tax document) electronically for every payment; it is available in the billing section and sent to the email address on the account. If you are ordering as a business, provide your business name, registered seat and company ID at checkout — without them we cannot issue an invoice your accounting can use.`}</p>
      </Section>

      <Section title={isSK ? "6. Prijateľné používanie" : "6. Acceptable use"}>
        <p>{isSK
          ? "Zaväzujete sa Službu nepoužívať v rozpore so zákonom ani spôsobom, ktorý by ju mohol poškodiť. Bez nášho písomného súhlasu najmä nesmiete: (a) hromadne sťahovať alebo automatizovane extrahovať dáta nad rámec poskytnutých exportov; (b) ďalej predávať, redistribuovať alebo verejne sprístupňovať dáta zo Služby; (c) spätne analyzovať alebo obchádzať technické či prístupové obmedzenia; (d) zdieľať svoj prístup. Porušenie môže viesť k pozastaveniu alebo zrušeniu účtu."
          : "You agree not to use the Service unlawfully or in a way that could harm it. Without our written consent you in particular may not: (a) bulk-download or automatically extract data beyond the exports we provide; (b) resell, redistribute, or publicly make available data from the Service; (c) reverse-engineer or circumvent technical or access controls; (d) share your access. Violation may result in suspension or termination of the account."}</p>
      </Section>

      <Section title={isSK ? "7. Duševné vlastníctvo" : "7. Intellectual property"}>
        <p>{isSK
          ? "Platforma, jej softvér, dizajn a spôsob usporiadania a prezentácie dát (databázová štruktúra a kompilácia) sú chránené a patria prevádzkovateľovi. Jednotlivé faktické údaje pochádzajú z ich pôvodných zdrojov. Poskytujeme vám nevýhradné, neprevoditeľné právo používať Službu na vlastné obchodné účely počas trvania predplatného."
          : "The platform, its software, design, and the way data is organized and presented (the database structure and compilation) are protected and belong to the operator. Individual factual data originates from its original sources. We grant you a non-exclusive, non-transferable right to use the Service for your own business purposes for the duration of your subscription."}</p>
      </Section>

      <Section title={isSK ? "8. Dostupnosť a beta funkcie" : "8. Availability and beta features"}>
        <p>{isSK
          ? "Niektoré funkcie (napr. AI asistent) sú v skúšobnom/beta režime a môžu byť obmedzené alebo zmenené. AI výstupy môžu obsahovať chyby a nie sú zdrojom pravdy — smerodajné sú čísla v Analytike a Reportoch."
          : "Some features (e.g. the AI assistant) are in trial/beta and may be limited or changed. AI outputs may contain errors and are not a source of truth — the figures in Analytics and Reports are authoritative."}</p>

        <p>{isSK
          ? "Pre platené predplatné sa zaväzujeme k mesačnej dostupnosti Služby na úrovni 99,5 %. Do výpadku sa nezapočítava plánovaná údržba oznámená aspoň 48 hodín vopred, výpadky na strane vašej siete alebo zariadenia a okolnosti vylúčené vyššou mocou. Ak dostupnosť v danom mesiaci klesne pod uvedenú úroveň, na požiadanie zaslané do 30 dní vám poskytneme pomernú kreditovú náhradu za daný mesiac."
          : "For paid subscriptions we commit to 99.5 % monthly availability of the Service. Excluded from downtime: scheduled maintenance announced at least 48 hours in advance, failures in your own network or device, and events of force majeure. If availability in a given month falls below that level, we will provide a pro-rata credit for that month on request made within 30 days."}</p>

        <p>{isSK
          ? "Denná aktualizácia dát je cieľom prevádzky, nie zárukou; zdrojové stránky developerov môžu byť dočasne nedostupné alebo zmenené. Výpadok jedného zdroja neznamená nedostupnosť Služby."
          : "The daily data refresh is an operational target, not a warranty; developer source sites may be temporarily unavailable or change. An outage at a single source does not constitute unavailability of the Service."}</p>
      </Section>

      <Section title={isSK ? "9. Ochrana osobných údajov" : "9. Data protection"}>
        <p>{isSK
          ? <>Spracúvanie osobných údajov upravujú samostatné <a href="/privacy" style={{ color: "var(--accent)" }}>Zásady ochrany osobných údajov</a>, ktoré sú súčasťou týchto podmienok.</>
          : <>The processing of personal data is governed by our separate <a href="/privacy" style={{ color: "var(--accent)" }}>Privacy Policy</a>, which forms part of these Terms.</>}</p>
      </Section>

      <Section title={isSK ? "10. Vylúčenie záruk a obmedzenie zodpovednosti" : "10. Warranty disclaimer and limitation of liability"}>
        <p style={{ marginTop: 0 }}>{isSK
          ? "Služba sa poskytuje „tak ako je“ a „ako je dostupná“, bez akýchkoľvek výslovných či implicitných záruk (vrátane záruky presnosti, vhodnosti na účel alebo neprerušovanej prevádzky) v maximálnom rozsahu povolenom právom. Tým nie je dotknutý výslovný záväzok dostupnosti podľa článku 8, ktorý platí prednostne."
          : "The Service is provided “as is” and “as available”, without any express or implied warranties (including accuracy, fitness for purpose, or uninterrupted operation) to the maximum extent permitted by law. This does not affect the express availability commitment in clause 8, which prevails."}</p>
        <p>{isSK
          ? "V maximálnom rozsahu povolenom právom nezodpovedáme za nepriame, následné alebo náhodné škody ani za ušlý zisk či rozhodnutia prijaté na základe dát zo Služby. Naša celková zodpovednosť voči vám je obmedzená sumou, ktorú ste za Službu zaplatili počas 12 mesiacov predchádzajúcich udalosti, ktorá zakladá nárok. Týmto nie sú dotknuté práva spotrebiteľa ani zodpovednosť, ktorú nemožno podľa práva vylúčiť."
          : "To the maximum extent permitted by law, we are not liable for indirect, consequential, or incidental damages, lost profits, or decisions made based on data from the Service. Our total liability to you is limited to the amount you paid for the Service in the 12 months preceding the event giving rise to the claim. This does not affect consumer rights or liability that cannot be excluded under applicable law."}</p>
      </Section>

      <Section title={isSK ? "11. Trvanie a ukončenie" : "11. Term and termination"}>
        <p>{isSK
          ? "Ktorákoľvek strana môže vzťah ukončiť. Váš prístup môžeme pozastaviť alebo zrušiť pri porušení týchto podmienok alebo z prevádzkových či právnych dôvodov. Po ukončení zaniká vaše právo používať Službu; ustanovenia o duševnom vlastníctve, zodpovednosti a rozhodnom práve zostávajú v platnosti."
          : "Either party may end the relationship. We may suspend or terminate your access for breach of these Terms or for operational or legal reasons. On termination your right to use the Service ceases; the provisions on intellectual property, liability, and governing law survive."}</p>
      </Section>

      <Section title={isSK ? "12. Zmeny podmienok" : "12. Changes to these Terms"}>
        <p>{isSK
          ? "Tieto podmienky môžeme priebežne aktualizovať. O podstatných zmenách vás budeme informovať primeraným spôsobom (napr. v aplikácii alebo e-mailom). Pokračovaním v používaní Služby po účinnosti zmien vyjadrujete s aktualizovanými podmienkami súhlas."
          : "We may update these Terms from time to time. We will notify you of material changes by reasonable means (e.g. in the app or by email). Continuing to use the Service after changes take effect constitutes acceptance of the updated Terms."}</p>
      </Section>

      <Section title={isSK ? "13. Rozhodné právo a spory" : "13. Governing law and disputes"}>
        <p>{isSK
          ? "Tieto podmienky sa riadia právom Slovenskej republiky. Na riešenie sporov sú príslušné súdy Slovenskej republiky. Tým nie sú dotknuté kogentné práva spotrebiteľa podľa miesta jeho bydliska."
          : "These Terms are governed by the law of the Slovak Republic. The courts of the Slovak Republic have jurisdiction over disputes. This does not affect the mandatory consumer rights of a consumer's place of residence."}</p>
      </Section>

      <Section title={isSK ? "14. Kontakt" : "14. Contact"}>
        <p>{isSK ? "Otázky k týmto podmienkam:" : "Questions about these Terms:"}{" "}
          <a href="mailto:info@residata.eu" style={{ color: "var(--accent)" }}>info@residata.eu</a></p>
      </Section>
    </LegalPageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// IMPRINT
// ─────────────────────────────────────────────────────────────────────

export function ImprintPage({ lang }) {
  const isSK = lang === "sk";

  useDocumentTitle(
    isSK ? "Impressum · Residata" : "Imprint · Residata",
    isSK
      ? "Identifikačné údaje prevádzkovateľa služby Residata."
      : "Identification details of the operator of the Residata service.",
  );

  // § 3a of the Commercial Code requires business name, registered seat, legal
  // form, IČO and the register entry on the website. The list comes from
  // lib/company so none of them can be dropped in a later edit, and so the
  // DIČ / IČ DPH rows appear by themselves the day those numbers are issued.
  const rows = statutoryWebsiteData(lang);
  const bank = bankDetails(lang);

  const dt = { fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)", margin: 0 };
  const dd = { margin: "0 0 0.9rem 0", color: "var(--text)", lineHeight: 1.55 };

  return (
    <LegalPageShell title={isSK ? "Impressum" : "Imprint"}>
      <Section title={isSK ? "Prevádzkovateľ" : "Operator"}>
        <p style={{ marginTop: 0 }}>{isSK
          ? <>Službu <strong>Residata</strong> prevádzkuje spoločnosť:</>
          : <>The <strong>Residata</strong> service is operated by:</>}</p>
        <dl style={{ margin: "1rem 0 0 0" }}>
          {rows.map((r) => (
            <div key={r.label}>
              <dt style={dt}>{r.label}</dt>
              <dd style={dd}>{r.value}</dd>
            </div>
          ))}
          <div>
            <dt style={dt}>{isSK ? "Štatutárny orgán" : "Statutory body"}</dt>
            <dd style={dd}>{isSK ? "konateľ: " : "Managing director: "}{COMPANY.director}</dd>
          </div>
          {bank.map((r) => (
            <div key={r.label}>
              <dt style={dt}>{r.label}</dt>
              <dd style={dd}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title={isSK ? "Kontakt" : "Contact"}>
        <p style={{ marginTop: 0 }}>
          {isSK ? "E-mail (všeobecný kontakt):" : "Email (general):"} {" "}
          <a href={`mailto:${COMPANY.email}`} style={{ color: "var(--accent)" }}>{COMPANY.email}</a><br />
          {isSK ? "E-mail (ochrana osobných údajov):" : "Email (privacy matters):"} {" "}
          <a href={`mailto:${COMPANY.privacyEmail}`} style={{ color: "var(--accent)" }}>{COMPANY.privacyEmail}</a><br />
          {isSK ? "Telefón:" : "Phone:"} {" "}
          <a href={`tel:${COMPANY.phoneHref}`} style={{ color: "var(--accent)" }}>{COMPANY.phone}</a>
        </p>
        <p>{isSK
          ? "Korešpondenčná adresa je zhodná so sídlom spoločnosti uvedeným vyššie."
          : "Correspondence address is the registered seat stated above."}</p>
      </Section>

      <Section title={isSK ? "Dozorné orgány" : "Supervisory authorities"}>
        <p style={{ marginTop: 0 }}>{isSK
          ? <>Vo veciach <strong>ochrany osobných údajov</strong>: {DPA_AUTHORITY.nameSk}, {DPA_AUTHORITY.address}, {" "}
              <a href={DPA_AUTHORITY.url} style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">dataprotection.gov.sk</a>.</>
          : <>For <strong>personal data</strong> matters: {DPA_AUTHORITY.nameEn}, {DPA_AUTHORITY.address}, {" "}
              <a href={DPA_AUTHORITY.url} style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">dataprotection.gov.sk</a>.</>}</p>
        <p>{isSK
          ? <>Vo veciach <strong>dozoru nad podnikaním</strong>: {TRADE_AUTHORITY.nameSk}, {TRADE_AUTHORITY.address}, {" "}
              <a href={`mailto:${TRADE_AUTHORITY.email}`} style={{ color: "var(--accent)" }}>{TRADE_AUTHORITY.email}</a>, {" "}
              <a href={TRADE_AUTHORITY.url} style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">soi.sk</a>.</>
          : <>For <strong>trade supervision</strong>: {TRADE_AUTHORITY.nameEn}, {TRADE_AUTHORITY.address}, {" "}
              <a href={`mailto:${TRADE_AUTHORITY.email}`} style={{ color: "var(--accent)" }}>{TRADE_AUTHORITY.email}</a>, {" "}
              <a href={TRADE_AUTHORITY.url} style={{ color: "var(--accent)" }} target="_blank" rel="noopener noreferrer">soi.sk</a>.</>}</p>
      </Section>

      <Section title={isSK ? "Ceny a DPH" : "Prices and VAT"}>
        <p style={{ marginTop: 0 }}>{vatNotice(lang)}</p>
      </Section>
    </LegalPageShell>
  );
}
