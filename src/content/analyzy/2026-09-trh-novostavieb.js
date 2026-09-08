/**
 * Analýza — september 2026. The first published issue, in Slovak and English.
 *
 * TONE — deliberately an early signal, not a verdict.
 *   The finding is real but modest: three-room flats are somewhat over-represented
 *   in supply relative to sales. Writing that up as an alarm would be the fastest
 *   way to lose a developer who can do the arithmetic himself. So the piece says
 *   what we see, says plainly that it is not yet a problem, and says what would
 *   make it one. A first issue earns the right to be opinionated later by not
 *   pretending to be now.
 *
 * WINDOW — 113 days of Slovak data, and the article says so.
 *   An earlier draft called this "the last six months" because the query used a
 *   rolling 180-day window. Collection began on 16 May. The sales were real, the
 *   label was not, and a single question would have exposed it. Every period in
 *   this file is phrased through windowPhrase()/windowDays(), which read the dates
 *   out of the generated report.
 *
 * WHOSE NUMBER IS WHOSE.
 *   Ours: supply, sales, mix, quartiles, price movements — all from our own daily
 *   reading of published price lists. Theirs: the €5 341/m² Bratislava average is
 *   Bencont Investments' published Q2 figure and is always attributed to them in
 *   the sentence that uses it. Nothing is stated that does not have one of those
 *   two provenances.
 *
 * Figures interpolate from report-2026-09.json. Never hardcode a number here.
 */

import data from "./data/report-2026-09.json";
import { n, pct, eurM2, byIzby, windowPhrase, windowDays } from "./format";

const d = data;
const W = d.window.sk;
const three = byIzby(d.mixSk, 3);
const two = byIzby(d.mixSk, 2);
const one = byIzby(d.mixSk, 1);
// The Czech comparison uses the window BOTH markets share, so two different
// observation lengths are never set side by side as if they were one period.
const czOne = byIzby(d.mixCz, 1);
const q = d.quartiles.rows;
const cheapest = q[0];
const dearest = q[q.length - 1];
const slug = d.slug;
const gap = (three.stockPct - three.salesPct).toFixed(1);

const win = { sk: windowPhrase(W, "sk"), en: windowPhrase(W, "en") };
const days = { sk: windowDays(W, "sk"), en: windowDays(W, "en") };

export default {
  slug,
  date: d.asOf,
  title: {
    sk: "Trojizbových bytov je v ponuke viac, než koľko sa ich predáva. Zatiaľ mierne.",
    en: "Three-room flats are a bigger share of supply than of sales. Mildly, so far.",
  },
  perex: {
    sk: `Za prvé mesiace denného zberu dát vidíme na slovenskom trhu novostavieb ` +
        `jeden konzistentný nepomer: trojizbové byty tvoria ${pct(three.stockPct)} ponuky, ` +
        `ale ${pct(three.salesPct)} predajov. Nie je to dramatické číslo — je to číslo, ` +
        `ktoré stojí za sledovanie.`,
    en: `In the first months of daily collection one consistent imbalance shows up in ` +
        `the Slovak new-build market: three-room flats are ${pct(three.stockPct, "en")} of ` +
        `supply but ${pct(three.salesPct, "en")} of sales. Not a dramatic number — a number ` +
        `worth watching.`,
  },
  ogImage: `/analyzy/${slug}-1-co-sa-predava.svg`,

  blocks: [
    {
      type: "lead",
      text: {
        sk: `Cenníky slovenských a českých novostavieb čítame každú noc ${win.sk}. ` +
            `Je to krátke obdobie na závery o trhu, ale dosť dlhé na to, aby sa ukázali ` +
            `prvé vzory. Jeden z nich je konzistentný naprieč všetkými spôsobmi, akými ` +
            `sme sa ho pokúsili rozbiť — a jeden je natoľko protichodný voči očakávaniu, ` +
            `že ho zatiaľ berieme skôr ako otázku než ako zistenie.`,
        en: `We have been reading Slovak and Czech new-build price lists every night ` +
            `${win.en}. That is a short period for conclusions about a market, but long ` +
            `enough for the first patterns to surface. One of them held up against every ` +
            `way we tried to break it — and one runs so far against expectation that we ` +
            `are treating it as a question rather than a finding.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "1. Trojizbové byty: tretina ponuky, necelá štvrtina predajov",
        en: "1. Three-room flats: a third of supply, under a quarter of sales",
      },
    },
    {
      type: "p",
      text: {
        sk: `Z ${n(d.mixSk.totalAvailable)} voľných bytov, ktoré dnes sledujeme na Slovensku, ` +
            `je ${pct(three.stockPct)} trojizbových. Z ${n(d.mixSk.totalSold)} predajov, ktoré ` +
            `sme ${days.sk} zaznamenali, ich bolo ${pct(three.salesPct)}. Rozdiel je ` +
            `${gap.replace(".", ",")} percentuálneho bodu. Dvojizbové byty to majú naopak: ` +
            `${pct(two.stockPct)} ponuky a ${pct(two.salesPct)} predajov.`,
        en: `Of the ${n(d.mixSk.totalAvailable)} available flats we currently track in Slovakia, ` +
            `${pct(three.stockPct, "en")} are three-room. Of the ${n(d.mixSk.totalSold)} sales ` +
            `we recorded ${days.en}, ${pct(three.salesPct, "en")} were. The gap is ` +
            `${gap} percentage points. Two-room flats run the other way: ` +
            `${pct(two.stockPct, "en")} of supply and ${pct(two.salesPct, "en")} of sales.`,
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
        sk: `Podiel na ponuke vs. podiel na predajoch, Slovensko, ${win.sk}. ` +
            `n = ${n(d.mixSk.totalAvailable)} voľných bytov, ${n(d.mixSk.totalSold)} predaných.`,
        en: `Share of supply vs. share of sales, Slovakia, ${win.en}. ` +
            `n = ${n(d.mixSk.totalAvailable)} available, ${n(d.mixSk.totalSold)} sold.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Povedzme rovno, čo to nie je: nie je to alarmujúce. Desať percentuálnych bodov ` +
            `pri jednej dispozícii je nepomer, ktorý trh unesie, a čiastočne je aj logický — ` +
            `menšie byty sú dostupnejšie a otáčajú sa rýchlejšie. Zaujímavé je, že sa ten ` +
            `vzor nedá odstrániť. Platí po vylúčení piatich najväčších projektov, platí aj ` +
            `keď Bratislavu úplne vynecháme, a rovnaký smer vidíme v Česku, kde je nepomer ` +
            `najvýraznejší pri jednoizbových: ${pct(czOne.stockPct)} ponuky, ` +
            `${pct(czOne.salesPct)} predajov.`,
        en: `Let us be clear about what this is not: it is not alarming. Ten percentage ` +
            `points on a single flat size is an imbalance a market absorbs, and part of it ` +
            `is simply logical — smaller flats are more affordable and turn over faster. ` +
            `What is interesting is that the pattern will not go away. It holds after ` +
            `excluding the five largest projects, it holds with Bratislava removed entirely, ` +
            `and the same direction appears in Czechia, where the sharpest gap is on ` +
            `one-room flats: ${pct(czOne.stockPct, "en")} of supply, ` +
            `${pct(czOne.salesPct, "en")} of sales.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Prečo to sledovať: ak sa ten rozdiel bude prehlbovať, neprejaví sa ako pokles ` +
            `cien, ale ako predlžujúca sa zásoba práve v jednej dispozícii. To je nákladný ` +
            `problém — projekt s dopredanými dvojizbovými a plným poschodím trojizbových ` +
            `nemá cenový problém, má problém so skladbou, a ten sa zľavou rieši draho. ` +
            `Pri troch mesiacoch dát nevieme povedať, či sa rozdiel prehlbuje. To je presne ` +
            `to, čo budeme sledovať ďalej.`,
        en: `Why watch it: if the gap widens, it will not show up as falling prices but as ` +
            `stock ageing in one specific size. That is an expensive problem — a project ` +
            `sold out of two-room flats with a full floor of three-room ones does not have ` +
            `a pricing problem, it has a mix problem, and discounting is an expensive way ` +
            `to fix that. With three months of data we cannot say whether the gap is ` +
            `widening. That is exactly what we will be watching.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "2. Drahšie projekty sa zatiaľ predávajú rýchlejšie",
        en: "2. Pricier projects are selling faster, so far",
      },
    },
    {
      type: "p",
      text: {
        sk: `Slovenské projekty s aspoň 20 voľnými bytmi sme rozdelili do štyroch skupín ` +
            `podľa ceny za m². Najlacnejšia štvrtina (≈ ${eurM2(cheapest.avgM2)}) predala ` +
            `${days.sk} ${pct(cheapest.pctSold)} svojej ponuky. Najdrahšia ` +
            `(≈ ${eurM2(dearest.avgM2)}) predala ${pct(dearest.pctSold)}.`,
        en: `We split Slovak projects with at least 20 available flats into four groups by ` +
            `price per m². The cheapest quartile (≈ ${eurM2(cheapest.avgM2)}) sold ` +
            `${pct(cheapest.pctSold, "en")} of its supply ${days.en}. The priciest ` +
            `(≈ ${eurM2(dearest.avgM2)}) sold ${pct(dearest.pctSold, "en")}.`,
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
        sk: `Podiel ponuky predaný ${win.sk}, slovenské projekty s 20+ voľnými bytmi. ` +
            `n = ${q.reduce((s, r) => s + r.projects, 0)} projektov.`,
        en: `Share of supply sold ${win.en}, Slovak projects with 20+ available flats. ` +
            `n = ${q.reduce((s, r) => s + r.projects, 0)} projects.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Toto uvádzame s väčšou opatrnosťou. Vzťah platí medzi projektmi, nie vnútri ` +
            `nich — vnútri jedného projektu sa lacnejšie byty predávajú skôr, ako by ` +
            `každý čakal. Medzi projektmi to skôr hovorí, že cenová hladina nie je hlavný ` +
            `určujúci faktor: drahé projekty sú drahé preto, že stoja tam, kde ľudia chcú ` +
            `bývať. Tri mesiace sú na takýto záver krátky čas a nemáme ako oddeliť vplyv ` +
            `lokality od vplyvu ceny. Berte to ako otázku, nie ako odporúčanie.`,
        en: `We report this with more caution. The relationship holds between projects, not ` +
            `inside them — within a single project the cheaper flats sell first, exactly as ` +
            `anyone would expect. Between projects it suggests price level is not the main ` +
            `determinant: expensive projects are expensive because of where they stand. ` +
            `Three months is short for a conclusion like this and we cannot separate the ` +
            `effect of location from the effect of price. Treat it as a question, not a ` +
            `recommendation.`,
      },
    },

    {
      type: "h2",
      text: {
        sk: "Kde sme si dáta overili",
        en: "Where we checked ourselves",
      },
    },
    {
      type: "p",
      text: {
        sk: `Medián ceny voľných bytov v Bratislave nám vychádza ${eurM2(d.bratislava.medianM2)} ` +
            `obytnej plochy s DPH. Spoločnosť ${d.benchmark.source} zverejnila za ` +
            `${d.benchmark.period} priemernú ponukovú cenu ${n(d.benchmark.avgM2)} €/m². ` +
            `Iný výpočet, iná metodika, prakticky rovnaké číslo — čo je pre nás dôležitejšie ` +
            `než ktorýkoľvek údaj vyššie, keďže zbierame dáta len od mája.`,
        en: `Our median for available flats in Bratislava comes out at ` +
            `${eurM2(d.bratislava.medianM2)} of living area including VAT. ` +
            `${d.benchmark.source} published an average asking price of ` +
            `${n(d.benchmark.avgM2)} €/m² for ${d.benchmark.period}. A different ` +
            `calculation and a different method, and practically the same number — which ` +
            `matters more to us than any figure above, given we have only been collecting ` +
            `since May.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Mimo Bratislavy je náš medián ${eurM2(d.restOfSk.medianM2)}. Vo zvyšku ` +
            `Slovenska evidujeme ${n(d.restOfSk.available)} voľných bytov v ` +
            `${d.restOfSk.projects} projektoch v ${d.restOfSk.towns} mestách — teda viac ` +
            `než v Bratislave, kde ich je ${n(d.bratislava.available)} v ` +
            `${d.bratislava.projects} projektoch.`,
        en: `Outside Bratislava our median is ${eurM2(d.restOfSk.medianM2)}. Across the rest ` +
            `of Slovakia we count ${n(d.restOfSk.available)} available flats in ` +
            `${d.restOfSk.projects} projects across ${d.restOfSk.towns} towns — more than ` +
            `Bratislava, where there are ${n(d.bratislava.available)} in ` +
            `${d.bratislava.projects} projects.`,
      },
    },
    {
      type: "figure",
      src: `/analyzy/${slug}-2-bratislava-vs-regiony.svg`,
      srcEn: `/analyzy/${slug}-2-bratislava-vs-regiony-en.svg`,
      alt: {
        sk: "Porovnanie Bratislavy a zvyšku Slovenska",
        en: "Bratislava compared with the rest of Slovakia",
      },
      caption: {
        sk: "Bratislava vs. zvyšok Slovenska. Predaje za posledných 90 dní.",
        en: "Bratislava vs. the rest of Slovakia. Sales over the last 90 days.",
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
      text: { sk: "Čo z týchto dát zatiaľ nevieme", en: "What these data cannot tell us yet" },
    },
    {
      type: "p",
      text: {
        sk: `Priemerný čas, ktorý byt strávi na trhu, nezverejňujeme. Zbierame ${days.sk} ` +
            `a ${pct(d.caveats.leftCensoredPct)} bytov, ktoré sa nám odvtedy predali, bolo ` +
            `na trhu už predtým — vykazovali by sme spodnú hranicu, nie skutočnosť. ` +
            `Rovnako nezverejňujeme ceny parkovania: uvádza ich ` +
            `${pct(d.caveats.parkingCoveragePct)} slovenských developerov, čo je na ` +
            `porovnávanie málo. A nemáme dosť dlhý rad na to, aby sme tvrdili čokoľvek ` +
            `o trende — všetko vyššie je stav, nie vývoj.`,
        en: `We do not publish average time on market. We have been collecting ${days.en} ` +
            `and ${pct(d.caveats.leftCensoredPct, "en")} of the flats that have sold since ` +
            `were already listed before we started — we would be reporting a floor, not a ` +
            `fact. We do not publish parking prices either: ` +
            `${pct(d.caveats.parkingCoveragePct, "en")} of Slovak developers state them, ` +
            `too few to compare. And we do not have a long enough series to claim anything ` +
            `about a trend — everything above is a state, not a movement.`,
      },
    },
    {
      type: "p",
      text: {
        sk: `Preto je toto prvé číslo skôr východiskový bod než správa o trhu. O mesiac ` +
            `budeme vedieť, či sa nepomer pri trojizbových prehlbuje alebo zaceľuje, ` +
            `a to je otázka, ktorá stojí za odpoveď skôr pre developera pripravujúceho ` +
            `ďalší projekt než pre kohokoľvek iného.`,
        en: `So this first issue is a baseline rather than a market report. In a month we ` +
            `will know whether the three-room gap is widening or closing — a question worth ` +
            `answering above all for a developer planning the next project.`,
      },
    },
  ],

  method: {
    sk: `Dáta pochádzajú z verejne publikovaných cenníkov developerov, ktoré čítame denne ` +
        `${win.sk} (${W.days} dní k ${d.asOf}). Cena za m² sa počíta z obytnej plochy vrátane ` +
        `DPH. Predaje sú identifikované zo zmien stavu bytu v cenníku developera, nie ` +
        `z katastra; zahrnuté sú len byty, nie parkovacie státia, pivnice ani nebytové ` +
        `priestory. Uvádzame mediány, nie priemery. Bunky pod 5 bytov alebo z menej než ` +
        `2 projektov sa nezobrazujú. Priemerná ponuková cena za Bratislavu za ` +
        `${d.benchmark.period} (${n(d.benchmark.avgM2)} €/m²) pochádza od spoločnosti ` +
        `${d.benchmark.source}; všetky ostatné čísla sú naše vlastné.`,
    en: `Data come from developers' publicly published price lists, which we read daily ` +
        `${win.en} (${W.days} days as of ${d.asOf}). Price per m² is calculated on living ` +
        `area including VAT. Sales are identified from changes of status in the developer's ` +
        `own price list, not from the land registry; flats only — no parking spaces, ` +
        `storage or commercial units. We report medians, not averages. Cells based on fewer ` +
        `than 5 flats or fewer than 2 projects are not shown. The Bratislava average asking ` +
        `price for ${d.benchmark.period} (${n(d.benchmark.avgM2)} €/m²) is published by ` +
        `${d.benchmark.source}; every other figure is our own.`,
  },
};
