/**
 * Analýza — september 2026, in Slovak and English.
 *
 * TONE — state findings, do not apologise for them.
 *   An earlier draft named the length of our data series in almost every
 *   paragraph and had a whole section on what we could not say. Boss, correctly:
 *   a reader learns little and the company looks weak. The collection period is
 *   a METHOD FACT — it belongs once, in the method block, the way every serious
 *   market analysis handles it. Precision qualifiers stay (a between-project
 *   effect is described as one, because saying otherwise would be wrong), but
 *   they are clauses inside sentences, never sections of their own.
 *
 * Figures interpolate from report-2026-09.json. Never hardcode a number here.
 *
 * PROVENANCE. Ours: supply, sales, mix, quartiles, price moves — our own daily
 * reading of published price lists. Theirs: one figure, Bencont Investments'
 * Q2 Bratislava average, attributed where it is used and in the method block.
 */

import data from "./data/report-2026-09.json";
import { n, pct, eurM2, byIzby, windowPhrase } from "./format";

const d = data;
const W = d.window.sk;
const three = byIzby(d.mixSk, 3);
const two = byIzby(d.mixSk, 2);
const czOne = byIzby(d.mixCz, 1);
const q = d.quartiles.rows;
const cheapest = q[0];
const dearest = q[q.length - 1];
const slug = d.slug;
const win = { sk: windowPhrase(W, "sk"), en: windowPhrase(W, "en") };

export default {
  slug,
  date: d.asOf,
  title: {
    sk: "Dvojizbové byty tvoria polovicu predajov novostavieb na Slovensku",
    en: "Two-room flats account for half of all new-build sales in Slovakia",
  },
  perex: {
    sk: `Dvojizbové byty tvoria ${pct(two.stockPct)} ponuky nových bytov, ale ` +
        `${pct(two.salesPct)} predajov. Pri trojizbových je pomer opačný: ` +
        `${pct(three.stockPct)} ponuky a ${pct(three.salesPct)} predajov.`,
    en: `Two-room flats are ${pct(two.stockPct, "en")} of new-build supply but ` +
        `${pct(two.salesPct, "en")} of sales. Three-room flats run the other way: ` +
        `${pct(three.stockPct, "en")} of supply and ${pct(three.salesPct, "en")} of sales.`,
  },
  ogImage: `/analyzy/${slug}-1-co-sa-predava.svg`,

  blocks: [
    {
      type: "lead",
      text: {
        sk: `Dvojizbové byty tvoria ${pct(two.stockPct)} ponuky nových bytov na Slovensku, ` +
            `ale ${pct(two.salesPct)} predajov. Pri trojizbových je pomer opačný: ` +
            `${pct(three.stockPct)} ponuky a ${pct(three.salesPct)} predajov. Vyplýva to ` +
            `z dát platformy Residata, ktorá denne zaznamenáva cenníky ` +
            `${d.coverage.skActiveProjects} aktívnych rezidenčných projektov na Slovensku ` +
            `a ${d.coverage.czActiveProjects} v Česku.`,
        en: `Two-room flats are ${pct(two.stockPct, "en")} of new-build supply in Slovakia ` +
            `but ${pct(two.salesPct, "en")} of sales. Three-room flats run the other way: ` +
            `${pct(three.stockPct, "en")} of supply and ${pct(three.salesPct, "en")} of ` +
            `sales. The figures come from Residata, which records the price lists of ` +
            `${d.coverage.skActiveProjects} active residential projects in Slovakia and ` +
            `${d.coverage.czActiveProjects} in Czechia every day.`,
      },
    },

    {
      type: "h2",
      text: { sk: "Skladba ponuky nesedí so skladbou dopytu", en: "Supply is not built the way demand buys" },
    },
    {
      type: "p",
      text: {
        sk: `Zo sledovaných ${n(d.mixSk.totalAvailable)} voľných bytov je ` +
            `${pct(three.stockPct)} trojizbových, no z ${n(d.mixSk.totalSold)} ` +
            `zaznamenaných predajov ich bolo ${pct(three.salesPct)}. Rozdiel platí aj po ` +
            `vylúčení piatich najväčších projektov a aj mimo Bratislavy. Rovnaký smer ` +
            `vidno v Česku, kde je najvýraznejší pri jednoizbových bytoch: ` +
            `${pct(czOne.stockPct)} ponuky oproti ${pct(czOne.salesPct)} predajov.`,
        en: `Of the ${n(d.mixSk.totalAvailable)} available flats tracked, ` +
            `${pct(three.stockPct, "en")} are three-room; of the ${n(d.mixSk.totalSold)} ` +
            `recorded sales, ${pct(three.salesPct, "en")} were. The gap holds after ` +
            `excluding the five largest projects and outside Bratislava. The same ` +
            `direction appears in Czechia, sharpest on one-room flats: ` +
            `${pct(czOne.stockPct, "en")} of supply against ${pct(czOne.salesPct, "en")} of sales.`,
      },
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-1-co-sa-predava.svg`,
      srcEn: `/analyzy/${slug}-1-co-sa-predava-en.svg`,
      alt: {
        sk: "Podiel jednotlivých dispozícií na ponuke a na predajoch novostavieb na Slovensku",
        en: "Share of each flat size in Slovak new-build supply versus sales",
      },
      caption: {
        sk: `Podiel na ponuke vs. podiel na predajoch, Slovensko. ` +
            `n = ${n(d.mixSk.totalAvailable)} voľných bytov, ${n(d.mixSk.totalSold)} predaných.`,
        en: `Share of supply vs. share of sales, Slovakia. ` +
            `n = ${n(d.mixSk.totalAvailable)} available, ${n(d.mixSk.totalSold)} sold.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Nepomer v skladbe sa neprejaví na cene, ale na rýchlosti vypredania jednej ` +
            `dispozície. Projekt, ktorý má dopredané dvojizbové byty a plné poschodie ` +
            `trojizbových, nemá cenový problém — má problém so skladbou, a ten sa zľavou ` +
            `rieši draho.`,
        en: `A mismatch in the mix does not show up in price, it shows up in how long one ` +
            `flat size takes to clear. A project sold out of two-room flats with a full ` +
            `floor of three-room ones does not have a pricing problem — it has a mix ` +
            `problem, and discounting is an expensive way to fix that.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "O rýchlosti predaja nerozhoduje cenová hladina",
        en: "Price level is not what decides how fast a project sells",
      },
    },
    {
      type: "p",
      text: {
        sk: `Slovenské projekty s aspoň 20 voľnými bytmi rozdelené do štyroch skupín podľa ` +
            `ceny za m² vykazujú opačný vzťah, než by sa dalo čakať. Najlacnejšia štvrtina ` +
            `(≈ ${eurM2(cheapest.avgM2)}) predala ${pct(cheapest.pctSold)} svojej ponuky, ` +
            `najdrahšia (≈ ${eurM2(dearest.avgM2)}) ${pct(dearest.pctSold)}. Vzťah platí ` +
            `medzi projektmi — vnútri jedného projektu sa lacnejšie byty predávajú skôr. ` +
            `Inak povedané: o predajnosti rozhoduje lokalita a produkt, nie cenník.`,
        en: `Slovak projects with at least 20 available flats, split into four groups by ` +
            `price per m², show the opposite of what might be expected. The cheapest ` +
            `quartile (≈ ${eurM2(cheapest.avgM2)}) sold ${pct(cheapest.pctSold, "en")} of ` +
            `its supply, the priciest (≈ ${eurM2(dearest.avgM2)}) ` +
            `${pct(dearest.pctSold, "en")}. The relationship holds between projects — ` +
            `within one, cheaper flats sell first. Put simply: location and product decide ` +
            `how fast a project sells, not the price list.`,
      },
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-3-cena-vs-rychlost.svg`,
      srcEn: `/analyzy/${slug}-3-cena-vs-rychlost-en.svg`,
      alt: {
        sk: "Podiel ponuky predaný podľa cenovej štvrtiny projektu",
        en: "Share of supply sold, by project price quartile",
      },
      caption: {
        sk: `Slovenské projekty s 20+ voľnými bytmi, rozdelené do štvrtín podľa ceny za m². ` +
            `n = ${q.reduce((s, r) => s + r.projects, 0)} projektov.`,
        en: `Slovak projects with 20+ available flats, split into quartiles by price per m². ` +
            `n = ${q.reduce((s, r) => s + r.projects, 0)} projects.`,
      },
    },

    {
      type: "h2",
      text: { sk: "Polovica trhu je mimo Bratislavy", en: "Half the market is outside Bratislava" },
    },
    {
      type: "p",
      text: {
        sk: `Vo zvyšku Slovenska je ${n(d.restOfSk.available)} voľných bytov v ` +
            `${d.restOfSk.projects} projektoch v ${d.restOfSk.towns} mestách — viac než ` +
            `v Bratislave, kde ich je ${n(d.bratislava.available)} v ` +
            `${d.bratislava.projects} projektoch. Za posledných 90 dní sa v Bratislave ` +
            `predalo ${n(d.sales90d.bratislava)} bytov, mimo nej ${n(d.sales90d.restOfSk)}. ` +
            `Medián ceny je v Bratislave ${eurM2(d.bratislava.medianM2)} obytnej plochy ` +
            `s DPH — v súlade s priemerom ${n(d.benchmark.avgM2)} €/m², ktorý za ` +
            `${d.benchmark.period} zverejnila spoločnosť ${d.benchmark.source} — a mimo nej ` +
            `${eurM2(d.restOfSk.medianM2)}.`,
        en: `The rest of Slovakia holds ${n(d.restOfSk.available)} available flats across ` +
            `${d.restOfSk.projects} projects in ${d.restOfSk.towns} towns — more than ` +
            `Bratislava, where there are ${n(d.bratislava.available)} across ` +
            `${d.bratislava.projects} projects. Over the last 90 days Bratislava sold ` +
            `${n(d.sales90d.bratislava)} flats and the rest of the country ` +
            `${n(d.sales90d.restOfSk)}. The median price in Bratislava is ` +
            `${eurM2(d.bratislava.medianM2)} of living area including VAT — in line with ` +
            `the ${n(d.benchmark.avgM2)} €/m² average ${d.benchmark.source} published for ` +
            `${d.benchmark.period} — and ${eurM2(d.restOfSk.medianM2)} elsewhere.`,
      },
    },
    {
      type: "table",
      head: { sk: ["Mesto", "Voľné byty", "Medián €/m²"], en: ["Town", "Available", "Median €/m²"] },
      rows: d.topCities.map((c) => [c.city, n(c.available), n(c.medianM2)]),
      caption: {
        sk: "Slovenské mestá mimo Bratislavy so 100 a viac voľnými bytmi v novostavbách.",
        en: "Slovak towns outside Bratislava with 100 or more available new-build flats.",
      },
    },

    {
      type: "h2",
      text: { sk: "Ceny sa menia zriedka, ale takmer vždy nahor", en: "Prices move rarely, and almost always upward" },
    },
    {
      type: "p",
      text: {
        sk: `Za posledných 90 dní sme zaznamenali ${n(d.priceMoves90d.moves)} zmien ceny ` +
            `jednotlivých bytov v ${d.priceMoves90d.projects} projektoch. ` +
            `${pct(d.priceMoves90d.pctUp)} z nich smerovalo nahor, medián zmeny bol ` +
            `${pct(d.priceMoves90d.medianPct)}. Väčšina cenníkov sa v danom mesiaci nemení ` +
            `vôbec — keď sa mení, takmer vždy rastie.`,
        en: `Over the last 90 days we recorded ${n(d.priceMoves90d.moves)} changes to ` +
            `individual flat prices across ${d.priceMoves90d.projects} projects. ` +
            `${pct(d.priceMoves90d.pctUp, "en")} were increases, with a median change of ` +
            `${pct(d.priceMoves90d.medianPct, "en")}. Most price lists do not move at all ` +
            `in a given month — when they do, they almost always move up.`,
      },
    },
  ],

  method: {
    sk: `Dáta pochádzajú z verejne publikovaných cenníkov developerov, ktoré Residata ` +
        `zaznamenáva denne ${win.sk}. Cena za m² sa počíta z obytnej plochy vrátane DPH. ` +
        `Predaje sú identifikované zo zmien stavu bytu v cenníku developera; zahrnuté sú ` +
        `len byty, nie parkovacie státia, pivnice ani nebytové priestory. Uvádzame mediány, ` +
        `nie priemery. Priemerná ponuková cena za Bratislavu za ${d.benchmark.period} ` +
        `(${n(d.benchmark.avgM2)} €/m²) pochádza od spoločnosti ${d.benchmark.source}; ` +
        `ostatné čísla sú z vlastných dát.`,
    en: `Data come from developers' publicly published price lists, recorded daily by ` +
        `Residata ${win.en}. Price per m² is calculated on living area including VAT. ` +
        `Sales are identified from changes of status in the developer's own price list; ` +
        `flats only — no parking spaces, storage or commercial units. Figures are medians, ` +
        `not averages. The Bratislava average asking price for ${d.benchmark.period} ` +
        `(${n(d.benchmark.avgM2)} €/m²) is published by ${d.benchmark.source}; all other ` +
        `figures are our own.`,
  },
};
