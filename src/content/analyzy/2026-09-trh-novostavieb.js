/**
 * Analýza — september 2026, in Slovak and English.
 *
 * ONE THESIS, AND EVERY SECTION SERVES IT: this market adjusts in TIME, not in
 * price. Slovak developers effectively never cut a list price, so stock that is
 * mis-mixed or mis-located does not get discounted — it ages. That makes
 * months-to-clear the number worth planning around, and it varies by more than
 * a year on decisions taken before construction starts.
 *
 * WHY MONTHS AND NOT "% SOLD" — Boss killed the first metric and was right:
 * "% of supply sold" rewards a nearly-finished project disposing of its last
 * units and punishes a fresh 200-unit project selling four times as many flats.
 * It measures size and age, not performance.
 *
 * EVERY MONTH FIGURE COMES FROM `monthsDisplay`, never from rounding `months`
 * here. Python's format() rounds 34.5 to 34 (half-to-even) and JavaScript's
 * Math.round gives 35 — so the article once said 35 months beside a chart that
 * said 34. The generator now rounds once and both read that integer.
 *
 * Slovak month counts go through months() for the 1 / 2–4 / 5+ declension.
 *
 * Ours: supply, sales, months-to-clear, quartiles, price behaviour. Theirs: one
 * figure, Bencont's Q2 Bratislava average, attributed where used.
 */

import data from "./data/report-2026-09.json";
import { n, pct, eurM2, windowPhrase, months } from "./format";

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
const scope = d.monthsToClear.byScope;
const pb = d.priceBehaviour;
const slug = d.slug;

const skGap = sk[3].monthsDisplay - sk[2].monthsDisplay;
const czGap = cz[3].monthsDisplay - cz[2].monthsDisplay;
const win = { sk: windowPhrase(W, "sk"), en: windowPhrase(W, "en") };

export default {
  slug,
  date: d.asOf,
  title: {
    sk: "Trojizbový byt sa na Slovensku predáva o rok dlhšie než dvojizbový",
    en: "A three-room flat in Slovakia takes a year longer to sell than a two-room one",
  },
  perex: {
    sk: `Pri súčasnom tempe predaja by sa ponuka dvojizbových bytov na Slovensku vypredala ` +
        `za ${months(sk[2].monthsDisplay)}, trojizbových za ${months(sk[3].monthsDisplay)}. ` +
        `V Česku sa pritom obe dispozície predávajú takmer rovnako rýchlo.`,
    en: `At the current pace of sales, Slovakia's two-room supply would clear in ` +
        `${months(sk[2].monthsDisplay, "en")} and its three-room supply in ` +
        `${months(sk[3].monthsDisplay, "en")}. In Czechia the two sell at almost the same speed.`,
  },
  ogImage: "/analyzy/og-2026-09.png",

  blocks: [
    {
      type: "lead",
      text: {
        sk: `Pri súčasnom tempe predaja by sa ponuka dvojizbových bytov na Slovensku ` +
            `vypredala za ${months(sk[2].monthsDisplay)}, trojizbových za ` +
            `${months(sk[3].monthsDisplay)} — rozdiel ${months(skGap)} na tom istom trhu. ` +
            `V Česku, kde sledujeme ${d.coverage.czActiveProjects} projektov rovnakým ` +
            `spôsobom, sa dvojizbové a trojizbové byty predávajú takmer rovnako rýchlo; ` +
            `delí ich ${months(czGap)}.`,
        en: `At the current pace of sales, Slovakia's two-room supply would clear in ` +
            `${months(sk[2].monthsDisplay, "en")} and its three-room supply in ` +
            `${months(sk[3].monthsDisplay, "en")} — ${months(skGap, "en")} apart on the same ` +
            `market. In Czechia, where we track ${d.coverage.czActiveProjects} projects the ` +
            `same way, two- and three-room flats sell at almost the same speed, ` +
            `${months(czGap, "en")} apart.`,
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
        sk: `Zásoba delená mesačným tempom predaja. Na Slovensku je voľných ` +
            `${n(sk[3].available)} trojizbových bytov; ${win.sk} sa ich predalo ` +
            `${n(sk[3].sold)}.`,
        en: `Stock divided by the monthly pace of sales. Slovakia has ` +
            `${n(sk[3].available)} three-room flats available; ${n(sk[3].sold)} have sold ` +
            `${win.en}.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "Prečo sa to prejaví na čase, a nie na cene",
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
        sk: `To má praktický dôsledok. Ak sa ponuka nepredáva cez zľavu, predáva sa cez ` +
            `čas — a zle zvolená skladba projektu sa neprejaví na cenníku, ale na tom, ako ` +
            `dlho ho developer drží. Rozhodnutie o pomere dvojizbových a trojizbových bytov ` +
            `je preto zároveň rozhodnutím o dĺžke predaja a padá ešte pred začiatkom výstavby.`,
        en: `That has a practical consequence. If supply does not sell through discounts, ` +
            `it sells through time — and a badly chosen unit mix shows up not in the price ` +
            `list but in how long the developer carries it. Deciding the ratio of two- to ` +
            `three-room flats is therefore also a decision about the length of the sales ` +
            `period, and it is taken before construction begins.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "Lacnejší projekt sa nepredáva rýchlejšie",
        en: "A cheaper project does not sell faster",
      },
    },
    {
      type: "p",
      text: {
        sk: `Slovenské projekty s aspoň 20 voľnými bytmi sme rozdelili do štvrtín podľa ` +
            `ceny za m². Najlacnejšej štvrtine (≈ ${eurM2(cheap.avgM2)}) by vypredanie ` +
            `trvalo ${months(cheap.monthsDisplay)}, najdrahšej (≈ ${eurM2(dear.avgM2)}) ` +
            `${months(dear.monthsDisplay)}. Veľkosťou projektov to nie je — mediánová ` +
            `ponuka je v oboch krajných štvrtinách rovnako veľká.`,
        en: `We split Slovak projects with at least 20 available flats into quartiles by ` +
            `price per m². The cheapest quartile (≈ ${eurM2(cheap.avgM2)}) would take ` +
            `${months(cheap.monthsDisplay, "en")} to clear, the priciest ` +
            `(≈ ${eurM2(dear.avgM2)}) ${months(dear.monthsDisplay, "en")}. It is not project ` +
            `size — median supply is the same in both outer quartiles.`,
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
        sk: `Slovenské projekty s 20 a viac voľnými bytmi. n = ${q.reduce((s, r) => s + r.projects, 0)} projektov.`,
        en: `Slovak projects with 20 or more available flats. n = ${q.reduce((s, r) => s + r.projects, 0)} projects.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Vzťah platí medzi projektmi, nie vnútri nich — v rámci jedného projektu sa ` +
            `lacnejšie byty predávajú skôr. Čo z toho vyplýva: cenová hladina nehovorí nič ` +
            `o tom, ako rýchlo sa projekt vypredá. Projekt, ktorý stojí, spravidla nemá ` +
            `privysokú cenu — problém býva v polohe alebo v samotnom produkte, a zľava ` +
            `nezmení ani jedno.`,
        en: `The relationship holds between projects, not inside them — within a single ` +
            `project the cheaper flats sell first. What follows: price level says nothing ` +
            `about how fast a project clears. A project that is stuck usually is not priced ` +
            `too high — the problem tends to be the location or the product itself, and a ` +
            `discount changes neither.`,
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
        sk: `Bratislava by svoju ponuku vypredala za ${months(scope.bratislava.monthsDisplay)}, ` +
            `zvyšok Slovenska za ${months(scope.rest.monthsDisplay)}. Priemer ale zakrýva ` +
            `to podstatné: ${fastest.city} ${months(fastest.monthsDisplay)}, ` +
            `${slowest.city} ${months(slowest.monthsDisplay)}. Rozdiely medzi jednotlivými ` +
            `mestami sú väčšie než rozdiel medzi Bratislavou a regiónmi ako celkom.`,
        en: `Bratislava would clear its supply in ${months(scope.bratislava.monthsDisplay, "en")}, ` +
            `the rest of Slovakia in ${months(scope.rest.monthsDisplay, "en")}. The average ` +
            `hides what matters: ${fastest.city} would take ` +
            `${months(fastest.monthsDisplay, "en")}, ${slowest.city} ` +
            `${months(slowest.monthsDisplay, "en")}. The differences between individual towns ` +
            `are larger than the difference between Bratislava and the regions as a whole.`,
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
        sk: `Ani tu to nie je o cene. ${slowest.city} má ${n(slowest.available)} voľných ` +
            `bytov a najpomalšie tempo zo sledovaných miest pri mediáne ` +
            `${eurM2(slowest.medianM2)}. Najrýchlejšie tempo má pritom mesto s ešte nižším ` +
            `mediánom: ${fastest.city}, ${eurM2(fastest.medianM2)} a ` +
            `${months(fastest.monthsDisplay)} do vypredania. ` +
            `Pre developera, ktorý zvažuje regionálny projekt, z toho vyplýva jedno: ` +
            `lacnejší trh sám o sebe nesľubuje rýchlejší predaj. Ako rýchlo sa predáva ` +
            `v konkrétnom meste, to sa dá zistiť vopred.`,
        en: `Here too it is not about price. ${slowest.city} has ${n(slowest.available)} ` +
            `available flats and the slowest pace of the towns tracked, at a median of ` +
            `${eurM2(slowest.medianM2)}. ${fastest.city} is cheaper still — ` +
            `${eurM2(fastest.medianM2)} — and would clear almost three times faster. For a ` +
            `developer weighing a regional project, one thing follows: a cheaper market does ` +
            `not in itself promise a faster sale. How fast a given town actually sells can be ` +
            `established in advance.`,
      },
    },
  ],

  method: {
    sk: `Dáta pochádzajú z verejne publikovaných cenníkov developerov, ktoré Residata ` +
        `zaznamenáva denne ${win.sk}. Mesiace do vypredania = aktuálna ponuka delená ` +
        `priemerným mesačným počtom predajov za sledované obdobie; údaj predpokladá, že ` +
        `tempo zostane rovnaké. Predaje sa identifikujú zo zmien stavu bytu v cenníku ` +
        `developera; zahrnuté sú len byty, nie parkovacie státia, pivnice ani nebytové ` +
        `priestory. Cena za m² sa počíta z obytnej plochy vrátane DPH; uvádzame mediány. ` +
        `V prehľade miest sú len mestá so 100 a viac voľnými bytmi a aspoň 25 predajmi. ` +
        `Priemerná ponuková cena za Bratislavu za ${d.benchmark.period} ` +
        `(${n(d.benchmark.avgM2)} €/m²) pochádza od spoločnosti ${d.benchmark.source}; ` +
        `ostatné čísla sú z vlastných dát.`,
    en: `Data come from developers' publicly published price lists, recorded daily by ` +
        `Residata ${win.en}. Months to clear = current supply divided by the average monthly ` +
        `number of sales over the observed period; the figure assumes the pace stays the ` +
        `same. Sales are identified from changes of status in the developer's own price ` +
        `list; flats only — no parking spaces, storage or commercial units. Price per m² is ` +
        `calculated on living area including VAT; figures are medians. The town table ` +
        `includes only towns with 100 or more available flats and at least 25 sales. The ` +
        `Bratislava average asking price for ${d.benchmark.period} ` +
        `(${n(d.benchmark.avgM2)} €/m²) is published by ${d.benchmark.source}; all other ` +
        `figures are our own.`,
  },
};
