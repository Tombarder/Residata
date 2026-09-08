/**
 * Analýza — september 2026, in Slovak and English.
 *
 * THE RULE THIS DRAFT WAS WRITTEN UNDER, after Boss rejected three earlier ones:
 * do not invent a belief nobody holds and then refute it. "A cheaper market does
 * not promise a faster sale" is not a finding — nobody thought it did. Every
 * section has to tell a developer something they could not have worked out from
 * first principles, and the evidence has to be inside the sentence.
 *
 * The three that survived that test:
 *
 *  1. The Slovak three-room slowdown is NOT price and NOT the product. Czech
 *     three-room flats cost 70 % MORE in absolute terms (523 613 € against
 *     307 100 €) and clear in half the time. What differs is how much of each
 *     market is built that way — 34.8 % of Slovak supply against 26.0 % Czech,
 *     while Slovakia holds barely 8.6 % in one-room flats against 19.4 %. The
 *     penalty is a supply condition, which is why the same flat behaves
 *     differently across a border and why it can change.
 *
 *  2. A competitor's price list carries no information about how they are doing
 *     and, if anything, points the wrong way: projects clearing within 18 months
 *     moved a price in 2.9 % of observations with 78.4 % of those up; projects
 *     sitting on 30+ months moved one in 9.1 % with 93.3 % up. The projects in
 *     trouble raise prices MORE. This is the most useful thing in the dataset,
 *     and the first three drafts buried it as a supporting statistic.
 *
 *  3. Clearing time runs 12 to 32 months across towns and price does not order
 *     the list — Trenčín and Trnava are 7 € per m² apart and 15 months apart.
 *     Stated as the fact it is, with NO speculation about the cause: supply per
 *     head does not explain it either (checked — Košice has the least stock per
 *     inhabitant and is second slowest), and three months cannot carry a causal
 *     claim.
 *
 * Figures interpolate from report-2026-09.json; month counts always come from
 * `monthsDisplay`, never rounded here. Slovak counts go through months() for the
 * 1 / 2–4 / 5+ declension, and no sentence declines a generated town name.
 */

import data from "./data/report-2026-09.json";
import { n, pct, eurM2, months } from "./format";

const d = data;
const sk = Object.fromEntries(d.monthsToClear.sk.map((r) => [r.izby, r]));
const cz = Object.fromEntries(d.monthsToClear.cz.map((r) => [r.izby, r]));
const mixSk = d.supplyMix.sk;
const mixCz = d.supplyMix.cz;
const priceSk = d.medianPriceBySize.sk;
const priceCz = d.medianPriceBySize.cz;
const ps = d.priceSignal;
const cities = d.monthsToClear.byCity;
const fastest = cities[0];
const slowest = cities[cities.length - 1];
const pair = d.closestPricedPair;
const slug = d.slug;

const eur = (v) => `${n(v)} €`;
const czPremium = Math.round((priceCz["3"] / priceSk["3"] - 1) * 100);

export default {
  slug,
  date: d.asOf,
  title: {
    sk: "Trojizbový byt sa na Slovensku predáva o rok dlhšie než dvojizbový",
    en: "A three-room flat in Slovakia takes a year longer to sell than a two-room one",
  },
  perex: {
    sk: `Ponuka trojizbových bytov by sa pri súčasnom tempe vypredávala ` +
        `${months(sk[3].monthsDisplay)}, dvojizbových ${months(sk[2].monthsDisplay)}. ` +
        `V Česku stojí trojizbový byt o ${czPremium} % viac a vypredá sa za polovičný čas.`,
    en: `At the current pace, three-room supply would take ${months(sk[3].monthsDisplay, "en")} ` +
        `to clear and two-room supply ${months(sk[2].monthsDisplay, "en")}. In Czechia a ` +
        `three-room flat costs ${czPremium} % more and clears in half the time.`,
  },
  ogImage: "/analyzy/og-2026-09.png",

  blocks: [
    {
      type: "lead",
      text: {
        sk: `Ponuka trojizbových bytov na Slovensku by sa pri súčasnom tempe predaja ` +
            `vypredávala ${months(sk[3].monthsDisplay)}, dvojizbových ` +
            `${months(sk[2].monthsDisplay)}. V Česku, kde sledujeme ` +
            `${d.coverage.czActiveProjects} projektov rovnakým spôsobom, sa trojizbové byty ` +
            `vypredajú za ${months(cz[3].monthsDisplay)} — a stoja pritom o ${czPremium} % viac.`,
        en: `At the current pace of sales, Slovakia's three-room supply would take ` +
            `${months(sk[3].monthsDisplay, "en")} to clear and its two-room supply ` +
            `${months(sk[2].monthsDisplay, "en")}. In Czechia, where we track ` +
            `${d.coverage.czActiveProjects} projects the same way, three-room flats clear in ` +
            `${months(cz[3].monthsDisplay, "en")} — and cost ${czPremium} % more.`,
      },
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-1-mesiace-do-vypredania.svg`,
      srcEn: `/analyzy/${slug}-1-mesiace-do-vypredania-en.svg`,
      alt: {
        sk: "Mesiace do vypredania ponuky podľa dispozície, Slovensko a Česko",
        en: "Months to clear supply by flat size, Slovakia and Czechia",
      },
      caption: {
        sk: "Zásoba delená mesačným tempom predaja, obe krajiny rovnakou metódou.",
        en: "Stock divided by the monthly pace of sales, both countries on the same method.",
      },
    },

    {
      type: "h2",
      text: {
        sk: "Nie je to cenou ani samotným bytom",
        en: "It is not the price, and not the flat",
      },
    },
    {
      type: "p",
      text: {
        sk: `Medián ceny trojizbového bytu je na Slovensku ${eur(priceSk["3"])}, v Česku ` +
            `${eur(priceCz["3"])}. Český kupujúci zaplatí za porovnateľný byt o ` +
            `${czPremium} % viac — a napriek tomu sa tam takéto byty vypredajú dvakrát ` +
            `rýchlejšie. Vysvetlenie, že trojizbové byty sú drahé, a preto ležia, tým padá.`,
        en: `The median three-room flat costs ${eur(priceSk["3"])} in Slovakia and ` +
            `${eur(priceCz["3"])} in Czechia. A Czech buyer pays ${czPremium} % more for a ` +
            `comparable flat — and those flats still clear twice as fast. The explanation ` +
            `that three-room flats are expensive and therefore sit does not survive that.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Rozdiel je v tom, koľko ich kde stojí. Na Slovensku tvoria trojizbové byty ` +
            `${pct(mixSk["3"])} celej ponuky novostavieb, v Česku ${pct(mixCz["3"])}. ` +
            `Pri najmenších bytoch je to opačne: na Slovensku ${pct(mixSk["1"])} ponuky, ` +
            `v Česku ${pct(mixCz["1"])}. Slovenský trh má ťažisko vyššie — a práve tam sa ` +
            `zásoba hromadí.`,
        en: `The difference is how many of them stand where. Three-room flats are ` +
            `${pct(mixSk["3"], "en")} of all Slovak new-build supply and ` +
            `${pct(mixCz["3"], "en")} of Czech. The smallest flats run the other way: ` +
            `${pct(mixSk["1"], "en")} of supply in Slovakia against ` +
            `${pct(mixCz["1"], "en")} in Czechia. The Slovak market's centre of gravity sits ` +
            `higher — and that is where the stock accumulates.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Dĺžka predaja trojizbového bytu teda nie je vlastnosť toho bytu, ale stav trhu, ` +
            `do ktorého ho developer postaví. Ten istý byt sa za hranicou správa inak.`,
        en: `So the selling time of a three-room flat is not a property of the flat but the ` +
            `condition of the market it is built into. The same flat behaves differently ` +
            `across the border.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "Cenník konkurencie nie je signál",
        en: "A competitor's price list is not a signal",
      },
    },
    {
      type: "p",
      text: {
        sk: `Projekty, ktoré by sa pri súčasnom tempe vypredali do 18 mesiacov, zmenili cenu ` +
            `v ${pct(ps.fast.pctChanged)} pozorovaní a ${pct(ps.fast.pctUp)} tých zmien ` +
            `smerovalo nahor. Projekty, ktoré na to potrebujú viac než 30 mesiacov, menili ` +
            `cenu v ${pct(ps.slow.pctChanged)} pozorovaní a nahor ich smerovalo ` +
            `${pct(ps.slow.pctUp)}. Projekty, ktoré sa nepredávajú, teda zdražujú častejšie ` +
            `aj ochotnejšie než tie, ktoré sa predávajú.`,
        en: `Projects on track to clear within 18 months changed a price in ` +
            `${pct(ps.fast.pctChanged, "en")} of observations, and ` +
            `${pct(ps.fast.pctUp, "en")} of those changes were increases. Projects needing ` +
            `more than 30 months changed a price in ${pct(ps.slow.pctChanged, "en")} of ` +
            `observations, with ${pct(ps.slow.pctUp, "en")} of them increases. The projects ` +
            `that are not selling raise prices both more often and more readily than the ` +
            `ones that are.`,
      },
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-3-cennik-signal.svg`,
      srcEn: `/analyzy/${slug}-3-cennik-signal-en.svg`,
      alt: {
        sk: "Podiel zmien cenníka smerujúcich nahor podľa rýchlosti predaja projektu",
        en: "Share of price-list changes that were increases, by project sales speed",
      },
      caption: {
        sk: `Slovenské projekty s 20 a viac voľnými bytmi: ${ps.fast.projects} rýchlych, ` +
            `${ps.slow.projects} pomalých.`,
        en: `Slovak projects with 20 or more available flats: ${ps.fast.projects} fast, ` +
            `${ps.slow.projects} slow.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Bežný spôsob, ako si developer overí vlastnú cenu, je pozrieť sa, za koľko ` +
            `ponúka konkurencia. Tieto čísla hovoria, že z cenníka sa o konkurencii nedá ` +
            `zistiť, ako sa jej darí — pohybuje sa nezávisle od predaja, a ak už niečo ` +
            `naznačuje, tak opačne. Porovnávať sa treba s tým, ako rýchlo sa v okolí ` +
            `predáva, nie s tým, čo je napísané v susedovom cenníku.`,
        en: `The usual way a developer sanity-checks their own price is to look at what the ` +
            `competition is asking. These figures say the price list reveals nothing about ` +
            `how the competition is doing — it moves independently of sales and, if it ` +
            `signals anything, points the wrong way. The comparison worth making is how fast ` +
            `the neighbours are selling, not what their price list says.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "Rovnaká cena, dvojnásobný čas",
        en: "Same price, twice the time",
      },
    },
    {
      type: "p",
      text: {
        sk: `${pair.a.city} a ${pair.b.city} majú prakticky rovnaký medián ceny — ` +
            `${eurM2(pair.a.medianM2)} a ${eurM2(pair.b.medianM2)}, rozdiel ` +
            `${pair.priceGap} € na meter. Čas do vypredania je pritom ` +
            `${months(pair.a.monthsDisplay)} a ${months(pair.b.monthsDisplay)}. Naprieč ` +
            `sledovanými mestami sa pohybuje od ${months(fastest.monthsDisplay)} ` +
            `(${fastest.city}) po ${months(slowest.monthsDisplay)} (${slowest.city}) a ` +
            `poradie nekopíruje cenu.`,
        en: `${pair.a.city} and ${pair.b.city} have practically the same median price — ` +
            `${eurM2(pair.a.medianM2)} and ${eurM2(pair.b.medianM2)}, ${pair.priceGap} € per ` +
            `metre apart. Their clearing times are ${months(pair.a.monthsDisplay, "en")} and ` +
            `${months(pair.b.monthsDisplay, "en")}. Across the towns tracked the figure runs ` +
            `from ${months(fastest.monthsDisplay, "en")} (${fastest.city}) to ` +
            `${months(slowest.monthsDisplay, "en")} (${slowest.city}), and the order does not ` +
            `follow price.`,
      },
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-2-mesta.svg`,
      srcEn: `/analyzy/${slug}-2-mesta-en.svg`,
      alt: {
        sk: "Medián ceny a mesiace do vypredania v slovenských mestách",
        en: "Median price against months to clear, Slovak towns",
      },
      caption: {
        sk: "Mestá so 100 a viac voľnými bytmi a aspoň 25 predajmi za sledované obdobie.",
        en: "Towns with 100 or more available flats and at least 25 sales in the observed period.",
      },
    },
    {
      type: "p",
      text: {
        sk: `Ten istý projekt sa teda podľa mesta predáva rok alebo dva a z cenovej hladiny ` +
            `mesta sa vopred nedá povedať, ktoré z toho. Pri kúpe pozemku je to rozdiel, ` +
            `ktorý sa počíta v rokoch financovania.`,
        en: `The same project therefore sells over one year or over two depending on the ` +
            `town, and the town's price level will not tell you which in advance. When buying ` +
            `land that difference is measured in years of financing.`,
      },
    },
  ],

  method: {
    sk: `Dáta pochádzajú z verejne publikovaných cenníkov developerov, ktoré Residata ` +
        `zaznamenáva denne od 16. mája 2026 (Česko od 9. júna). Mesiace do vypredania = ` +
        `aktuálna ponuka delená priemerným mesačným počtom predajov za sledované obdobie; ` +
        `údaj predpokladá, že tempo zostane rovnaké. Predaje sa identifikujú zo zmien stavu ` +
        `bytu v cenníku developera; zahrnuté sú len byty, nie parkovacie státia, pivnice ani ` +
        `nebytové priestory. Cena za m² sa počíta z obytnej plochy vrátane DPH; uvádzame ` +
        `mediány. V grafe miest sú mestá so 100 a viac voľnými bytmi a aspoň 25 predajmi. ` +
        `České ceny sú prepočítané kurzom ku dňu zberu. Všetky čísla sú z vlastných dát.`,
    en: `Data come from developers' publicly published price lists, recorded daily by ` +
        `Residata since 16 May 2026 (Czechia from 9 June). Months to clear = current supply ` +
        `divided by the average monthly number of sales over the observed period; the figure ` +
        `assumes the pace stays the same. Sales are identified from changes of status in the ` +
        `developer's own price list; flats only — no parking spaces, storage or commercial ` +
        `units. Price per m² is calculated on living area including VAT; figures are medians. ` +
        `The town chart includes towns with 100 or more available flats and at least 25 ` +
        `sales. Czech prices are converted at the rate on the day of collection. All figures ` +
        `are our own.`,
  },
};
