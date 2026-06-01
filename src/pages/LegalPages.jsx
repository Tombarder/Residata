/**
 * Privacy Policy + Imprint pages — EN + SK.
 *
 * Pre-revenue stage (no registered company, no paid users yet). The
 * operator is Tomáš Kamhal as a natural person at the Krasovského 13
 * Bratislava address shown in the site Footer. Privacy contact email
 * is tkamhal@gmail.com per Boss instruction 2026-05-31.
 *
 * Not lawyer-reviewed. Will be revised when:
 *   - A legal entity (s.r.o. or živnostník) is formed → update Imprint
 *   - Paid plans launch → add Terms of Service + payment-data disclosures
 *   - Any new third-party data processor is added → update Privacy list
 *
 * Third parties currently disclosed (verified in codebase):
 *   - Supabase (data hosting — EU region, Frankfurt)
 *   - Vercel (web hosting — global CDN, primary region EU)
 *   - Anthropic (AI chat assistant — sends user prompts to US)
 *   - Google (Gmail SMTP for sending login + system emails)
 */

// Shared layout shell for both legal pages.
function LegalPageShell({ title, children }) {
  return (
    <div style={{ background: "#0a0a0c", minHeight: "100vh", color: "#e8e8ed" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "4rem 2rem 6rem" }}>
        <div style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.7rem",
          color: "#00e5a0",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: "0.8rem",
        }}>
          Residata
        </div>
        <h1 style={{
          fontSize: "2.2rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 2rem 0",
          color: "#e8e8ed",
        }}>{title}</h1>
        <div style={{ fontSize: "0.95rem", lineHeight: 1.75, color: "#c5c5cc" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: "2.25rem" }}>
      <h2 style={{
        fontSize: "1.1rem",
        fontWeight: 600,
        color: "#e8e8ed",
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
  const lastUpdated = isSK ? "Posledná aktualizácia: 31. máj 2026" : "Last updated: 31 May 2026";

  return (
    <LegalPageShell title={isSK ? "Zásady ochrany osobných údajov" : "Privacy Policy"}>
      <p style={{ marginTop: 0, fontSize: "0.82rem", color: "#8a8a96", marginBottom: "2rem" }}>
        {lastUpdated}
      </p>

      <Section title={isSK ? "1. Kto sme" : "1. Who we are"}>
        {isSK ? (
          <p>
            Residata je projekt prevádzkovaný fyzickou osobou Tomáš Kamhal,
            so sídlom Krasovského 13, Bratislava, Slovenská republika. Projekt
            v súčasnosti nie je registrovaný ako samostatný podnikateľský
            subjekt; jeho právna forma sa môže v budúcnosti zmeniť (živnosť
            alebo obchodná spoločnosť), pričom tieto zásady budú zodpovedajúco
            aktualizované.
          </p>
        ) : (
          <p>
            Residata is a project operated by Tomáš Kamhal, a natural person,
            located at Krasovského 13, Bratislava, Slovak Republic. The project
            is not currently registered as a separate business entity; its
            legal form may change in the future (sole trader or limited
            company), and this policy will be updated accordingly.
          </p>
        )}
        <p>
          {isSK ? "Kontakt vo veciach ochrany osobných údajov:" : "Privacy contact:"} {" "}
          <a href="mailto:tkamhal@gmail.com" style={{ color: "#00e5a0" }}>
            tkamhal@gmail.com
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
              <li><strong>Údaje o predplatnom:</strong> stav skúšobnej doby, dátum začiatku a konca platnosti — relevantné len pre používateľov, ktorí prejdú na platený plán (v súčasnosti neexistujú platené plány).</li>
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
              <li><strong>Subscription data:</strong> trial period status, start and end dates — relevant only for users on a paid plan (no paid plans currently exist).</li>
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
            <li><strong>Zákonné povinnosti</strong> (čl. 6 ods. 1 písm. c GDPR): vedenie účtovných záznamov, ak služba začne fungovať komerčne (zatiaľ neaplikovateľné).</li>
          </ul>
        ) : (
          <ul>
            <li><strong>Service provision</strong> (Art. 6(1)(b) GDPR — performance of a contract / pre-contractual steps): authentication, displaying data relevant to your account, support.</li>
            <li><strong>Consent</strong> (Art. 6(1)(a) GDPR): optional profile fields, opt-in to informational emails (if we introduce them).</li>
            <li><strong>Legitimate interest</strong> (Art. 6(1)(f) GDPR): keeping the service secure and stable, preventing abuse, developing and improving the product based on aggregated usage data.</li>
            <li><strong>Legal obligations</strong> (Art. 6(1)(c) GDPR): keeping accounting records if the service starts operating commercially (not currently applicable).</li>
          </ul>
        )}
      </Section>

      <Section title={isSK ? "4. Komu údaje sprístupňujeme" : "4. Who we share data with"}>
        {isSK ? (
          <>
            <p>Aby sme mohli službu prevádzkovať, využívame nasledovné sprostredkovateľov:</p>
            <ul>
              <li><strong>Supabase Inc.</strong> — databázové hostovanie a autentifikácia. Údaje sú uložené v regióne Európskej únie (Frankfurt, Nemecko). <a href="https://supabase.com/privacy" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Supabase</a>.</li>
              <li><strong>Vercel Inc.</strong> — hosting webovej aplikácie. Globálna CDN sieť s primárnym regiónom v EÚ. <a href="https://vercel.com/legal/privacy-policy" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Vercel</a>.</li>
              <li><strong>Anthropic PBC</strong> — náš AI asistent posiela vaše otázky modelu Claude na spracovanie. Spracovanie prebieha v USA. Otázky sa nepoužívajú na trénovanie modelu. <a href="https://www.anthropic.com/legal/privacy" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Anthropic</a>.</li>
              <li><strong>Google LLC</strong> — Gmail SMTP službu používame na zasielanie prihlasovacích odkazov a systémových e-mailov. <a href="https://policies.google.com/privacy" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">Zásady spoločnosti Google</a>.</li>
            </ul>
            <p>
              Vaše osobné údaje nepredávame ani neposkytujeme tretím stranám
              na ich vlastné marketingové účely. Prenos údajov mimo EÚ
              (Anthropic, Google) sa uskutočňuje na základe štandardných
              zmluvných doložiek EÚ.
            </p>
          </>
        ) : (
          <>
            <p>To operate the service we rely on the following processors:</p>
            <ul>
              <li><strong>Supabase Inc.</strong> — database hosting and authentication. Data is stored in an EU region (Frankfurt, Germany). <a href="https://supabase.com/privacy" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">Supabase Privacy Policy</a>.</li>
              <li><strong>Vercel Inc.</strong> — web application hosting. Global CDN with primary EU region. <a href="https://vercel.com/legal/privacy-policy" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">Vercel Privacy Policy</a>.</li>
              <li><strong>Anthropic PBC</strong> — our AI assistant sends your queries to the Claude model for processing. Processing happens in the United States. Queries are not used to train the model. <a href="https://www.anthropic.com/legal/privacy" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">Anthropic Privacy Policy</a>.</li>
              <li><strong>Google LLC</strong> — Gmail SMTP is used to send login links and system emails. <a href="https://policies.google.com/privacy" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.</li>
            </ul>
            <p>
              We do not sell or share your personal data with third parties
              for their own marketing purposes. Transfers outside the EU
              (Anthropic, Google) happen under EU Standard Contractual Clauses.
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
            <li><strong>Účtovné záznamy</strong> — ak v budúcnosti spustíme platenú službu, faktúry sa uchovávajú 10 rokov podľa slovenského zákona o účtovníctve.</li>
          </ul>
        ) : (
          <ul>
            <li><strong>Account data</strong> — retained while you have an active account. After an account deletion request, data is removed within 30 days.</li>
            <li><strong>Usage records</strong> — aggregated and anonymized data is retained indefinitely; user-linked records are deleted within 90 days of account closure.</li>
            <li><strong>AI assistant queries</strong> — retained for product improvement and quality control, maximum 12 months.</li>
            <li><strong>Accounting records</strong> — if we launch a paid service in the future, invoices are retained for 10 years under Slovak accounting law.</li>
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
              <li>podať <strong>sťažnosť</strong> u dozorného orgánu — Úrad na ochranu osobných údajov SR, Hraničná 12, 820 07 Bratislava, <a href="https://dataprotection.gov.sk" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">dataprotection.gov.sk</a>.</li>
            </ul>
            <p>
              Pre uplatnenie ktoréhokoľvek z týchto práv nám napíšte na
              {" "}<a href="mailto:tkamhal@gmail.com" style={{ color: "#00e5a0" }}>tkamhal@gmail.com</a>.
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
              <li>lodge a <strong>complaint</strong> with the supervisory authority — Office for Personal Data Protection of the Slovak Republic, Hraničná 12, 820 07 Bratislava, <a href="https://dataprotection.gov.sk" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">dataprotection.gov.sk</a>.</li>
            </ul>
            <p>
              To exercise any of these rights, write to
              {" "}<a href="mailto:tkamhal@gmail.com" style={{ color: "#00e5a0" }}>tkamhal@gmail.com</a>.
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
              <li><strong>Analytické cookies</strong> — v súčasnosti žiadne nepoužívame. Ak ich v budúcnosti pridáme, budeme od vás vyžadovať predchádzajúci súhlas.</li>
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
              <li><strong>Analytics cookies</strong> — none currently used. If we add any in the future, we will request your prior consent.</li>
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
// IMPRINT
// ─────────────────────────────────────────────────────────────────────

export function ImprintPage({ lang }) {
  const isSK = lang === "sk";

  return (
    <LegalPageShell title={isSK ? "Impressum" : "Imprint"}>
      <Section title={isSK ? "Prevádzkovateľ" : "Operator"}>
        <p>
          <strong>Tomáš Kamhal</strong><br />
          {isSK ? "Krasovského 13" : "Krasovského 13"}<br />
          {isSK ? "Bratislava, Slovenská republika" : "Bratislava, Slovak Republic"}
        </p>
      </Section>

      <Section title={isSK ? "Kontakt" : "Contact"}>
        <p>
          {isSK ? "E-mail (všeobecný kontakt):" : "Email (general):"} {" "}
          <a href="mailto:residata@proton.me" style={{ color: "#00e5a0" }}>residata@proton.me</a><br />
          {isSK ? "E-mail (ochrana osobných údajov):" : "Email (privacy matters):"} {" "}
          <a href="mailto:tkamhal@gmail.com" style={{ color: "#00e5a0" }}>tkamhal@gmail.com</a><br />
          {isSK ? "Telefón:" : "Phone:"} {" "}
          <a href="tel:+421911963909" style={{ color: "#00e5a0" }}>+421 911 963 909</a>
        </p>
      </Section>

      <Section title={isSK ? "Právny stav" : "Legal status"}>
        {isSK ? (
          <p>
            Residata je v súčasnosti prevádzkovaná ako osobný projekt fyzickou
            osobou. Projekt nie je registrovaný ako samostatný podnikateľský
            subjekt (živnosť ani obchodná spoločnosť) a nie je platiteľom DPH.
            Identifikačné a daňové údaje budú doplnené po formálnej registrácii
            právnej formy.
          </p>
        ) : (
          <p>
            Residata is currently operated as a personal project by a natural
            person. The project is not registered as a separate business
            entity (sole trader or limited company) and is not VAT-registered.
            Registration and tax identification numbers will be added once a
            legal form is formally established.
          </p>
        )}
      </Section>

      <Section title={isSK ? "Dozorný orgán" : "Supervisory authority"}>
        {isSK ? (
          <p>
            Vo veciach ochrany osobných údajov je dozorným orgánom Úrad na
            ochranu osobných údajov Slovenskej republiky, Hraničná 12, 820 07
            Bratislava 27, {" "}
            <a href="https://dataprotection.gov.sk" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">dataprotection.gov.sk</a>.
          </p>
        ) : (
          <p>
            The supervisory authority for personal data matters is the Office
            for Personal Data Protection of the Slovak Republic, Hraničná 12,
            820 07 Bratislava 27, {" "}
            <a href="https://dataprotection.gov.sk" style={{ color: "#00e5a0" }} target="_blank" rel="noopener noreferrer">dataprotection.gov.sk</a>.
          </p>
        )}
      </Section>
    </LegalPageShell>
  );
}
