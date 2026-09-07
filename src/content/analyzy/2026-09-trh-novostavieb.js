/**
 * Analýza — september 2026. The first published issue.
 *
 * Written in the house style Slovak market analyses use (Bencont / TASR / ASB /
 * yimba all share it): a declarative headline that states the finding, the
 * headline number inside the first sentence, a fixed metric order, and a
 * methodology block at the end. That last part is what makes it quotable rather
 * than promotional — it is the reason a journalist can cite it.
 *
 * Every figure below is interpolated from report-2026-09.json, which is generated
 * and self-verified by `python3 -m v2.scripts.market_report` in the scraper repo.
 * Do not hardcode a number here, ever: the whole point is that the text, the
 * charts and the database cannot disagree.
 *
 * The three findings were each stress-tested before publication:
 *   · the disposition mismatch survives excluding the five biggest projects,
 *     excluding Bratislava, and repeats in Czechia;
 *   · the price/velocity relationship is stated as a BETWEEN-project fact, which
 *     is what the data supports. Within a project the cheaper flats sell first —
 *     an earlier draft claimed the opposite and it was wrong.
 *   · the Bratislava median is checked against Bencont's published figure.
 * What is deliberately NOT here — days on market, parking prices — is named in
 * the article itself rather than quietly omitted.
 */

import data from "./data/report-2026-09.json";
import { n, pct, eurM2, byIzby } from "./format";

const d = data;
const three = byIzby(d.mixSk, 3);
const two = byIzby(d.mixSk, 2);
const czOne = byIzby(d.mixCz, 1);
const q = d.quartiles.rows;
const cheapest = q[0];
const dearest = q[q.length - 1];
const slug = d.slug;

export default {
  slug,
  date: d.asOf,
  title: "Dvojizbové byty ťahajú polovicu predajov novostavieb, trojizbových sa stavia priveľa",
  perex:
    `Dvojizbové byty tvoria ${pct(two.stockPct)} ponuky nových bytov na Slovensku, ale ` +
    `${pct(two.salesPct)} všetkých predajov za posledných šesť mesiacov. Pri trojizbových je ` +
    `pomer opačný: ${pct(three.stockPct)} ponuky a len ${pct(three.salesPct)} predajov.`,
  ogImage: `/analyzy/${slug}-1-co-sa-predava.svg`,
  ogImagePng: "/analyzy/og-2026-09.png",

  blocks: [
    {
      type: "lead",
      text:
        `Dvojizbové byty tvoria ${pct(two.stockPct)} ponuky nových bytov na Slovensku, ale ` +
        `${pct(two.salesPct)} všetkých predajov za posledných šesť mesiacov. Pri trojizbových ` +
        `je pomer opačný: ${pct(three.stockPct)} ponuky a len ${pct(three.salesPct)} predajov. ` +
        `Vyplýva to z dát platformy Residata, ktorá denne zaznamenáva cenníky ` +
        `${d.coverage.skActiveProjects} aktívnych rezidenčných projektov na Slovensku ` +
        `a ${d.coverage.czActiveProjects} v Česku.`,
    },

    { type: "h2", text: "Skladba ponuky nesedí so skladbou dopytu" },
    {
      type: "p",
      text:
        `Za posledných 180 dní sa na Slovensku predalo ${n(d.mixSk.totalSold)} bytov ` +
        `z ponuky ${n(d.mixSk.totalAvailable)} voľných. Rozdiel medzi tým, čo je na trhu, ` +
        `a tým, čo sa reálne predáva, je pri trojizbových bytoch ` +
        `${(three.stockPct - three.salesPct).toFixed(1).replace(".", ",")} percentuálneho bodu ` +
        `v neprospech ponuky — sú tretinou trhu a necelou štvrtinou predajov.`,
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-1-co-sa-predava.svg`,
      alt: "Podiel jednotlivých dispozícií na ponuke a na predajoch novostavieb na Slovensku",
      caption:
        `Podiel na ponuke vs. podiel na predajoch, Slovensko, 180 dní. ` +
        `n = ${n(d.mixSk.totalAvailable)} voľných bytov, ${n(d.mixSk.totalSold)} predaných.`,
    },
    {
      type: "p",
      text:
        "Nepomer nie je artefaktom niekoľkých veľkých projektov. Potvrdzuje sa aj po vylúčení " +
        "piatich najväčších predajcov a aj po úplnom vylúčení Bratislavy, kde je rozdiel medzi " +
        "podielom na ponuke a podielom na predajoch ešte výraznejší. V Česku je najvýraznejší " +
        `pri jednoizbových bytoch: ${pct(czOne.stockPct)} ponuky oproti ${pct(czOne.salesPct)} predajov.`,
    },

    { type: "h2", text: "Cena nie je hlavným určujúcim faktorom predajnosti" },
    {
      type: "p",
      text:
        `Slovenské projekty s aspoň 20 voľnými bytmi rozdelené do štvrtín podľa ceny za m² ` +
        `vykazujú opačný vzťah, než by sa dalo čakať. Najlacnejšia štvrtina ` +
        `(≈ ${eurM2(cheapest.avgM2)}) predala za pol roka ${pct(cheapest.pctSold)} svojej ponuky. ` +
        `Najdrahšia štvrtina (≈ ${eurM2(dearest.avgM2)}) predala ${pct(dearest.pctSold)}.`,
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-3-cena-vs-rychlost.svg`,
      alt: "Podiel ponuky predaný za 180 dní podľa cenovej štvrtiny projektu",
      caption:
        `Podiel ponuky predaný za 180 dní, slovenské projekty s 20+ voľnými bytmi, ` +
        `rozdelené do štvrtín podľa ceny za m². n = ${q.reduce((s, r) => s + r.projects, 0)} projektov.`,
    },
    {
      type: "p",
      text:
        "Vzťah platí medzi projektmi, nie vnútri nich — vnútri jedného projektu sa lacnejšie " +
        "byty predávajú skôr. Čítať sa to teda dá takto: o predajnosti projektu nerozhoduje " +
        "primárne cenová hladina, ale lokalita a produkt. Zľava na projekte v slabej lokalite " +
        "ho neposunie do tempa, ktoré dosahujú drahšie projekty v silných lokalitách.",
    },

    { type: "h2", text: "Polovica trhu je mimo Bratislavy" },
    {
      type: "p",
      text:
        `Medián ceny voľných bytov v Bratislave dosahuje ${eurM2(d.bratislava.medianM2)} obytnej ` +
        `plochy s DPH. Je to prakticky totožné s priemerom ${n(d.benchmark.avgM2)} €/m², ktorý za ` +
        `${d.benchmark.period} zverejnila spoločnosť ${d.benchmark.source}. Mimo Bratislavy je ` +
        `medián ${eurM2(d.restOfSk.medianM2)}.`,
    },
    {
      type: "p",
      text:
        `Vo zvyšku Slovenska je momentálne ${n(d.restOfSk.available)} voľných bytov v ` +
        `${d.restOfSk.projects} projektoch v ${d.restOfSk.towns} mestách — teda viac než ` +
        `v Bratislave, kde ich je ${n(d.bratislava.available)} v ${d.bratislava.projects} ` +
        `projektoch. Za posledných 90 dní sa v Bratislave predalo ${n(d.sales90d.bratislava)} ` +
        `bytov, mimo nej ${n(d.sales90d.restOfSk)}.`,
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-2-bratislava-vs-regiony.svg`,
      alt: "Porovnanie Bratislavy a zvyšku Slovenska podľa počtu projektov, voľných bytov a predajov",
      caption:
        `Bratislava vs. zvyšok Slovenska. Predaje za posledných 90 dní.`,
    },
    {
      type: "p",
      text:
        "Ceny v regiónoch sledované sú — NBS aj Realitná únia zverejňujú krajské indexy. " +
        "Nesleduje sa ponuka a predaje na úrovni projektov: koľko bytov je v danom meste " +
        "reálne voľných, koľko sa ich za štvrťrok predalo a ako rýchlo sa sklad hýbe.",
    },
    {
      type: "table",
      head: ["Mesto", "Voľné byty", "Medián €/m²"],
      rows: d.topCities.map((c) => [c.city, n(c.available), n(c.medianM2)]),
      caption: "Slovenské mestá mimo Bratislavy so 100 a viac voľnými bytmi v novostavbách.",
    },

    { type: "h2", text: "Ceny sa menia zriedka, ale takmer vždy nahor" },
    {
      type: "p",
      text:
        `Za posledných 90 dní sme zaznamenali ${n(d.priceMoves90d.moves)} zmien ceny ` +
        `jednotlivých bytov v ${d.priceMoves90d.projects} projektoch. ` +
        `${pct(d.priceMoves90d.pctUp)} z nich smerovalo nahor, medián zmeny bol ` +
        `${pct(d.priceMoves90d.medianPct)}. Väčšina cenníkov sa v danom mesiaci nemení vôbec; ` +
        `keď sa mení, takmer vždy rastie.`,
    },

    { type: "h2", text: "Čo v tejto analýze zámerne nie je" },
    {
      type: "p",
      text:
        `Priemerný čas, ktorý byt strávi na trhu, nezverejňujeme. Dáta zbierame od mája 2026 ` +
        `a ${pct(d.caveats.leftCensoredPct)} bytov, ktoré sa odvtedy predali, bolo na trhu už ` +
        `predtým — vykazovali by sme spodnú hranicu, nie skutočnosť. Použiteľné to bude, keď ` +
        `budeme mať odsledovaný celý životný cyklus dostatočného počtu bytov.`,
    },
    {
      type: "p",
      text:
        `Ceny parkovania a pivníc rovnako nie. Zverejňuje ich ` +
        `${pct(d.caveats.parkingCoveragePct)} slovenských developerov, čo je na seriózne ` +
        `porovnanie málo. Samotné to číslo je ale zaujímavé: cena parkovacieho miesta je ` +
        `pri väčšine projektov informácia, ktorú kupujúci vopred nezistí.`,
    },
  ],

  method:
    "Dáta pochádzajú z verejne publikovaných cenníkov developerov, zaznamenávaných denne " +
    "od mája 2026. Cena za m² sa počíta z obytnej plochy vrátane DPH. Predaje sú " +
    "identifikované zo zmien stavu bytu v cenníku developera, nie z katastra; " +
    "zahrnuté sú len byty, nie parkovacie státia, pivnice ani nebytové priestory. " +
    "Uvádzame mediány, nie priemery — medián neposúva jedna extrémna cena. " +
    "Bunky pod 5 bytov alebo z menej než 2 projektov sa nezobrazujú.",
};
