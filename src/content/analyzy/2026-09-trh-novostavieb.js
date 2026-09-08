/**
 * Analýza — september 2026, in Slovak and English.
 *
 * ONE THESIS, AND EVERY SECTION SERVES IT: this market adjusts in TIME, not in
 * price. Developers do not cut list prices (86.6 % of all price changes are
 * increases), so stock that is mispriced or mis-mixed does not get discounted —
 * it ages. Which makes months-to-clear the number worth planning around, and it
 * varies by more than a year depending on decisions made before the first brick.
 *
 * WHY MONTHS AND NOT "% SOLD". The first draft reported "% of supply sold" and
 * Boss called it correctly: it rewards a project with 20 units left finishing
 * them off and punishes a fresh 200-unit project actually selling four times as
 * many flats. It conflates size and age with performance. Months-to-clear
 * normalises for size and answers a question a developer actually has. The
 * price finding survived the change — median stock is 35 units in BOTH the
 * cheapest and the priciest quartile, so it was never a size effect — but it is
 * now in a unit that means something.
 *
 * THE "SO WHAT" TEST. Every section has to survive a reader asking it. A share
 * of supply against a share of sales does not; "your three-room stock will take
 * a year longer to sell than your two-room stock" does. Sections that could not
 * answer it were cut, not softened.
 *
 * Figures interpolate from report-2026-09.json. Never hardcode a number here.
 * Ours: supply, sales, months-to-clear, quartiles, price behaviour. Theirs: one
 * figure, Bencont's Q2 Bratislava average, attributed where used.
 */

import data from "./data/report-2026-09.json";
import { n, pct, eurM2, windowPhrase } from "./format";

const d = data;
const W = d.window.sk;
const sk = Object.fromEntries(d.monthsToClear.sk.map((r) => [r.izby, r]));
const cz = Object.fromEntries(d.monthsToClear.cz.map((r) => [r.izby, r]));
const q = d.quartiles.rows;
const cheap = q[0];
const dear = q[q.length - 1];
const cities = d.monthsToClear.byCity;
const fastest = cities[0];
const slowest = cities[cities.length - 1];
const pb = d.priceBehaviour;
const slug = d.slug;

const mo = (v) => Math.round(v);
const skGap = mo(sk[3].months - sk[2].months);
const czGap = mo(cz[3].months - cz[2].months);
const win = { sk: windowPhrase(W, "sk"), en: windowPhrase(W, "en") };

export default {
  slug,
  date: d.asOf,
  title: {
    sk: "Trojizbový byt sa na Slovensku predáva o rok dlhšie než dvojizbový",
    en: "A three-room flat in Slovakia takes a year longer to sell than a two-room one",
  },
  perex: {
    sk: `Pri súčasnom tempe predaja sa ponuka dvojizbových bytov na Slovensku vypredá za ` +
        `${mo(sk[2].months)} mesiacov, trojizbových za ${mo(sk[3].months)}. V Česku je ` +
        `ten istý rozdiel ${czGap === 1 ? "jeden mesiac" : `${czGap} mesiace`}.`,
    en: `At the current pace of sales, Slovakia's two-room supply clears in ` +
        `${mo(sk[2].months)} months and its three-room supply in ${mo(sk[3].months)}. ` +
        `In Czechia the same gap is ${czGap === 1 ? "one month" : `${czGap} months`}.`,
  },
  ogImage: "/analyzy/og-2026-09.png",

  blocks: [
    {
      type: "lead",
      text: {
        sk: `Pri súčasnom tempe predaja sa ponuka dvojizbových bytov na Slovensku vypredá ` +
            `za ${mo(sk[2].months)} mesiacov, trojizbových za ${mo(sk[3].months)}. Rovnaký ` +
            `trh, rovnakí kupujúci, rozdiel ${skGap} mesiacov. V Česku, kde sledujeme ` +
            `${d.coverage.czActiveProjects} projektov rovnakým spôsobom, je ten istý rozdiel ` +
            `${czGap === 1 ? "jeden mesiac" : `${czGap} mesiace`}.`,
        en: `At the current pace of sales, Slovakia's two-room supply clears in ` +
            `${mo(sk[2].months)} months and its three-room supply in ${mo(sk[3].months)}. ` +
            `Same market, same buyers, ${skGap} months apart. In Czechia, where we track ` +
            `${d.coverage.czActiveProjects} projects the same way, the gap is ` +
            `${czGap === 1 ? "one month" : `${czGap} months`}.`,
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
        sk: `Zásoba delená mesačným tempom predaja. Slovensko: ` +
            `${n(sk[3].available)} voľných trojizbových bytov, ${n(sk[3].sold)} predaných.`,
        en: `Stock divided by the monthly pace of sales. Slovakia: ` +
            `${n(sk[3].available)} three-room flats available, ${n(sk[3].sold)} sold.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "Prečo je to čas a nie cena",
        en: "Why this shows up as time and not as price",
      },
    },
    {
      type: "p",
      text: {
        sk: `Z ${n(pb.tracked)} medzimesačných porovnaní ceny toho istého bytu sa cena ` +
            `zmenila v ${pct(pb.pctChanged)} prípadov — a z tých zmien ` +
            `${pct(pb.pctOfChangesUp)} smerovalo nahor. Slovenskí developeri cenníky ` +
            `prakticky neznižujú.`,
        en: `Across ${n(pb.tracked)} month-on-month comparisons of the same flat's price, ` +
            `the price changed in ${pct(pb.pctChanged, "en")} of cases — and ` +
            `${pct(pb.pctOfChangesUp, "en")} of those changes were increases. Slovak ` +
            `developers effectively do not cut their price lists.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `To má jeden praktický dôsledok. Ak sa trh nečistí zľavou, čistí sa čakaním — ` +
            `a zle zvolená skladba projektu sa neprejaví na marži, ale na tom, ako dlho ` +
            `bude projekt v predaji. Rozhodnutie o pomere dvojizbových a trojizbových bytov ` +
            `je preto rozhodnutím o dĺžke predaja, a to sa robí pred prvým výkopom.`,
        en: `That has one practical consequence. If a market does not clear through ` +
            `discounts, it clears through waiting — and a badly chosen unit mix shows up ` +
            `not in the margin but in how long the project stays on sale. Deciding the ` +
            `ratio of two- to three-room flats is therefore a decision about the length of ` +
            `the sales period, and it is taken before the first hole is dug.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "Nižšia cena rýchlosť nekupuje",
        en: "A lower price does not buy speed",
      },
    },
    {
      type: "p",
      text: {
        sk: `Slovenské projekty s aspoň 20 voľnými bytmi rozdelené do štvrtín podľa ceny ` +
            `za m²: najlacnejšia štvrtina (≈ ${eurM2(cheap.avgM2)}) potrebuje na vypredanie ` +
            `${mo(cheap.monthsToClear)} mesiacov, najdrahšia (≈ ${eurM2(dear.avgM2)}) ` +
            `${mo(dear.monthsToClear)}. Nejde o veľkosť projektov — mediánová zásoba je ` +
            `v oboch krajných štvrtinách rovnaká (${cheap.medianStock} bytov).`,
        en: `Slovak projects with at least 20 available flats, split into quartiles by price ` +
            `per m²: the cheapest quartile (≈ ${eurM2(cheap.avgM2)}) needs ` +
            `${mo(cheap.monthsToClear)} months to clear, the priciest ` +
            `(≈ ${eurM2(dear.avgM2)}) needs ${mo(dear.monthsToClear)}. This is not project ` +
            `size — median stock is identical in both outer quartiles ` +
            `(${cheap.medianStock} flats).`,
      },
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-3-cena-vs-cas.svg`,
      srcEn: `/analyzy/${slug}-3-cena-vs-cas-en.svg`,
      alt: {
        sk: "Mesiace do vypredania podľa cenovej štvrtiny projektu",
        en: "Months to clear by project price quartile",
      },
      caption: {
        sk: `Slovenské projekty s 20+ voľnými bytmi. n = ${q.reduce((s, r) => s + r.projects, 0)} projektov.`,
        en: `Slovak projects with 20+ available flats. n = ${q.reduce((s, r) => s + r.projects, 0)} projects.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Vzťah platí medzi projektmi, nie vnútri nich — vnútri jedného projektu sa ` +
            `lacnejšie byty predávajú skôr. Čo z toho vyplýva: cenová hladina projektu ` +
            `nepredpovedá, ako rýchlo sa vypredá. Projekt, ktorý sa predáva pomaly, ` +
            `spravidla nemá privysokú cenu — má inú polohu alebo iný produkt, a zľava ` +
            `ani jedno z toho nezmení.`,
        en: `The relationship holds between projects, not inside them — within a single ` +
            `project the cheaper flats sell first. What follows from it: a project's price ` +
            `level does not predict how fast it clears. A project selling slowly usually ` +
            `does not have too high a price — it has a different location or a different ` +
            `product, and a discount changes neither.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "„Regióny“ nie sú jeden trh",
        en: "“The regions” are not one market",
      },
    },
    {
      type: "p",
      text: {
        sk: `Bratislava vypredá svoju ponuku za ${mo(d.monthsToClear.byScope.bratislava.months)} ` +
            `mesiacov, zvyšok Slovenska za ${mo(d.monthsToClear.byScope.rest.months)}. ` +
            `Priemer ale zakrýva to podstatné: ${fastest.city} potrebuje ` +
            `${mo(fastest.months)} mesiacov, ${slowest.city} ${mo(slowest.months)}. ` +
            `Rozdiel medzi slovenskými mestami je väčší než rozdiel medzi Bratislavou ` +
            `a regiónmi ako celkom.`,
        en: `Bratislava clears its supply in ${mo(d.monthsToClear.byScope.bratislava.months)} ` +
            `months, the rest of Slovakia in ${mo(d.monthsToClear.byScope.rest.months)}. ` +
            `The average hides what matters: ${fastest.city} needs ${mo(fastest.months)} ` +
            `months, ${slowest.city} ${mo(slowest.months)}. The spread between Slovak towns ` +
            `is wider than the spread between Bratislava and the regions as a whole.`,
      },
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-2-mesta.svg`,
      srcEn: `/analyzy/${slug}-2-mesta-en.svg`,
      alt: {
        sk: "Mesiace do vypredania ponuky podľa mesta",
        en: "Months to clear supply, by town",
      },
      caption: {
        sk: "Slovenské mestá so 100 a viac voľnými bytmi v novostavbách.",
        en: "Slovak towns with 100 or more available new-build flats.",
      },
    },
    {
      type: "p",
      text: {
        sk: `Cena tú rýchlosť opäť nevysvetľuje. ${slowest.city} má ` +
            `${n(slowest.available)} voľných bytov a najpomalší odbyt zo sledovaných miest, ` +
            `hoci je lacnejšie než Bratislava — medián mimo hlavného mesta je ` +
            `${eurM2(d.restOfSk.medianM2)} oproti ${eurM2(d.bratislava.medianM2)} ` +
            `v Bratislave, ktorá je v súlade s priemerom ${n(d.benchmark.avgM2)} €/m² ` +
            `zverejneným spoločnosťou ${d.benchmark.source} za ${d.benchmark.period}. ` +
            `Pre developera zvažujúceho regionálny projekt to znamená, že nižšia cena ` +
            `pozemku aj bytu sa platí dlhším predajom — a koľko presne, sa dá zistiť ` +
            `pre konkrétne mesto vopred.`,
        en: `Price does not explain that speed either. ${slowest.city} holds ` +
            `${n(slowest.available)} available flats and the slowest absorption of the towns ` +
            `tracked, despite being cheaper than Bratislava — the median outside the capital ` +
            `is ${eurM2(d.restOfSk.medianM2)} against ${eurM2(d.bratislava.medianM2)} in ` +
            `Bratislava, which is in line with the ${n(d.benchmark.avgM2)} €/m² average ` +
            `published by ${d.benchmark.source} for ${d.benchmark.period}. For a developer ` +
            `weighing a regional project, it means the lower price of land and flats is paid ` +
            `for in a longer sales period — and how much longer can be established for a ` +
            `specific town in advance.`,
      },
    },
  ],

  method: {
    sk: `Dáta pochádzajú z verejne publikovaných cenníkov developerov, ktoré Residata ` +
        `zaznamenáva denne ${win.sk}. Mesiace do vypredania = aktuálna ponuka delená ` +
        `priemerným mesačným počtom predajov za sledované obdobie; predpokladá zachovanie ` +
        `tempa. Predaje sú identifikované zo zmien stavu bytu v cenníku developera; ` +
        `zahrnuté sú len byty, nie parkovacie státia, pivnice ani nebytové priestory. ` +
        `Cena za m² je z obytnej plochy vrátane DPH, uvádzame mediány. Priemerná ponuková ` +
        `cena za Bratislavu za ${d.benchmark.period} (${n(d.benchmark.avgM2)} €/m²) ` +
        `pochádza od spoločnosti ${d.benchmark.source}; ostatné čísla sú z vlastných dát.`,
    en: `Data come from developers' publicly published price lists, recorded daily by ` +
        `Residata ${win.en}. Months to clear = current supply divided by the average ` +
        `monthly number of sales over the observed period; it assumes the pace holds. ` +
        `Sales are identified from changes of status in the developer's own price list; ` +
        `flats only — no parking spaces, storage or commercial units. Price per m² is on ` +
        `living area including VAT, and figures are medians. The Bratislava average asking ` +
        `price for ${d.benchmark.period} (${n(d.benchmark.avgM2)} €/m²) is published by ` +
        `${d.benchmark.source}; all other figures are our own.`,
  },
};
