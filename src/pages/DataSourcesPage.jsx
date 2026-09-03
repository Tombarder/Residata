/**
 * /data-sources — where the data comes from, and how a developer objects.
 *
 * The largest untouched legal risk in this business is that we collect data
 * published on developers' own websites and sell access to it. A lawyer has to
 * answer whether that is defensible; nothing on this page pretends otherwise.
 *
 * But one part of the risk is ours to lower today and costs nothing: right now
 * a developer who objects has no way to reach us except guessing an address.
 * That is how a polite email becomes a lawyer's letter — not because anyone
 * wanted a fight, but because there was no smaller step available. A stated
 * route, a named address and a promise we can actually keep turns the first
 * move into a conversation.
 *
 * EVERY COMMITMENT HERE IS ONE WE CAN KEEP WITHOUT ASKING ANYONE:
 *   · acknowledge in 3 working days — an email
 *   · stop collecting in 10 working days — set the project to paused
 *   · remove it from the live product — the same action
 * Nothing promises deletion of historical aggregates, because that would be a
 * promise about data we may have a legitimate reason to keep, and a promise
 * made here that we later argue about is worse than no page at all.
 */
import { COMPANY, operatorInSentence } from "../lib/company";

const H2 = { fontSize: "1.1rem", fontWeight: 600, color: "var(--text)", margin: "2.2rem 0 0.7rem", letterSpacing: "-0.01em" };
const P = { color: "var(--text-2)", lineHeight: 1.7, margin: "0 0 1rem", maxWidth: "64ch" };
const LI = { color: "var(--text-2)", lineHeight: 1.7, marginBottom: "0.5rem" };

export default function DataSourcesPage({ lang = "sk" }) {
  const isSK = lang === "sk";
  const t = (sk, en) => (isSK ? sk : en);


  const mail = (subject) => `mailto:${COMPANY.email}?subject=${encodeURIComponent(subject)}`;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "9rem 2rem 6rem" }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "var(--accent)",
          letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.8rem",
        }}>{t("Pre developerov", "For developers")}</div>

        <h1 style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 0.8rem" }}>
          {t("Zdroje dát a námietky", "Data sources and objections")}
        </h1>
        <p style={{ ...P, fontSize: "1.05rem" }}>
          {t("Ak ste developer a našli ste svoj projekt v Residate: táto stránka hovorí, čo o ňom vieme, odkiaľ to máme, a ako to zastavíte alebo opravíte. Bez právnika, bez formulára — stačí e-mail.",
             "If you are a developer and you have found your project in Residata: this page says what we hold, where it came from, and how you stop it or correct it. No lawyer, no form — an email is enough.")}
        </p>

        <h2 style={H2}>{t("Čo zbierame", "What we collect")}</h2>
        <p style={P}>
          {t("Údaje, ktoré sami zverejňujete na svojej webovej stránke — spravidla cenník bytov: označenie bytu, dispozíciu, plochu, poschodie, cenu a stav (voľný, rezervovaný, predaný). Nič iné.",
             "The data you publish on your own website — usually a price list: unit reference, layout, floor area, floor, price and status (available, reserved, sold). Nothing else.")}
        </p>
        <ul style={{ paddingLeft: "1.2rem", margin: "0 0 1rem" }}>
          <li style={LI}>{t(<><strong>Nezbierame osobné údaje.</strong> Žiadne mená kupujúcich, žiadne kontakty z formulárov.</>,
                            <><strong>We collect no personal data.</strong> No buyer names, no contacts from your forms.</>)}</li>
          <li style={LI}>{t(<><strong>Neobchádzame prihlásenie ani platený obsah.</strong> Ak je niečo za heslom, nie je to u nás.</>,
                            <><strong>We do not bypass logins or paid content.</strong> If something sits behind a password, it is not with us.</>)}</li>
          <li style={LI}>{t(<><strong>Sťahujeme raz denne</strong> a v takom objeme, aby to vašu stránku nezaťažilo.</>,
                            <><strong>We fetch once a day</strong>, at a volume that does not load your site.</>)}</li>
        </ul>

        <h2 style={H2}>{t("Prečo to robíme", "Why we do it")}</h2>
        <p style={P}>
          {t("Residata dáva developerom, bankám, znalcom a investorom prehľad o trhu novostavieb — teda o cenách a dostupnosti, ktoré sú už dnes verejné, len roztrúsené po stovkách stránok. Nepredávame vaše dáta ako vaše: predávame prístup k trhovému prehľadu, ktorého ste súčasťou rovnako ako vaša konkurencia.",
             "Residata gives developers, banks, valuers and investors a view of the new-build market — prices and availability that are already public, just scattered across hundreds of websites. We do not sell your data as yours: we sell access to a market view in which you appear on the same terms as your competitors.")}
        </p>

        <h2 style={H2}>{t("Ak si to neželáte", "If you would rather we did not")}</h2>
        <p style={P}>
          {t(<>Napíšte na {" "}<a href={mail("Námietka — zber údajov")} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>{" "} z e-mailovej adresy na doméne projektu (alebo firmy, ktorá ho predáva), a uveďte, o ktorý projekt ide. Nemusíte nič odôvodňovať.</>,
             <>Write to {" "}<a href={mail("Objection — data collection")} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>{" "} from an email address on the project's domain (or the company selling it), and say which project. You do not have to give a reason.</>)}
        </p>
        <p style={P}>{t("Čo urobíme:", "What we will do:")}</p>
        <ul style={{ paddingLeft: "1.2rem", margin: "0 0 1rem" }}>
          <li style={LI}>{t(<>Prijatie potvrdíme <strong>do 3 pracovných dní</strong>.</>, <>Acknowledge <strong>within 3 working days</strong>.</>)}</li>
          <li style={LI}>{t(<>Zber z vašej stránky <strong>zastavíme do 10 pracovných dní</strong>.</>, <>Stop collecting from your site <strong>within 10 working days</strong>.</>)}</li>
          <li style={LI}>{t(<>Projekt <strong>odstránime zo služby</strong>, takže ho zákazníci ďalej neuvidia.</>, <>Remove the project <strong>from the service</strong>, so customers no longer see it.</>)}</li>
        </ul>
        <p style={P}>
          {t("Čo nesľubujeme: že spätne vymažeme agregované štatistiky trhu za obdobia, keď bol projekt v ponuke, ak už neidentifikujú konkrétny projekt. Ak vám prekáža aj to, napíšte a preberieme to — radšej sa dohodneme, než aby sme sem napísali sľub, o ktorom by sme sa potom hádali.",
             "What we do not promise: to retrospectively delete aggregated market statistics for periods when the project was on sale, where those no longer identify the project. If that also concerns you, write and we will discuss it — better to agree than to put a promise here that we would later argue about.")}
        </p>

        <h2 style={H2}>{t("Ak je niečo nesprávne", "If something is wrong")}</h2>
        <p style={P}>
          {t(<>Toto je častejšie než námietky a vyriešime to rýchlejšie. Ak sme niečo prečítali zle — cenu, plochu, počet bytov, stav — napíšte na {" "}<a href={mail("Oprava údajov")} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>{" "} a opravíme to. Je to v našom záujme rovnako ako vo vašom: nepresný údaj o vašom projekte znehodnocuje celý prehľad.</>,
             <>This is more common than objections, and quicker to fix. If we have read something wrong — a price, an area, a unit count, a status — write to {" "}<a href={mail("Data correction")} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>{" "} and we will correct it. It is as much in our interest as yours: a wrong figure about your project devalues the whole view.</>)}
        </p>

        <h2 style={H2}>{t("Kto sme", "Who we are")}</h2>
        <p style={P}>
          {operatorInSentence(lang)}. {t(<>Podrobnosti v {" "}<a href="/imprint" style={{ color: "var(--accent)" }}>impressume</a>.</>,
                                          <>Full details in the {" "}<a href="/imprint" style={{ color: "var(--accent)" }}>imprint</a>.</>)}
        </p>
        <p style={{ ...P, color: "var(--text-dim)", fontSize: "0.88rem" }}>
          {t("Píše vám skutočný človek, spravidla v ten istý deň.", "A real person replies, usually the same day.")}
        </p>
      </div>
    </div>
  );
}
