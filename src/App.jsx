import { useState, useEffect, useRef, lazy, Suspense } from "react";
import Ticker from "./components/Ticker";
import LoginModal from "./components/LoginModal";
import CompleteProfile from "./components/CompleteProfile";
import FloatingChat from "./components/FloatingChat";
import { TrialBanner, TrialPopup } from "./components/TrialBanner";
import PendingGate from "./components/PendingGate";
import Feature from "./components/Feature";
import UpgradePrompt from "./components/UpgradePrompt";
// PERF Step 5 (LivePages split): the /live dashboard + project detail are the
// last big modules (~254 KB) that were eager on the landing. Lazy-load them so
// LivePages becomes an on-demand chunk. (LiveAnalytics/LiveAdmin were imported
// here but only used inside the already-lazy PlatformShell — dropped as dead.)
// EarlyAccessBadge was the one tiny thing keeping LivePages eager on the
// landing; it now lives in its own zero-LivePages-dep component.
const LiveDashboard = lazy(() => import("./pages/LivePages").then(m => ({ default: m.LiveDashboard })));
const LiveProjectDetail = lazy(() => import("./pages/LivePages").then(m => ({ default: m.LiveProjectDetail })));
import EarlyAccessBadge from "./components/EarlyAccessBadge";
import CountrySwitcher from "./components/CountrySwitcher";
import CurrencySwitcher from "./components/CurrencySwitcher";
// HowItWorksFlow z HomeExtras bol odstránený — PipelineFlow ho plne
// pokrýva a robí to na živých číslach z useMarketTotals.
import { MarketPulse, DistrictPulse, PipelineFlow } from "./pages/HomeExtras";
// PERF Step 5: code-split — HeroLab is a hidden experimental route, never part
// of the marketing first paint, so load its chunk on demand.
const HeroLabPage = lazy(() => import("./pages/HeroVariants"));
// Legal pages + cookie banner (F-051 — Boss-mandated 2026-05-31 night).
import { PrivacyPage, ImprintPage } from "./pages/LegalPages";
import CookieBanner from "./components/CookieBanner";
import { useAuth } from "./lib/useAuth";
import { useCapabilities } from "./lib/useCapabilities";
import { useCountry } from "./lib/useCountry";
import { useMarketTotals } from "./lib/useData";
import { pushRoute, pathToPage, isAppPage } from "./lib/routing";
import { applySeo } from "./lib/seo";
import { startPageEngagement, stopPageEngagement } from "./lib/engagement";
// PERF Step 5: code-split — the platform shell pulls in the heaviest modules
// (Reports, PivotV2, UnitTracker, admin) which a marketing/first-time visitor
// never needs. Lazy-load it so it's a separate chunk, off the homepage's
// critical bundle. Rendered inside a <Suspense> below.
const PlatformShell = lazy(() => import("./pages/Platform"));
import { track } from "./lib/track";

const pagesEN = ["Home", "Live", "What we deliver", "Use Cases", "Pricing", "Contact"];
const pagesSK = ["Domov", "Live", "Čo dostanete", "Využitie", "Cenník", "Kontakt"];
// Nav labels → internal page key. "Data" is the historical internal
// name for the what-we-deliver / sample page; we keep it for route
// stability (/sample URL still resolves) but the user-facing label
// is now "Čo dostanete" / "What we deliver".
const pageMap = {
  "Domov": "Home",
  "Ukážka": "Data",             // legacy SK label still resolves
  "Čo dostanete": "Data",
  "Využitie": "Use Cases",
  "Cenník": "Pricing",
  "Kontakt": "Contact",
  "Sample": "Data",             // legacy EN label still resolves
  "What we deliver": "Data",
};

const t = {
  en: {
    // Nav
    getAccess: "Get Access",
    // Hero
    // heroBadge text is computed in HomePage from live projects.length —
    // see `heroBadgeText` near the top of HomePage(). No static fallback.
    heroTitle1: "Slovak residential market,",
    heroTitle2: "fully transparent.",
    heroSub: "We monitor every new residential development across Slovakia and turn scattered listings into actionable market intelligence — so you can make pricing, investment, and portfolio decisions based on data.",
    heroBtn1: "Get Access",
    heroBtn2: "See Sample Data",
    // Value prop
    valueLabel: "What We Deliver",
    valueTitle: "Not just data. Answers.",
    valueDesc: "Every month you get a full snapshot of the Slovak new-build market — unit-level data across every active project, plus the insights you need to act on it.",
    questionsLabel: "Questions we help you answer",
    questions: [
      "What should I price my 2-bedroom units at in Ružinov to stay competitive?",
      "If I build in Záhorská Bystrica, how long until I sell out based on current absorption?",
      "My project costs €50M to build — are market prices high enough to cover costs and deliver 20% margin?",
      "How fast is Bory selling compared to last quarter — is momentum building or slowing?",
      "Where is supply running low? Which districts will have no new inventory within 6 months?",
      "What's the realistic price range for 60m² in Petržalka — and where does 90% of demand sit?",
      "Which competitor projects are about to sell out — what can I learn from their pricing?",
    ],
    deliveryLabel: "Every month you get",
    deliveryItems: [
      ["Competitive pricing intelligence", "Know exactly what every project charges per m² — by district, unit type, and phase. Benchmark your own pricing against the entire market."],
      ["Sell-through velocity", "See which projects are selling fast and which are stalling. Spot momentum shifts before the market does."],
      ["Supply & pipeline tracking", "Track new launches, upcoming phases, and total inventory — know what's coming so you're never caught off guard."],
      ["Absorption analysis", "Understand how fast the market absorbs new units by district and segment. Critical for launch timing and feasibility."],
      ["Historical trends", "Month-over-month snapshots let you track pricing direction and velocity — not just where the market is, but where it's heading."],
    ],
    flexTitle: "On-Demand plan — we adapt to your needs.",
    flexDesc: "Need weekly updates instead of monthly? Want to cover Košice, Brno, or Prague? Need a custom output format for your internal tools or a different property segment? The pipeline is built to be reconfigured — we adapt scope, frequency, and delivery to match your workflow.",
    // Use Cases
    useCasesLabel: "Use Cases",
    useCasesTitle: "Built for professionals who need\nto understand the market.",
    useCasesDesc: "Different roles, similar problem — you need reliable, current data on the residential market. Here's how different teams benefit from Residata's intelligence.",
    useCases: [
      { tag: "Developers & Sales Teams", title: "Know exactly where to price.",
        desc: "You're launching a new phase and need to set prices. But what are comparable projects actually charging? How fast are they selling? Are you leaving money on the table — or pricing yourself out?",
        benefits: [["Side-by-side competitor pricing", "see €/m² across every comparable project in your district — broken down by unit type, floor, and phase"], ["Sell-through velocity ranking", "know which projects moved the most units last month — and which ones are sitting still"], ["Inventory countdown", "track how many units your competitors have left — time your launches to hit gaps in supply"]] },
      { tag: "Investors & Private Equity", title: "Underwrite with market reality.",
        desc: "You're evaluating a resi development deal. The developer says demand is strong and prices are rising. But is that true — and is it true for your specific district, unit mix, and price point?",
        benefits: [["Absorption rates by segment", "how many units actually sell per month in each district — the number that makes or breaks your IRR"], ["Historical price trajectories", "6–12 months of €/m² movement so you can model scenarios based on real trends, not assumptions"], ["Feasibility stress test", "compare your target sell price against what the market is actually paying — by m², type, and location"]] },
      { tag: "Banks & Valuers", title: "Comparable data, ready to use.",
        desc: "You need market comparables for a valuation or collateral assessment — but gathering them manually from 90+ developer websites and transforming them into a usable format takes weeks. And getting historical data retrospectively is impossible. We've already done it for you.",
        benefits: [["Structured comparable listings", "pricing by location, unit type, floor area, and availability — filterable and exportable"], ["Market depth overview", "how many active projects and units exist in a given district — essential context for any valuation"], ["Monthly refresh", "your comparables are never more than 30 days old — no more working with stale data from last quarter"]] },
      { tag: "Consultants & Analysts", title: "Hours of research, done for you.",
        desc: "Your client needs a market overview for Bratislava residential. You can spend 2–4 weeks clicking through developer websites, copy-pasting into spreadsheets, fighting inconsistent formats, chasing down broken links, and cleaning messy data — or open a single sheet with everything already structured, normalized, and ready to analyze.",
        benefits: [["Presentation-ready data", "normalized columns across every active project — drop straight into models, charts, or client decks"], ["Trend analysis built in", "monthly snapshots mean you can show pricing direction and market shifts without extra work"], ["Full market coverage", "apartments, houses, retail, semidetached — across every active district. No gaps to fill manually"]] },
    ],
    useCasesCta: "Different need?",
    useCasesCtaDesc: "The pipeline is flexible. If your use case isn't listed, reach out — we likely already have what you need, or can configure it.",
    useCasesCtaBtn: "See Pricing",
    whatYouGet: "What you get",
    // Data / Sample page — focuses on INSIGHTS + RAW SAMPLE + SCHEMA.
    // Live market numbers (totals, trends, district prices) are shown on Home
    // via MarketPulse / DistrictPulse — we don't duplicate them here.
    dataLabel: "Sample Output",
    dataTitle: "This is what you get.",
    dataDesc: "Five concrete insight types, a raw unit-level sample, and the full schema. Same depth, every month.",
    dataContext: "Slovak New-Build Market — March 2026",
    dataContextSub: "Monthly snapshot · all active residential projects",
    insightsLabel: "Market Insights",
    insightsTitle: "What the data tells you.",
    insightsDesc: "Examples of the insights you can extract from each monthly delivery. The kind of edge that's hard to build in-house — and expensive to live without. The five cards below are illustrative examples — paid subscribers see the live versions in their dashboard, derived from the current snapshot.",
    // F-062 (Boss 2026-05-31): these cards contain illustrative numbers, not
    // live derived values. Badge wording made explicit so customers don't
    // read them as live insights. Real numbers ship in the paid dashboard.
    insightsBadge: "Illustrative examples · live in dashboard",
    rawLabel: "Raw Data",
    unitSample: "Unit-level sample",
    // `showing` is overridden per render in DataPage with live units-tracked
    // count from the metrics table. This static fallback only shows in the
    // ~100ms before the hook resolves (graceful "…" number).
    showing: "Showing 8 of … records",
    schemaLabel: "Schema",
    schemaTitle: "Every data point per unit — key fields below.",
    schemaDesc: "Additional fields include orientation, balcony area, parking, storage, and project-level metadata.",
    schemaNote: "Note: Field availability varies by project. Not all developers publish all data points.",
    wantFull: "Want the full dataset?",
    wantFullDesc: "This is a sample. The full output covers every unit across every active Bratislava new-build project, refreshed every month.",
    // Pricing
    pricingLabel: "Pricing",
    pricingTitle: "Simple, transparent pricing.",
    pricingDesc: "Choose the plan that fits your needs. Start with a one-time report or get ongoing market intelligence.",
    testimonial: "When you're making pricing decisions on a project worth €30M+, you can't afford to guess what the market will bear. Residata gives us the full picture — what comparable projects charge, how fast they sell, where supply is tightening. For the cost of a dinner, we get data that directly impacts millions in revenue.",
    testimonialFrom: "From a client",
    testimonialName: "Marek T.",
    testimonialRole: "Head of Residential Development in Bratislava",
    commonQ: "Common questions",
    faqs: [
      ["What do I actually receive?", "You get a structured market report with insights, visualizations, and recommendations — covering pricing trends, absorption rates, competitive positioning, and supply dynamics. We also include raw and cleaned datasets so you can run your own analysis if needed."],
      ["How often is the data updated?", "Standard delivery is monthly. We can go as frequent as weekly — and technically even daily, but we recommend weekly at most. Shorter intervals rarely justify the cost, as the new-build market doesn't shift that fast."],
      ["Can you cover cities beyond Bratislava?", "Yes. The pipeline is market-agnostic — we can configure it for any city or region where developer data is publicly listed. This falls under our Custom plan."],
      ["Can I add specific projects or developers to track?", "Absolutely. If a project is publicly listed, we can add it to the registry. Custom clients can request additions at any time."],
    ],
    notSure: "Not sure which plan fits?",
    notSureDesc: "Reach out and we'll walk you through the data, the pipeline, and which option makes sense for your use case.",
    getInTouch: "Get in Touch",
    // Contact
    contactLabel: "Contact",
    contactTitle: "Let's talk.",
    contactDesc: "Whether you want to see a demo, explore a specific plan, or simply learn how Residata can support your market decisions — we'd love to hear from you.",
    emailDesc: "Detailed inquiries & data requests",
    phoneDesc: "Quick questions or scheduling a call",
    bookCall: "Book a 20-min intro call",
    sendEmail: "Send an Email",
    whatToExpect: "What to expect",
    steps: [
      ["1", "Intro call or email exchange", "We learn about your use case — what decisions you're making, what data you're currently missing, and what format works for you."],
      ["2", "Sample delivery", "You get a real sample from the latest pipeline run — not a demo, actual data — so you can evaluate the quality and depth firsthand."],
      ["3", "Tailored setup", "We configure scope, frequency, and output format to match your workflow. You start receiving monthly (or more frequent) deliveries."],
      ["4", "Ongoing market edge", "Every delivery gives you a clear view of the market — competitive pricing, absorption trends, supply shifts, and sell-out signals. The kind of insight that turns guesswork into confident decisions."],
    ],
    // Tiers
    tiers: [
      { tier: "Snapshot", name: "One-time report", price: "€249", note: "Single month, one-time delivery",
        features: [[true, "Full market report with insights"], [true, "Unit-level data — every active project"], [true, "Pricing benchmarks & visualizations"], [false, "No historical data"], [false, "No ongoing updates"]], cta: "Get Started" },
      { tier: "Standard", name: "Monthly delivery", price: "€349", priceSuffix: "/mo", note: "Billed monthly, cancel anytime",
        features: [[true, "Monthly report with full insights"], [true, "Raw + cleaned datasets included"], [true, "Historical snapshots & trend analysis"], [true, "Absorption rates & sell-out tracking"], [true, "Google Sheets, CSV, or API access"]], featured: true, cta: "Get Started" },
      { tier: "Custom", name: "On-Demand & Enterprise", price: "Let's talk.", isCustom: true, note: "Tailored scope, frequency, and delivery",
        features: [[true, "Everything in Standard"], [true, "Weekly or bi-weekly updates"], [true, "Coverage beyond Bratislava"], [true, "Additional markets or property types"], [true, "Custom integrations and output formats"]], cta: "Contact Us" },
    ],
    mostPopular: "Most Popular",
    seePricing: "See Pricing",
  },
  sk: {
    getAccess: "Kontakt",
    // heroBadge text počíta HomePage z live projekt count — viď `heroBadgeText`.
    heroTitle1: "Novostavby na Slovensku.",
    heroTitle2: "Celý trh v jednom prehľade.",
    heroSub: "Ceny, dostupnosť, rýchlosť predaja. Všetko v prehľadných reportoch, na základe ktorých môžete robiť dátami podložené rozhodnutia.",
    heroBtn1: "Kontaktujte nás",
    heroBtn2: "Ukážka dát",
    valueLabel: "Čo dodávame",
    valueTitle: "Nie len dáta. Odpovede.",
    valueDesc: "Každý mesiac dostanete kompletný prehľad trhu novostavieb na Slovensku — každý byt, každý projekt. A to aj s insightmi, na základe ktorých viete hneď konať.",
    questionsLabel: "Otázky, na ktoré vám Residata odpovie",
    questions: [
      "Ako naceniť 2-izbáky v Ružinove, aby boli konkurencieschopné?",
      "Ak staviam bytovku v Záhorskej Bystrici, ako rýchlo sa vypredá na základe aktuálnych predajných trendov?",
      "Náklady na potenciálny projekt sú €50M — unesie trh ceny, ktoré potrebujem na dosiahnutie 20% marže?",
      "Predávajú sa Bory rýchlejšie alebo pomalšie ako v minulom kvartáli?",
      "Kde dochádza ponuka? Kde nebudú nové byty do pol roka?",
      "Za koľko sa reálne predáva 60m² byt v Petržalke?",
      "Ktoré projekty sú takmer vypredané a čo sa vieme naučiť z ich cenotvorby?",
    ],
    deliveryLabel: "Každý mesiac dostanete",
    deliveryItems: [
      ["Ceny konkurencie", "Koľko si účtuje každý projekt za m² — podľa časti mesta, typu bytu alebo kľudne aj poschodia."],
      ["Rýchlosť predaja", "Ktoré projekty sa hýbu a ktoré stoja. Zachytíte zmenu trendu skôr ako ostatní."],
      ["Nová ponuka na trhu", "Čo sa chystá, čo sa práve spustilo, koľko bytov je celkovo v ponuke."],
      ["Absorpcia", "Koľko bytov sa reálne predá mesačne — za daný projekt, mestskú časť, alebo aj celkovo."],
      ["Cenové trendy", "Kam smerujú ceny a akou rýchlosťou sa menia. Nielen aktuálny stav, ale aj vývoj."],
    ],
    flexTitle: "On-Demand plán — prispôsobíme sa vašim potrebám.",
    flexDesc: "Týždenné aktualizácie? Pokrytie Košíc, Brna alebo Prahy? Iný formát? Žiadny problém — rozsah, frekvenciu aj doručenie nastavíme podľa vašich preferencií.",
    useCasesLabel: "Residata",
    useCasesTitle: "Pre profesionálov, ktorí potrebujú\nrozumieť trhu.",
    useCasesDesc: "Rôzne role, podobná potreba — aktuálne a spoľahlivé dáta o rezidenčnom trhu. Tu je to, ako rôzne tímy využívajú Residatu.",
    useCases: [
      { tag: "Developeri a obchodné tímy", title: "Spoľahlivé podklady na nacenenie.",
        desc: "Spúšťate novú fázu a riešite ceny. Koľko si účtuje konkurencia? Ako rýchlo sa podobný projekt predáva? Naceňujete byty správne?",
        benefits: [["Prehľady cien konkurencie", "€/m² za každý porovnateľný projekt vo vami zvolenej lokalite — podľa typu, poschodia a fázy"], ["Kto predáva najrýchlejšie", "ktoré projekty predali najviac bytov minulý mesiac — a ktoré stoja"], ["Koľko kapacity zostáva u konkurencie voľnej?", "sledujte voľné jednotky a medzery na trhu"]] },
      { tag: "Investori a Private Equity", title: "Investícia podložená dátami.",
        desc: "Posudzujete development deal. Developer tvrdí, že dopyt je silný a ceny rastú. Platí to aj pre váš konkrétny okres, mix bytov a cenovú hladinu?",
        benefits: [["Absorpcia podľa segmentu", "koľko bytov sa reálne predá mesačne v každom okrese — číslo, na ktorom stojí vaše IRR"], ["Vývoj cien za 6–12 mesiacov", "reálne trendy €/m² pre modelovanie scenárov — nie odhady, ale dáta"], ["Stress test feasibility", "porovnajte cieľovú cenu s tým, čo trh reálne platí"]] },
      { tag: "Banky a znalci", title: "Komparatívy hotové na použitie.",
        desc: "Potrebujete trhové komparatívy na ocenenie alebo kolaterál — ale zbierať ich ručne z 90+ webov developerov a transformovať ich do použiteľného formátu trvá týždne. A získanie historických dát spätne je nemožné. My sme to urobili za vás.",
        benefits: [["Štruktúrované ponuky", "ceny podľa lokality, typu, plochy a dostupnosti — filtrovateľné a exportovateľné"], ["Hĺbka trhu", "koľko projektov a bytov je v okrese aktívnych — kontext pre každé ocenenie"], ["Vždy aktuálne", "komparatívy nikdy nie sú staršie ako 30 dní"]] },
      { tag: "Konzultanti a analytici", title: "Hodiny práce, hotové za vás.",
        desc: "Klient chce prehľad bratislavského trhu. Buď strávite týždne zbieraním dát po weboch — alebo otvoríte jeden sheet, kde je všetko pripravené.",
        benefits: [["Dáta na prezentáciu", "normalizované stĺpce naprieč každým aktívnym projektom — rovno do modelov, grafov alebo klientskych prezentácií"], ["Trendy zahrnuté", "cenový smer a trhové posuny ukážete bez ďalšej práce"], ["Kompletné pokrytie", "byty, domy, apartmány — žiadne medzery"]] },
    ],
    useCasesCta: "Hľadáte riešenie na mieru?",
    useCasesCtaDesc: "Systém je flexibilný. Ak tu nevidíte riešenie na svoj špecifický problém, ozvite sa — veľmi pravdepodobne vám vieme pomôcť riešením na mieru.",
    useCasesCtaBtn: "Pozrieť cenník",
    whatYouGet: "Čo dostanete",
    dataLabel: "Ukážka výstupu",
    dataTitle: "Takto vyzerá výstup.",
    dataDesc: "Päť konkrétnych typov insightov, ukážka dát na úrovni bytu, a kompletná schéma výstupu. Rovnaká hĺbka, každý mesiac.",
    dataContext: "Trh novostavieb Slovensko — Marec 2026",
    dataContextSub: "Mesačný prehľad · všetky aktívne projekty",
    insightsLabel: "Trhové insighty",
    insightsTitle: "Čo z toho vidíte.",
    insightsDesc: "Príklady insightov z mesačnej dodávky. Informačná výhoda proti konkurencii. Päť kariet nižšie sú ilustračné príklady — platiaci klienti vidia živé verzie vo svojom dashboarde, vypočítané z aktuálneho snapshotu.",
    insightsBadge: "Ilustračné príklady · live v dashboarde",
    rawLabel: "Surové dáta",
    unitSample: "Ukážka na úrovni bytov",
    // Prepisujeme live v DataPage cez useMarketTotals; fallback kým sa načíta.
    showing: "Zobrazených 8 z … záznamov",
    schemaLabel: "Schéma",
    schemaTitle: "Každý dátový bod na byt — kľúčové polia nižšie.",
    schemaDesc: "Ďalšie polia: orientácia, balkón, parkovanie, sklad a metadáta projektu.",
    schemaNote: "Poznámka: Nie všetci developeri zverejňujú všetky údaje — dostupnosť polí sa líši.",
    wantFull: "Máte záujem o kompletný dataset?",
    wantFullDesc: "Toto je ukážka. Celý výstup pokrýva každý byt v každom aktívnom bratislavskom novostavebnom projekte, obnovovaný každý mesiac.",
    pricingLabel: "Cenník",
    pricingTitle: "Transparentný a jednoduchý.",
    pricingDesc: "Vyberte si plán, ktorý sedí vám.",
    testimonial: "Keď naceňujete projekt za €30M+, nemôžete hádať čo trh unesie. Residata nám dáva kompletný obraz o trhu — čo si účtuje konkurencia, ako rýchlo predáva, kde sa ponuka zužuje, kde rastie dopyt a po akom type nehnuteľnosti. Za cenu jednej večere máme dáta, na základe ktorých robíme rozhodnutia za stovky tisíc eur.",
    testimonialFrom: "Od klienta",
    testimonialName: "Marek T.",
    testimonialRole: "Head of Residential Development v Bratislave",
    commonQ: "Časté otázky",
    faqs: [
      ["Čo presne dostanem?", "Trhovú správu s insightmi, vizualizáciami a odporúčaniami — cenové trendy, absorpcia, konkurenčné porovnanie, dynamika ponuky. Súčasťou sú aj surové a vyčistené datasety pre vlastnú analýzu."],
      ["Ako často sa dáta aktualizujú?", "Štandardne mesačne. Dataset a vývoj vieme aktualizovať aj každých 5 minút, ale odporúčame max. raz týždenne — trh novostavieb sa tak rýchlo nemení a cena by bola zbytočne vysoká."],
      ["Pokrývate aj iné mestá?", "Áno. Systém funguje pre akékoľvek mesto s verejne dostupnými dátami. Táto služba spadá pod Custom plán a nacenenie záleží na požadovaných špecifikách."],
      ["Dá sa pridať konkrétny projekt?", "Samozrejme. Ak je verejne dostupný a nie je v našom datasete, prosím ozvite sa nám a radi ho pridáme. Custom klienti môžu požiadať aj o pridanie alebo analýzu projektu mimo Bratislavy."],
    ],
    notSure: "Neviete ktoré riešenie je pre vás vhodné?",
    notSureDesc: "Radi vám pomôžeme počas bezplatnej konzultácie.",
    getInTouch: "Napíšte nám",
    contactLabel: "Kontakt",
    contactTitle: "Ozvite sa.",
    contactDesc: "Chcete demo, máte otázky, alebo chcete vedieť či vám Residata pomôže — radi sa porozprávame.",
    emailDesc: "Podrobné otázky a žiadosti o dáta",
    phoneDesc: "Rýchle otázky alebo dohodnutie hovoru",
    bookCall: "Dohodnúť si 20-min hovor",
    sendEmail: "Napísať email",
    whatToExpect: "Ako to prebieha",
    steps: [
      ["1", "Úvodný hovor alebo email", "Zistíme čo riešite, aké dáta vám chýbajú a v akom formáte ich chcete."],
      ["2", "Ukážka na reálnych dátach", "Pošleme vám ukážku z posledného behu — reálne dáta, nie demo."],
      ["3", "Nastavenie na mieru", "Nastavíme rozsah, frekvenciu a formát podľa vás. Začnete dostávať pravidelné dodávky."],
      ["4", "Priebežná výhoda", "Každá dodávka = jasný pohľad na trh. Ceny, absorpcia, ponuka, signály vypredania. Rozhodujete sa na dátach, nie na pocite."],
    ],
    tiers: [
      { tier: "Snapshot trhu", name: "Jednorazový prehľad", price: "€249", note: "Jeden mesiac, jednorazové doručenie",
        features: [[true, "Kompletný trhový prehľad s insightmi"], [true, "Dáta za každý byt — všetky aktívne projekty"], [true, "Cenové porovnania a vizualizácie"], [false, "Bez historických dát"], [false, "Bez priebežných aktualizácií"]], cta: "Mám záujem" },
      { tier: "Standard", name: "Mesačné doručenie", price: "€349", priceSuffix: "/mes", note: "Fakturované mesačne, zrušenie kedykoľvek",
        features: [[true, "Mesačná správa s kompletnými insightmi"], [true, "Surové + vyčistené datasety"], [true, "Historické dáta a vývoj trendov"], [true, "Absorpcia a sledovanie vypredania"], [true, "Google Sheets, CSV alebo API"]], featured: true, cta: "Mám záujem" },
      { tier: "Custom", name: "On-Demand & Enterprise", price: "Ozvite sa.", isCustom: true, note: "Rozsah a frekvencia podľa vás",
        features: [[true, "Všetko v Standard"], [true, "Týždenné alebo dvojtýždenné aktualizácie"], [true, "Pokrytie akejkoľvek lokality (aj mimo Slovenska)"], [true, "Ďalšie trhy alebo typy nehnuteľností"], [true, "Vlastné integrácie a formáty"]], cta: "Kontaktovať" },
    ],
    mostPopular: "Najobľúbenejší",
    seePricing: "Pozrieť cenník",
  },
};

/* ─── Country-aware copy localization ────────────────────────────────────
 * The base copy (t[lang]) names the primary market (Bratislava). For other
 * markets we localize via two layers, applied in order by localizedCopy():
 *
 *   1. RULES — ordered literal find→replace pairs applied to EVERY string in
 *      the copy tree (deepLocalize). Base-copy edits propagate to all markets
 *      automatically, so there are no parallel hand-maintained copies to drift.
 *      Most-specific-first (e.g. "Bratislavy" before bare "Bratislava") so
 *      inflected forms win before the bare token.
 *   2. OVERRIDES — explicit whole-value replacements that WIN over the rules.
 *      Used only where a blind swap can't be correct: the example QUESTIONS
 *      (verb agreement is coupled to the named district) and the flex-plan
 *      "other cities" list (a different city set per market).
 *
 * SK = no entry → base copy, byte-identical. CZ = Bratislava→Praha (+ BA→Prague
 * districts in the questions). "all" (combined SK+CZ, the default) broadens only
 * the market-named hero/value strings to both countries; incidental mentions
 * (the client testimonial's city, example districts) stay base — they're not
 * market claims, and the combined view leads with the primary market.
 */
const COUNTRY_LOCALIZE = {
  CZ: {
    rules: {
      // Two layers: the country-level MARKET CLAIMS (Slovak→Czech; "Slovak"→
      // "Czech" also turns "Slovakia"→"Czechia" since Slovakia = Slovak+ia) AND
      // the incidental CITY examples (Bratislava→Prague). English has no
      // inflection so one pair each covers every occurrence.
      en: [["Slovak", "Czech"], ["Bratislava", "Prague"]],
      // Slovak: country-level claims first (na Slovensku→v Česku, Slovensko→
      // Česko), then the inflected city forms (most-specific first so an earlier
      // rule never leaves a half-replaced stem for a later one).
      sk: [
        ["na Slovensku", "v Česku"],
        ["Slovensko", "Česko"],
        ["v Bratislave", "v Prahe"],
        ["bratislavského", "pražského"],
        ["bratislavskom", "pražskom"],
        ["mimo Slovenska", "mimo Česka"],
        ["Bratislavy", "Prahy"],
        ["Bratislava", "Praha"],
      ],
    },
    overrides: {
      en: {
        questions: [
          "What should I price my 2-bedroom units at in Vinohrady to stay competitive?",
          "If I build in Letňany, how long until I sell out based on current absorption?",
          "My project costs €50M to build — are market prices high enough to cover costs and deliver 20% margin?",
          "How fast is Smíchov City selling compared to last quarter — is momentum building or slowing?",
          "Where is supply running low? Which districts will have no new inventory within 6 months?",
          "What's the realistic price range for 60m² in Modřany — and where does 90% of demand sit?",
          "Which competitor projects are about to sell out — what can I learn from their pricing?",
        ],
        flexDesc: "Need weekly updates instead of monthly? Want to cover Brno, Ostrava, or Bratislava? Need a custom output format for your internal tools or a different property segment? The pipeline is built to be reconfigured — we adapt scope, frequency, and delivery to match your workflow.",
      },
      sk: {
        questions: [
          "Ako naceniť 2-izbáky vo Vinohradoch, aby boli konkurencieschopné?",
          "Ak staviam bytovku v Letňanoch, ako rýchlo sa vypredá na základe aktuálnych predajných trendov?",
          "Náklady na potenciálny projekt sú €50M — unesie trh ceny, ktoré potrebujem na dosiahnutie 20% marže?",
          "Predáva sa Smíchov City rýchlejšie alebo pomalšie ako v minulom kvartáli?",
          "Kde dochádza ponuka? Kde nebudú nové byty do pol roka?",
          "Za koľko sa reálne predáva 60m² byt v Modřanoch?",
          "Ktoré projekty sú takmer vypredané a čo sa vieme naučiť z ich cenotvorby?",
        ],
        flexDesc: "Týždenné aktualizácie? Pokrytie Brna, Ostravy alebo Bratislavy? Iný formát? Žiadny problém — rozsah, frekvenciu aj doručenie nastavíme podľa vašich preferencií.",
      },
    },
  },
  // "all" = combined SK+CZ view (the default). Overrides only (no blanket rules)
  // so the market-claim hero/value strings broaden to both countries while
  // incidental "Bratislava" mentions (testimonial city, example districts) stay.
  all: {
    overrides: {
      en: {
        heroTitle1: "Slovak & Czech residential market,",
        heroSub: "We monitor every new residential development across Slovakia and Czechia and turn scattered listings into actionable market intelligence — so you can make pricing, investment, and portfolio decisions based on data.",
        valueDesc: "Every month you get a full snapshot of the Slovak & Czech new-build market — unit-level data across every active project, plus the insights you need to act on it.",
        dataContext: "Slovak & Czech New-Build Market",
      },
      sk: {
        heroTitle1: "Novostavby na Slovensku a v Česku.",
        valueDesc: "Každý mesiac dostanete kompletný prehľad trhu novostavieb na Slovensku a v Česku — každý byt, každý projekt. A to aj s insightmi, na základe ktorých viete hneď konať.",
        dataContext: "Trh novostavieb Slovensko a Česko",
      },
    },
  },
};

/**
 * Recursively apply ordered find→replace RULES to every string in a copy
 * subtree (strings, arrays, plain objects). Non-strings pass through — notably
 * the booleans inside the tier `features` [bool, "text"] pairs.
 */
function deepLocalize(node, rules) {
  if (typeof node === "string") {
    let out = node;
    for (const [from, to] of rules) out = out.split(from).join(to);
    return out;
  }
  if (Array.isArray(node)) return node.map((n) => deepLocalize(n, rules));
  if (node && typeof node === "object") {
    const o = {};
    for (const k in node) o[k] = deepLocalize(node[k], rules);
    return o;
  }
  return node;
}

/**
 * Resolve the marketing copy for the active language + selected country.
 * SK / unknown → base t[lang], byte-identical. Otherwise apply the market's
 * find→replace rules across the whole tree, then spread its explicit overrides
 * on top (overrides win).
 */
function localizedCopy(lang, country) {
  const base = t[lang];
  const spec = COUNTRY_LOCALIZE[country];
  if (!spec) return base;
  const lk = lang === "sk" ? "sk" : "en";
  const rules = spec.rules?.[lk];
  const copy = rules && rules.length ? deepLocalize(base, rules) : { ...base };
  const ov = spec.overrides?.[lk];
  return ov ? { ...copy, ...ov } : copy;
}

/* ─── Animation hooks ─── */
function useScrollReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, visible];
}

function FadeIn({ children, delay = 0, style = {} }) {
  const [ref, visible] = useScrollReveal();
  return (
    <div ref={ref} style={{
      ...style,
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(24px)",
      transition: `opacity 0.6s ease ${delay}s, transform 0.6s ease ${delay}s`,
    }}>{children}</div>
  );
}

/* ─── Rising Particles (JS-driven, scroll-independent) ─── */
function RisingParticles() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    const dpr = window.devicePixelRatio || 1;
    
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: 20 }, (_, i) => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight * 1.5,
      size: 1.5 + Math.random() * 2,
      speed: 0.15 + Math.random() * 0.3,
      opacity: 0.12 + Math.random() * 0.12,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const fadeStart = window.innerHeight * 0.45;
      const fadeEnd = window.innerHeight * 0.2;
      for (const p of particles) {
        p.y -= p.speed;
        if (p.y < -20) {
          p.y = window.innerHeight + 20;
          p.x = Math.random() * window.innerWidth;
        }
        let alpha = p.opacity;
        if (p.y < fadeStart) {
          alpha *= Math.max(0, (p.y - fadeEnd) / (fadeStart - fadeEnd));
        }
        if (alpha < 0.002) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 229, 160, ${alpha})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  
  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }} />;
}

function Nav({ current, setCurrent, lang, setLang, auth, onLogin, caps }) {
  const pages = lang === "sk" ? pagesSK : pagesEN;
  const l = t[lang];
  const user = auth?.user;
  const showAdminLink = caps.can("view_admin_nav");
  return (
    <nav style={{
      position: "fixed", top: 0, width: "100%", zIndex: 100,
      background: "rgba(10,10,11,0.85)",
      backdropFilter: "blur(20px)", borderBottom: "1px solid #222228",
    }}>
      <div style={{
        maxWidth: 1200, margin: "0 auto", padding: "1.25rem 2rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <a onClick={() => setCurrent("Home")} style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer", textDecoration: "none" }}>
          <div style={{
            width: 28, height: 28, background: "#00e5a0", borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, color: "#0a0a0b",
          }}>R</div>
          <span style={{ fontWeight: 600, fontSize: "1.1rem", color: "#e8e8ed", letterSpacing: "-0.02em" }}>Residata</span>
        </a>
        <div className="nav-right" style={{ display: "flex", alignItems: "center", gap: "2rem", listStyle: "none" }}>
          {pages.map((p, i) => {
            const key = pagesEN[i];
            // "Sample" in the nav maps to the "Data" page key internally
            // (see pageMap). Resolve it the same way so the active-state
            // highlight picks up the glow when we're on /sample.
            const internalKey = pageMap[key] || key;
            const isActive = current === internalKey;
            return (
              <a key={key} className="nav-link" onClick={() => setCurrent(key)} style={{
                color: isActive ? "#e8e8ed" : "#8a8a96", textDecoration: "none",
                fontSize: "0.875rem", cursor: "pointer", transition: "color 0.2s",
              }}>{p}</a>
            );
          })}
          {/* Country switcher — dormant (renders null) until a 2nd market has data */}
          <CountrySwitcher lang={lang} />
          {/* Currency switcher — dormant (renders null) unless the viewed country's
              native currency != € (today: Czechia → [Kč | €]) */}
          <CurrencySwitcher lang={lang} />
          {/* Language toggle */}
          <div style={{
            display: "flex", borderRadius: 6, overflow: "hidden",
            border: "1px solid #222228", fontSize: "0.72rem",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <button onClick={() => { if (lang !== "en") { track("language_switched", { from: lang, to: "en" }); setLang("en"); } }} style={{
              padding: "0.3rem 0.6rem", border: "none", cursor: "pointer",
              background: lang === "en" ? "#222228" : "transparent",
              color: lang === "en" ? "#e8e8ed" : "#55555f",
              fontFamily: "inherit", fontSize: "inherit", transition: "all 0.2s",
            }}>EN</button>
            <button onClick={() => { if (lang !== "sk") { track("language_switched", { from: lang, to: "sk" }); setLang("sk"); } }} style={{
              padding: "0.3rem 0.6rem", border: "none", cursor: "pointer",
              borderLeft: "1px solid #222228",
              background: lang === "sk" ? "#222228" : "transparent",
              color: lang === "sk" ? "#e8e8ed" : "#55555f",
              fontFamily: "inherit", fontSize: "inherit", transition: "all 0.2s",
            }}>SK</button>
          </div>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              {/* Primary CTA for logged-in users on marketing pages: jump to platform. */}
              <a onClick={() => setCurrent("App:Dashboard")} className="nav-cta-btn" style={{
                padding: "0.45rem 1rem", background: "#00e5a0", color: "#0a0a0b",
                fontWeight: 600, borderRadius: 6, fontSize: "0.78rem", cursor: "pointer",
                textDecoration: "none",
              }}>{lang === "sk" ? "Otvoriť platformu →" : "Open platform →"}</a>
              {/* Debug badge — dev-only. Shows current tier + profile load
                  state next to the user email in the nav. Gated behind
                  import.meta.env.DEV so customers don't see internal tier
                  vocabulary in prod. */}
              {import.meta.env.DEV && (
                <span title={`tier=${caps.tier} profile=${auth.profile ? "loaded" : "MISSING"} err=${auth.profileError || "none"}`} style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                  padding: "2px 6px", borderRadius: 3,
                  background: auth.profile ? "rgba(0,229,160,0.15)" : "rgba(245,166,35,0.2)",
                  color: auth.profile ? "#00e5a0" : "#f5a623",
                  fontWeight: 700, letterSpacing: "0.05em",
                }}>{caps.tier}</span>
              )}
              <span style={{ fontSize: "0.75rem", color: "#8a8a96", fontFamily: "'JetBrains Mono', monospace", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user.email}
              </span>
              <button onClick={() => auth.signOut()} style={{
                padding: "0.4rem 0.85rem", background: "transparent", color: "#e8e8ed",
                fontWeight: 500, borderRadius: 6, fontSize: "0.75rem", cursor: "pointer",
                border: "1px solid #222228", fontFamily: "inherit",
              }}>{lang === "sk" ? "Odhlásiť" : "Sign out"}</button>
            </div>
          ) : (
            // Two separate CTAs — returning users need a clear "sign in"
            // path, new visitors want "get started free". Both open the
            // same LoginModal (which supports both flows), but explicit
            // labels end the "wait, am I signing up or logging in?"
            // confusion the user reported.
            <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <a onClick={onLogin} className="nav-signin-btn" style={{
                padding: "0.45rem 0.95rem", background: "transparent", color: "#e8e8ed",
                border: "1px solid #222228", fontWeight: 500, borderRadius: 6,
                fontSize: "0.78rem", cursor: "pointer", textDecoration: "none",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#00e5a0"; e.currentTarget.style.color = "#00e5a0"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#222228"; e.currentTarget.style.color = "#e8e8ed"; }}
              title={lang === "sk" ? "Už máš účet? Prihlás sa." : "Already have an account? Sign in."}
              >{lang === "sk" ? "Prihlásiť sa" : "Sign in"}</a>
              <a onClick={onLogin} className="nav-cta-btn" style={{
                padding: "0.5rem 1.15rem", background: "#00e5a0", color: "#0a0a0b",
                fontWeight: 700, borderRadius: 6, fontSize: "0.8rem", cursor: "pointer",
                letterSpacing: "0.01em", textDecoration: "none",
              }}
              title={lang === "sk" ? "Nový tu? Zaregistruj sa za 30s a dostaneš 7-dňový paid trial zadarmo." : "New here? 30s sign-up → 7-day paid trial free."}
              >{lang === "sk" ? "Začať zadarmo →" : "Get started free →"}</a>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

function Footer({ lang = "en", setCurrent }) {
  const isSK = lang === "sk";
  // F-051: legal links + cookie settings re-opener. The "Cookie settings"
  // link calls the global the CookieBanner registers on mount — this lets
  // users revisit their consent any time without a separate page.
  const handleNav = (page) => (e) => {
    e.preventDefault();
    if (setCurrent) setCurrent(page);
  };
  const reopenCookies = (e) => {
    e.preventDefault();
    if (typeof window !== "undefined" && window.residataReopenCookieBanner) {
      window.residataReopenCookieBanner();
    }
  };
  const linkStyle = { fontSize: "0.78rem", color: "#8a8a96", textDecoration: "none" };
  return (
    <footer style={{
      padding: "2.5rem 2rem", borderTop: "1px solid #222228",
      maxWidth: 1100, margin: "0 auto",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: "1rem",
      }}>
        <span style={{ fontSize: "0.78rem", color: "#8a8a96" }}>© {new Date().getFullYear()} Residata · Krasovského 13, Bratislava</span>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <a href="mailto:residata@proton.me" style={linkStyle}>residata@proton.me</a>
          <a href="tel:+421911963909" style={linkStyle}>+421 911 963 909</a>
        </div>
      </div>
      <div style={{
        display: "flex", gap: "1.5rem", flexWrap: "wrap",
        marginTop: "0.85rem", paddingTop: "0.85rem",
        borderTop: "1px solid #1a1a20",
      }}>
        <a href="/privacy" onClick={handleNav("Privacy")} style={linkStyle}>
          {isSK ? "Ochrana údajov" : "Privacy"}
        </a>
        <a href="/imprint" onClick={handleNav("Imprint")} style={linkStyle}>
          {isSK ? "Impressum" : "Imprint"}
        </a>
        <a href="#" onClick={reopenCookies} style={linkStyle}>
          {isSK ? "Nastavenia cookies" : "Cookie settings"}
        </a>
      </div>
    </footer>
  );
}

/* ─────── HOME ─────── */
function HomePage({ setCurrent, l, lang, onLogin }) {
  const { can, tier } = useCapabilities();
  // Hero badge — surfaces the depth of our dataset. "tracked" = projects
  // with archive data (active + paused/sold-out projects we still keep
  // historical data on). The active subset is shown alongside whenever
  // it differs from tracked. Today the gap is ~30% (e.g. 73 active vs
  // 116 tracked) because projects move between active and paused as
  // they sell out or pause sales; the gap grows naturally over time as
  // more projects accumulate archive history. Reads from market_totals
  // — same view /live, Dashboard, and the build-time SEO files read.
  // (The homepage Ticker uses a separate unit-weighted aggregation; see
  // audit_findings.md F-019 for the divergence.)
  const marketTotals = useMarketTotals();
  const liveProjCount = marketTotals.projectsActive ?? 0;
  const trackedProjCount = marketTotals.projectsTracked ?? liveProjCount;
  // F-010: split into 3 distinct states so we don't conflate "the hook is
  // still resolving" with "the DB legitimately has zero active projects."
  // The old ternary used liveProjCount > 0 ? (…) : "loading…", which
  // showed "Live — loading projects…" forever in the (vanishingly rare
  // but real) all-paused state.
  let heroBadgeText;
  if (marketTotals.loading) {
    heroBadgeText = lang === "sk" ? "Live — načítavam projekty…" : "Live — loading projects…";
  } else if (liveProjCount === 0) {
    heroBadgeText = lang === "sk" ? "Live — žiadne aktívne projekty" : "Live — no active projects";
  } else if (trackedProjCount > liveProjCount) {
    heroBadgeText = lang === "sk"
      ? `Live — ${trackedProjCount} projektov v databáze · ${liveProjCount} aktívne`
      : `Live — ${trackedProjCount} projects in dataset · ${liveProjCount} active`;
  } else {
    heroBadgeText = lang === "sk"
      ? `Live — sledujeme ${liveProjCount} projektov`
      : `Live — tracking ${liveProjCount} developments`;
  }
  // Hero CTA logika podľa tier-u
  let heroButtons;
  if (can("prompt_signup")) {
    // anon — hlavný CTA = signup
    heroButtons = (
      <>
        <a onClick={onLogin} className="btn-p">{l.heroBtn1}</a>
        <a onClick={() => setCurrent("Live")} className="btn-s">{l.heroBtn2}</a>
      </>
    );
  } else if (tier === "pending") {
    // Logged-in but not yet approved (freemium edge case).
    heroButtons = (
      <>
        <a onClick={() => setCurrent("App:Dashboard")} className="btn-p">{lang === "sk" ? "Otvoriť platformu" : "Open platform"}</a>
        <a onClick={() => setCurrent("Pricing")} className="btn-s">{lang === "sk" ? "Cenník" : "See pricing"}</a>
      </>
    );
  } else if (can("prompt_upgrade_to_paid")) {
    // Logged-in free user — route to platform, offer upgrade as secondary.
    heroButtons = (
      <>
        <a onClick={() => setCurrent("App:Dashboard")} className="btn-p">{lang === "sk" ? "Otvoriť platformu" : "Open platform"}</a>
        <a onClick={() => setCurrent("App:Billing")} className="btn-s">{lang === "sk" ? "Upgrade na paid" : "Upgrade to paid"}</a>
      </>
    );
  } else {
    // paid / admin — primary = platform, secondary = Analytics (platform).
    heroButtons = (
      <>
        <a onClick={() => setCurrent("App:Dashboard")} className="btn-p">{lang === "sk" ? "Otvoriť platformu" : "Open platform"}</a>
        {can("view_analytics") && <a onClick={() => setCurrent("App:Analytics")} className="btn-s">{lang === "sk" ? "Analytika" : "Analytics"}</a>}
      </>
    );
  }
  return (
    <>
      {/* Hero */}
      <section style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center", textAlign: "center",
        padding: "8rem 2rem 4rem", position: "relative", overflow: "hidden",
      }}>
        {/* Animated dot grid */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          <svg width="100%" height="100%" style={{ opacity: 0.25 }}>
            <defs>
              <pattern id="dotgrid" width="32" height="32" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" fill="#333" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dotgrid)" />
          </svg>
        </div>
        {/* Breathing glow */}
        <div className="breathing-glow-1" style={{
          position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)",
          width: 900, height: 900,
          background: "radial-gradient(ellipse, rgba(0,229,160,0.12) 0%, transparent 65%)",
          pointerEvents: "none",
        }} />
        <div className="breathing-glow-2" style={{
          position: "absolute", top: "-10%", left: "30%", transform: "translateX(-50%)",
          width: 600, height: 600,
          background: "radial-gradient(ellipse, rgba(0,229,160,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
        <div className="breathing-glow-3" style={{
          position: "absolute", top: "10%", left: "70%", transform: "translateX(-50%)",
          width: 500, height: 500,
          background: "radial-gradient(ellipse, rgba(0,229,160,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
        <div className="hero-anim-1" style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          padding: "0.4rem 1rem", border: "1px solid #222228", borderRadius: 100,
          fontSize: "0.75rem", color: "#8a8a96", fontFamily: "'JetBrains Mono', monospace",
          marginBottom: "2.5rem", background: "#111113",
        }}>
          <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e5a0" }} />
          {heroBadgeText}
        </div>
        <h1 className="hero-anim-2" style={{ fontSize: "clamp(2.8rem, 6vw, 5rem)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.05, maxWidth: 800 }}>
          {l.heroTitle1}<br />
          <span style={{
            background: "linear-gradient(135deg, #00e5a0 0%, #00b880 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>{l.heroTitle2}</span>
        </h1>
        <p className="hero-anim-3" style={{ marginTop: "1.5rem", fontSize: "1.15rem", color: "#8a8a96", maxWidth: 560, fontWeight: 300, lineHeight: 1.7 }}>
          {l.heroSub}
        </p>
        <div className="hero-anim-4 hero-actions-wrap" style={{ marginTop: "2.5rem", display: "flex", gap: "1rem" }}>
          {heroButtons}
        </div>
      </section>

      {/* Pipeline visualisation — rich 3-stage flow with LIVE counts from DB.
          Replaces the old static "Terminal pipeline run" decorative card. */}
      <FadeIn delay={0.05}>
        <PipelineFlow lang={lang} />
      </FadeIn>

      {/* Live market data — real numbers from Supabase */}
      <FadeIn delay={0.1}>
        <MarketPulse lang={lang} setCurrent={setCurrent} />
      </FadeIn>

      {/* Bratislava pricing map */}
      <FadeIn delay={0.15}>
        <DistrictPulse lang={lang} setCurrent={setCurrent} />
      </FadeIn>

      {/* Value Prop (Questions + Deliverables + Flex Scope) used to live
          here — moved to the dedicated "What we deliver" page so the
          homepage stays focused on live market data and the offer
          detail lives in one structured place. */}

      {/* Short teaser pointing to the What-We-Deliver page */}
      <FadeIn style={{ padding: "4rem 2rem 5rem", maxWidth: 1100, margin: "0 auto" }}>
        <div className="flex-scope" style={{
          border: "1px solid #222228", borderRadius: 12, background: "#16161a",
          padding: "2rem 2.25rem", display: "flex", gap: "1.25rem",
          alignItems: "center", flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>
              {l.valueLabel}
            </div>
            <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "#e8e8ed" }}>{l.valueTitle}</div>
          </div>
          <button onClick={() => setCurrent("Data")} className="btn-p" style={{ whiteSpace: "nowrap" }}>
            {lang === "sk" ? "Čo dostanete →" : "What we deliver →"}
          </button>
        </div>
      </FadeIn>
    </>
  );
}

/* ─────── USE CASES ─────── */
// Hero photos per use case (Unsplash CDN — stable, free licence).
// Poradie musí matchovať poradiu v t[*].useCases.
const USE_CASE_IMAGES = [
  // 0 Developers & Sales — modern construction / architecture
  { url: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&q=80&auto=format&fit=crop", credit: "Modern skyline" },
  // 1 Investors & PE — data / financial analytics
  { url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80&auto=format&fit=crop", credit: "Financial analytics" },
  // 2 Banks & Valuers — professional office / institution
  { url: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=1200&q=80&auto=format&fit=crop", credit: "Banking & valuation" },
  // 3 Consultants & Analysts — laptop + charts
  { url: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&q=80&auto=format&fit=crop", credit: "Analytics consulting" },
];

function UseCasesPage({ setCurrent, l, lang }) {
  const { can } = useCapabilities();
  const isPaid = can("has_paid_access");
  return (
    <>
      <div style={{ padding: "8rem 2rem 3rem", maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
        <Label>{l.useCasesLabel}</Label>
        <h1 className="sec-title" style={{ whiteSpace: "pre-line" }}>{l.useCasesTitle}</h1>
        <p className="sec-desc" style={{ margin: "0 auto" }}>{l.useCasesDesc}</p>
      </div>

      <div style={{ padding: "0 2rem 5rem", maxWidth: 1150, margin: "0 auto" }}>
        {l.useCases.map((c, i) => {
          const img = USE_CASE_IMAGES[i] || USE_CASE_IMAGES[0];
          const imageLeft = i % 2 === 0;  // even index → image left
          const num = String(i + 1).padStart(2, "0");
          return (
            <FadeIn key={c.tag} delay={0.05}>
              <article className="use-case-card" style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                border: "1px solid #222228",
                borderRadius: 16,
                overflow: "hidden",
                marginBottom: "2rem",
                background: "#0e0e10",
                minHeight: 420,
              }}>
                {/* Image side */}
                <div style={{
                  position: "relative",
                  gridColumn: imageLeft ? 1 : 2,
                  gridRow: 1,
                  minHeight: 320,
                  overflow: "hidden",
                }}>
                  <img
                    src={img.url}
                    alt={c.tag}
                    loading="lazy"
                    style={{
                      position: "absolute", inset: 0, width: "100%", height: "100%",
                      objectFit: "cover",
                      filter: "saturate(0.85) brightness(0.65) contrast(1.05)",
                      transition: "transform 0.6s ease, filter 0.3s",
                    }}
                    className="use-case-img"
                  />
                  {/* Dark gradient overlay — blend do témy */}
                  <div style={{
                    position: "absolute", inset: 0,
                    background: `linear-gradient(${imageLeft ? "90deg" : "-90deg"}, rgba(10,10,11,0.15) 0%, rgba(10,10,11,0.85) 100%)`,
                    pointerEvents: "none",
                  }} />
                  {/* Green accent glow */}
                  <div style={{
                    position: "absolute",
                    ...(imageLeft ? { right: 0, bottom: 0 } : { left: 0, bottom: 0 }),
                    width: 180, height: 180,
                    background: "radial-gradient(circle, rgba(0,229,160,0.18) 0%, transparent 70%)",
                    pointerEvents: "none",
                  }} />
                  {/* Tag + number in top corner */}
                  <div style={{
                    position: "absolute", top: "1.5rem", left: "1.5rem",
                    display: "flex", alignItems: "center", gap: "0.75rem",
                  }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.75rem",
                      color: "#00e5a0",
                      background: "rgba(0,229,160,0.1)",
                      border: "1px solid rgba(0,229,160,0.3)",
                      padding: "0.25rem 0.6rem",
                      borderRadius: 4,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                    }}>{num}</span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.7rem",
                      color: "#c0c0c8",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      textShadow: "0 2px 8px rgba(0,0,0,0.8)",
                    }}>{c.title}</span>
                  </div>
                  {/* Big title overlaid */}
                  <div style={{
                    position: "absolute", bottom: "1.5rem", left: "1.5rem", right: "1.5rem",
                  }}>
                    <h3 style={{
                      fontSize: "1.75rem",
                      fontWeight: 700,
                      letterSpacing: "-0.025em",
                      color: "#ffffff",
                      lineHeight: 1.2,
                      textShadow: "0 2px 16px rgba(0,0,0,0.9)",
                      margin: 0,
                    }}>{c.tag}</h3>
                  </div>
                </div>

                {/* Content side */}
                <div style={{
                  gridColumn: imageLeft ? 2 : 1,
                  gridRow: 1,
                  padding: "2.5rem 2.5rem 2rem",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}>
                  <p style={{
                    fontSize: "0.95rem",
                    color: "#c0c0c8",
                    lineHeight: 1.65,
                    fontWeight: 300,
                    marginBottom: "1.75rem",
                  }}>{c.desc}</p>

                  <div style={{
                    fontSize: "0.7rem",
                    color: "#00e5a0",
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: "0.9rem",
                    fontWeight: 600,
                  }}>{l.whatYouGet}</div>

                  <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {c.benefits.map(([b, d]) => (
                      <li key={b} style={{
                        display: "flex",
                        gap: "0.75rem",
                        marginBottom: "0.9rem",
                        alignItems: "flex-start",
                      }}>
                        <span style={{
                          color: "#00e5a0",
                          fontSize: "0.85rem",
                          marginTop: "0.15rem",
                          flexShrink: 0,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>→</span>
                        <p style={{
                          fontSize: "0.83rem",
                          color: "#8a8a96",
                          lineHeight: 1.55,
                          margin: 0,
                        }}>
                          <strong style={{ color: "#e8e8ed", fontWeight: 500 }}>{b}</strong> — {d}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            </FadeIn>
          );
        })}
      </div>

      <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
        {isPaid ? (
          <>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: "1rem" }}>
              {lang === "sk" ? "Tvoj use case je pokrytý?" : "Your use case covered?"}
            </h2>
            <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>
              {lang === "sk"
                ? "Otvor dashboard a začni pracovať s reálnymi dátami. Ak niečo chýba, napíš — doladíme."
                : "Open the dashboard and work with real data. If something's missing, reach out — we'll tailor it."}
            </p>
            <a onClick={() => setCurrent("Live")} className="btn-p">
              {lang === "sk" ? "Otvoriť dashboard" : "Open dashboard"}
            </a>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: "1rem" }}>{l.useCasesCta}</h2>
            <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>{l.useCasesCtaDesc}</p>
            <a onClick={() => setCurrent("Pricing")} className="btn-p">{l.useCasesCtaBtn}</a>
          </>
        )}
      </div>
    </>
  );
}

/* ─────── DATA ─────── */
// Real per-market sample data for the public "Sample Output" page. Pulled from
// the live DB (current snapshot) so the demo numbers are ACCURATE, not invented:
// Bratislava for SK / All, Praha for CZ. Prices are real listed units (unit IDs
// anonymized); districts/€-m²/sold-through are real current aggregates. Static
// snapshot example — refresh on a major data shift.
const DATA_SAMPLE = {
  SK: {
    rows: [
      ["Downtown Yards", "Staré Mesto", "byt", "—", "111.4", "961,860",   "8,638", "4", "V"],
      ["Drotárska 15",   "Staré Mesto", "byt", "—", "110.5", "765,000",   "6,924", "4", "P"],
      ["Byty Ružinov",   "Ružinov",     "byt", "—", "61.5",  "332,625",   "5,409", "2", "V"],
      ["Danubius",       "Ružinov",     "byt", "—", "215.4", "1,135,595", "5,272", "3", "V"],
      ["Galvania",       "Nové Mesto",  "byt", "—", "80.2",  "495,000",   "6,175", "3", "V"],
      ["Agáty",          "Dúbravka",    "byt", "—", "87.0",  "587,552",   "6,753", "4", "V"],
      ["Bory",           "Lamač",       "byt", "—", "137.4", "581,000",   "4,229", "5", "P"],
      ["Floret",         "Rovinka",     "byt", "—", "59.7",  "229,990",   "3,853", "2", "V"],
    ],
    marketAvg: "5,525", gap: "1.9×",
    trend: { mom: "+2.1%", est: false },   // REAL: latest May vs June Bratislava avg €/m²
    // [district, €/m², units, MoM %] — MoM is REAL (latest May vs June snapshot)
    districts: [["Staré Mesto","7,521",1469,"+2.7%"],["Ružinov","6,188",1885,"+0.6%"],["Karlova Ves","5,786",40,"+1.3%"],["Nové Mesto","5,684",859,"+3.4%"],["Dúbravka","5,277",649,"+2.4%"],["Rača","5,131",223,"+1.3%"]],
    seg: ["€281k", "€418k", "€642k"],
    // [name, district, total, remaining, sold%, est. months-to-sell-out at standard absorption]
    nearSellout: [["Livana","Záhorská Bystrica",117,1,"99%","<1 mo"],["Svrčina","Karlova Ves",30,1,"97%","<1 mo"],["Drotárska 15","Staré Mesto",30,1,"97%","<1 mo"],["Pristavná 1","Ružinov",207,7,"97%","~1 mo"],["Rowink","Petržalka",80,5,"94%","~2 mo"]],
    top: { district: "Staré Mesto", projects: 20, units: 1469, avail: 468, m2: "7,521", peak: "15,916" },
    fast: { project: "Pristavná 1", district: "Ružinov", total: 207, left: 7, pct: "97%" },
  },
  CZ: {
    rows: [
      ["Ethos Karlín",       "Karlín",   "byt", "—", "112.3", "1,118,457", "9,960", "4", "V"],
      ["Rezidence Parková",  "Žižkov",   "byt", "—", "60.6",  "517,888",   "8,546", "2", "V"],
      ["Bohdalecké zahrady", "Michle",   "byt", "—", "91.0",  "720,436",   "7,917", "3", "V"],
      ["D.O.K. Dřevák",      "Radlice",  "byt", "—", "119.9", "850,654",   "7,095", "4", "R"],
      ["TOIVO Roztyly II",   "Chodov",   "byt", "—", "49.6",  "343,638",   "6,928", "2", "P"],
      ["Albatros Kbely",     "Kbely",    "byt", "—", "80.9",  "565,862",   "6,995", "3", "V"],
      ["Viladomy Střížkov",  "Střížkov", "byt", "—", "34.5",  "268,312",   "7,777", "1", "V"],
      ["Lihovar Smíchov",    "Smíchov",  "byt", "—", "149.7", "1,418,170", "9,473", "4", "V"],
    ],
    marketAvg: "7,443", gap: "1.6×",
    trend: { mom: "+1.5%", est: true },    // ESTIMATED — Praha history starts now (2 days so far); model-based, adjust when real
    // [district, €/m², units, MoM %] — MoM ESTIMATED (scaled to price tier) until Praha banks history
    districts: [["Karlín","9,616",147,"+1.9%"],["Smíchov","9,109",162,"+1.8%"],["Žižkov","8,570",104,"+1.7%"],["Chodov","7,762",115,"+1.6%"],["Jinonice","7,506",488,"+1.5%"],["Uhříněves","6,932",263,"+1.4%"]],
    seg: ["€407k", "€554k", "€794k"],
    nearSellout: [["D.O.K. Dřevák","Radlice",26,1,"96%","~1 mo"],["Viladomy Uhříněves","Uhříněves",151,22,"85%","~4 mo"],["JITRO Vršovice","Vršovice",155,25,"84%","~4 mo"],["TOIVO Roztyly II","Chodov",112,26,"77%","~6 mo"],["NEAR living","Palmovka",212,32,"74%","~4 mo"]],
    top: { district: "Karlín", projects: 2, units: 147, avail: 147, m2: "9,616", peak: "12,071" },
    fast: { project: "D.O.K. Dřevák", district: "Radlice", total: 26, left: 1, pct: "96%" },
  },
};

function DataPage({ setCurrent, l, lang }) {
  const mono = "'JetBrains Mono', monospace";
  const { can } = useCapabilities();
  const { country } = useCountry();
  const d = DATA_SAMPLE[country] || DATA_SAMPLE.SK;   // CZ → Praha; SK / All → Bratislava
  const isPaid = can("has_paid_access");
  // Live count nad "Unit-level sample" tabulkou. Reads from the
  // `market_totals` view (single source of truth — same number the
  // homepage MarketPulse and the Ticker show). Always fresh.
  const { unitsTracked, snapshotMonth } = useMarketTotals();
  const locale = lang === "sk" ? "sk-SK" : "en-US";
  const showingLive = unitsTracked == null
    ? (lang === "sk" ? "Zobrazených 8 z … záznamov" : "Showing 8 of … records")
    : (lang === "sk"
        ? `Zobrazených 8 z ${Number(unitsTracked).toLocaleString(locale)} záznamov`
        : `Showing 8 of ${Number(unitsTracked).toLocaleString(locale)} records`);
  // F-062 (Boss 2026-05-31): the InsightCards section contains hardcoded
  // illustrative numbers, NOT live derived data. The previous dynamic badge
  // claimed "<Month Year> snapshot · real data" which was misleading. Badge
  // text now comes from l.insightsBadge ("Illustrative examples · live in
  // dashboard") so customers don't mistake hand-authored examples for live
  // insights. Live versions ship in the paid dashboard.
  const dynamicInsightsBadge = l.insightsBadge;
  // Unit-level sample rows — real active projects + real listed prices/€-m²
  // for the viewed market (Bratislava for SK/All, Praha for CZ), from DATA_SAMPLE.
  // Unit IDs are anonymized ("—"); everything else is real. Floor column shows
  // rooms (izby). Refresh DATA_SAMPLE on a major data shift.
  const rows = d.rows;
  const statusStyle = { V: { color: "#00e5a0", bg: "rgba(0,229,160,0.08)" }, P: { color: "#f5a623", bg: "rgba(245,166,35,0.08)" }, R: { color: "#55555f", bg: "rgba(85,85,95,0.15)" } };

  // Insight card component
  const InsightCard = ({ label, title, children, span2 }) => (
    <div style={{
      border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "1.75rem",
      gridColumn: span2 ? "span 2" : "span 1",
    }}>
      <div style={{ fontFamily: mono, fontSize: "0.6rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.6rem" }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem", letterSpacing: "-0.01em" }}>{title}</div>
      {children}
    </div>
  );

  const Bar = ({ label, value, max, color }) => (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "0.75rem", color: "#8a8a96" }}>{label}</span>
        <span style={{ fontFamily: mono, fontSize: "0.7rem", color: "#e8e8ed" }}>{value}%</span>
      </div>
      <div style={{ width: "100%", height: 6, background: "#222228", borderRadius: 3 }}>
        <div style={{ width: `${(value / max) * 100}%`, height: "100%", background: color || "#00e5a0", borderRadius: 3 }} />
      </div>
    </div>
  );

  const schemaLines = [
    { field: "projekt", type: "string", desc: "Development name" },
    { field: "developer", type: "string", desc: "Developer company" },
    { field: "okres", type: "string", desc: "City district" },
    { field: "typ", type: "enum", desc: "byt | apartmán | dom | retail | semidetached | ine" },
    { field: "oznacenie", type: "string", desc: "Unit label — e.g. A2-304" },
    { field: "dispozicia", type: "string", desc: "Layout — 1-izbový, 2-izbový..." },
    { field: "plocha_m2", type: "float", desc: "Floor area in m²" },
    { field: "cena_eur", type: "int", desc: "Listed price in EUR" },
    { field: "cena_m2", type: "float", desc: "Price per m² (computed)" },
    { field: "poschodie", type: "int", desc: "Floor number" },
    { field: "stav", type: "enum", desc: "V (voľný) | P (predaný) | R (rezervovaný)" },
    { field: "datum_scrape", type: "date", desc: "Collection date — YYYY-MM-DD" },
  ];

  return (
    <>
      <style>{`
        .dark-scroll::-webkit-scrollbar { height: 6px; }
        .dark-scroll::-webkit-scrollbar-track { background: #111113; border-radius: 3px; }
        .dark-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        .dark-scroll::-webkit-scrollbar-thumb:hover { background: #444; }
        .dark-scroll { scrollbar-width: thin; scrollbar-color: #333 #111113; }
      `}</style>

      {/* ═══ HERO — What we deliver (moved from Home) ═══
          A two-column split: text on the left, market-analytics photo on
          the right. Same visual language as the Use Cases page cards so
          the "offer" feels like one brand, not two separate pitches. */}
      <div style={{ padding: "7rem 2rem 1rem", maxWidth: 1200, margin: "0 auto" }}>
        <div className="wwd-hero" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "center" }}>
          <div>
            <Label>{l.valueLabel}</Label>
            <h1 className="sec-title" style={{ marginBottom: "0.75rem" }}>{l.valueTitle}</h1>
            <p className="sec-desc" style={{ maxWidth: 520 }}>{l.valueDesc}</p>
          </div>
          <div style={{
            borderRadius: 14, overflow: "hidden",
            border: "1px solid #222228",
            aspectRatio: "4 / 3", minHeight: 280,
            // Image trace (log for future iterations):
            //  · 2429e8be8625  modern geometric tall white ← this is the
            //                  'biela veľká budova' user wants
            //  · be6161a56a0c  read as 'dom / house' (rejected 2×)
            //  · cc1a3fa10c00  'zebracka bytovka' (rejected)
            // Restoring 2429e8be8625 — the only one that matches the
            // 'white big building' description.
            background: `linear-gradient(135deg, rgba(0,229,160,0.06), rgba(0,0,0,0.1)), url("https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1400&q=85&auto=format&fit=crop") center/cover`,
          }} aria-label="Modern residential building" />
        </div>
      </div>

      {/* ═══ Questions ↔ Deliverables — core "what you get" grid ═══ */}
      <div style={{ padding: "3rem 2rem 0", maxWidth: 1100, margin: "0 auto" }}>
        <div className="value-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "2rem" }}>
            <div style={{ fontFamily: mono, fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.25rem" }}>{l.questionsLabel}</div>
            {l.questions.map((q, i) => (
              <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: "0.85rem", alignItems: "flex-start" }}>
                <span style={{ fontFamily: mono, fontSize: "0.72rem", color: "#00e5a0", marginTop: "0.15rem", flexShrink: 0 }}>→</span>
                <span style={{ fontSize: "0.84rem", color: "#8a8a96", lineHeight: 1.55 }}>{q}</span>
              </div>
            ))}
          </div>
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "2rem" }}>
            <div style={{ fontFamily: mono, fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.25rem" }}>{l.deliveryLabel}</div>
            {l.deliveryItems.map(([title, desc]) => (
              <div key={title} style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", alignItems: "flex-start" }}>
                <span style={{ color: "#00e5a0", fontSize: "0.85rem", marginTop: "0.15rem", flexShrink: 0 }}>✓</span>
                <div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "#e8e8ed", marginBottom: "0.2rem" }}>{title}</div>
                  <div style={{ fontSize: "0.8rem", color: "#8a8a96", lineHeight: 1.55 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Flexible Scope — full-width card below the two columns */}
      <div style={{ padding: "1.5rem 2rem 4rem", maxWidth: 1100, margin: "0 auto" }}>
        <div className="flex-scope" style={{
          border: "1px solid #222228", borderRadius: 12, background: "#16161a",
          padding: "2rem 2.25rem", display: "grid", gridTemplateColumns: "auto 1fr", gap: "1.75rem", alignItems: "center",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10,
            background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: mono, fontSize: "1.1rem", color: "#00e5a0", fontWeight: 700,
          }}>↗</div>
          <div>
            <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "#e8e8ed", marginBottom: "0.4rem" }}>{l.flexTitle}</div>
            <p style={{ fontSize: "0.85rem", color: "#8a8a96", lineHeight: 1.65, maxWidth: 700, margin: 0 }}>
              {l.flexDesc}
            </p>
          </div>
        </div>
      </div>

      {/* ═══ INSIGHTS ═══ */}
      <div style={{ padding: "2rem 2rem 1rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>{l.insightsLabel}</Label>
        <h2 className="sec-title" style={{ marginBottom: "0.5rem" }}>{l.insightsTitle}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginBottom: "2rem" }}>
          <p className="sec-desc" style={{ marginBottom: 0 }}>{l.insightsDesc}</p>
          <span style={{ fontFamily: mono, fontSize: "0.6rem", color: "#55555f", background: "#111113", border: "1px solid #222228", padding: "0.3rem 0.75rem", borderRadius: 6, whiteSpace: "nowrap", flexShrink: 0 }}>{dynamicInsightsBadge}</span>
        </div>
      </div>

      <div className="insight-grid" style={{ padding: "0 2rem 2rem", maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>

        {/* ─── Insight cards — April 2026 snapshot with directional signals
            Every card pairs a hard number with a trend (QoQ, YoY, months-
            to-sellout) and a forward implication for the buyer. Base numbers
            are from the real sync; velocity deltas and forecasts are
            plausible estimates drawn from the same data (we flag where
            projection vs. hard count). The user ask was insights that make
            a reader say "I need this" — static percentages don't do that,
            directional forecasts do. */}

        {/* 1 — Sell-through leader (real near-sell-out project) */}
        <InsightCard label={`Sell-through — ${d.fast.project}`} title="In its final units.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            <span style={{ color: "#e8e8ed" }}>{d.fast.project}</span> in {d.fast.district} is <span style={{ color: "#00e5a0", fontWeight: 600 }}>{d.fast.pct} sold</span> — only {d.fast.left} of {d.fast.total} units remain. The kind of signal a developer uses to time a launch into the gap, and a buyer uses before the last units clear.
          </div>
          <div style={{ display: "flex", gap: "1.5rem" }}>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#00e5a0" }}>{d.fast.pct}</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>sold-through</div></div>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#e8e8ed" }}>{d.fast.left}</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>units left</div></div>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#8a8a96" }}>{d.fast.total}</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>total units</div></div>
          </div>
        </InsightCard>

        {/* 2 — Segment pricing — real average price by layout */}
        <InsightCard label="Segment Pricing" title="The 4-room premium runs ~2× the 2-room core.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Average price climbs steeply with size. 2-room units at <span style={{ color: "#e8e8ed" }}>{d.seg[0]}</span> are the market's liquid core; 4-room units average <span style={{ color: "#e8e8ed" }}>{d.seg[2]}</span> — roughly double, and a thinner, slower-moving pool. Pricing a large unit means competing in a much smaller buyer segment.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "0.5rem 0.75rem", fontSize: "0.74rem", alignItems: "center" }}>
            <span style={{ fontFamily: mono, color: "#e8e8ed" }}>2-izb</span>
            <div style={{ height: 8, background: "rgba(0,229,160,0.15)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "44%", background: "#00e5a0" }} />
            </div>
            <span style={{ fontFamily: mono, color: "#00e5a0", fontSize: "0.68rem" }}>{d.seg[0]}</span>

            <span style={{ fontFamily: mono, color: "#e8e8ed" }}>3-izb</span>
            <div style={{ height: 8, background: "rgba(0,229,160,0.15)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "68%", background: "#00e5a0" }} />
            </div>
            <span style={{ fontFamily: mono, color: "#8a8a96", fontSize: "0.68rem" }}>{d.seg[1]}</span>

            <span style={{ fontFamily: mono, color: "#e8e8ed" }}>4-izb+</span>
            <div style={{ height: 8, background: "rgba(245,166,35,0.15)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "100%", background: "#f5a623" }} />
            </div>
            <span style={{ fontFamily: mono, color: "#f5a623", fontSize: "0.68rem" }}>{d.seg[2]}</span>
          </div>
          <div style={{ fontSize: "0.68rem", color: "#55555f", marginTop: "0.8rem" }}>
            Average listed price by layout · current snapshot.
          </div>
        </InsightCard>

        {/* 3 — Price by district — real €/m² + MoM trend (SK real / CZ estimated) */}
        <InsightCard label="Price by District" title={`Market ${d.trend.mom} MoM · ${d.gap} district spread.`}>
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Market average is <span style={{ color: "#e8e8ed" }}>€{d.marketAvg}/m²</span>, {d.trend.est ? "an estimated " : ""}<span style={{ color: "#00e5a0", fontWeight: 600 }}>{d.trend.mom}</span> month-over-month. Premium districts price at a <span style={{ color: "#e8e8ed", fontWeight: 600 }}>{d.gap}</span> multiple of the most affordable. €/m² and recent move by district:
          </div>
          {d.districts.map(([name, price, units, mom]) => (
            <div key={name} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0.6rem", alignItems: "center", padding: "0.35rem 0", borderBottom: "1px solid #1a1a1f", fontSize: "0.76rem" }}>
              <span style={{ color: "#e8e8ed" }}>{name}</span>
              <span style={{ fontFamily: mono, fontSize: "0.68rem", color: "#55555f" }}>€{price}/m²</span>
              <span style={{ fontFamily: mono, fontSize: "0.72rem", fontWeight: 600, color: "#00e5a0", minWidth: 48, textAlign: "right" }}>{mom}</span>
            </div>
          ))}
          <div style={{ fontSize: "0.62rem", color: "#55555f", marginTop: "0.7rem", fontStyle: "italic" }}>
            {d.trend.est ? "△ estimated — Praha banks live trend data from this month on." : "△ €/m² month-over-month, latest snapshots."}
          </div>
        </InsightCard>

        {/* 4 — Premium cluster — real top-district depth + €/m² ranking */}
        <InsightCard label={`Premium Cluster — ${d.top.district}`} title={`${d.top.avail} units available at €${d.top.m2}/m².`} span2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
            <div>
              <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.65, marginBottom: "1rem" }}>
                {d.top.district} is the city's priciest cluster — <span style={{ color: "#e8e8ed" }}>{d.top.projects} active projects</span> and <span style={{ color: "#e8e8ed" }}>{d.top.units} units</span> tracked ({d.top.avail} still available) at <span style={{ color: "#e8e8ed" }}>€{d.top.m2}/m²</span> average, peaking at <span style={{ color: "#e8e8ed" }}>€{d.top.peak}/m²</span>.
                <br /><br />
                <span style={{ color: "#e8e8ed", fontWeight: 600 }}>For banks & valuers:</span> this is where comparable evidence is scarcest and most valuable. Once a premium project sells out its transaction history stops updating — and can't be reconstructed retrospectively.
              </div>
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#00e5a0" }}>{d.top.projects}</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>active projects</div></div>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#e8e8ed" }}>{d.top.avail}</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>units available</div></div>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#f5a623" }}>€{d.top.peak}</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>peak €/m²</div></div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.78rem", color: "#55555f", marginBottom: "0.6rem" }}>Top districts · avg €/m²</div>
              {(() => { const mx = parseInt(d.districts[0][1].replace(/,/g, ""), 10) || 1; return d.districts.slice(0, 5).map(([name, price]) => {
                const v = parseInt(price.replace(/,/g, ""), 10) || 0;
                return (
                  <div key={name} style={{ marginBottom: "0.6rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem", fontSize: "0.72rem" }}>
                      <span style={{ color: "#8a8a96" }}>{name}</span>
                      <span style={{ fontFamily: mono, color: "#e8e8ed", fontSize: "0.68rem" }}>€{price}</span>
                    </div>
                    <div style={{ width: "100%", height: 6, background: "#222228", borderRadius: 3 }}>
                      <div style={{ width: `${Math.round((v / mx) * 100)}%`, height: "100%", background: "#00e5a0", borderRadius: 3 }} />
                    </div>
                  </div>
                );
              }); })()}
            </div>
          </div>
        </InsightCard>

        {/* 5 — Comparable-data closing window (real near-sell-out projects) */}
        <InsightCard label="Comps Expiry Watch" title="These projects are in their final units.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Each is deep into sell-through. Once a project closes out, its pricing and transaction history stop updating — your live comparable evidence for that location closes with it. Remaining inventory + sold-through:
          </div>
          {d.nearSellout.map(([name, district, total, remaining, pct, months]) => (
            <div key={name} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "0.55rem", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid #1a1a1f" }}>
              <div>
                <span style={{ fontSize: "0.8rem", color: "#e8e8ed", fontWeight: 500 }}>{name}</span>
                <span style={{ fontSize: "0.72rem", color: "#55555f", marginLeft: "0.5rem" }}>· {district}</span>
              </div>
              <span style={{ fontFamily: mono, fontSize: "0.66rem", color: "#8a8a96" }}>{remaining}/{total}</span>
              <span style={{ fontFamily: mono, fontSize: "0.62rem", color: "#f5a623", background: "rgba(245,166,35,0.08)", padding: "0.1rem 0.4rem", borderRadius: 4, minWidth: 38, textAlign: "center" }}>{pct}</span>
              <span style={{ fontFamily: mono, fontSize: "0.66rem", color: "#ff6b6b", fontWeight: 600, minWidth: 46, textAlign: "right" }}>{months}</span>
            </div>
          ))}
          <div style={{ fontSize: "0.62rem", color: "#55555f", marginTop: "0.7rem", fontStyle: "italic" }}>
            Sell-out windows estimated at standard absorption · refined as velocity history builds.
          </div>
        </InsightCard>
      </div>

      {/* Unit Table + Schema — two-column layout */}
      <div style={{ padding: "2rem 2rem 5rem", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.5rem", alignItems: "start" }}>

          {/* Left — Real data examples (lighter) */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1rem" }}>
              <div>
                <Label>{l.rawLabel}</Label>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 600 }}>{l.unitSample}</h3>
              </div>
              <span style={{ fontFamily: mono, fontSize: "0.7rem", color: "#55555f" }}>{showingLive}</span>
            </div>
            <div className="dark-scroll" style={{ border: "1px solid #222228", borderRadius: 12, overflowX: "auto", background: "#111113" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr style={{ background: "#111113" }}>
                    {["Project", "District", "Typ", "m²", "Price €", "€/m²", "Floor", "Stav"].map(h => (
                      <th key={h} style={{ padding: "0.75rem 0.85rem", textAlign: "left", fontFamily: mono, fontSize: "0.6rem", color: "#55555f", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, borderBottom: "1px solid #222228", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: i < rows.length - 1 ? "1px solid #1a1a1f" : "none" }}>
                      {r.filter((_, j) => j !== 3).map((cell, j) => (
                        <td key={j} style={{
                          padding: "0.65rem 0.85rem", whiteSpace: "nowrap",
                          color: j === 0 ? "#e8e8ed" : "#8a8a96",
                          fontWeight: j === 0 ? 500 : 400,
                          fontFamily: j >= 2 ? mono : "inherit",
                          fontSize: j >= 2 ? "0.7rem" : "0.78rem",
                        }}>
                          {j === 7 ? (
                            <span style={{
                              fontFamily: mono, fontSize: "0.62rem",
                              padding: "0.15rem 0.5rem", borderRadius: 4, fontWeight: 500,
                              color: statusStyle[cell]?.color, background: statusStyle[cell]?.bg,
                            }}>{cell}</span>
                          ) : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: "0.5rem", fontFamily: mono, fontSize: "0.6rem", color: "#55555f", fontStyle: "italic", lineHeight: 1.5 }}>
              {lang === "sk"
                ? "Ilustračná vzorka · Označenia bytov anonymizované. Reálne projekty + ceny."
                : "Illustrative sample · Unit IDs anonymized. Real projects + prices."}
            </div>
          </div>

          {/* Right — Schema / YAML (darker) */}
          <div>
            <Label>{l.schemaLabel}</Label>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{l.schemaTitle}</h3>
            <p className="sec-desc" style={{ marginBottom: "1.5rem" }}>{l.schemaDesc}</p>
            <div style={{ border: "1px solid #1a1a1f", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", background: "#0a0a0c", borderBottom: "1px solid #1a1a1f" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
                <span style={{ flex: 1, textAlign: "center", fontFamily: mono, fontSize: "0.68rem", color: "#55555f", marginRight: "2rem" }}>residata.schema.yml</span>
              </div>
              <div style={{ background: "#07070a", padding: "1.25rem 1.5rem", fontFamily: mono, fontSize: "0.73rem", lineHeight: 1.85 }}>
                <div style={{ color: "#44444e", marginBottom: "0.25rem" }}># residata output schema v2.4</div>
                <div style={{ color: "#44444e", marginBottom: "0.75rem" }}>
                  {lang === "sk" ? "# každý dátový bod ktorý pre vás extrahujeme" : "# every data point we extract per unit"}
                </div>
                <div style={{ color: "#44444e", marginBottom: "0.5rem" }}>---</div>
                <div style={{ marginBottom: "0.25rem" }}><span style={{ color: "#f5a623" }}>fields</span><span style={{ color: "#44444e" }}>:</span></div>
                {schemaLines.map((s, i) => (
                  <div key={i} style={{ paddingLeft: "1.25rem", display: "flex", gap: "0.5rem" }}>
                    <span style={{ color: "#44444e" }}>-</span>
                    <span style={{ color: "#00e5a0" }}>{s.field}</span>
                    <span style={{ color: "#44444e" }}>:</span>
                    <span style={{ color: "#c8c8d4" }}>{s.type}</span>
                    <span style={{ color: "#44444e", marginLeft: "auto", fontSize: "0.67rem" }}>  # {s.desc}</span>
                  </div>
                ))}
                <div style={{ marginTop: "0.75rem", color: "#44444e" }}>---</div>
                <div style={{ marginTop: "0.25rem" }}><span style={{ color: "#f5a623" }}>refresh</span><span style={{ color: "#44444e" }}>: </span><span style={{ color: "#c8c8d4" }}>monthly</span></div>
                <div><span style={{ color: "#f5a623" }}>output</span><span style={{ color: "#44444e" }}>: </span><span style={{ color: "#c8c8d4" }}>google_sheets | csv | xlsx</span></div>
                <div><span style={{ color: "#f5a623" }}>encoding</span><span style={{ color: "#44444e" }}>: </span><span style={{ color: "#c8c8d4" }}>utf-8</span></div>
              </div>
            </div>
            <div style={{ marginTop: "0.75rem", fontFamily: mono, fontSize: "0.62rem", color: "#44444e", lineHeight: 1.6 }}>
              {l.schemaNote}
            </div>
          </div>

        </div>
      </div>

      <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
        {isPaid ? (
          <>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>
              {lang === "sk" ? "Toto je len ukážka. Vďaka prémiovému členstvu máš prístup ku všetkému." : "This is just a sample. You already have access to everything thanks to your premium membership."}
            </h2>
            <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>
              {lang === "sk"
                ? "Otvor live dashboard pre reálne aktuálne dáta zo všetkých aktívnych projektov."
                : "Open the live dashboard for real, current data across every active project."}
            </p>
            <a onClick={() => setCurrent("Live")} className="btn-p">
              {lang === "sk" ? "Otvoriť dashboard" : "Open dashboard"}
            </a>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>{l.wantFull}</h2>
            <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>{l.wantFullDesc}</p>
            <a onClick={() => setCurrent("Pricing")} className="btn-p">{l.seePricing}</a>
          </>
        )}
      </div>
    </>
  );
}

/* ─────── PRICING ─────── */
function PricingPage({ setCurrent, l, lang, onLogin }) {
  const mono = "'JetBrains Mono', monospace";
  const tiers = l.tiers;
  const faqs = l.faqs;
  const { can } = useCapabilities();
  const auth = useAuth();
  const showEarlyAccessBlock = can("see_early_access_badge");
  const isAlreadyPaid = can("has_paid_access");
  // Trial CTA routing: anon → open the LoginModal so they can sign
  // up first; signed-in free → straight to in-platform Billing where
  // the Start-trial button lives.
  const startTrial = () => {
    if (auth.user) setCurrent("App:Billing");
    else if (onLogin) onLogin();
    else setCurrent("Home");
  };
  const ea = lang === "sk" ? {
    badge: "🔥 Early access — 5 min a máš prístup",
    body: <>Prvých <strong style={{ color: "#00e5a0" }}>9 zákazníkov</strong> dostane <strong style={{ color: "#00e5a0" }}>50 % zľavu prvé 3 mesiace</strong>. Žiadne formuláre — krátky 5-minútový call, dohodneme sa, prístup máš hneď.</>,
    cta1: "📞 Zavolať +421 911 963 909",
    cta2: "✉️ Booknuť 5-min call",
  } : {
    badge: "🔥 Early access — 5 minutes to full access",
    body: <>First <strong style={{ color: "#00e5a0" }}>9 customers</strong> get <strong style={{ color: "#00e5a0" }}>50% off for the first 3 months</strong>. No forms — a quick 5-minute call, we agree, you're in.</>,
    cta1: "📞 Call +421 911 963 909",
    cta2: "✉️ Book a 5-min call",
  };

  return (
    <>
      <div style={{ padding: "8rem 2rem 3rem", maxWidth: 1100, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {showEarlyAccessBlock && <div style={{ marginBottom: "1rem" }}><EarlyAccessBadge lang={lang} /></div>}
        {isAlreadyPaid && (
          <div style={{ marginBottom: "1rem",
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.4rem 0.9rem", background: "rgba(0,229,160,0.1)",
            border: "1px solid rgba(0,229,160,0.3)", borderRadius: 999,
            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#00e5a0", fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e5a0" }}></span>
            {lang === "sk" ? "Máš aktívny paid prístup" : "You have active paid access"}
          </div>
        )}
        <Label>{l.pricingLabel}</Label>
        <h1 className="sec-title">{l.pricingTitle}</h1>
        <p className="sec-desc" style={{ textAlign: "center" }}>{l.pricingDesc}</p>

        {/* 7-day free trial card — front and centre on Pricing for
            anon + free users. Mirrors the Billing-page version so the
            messaging is consistent across the funnel. CTA opens the
            login modal (anon → signup) or routes free users to the
            in-platform Billing page where the actual Start button
            lives. */}
        {showEarlyAccessBlock && (
          <div style={{
            marginTop: "2rem", padding: "1.75rem 2rem", maxWidth: 680, width: "100%",
            background: "linear-gradient(135deg, rgba(0,229,160,0.16), rgba(0,229,160,0.04))",
            border: "1px solid #00e5a0", borderRadius: 12,
          }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.5rem", fontWeight: 700 }}>
              🎁 {lang === "sk" ? "Darček pre teba" : "A gift for you"}
            </div>
            <h3 style={{ fontSize: "1.35rem", fontWeight: 700, color: "#e8e8ed", margin: "0 0 0.5rem", letterSpacing: "-0.01em" }}>
              {lang === "sk" ? "7 dní plného Residata — zadarmo" : "7 days of the full Residata — on us"}
            </h3>
            <p style={{ fontSize: "0.92rem", color: "#c0c0c8", lineHeight: 1.55, margin: "0 0 1rem" }}>
              {lang === "sk"
                ? <>Vyskúšaj všetky projekty, analytiku, reporty, exporty + AI asistenta na týždeň naplno. <strong style={{ color: "#e8e8ed" }}>Bez karty</strong> — kartu pýtame až keby si chcel pokračovať po trial-e.</>
                : <>Try every project, analytics, reports, exports + the AI assistant for a full week. <strong style={{ color: "#e8e8ed" }}>No card required</strong> — we only ask for one if you decide to continue after the trial.</>}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
              <a onClick={startTrial} className="btn-p" style={{ cursor: "pointer" }}>
                {lang === "sk" ? "Aktivovať 7-dňový trial" : "Activate 7-day trial"}
              </a>
              <span style={{ fontSize: "0.72rem", color: "#8a8a96", fontFamily: "'JetBrains Mono', monospace" }}>
                {lang === "sk" ? "30s signup · žiadna karta · bez strhávania" : "30s signup · no card · no auto-charge"}
              </span>
            </div>
          </div>
        )}

        {/* Existing early-access / 50% promo card — left in place
            below the trial card for users who want long-term commit
            after evaluating during the trial. */}
        {showEarlyAccessBlock && (
          <div style={{
            marginTop: "1.25rem", padding: "1.5rem 2rem", maxWidth: 680,
            background: "linear-gradient(135deg, rgba(245,166,35,0.08), rgba(245,166,35,0.02))",
            border: "1px solid rgba(245,166,35,0.3)", borderRadius: 12, width: "100%",
          }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#f5a623", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
              {ea.badge}
            </div>
            <p style={{ fontSize: "0.95rem", color: "#e8e8ed", lineHeight: 1.6, marginBottom: "1rem" }}>
              {ea.body}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
              <a href="tel:+421911963909" className="btn-p">{ea.cta1}</a>
              <a href="https://calendar.app.google/x6vKBohYsVjNKL1A9" target="_blank" rel="noopener noreferrer" className="btn-s">{ea.cta2}</a>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "0 2rem 4rem", maxWidth: 1100, margin: "0 auto" }}>
        <div className="pricing-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.5rem" }}>
          {tiers.map(t => (
            <div key={t.tier} style={{
              border: `1px solid ${t.featured ? "#00e5a0" : "#222228"}`,
              borderRadius: 12, background: "#16161a", padding: "2.5rem",
              display: "flex", flexDirection: "column", position: "relative",
            }}>
              {t.featured && (
                <div style={{
                  position: "absolute", top: "-0.6rem", left: "50%", transform: "translateX(-50%)",
                  padding: "0.2rem 0.75rem", background: "#00e5a0", color: "#0a0a0b",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem", fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 4,
                }}>{l.mostPopular}</div>
              )}
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>{t.tier}</div>
              <h3 style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.name}</h3>
              {t.isCustom ? (
                <div style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "0.25rem" }}>{t.price}</div>
              ) : (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "2.2rem", fontWeight: 700, marginBottom: "0.25rem" }}>
                  {t.price}{t.priceSuffix && <span style={{ fontSize: "1rem", fontWeight: 400, color: "#55555f" }}>{t.priceSuffix}</span>}
                </div>
              )}
              <div style={{ fontSize: "0.78rem", color: "#55555f", marginBottom: "2rem" }}>{t.note}</div>
              <div style={{ flex: 1, marginBottom: "2rem" }}>
                {t.features.map(([on, text]) => (
                  <div key={text} style={{ display: "flex", gap: "0.6rem", marginBottom: "0.75rem", alignItems: "flex-start" }}>
                    <span style={{ color: on ? "#00e5a0" : "#55555f", fontSize: "0.8rem", marginTop: "0.2rem" }}>{on ? "✓" : "—"}</span>
                    <p style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.5 }}>{text}</p>
                  </div>
                ))}
              </div>
              {(isAlreadyPaid && !t.isCustom) ? (
                <div style={{
                  display: "block", textAlign: "center",
                  fontSize: "0.85rem", padding: "0.85rem 1rem",
                  color: "#8a8a96",
                  border: "1px dashed #2a2a32",
                  borderRadius: 8,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.03em",
                }}>
                  {lang === "sk" ? "Už máš prístup" : "You're subscribed"}
                </div>
              ) : (
                <a
                  onClick={() => setCurrent("Contact")}
                  className={t.featured ? "btn-p" : "btn-s"}
                  style={{
                    display: "block", textAlign: "center",
                    fontSize: "0.9rem", padding: "0.85rem 2rem",
                  }}
                >{t.cta}</a>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Testimonial */}
      <div style={{ padding: "2.5rem 2rem 0", maxWidth: 800, margin: "0 auto" }}>
        <div style={{ 
          borderRadius: 12, background: "#16161a", padding: "2.5rem 3rem", position: "relative",
          borderLeft: "3px solid #00e5a0",
        }}>
          <div style={{ 
            fontFamily: mono, fontSize: "0.6rem", color: "#00e5a0", letterSpacing: "0.12em", 
            textTransform: "uppercase", marginBottom: "1.25rem",
          }}>{l.testimonialFrom}</div>
          <div style={{ fontSize: "1.05rem", color: "#e8e8ed", lineHeight: 1.75, fontWeight: 300, fontStyle: "italic", marginBottom: "1.75rem" }}>
            {l.testimonial}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            <div style={{ 
              width: 40, height: 40, borderRadius: 10, 
              background: "linear-gradient(135deg, rgba(0,229,160,0.12) 0%, rgba(0,229,160,0.04) 100%)", 
              border: "1px solid rgba(0,229,160,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontFamily: mono, fontSize: "0.85rem", color: "#00e5a0", fontWeight: 600 }}>M</span>
            </div>
            <div>
              <div style={{ fontSize: "0.88rem", fontWeight: 500, color: "#e8e8ed" }}>{l.testimonialName}</div>
              <div style={{ fontSize: "0.74rem", color: "#55555f" }}>{l.testimonialRole}</div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div style={{ padding: "3rem 2rem 5rem", maxWidth: 800, margin: "0 auto" }}>
        <h3 style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: "2rem" }}>{l.commonQ}</h3>
        {faqs.map(([q, a], i) => (
          <div key={i} style={{ borderTop: "1px solid #222228", padding: "1.5rem 0", borderBottom: i === faqs.length - 1 ? "1px solid #222228" : "none" }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 500, marginBottom: "0.5rem" }}>{q}</div>
            <div style={{ fontSize: "0.85rem", color: "#8a8a96", lineHeight: 1.65, fontWeight: 300 }}>{a}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: "4rem 2rem 6rem", textAlign: "center", position: "relative" }}>
        <div style={{
          position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: 600, height: 400,
          background: "radial-gradient(ellipse, rgba(0,229,160,0.15) 0%, transparent 70%)",
          pointerEvents: "none", opacity: 0.3,
        }} />
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>{l.notSure}</h2>
        <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>{l.notSureDesc}</p>
        <a onClick={() => setCurrent("Contact")} className="btn-p" style={{ cursor: "pointer" }}>{l.getInTouch}</a>
      </div>
    </>
  );
}

/* ─────── CONTACT ─────── */
function ContactPage({ l }) {
  const mono = "'JetBrains Mono', monospace";
  return (
    <>
      <div style={{ padding: "8rem 2rem 3rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>{l.contactLabel}</Label>
        <h1 className="sec-title">{l.contactTitle}</h1>
        <p className="sec-desc">{l.contactDesc}</p>
      </div>

      <div style={{ padding: "0 2rem 5rem", maxWidth: 1100, margin: "0 auto" }}>
        <div className="contact-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>

          {/* Left — Contact card */}
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "2.5rem" }}>
            {/* Profile */}
            <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", marginBottom: "2rem" }}>
              {/* Photo placeholder */}
              <div style={{
                width: 80, height: 80, borderRadius: 12, flexShrink: 0,
                border: "1px solid #333",
                overflow: "hidden",
              }}>
                <img src="/photo.jpg" style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="Tomáš Kamhal" />
              </div>
              <div>
                <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#e8e8ed", marginBottom: "0.2rem" }}>Tomáš Kamhal</div>
                <div style={{ fontFamily: mono, fontSize: "0.72rem", color: "#00e5a0", marginBottom: "0.5rem" }}>Founder, Residata</div>
                <a href="https://www.linkedin.com/in/tomaskamhal/" target="_blank" rel="noopener noreferrer" style={{
                  display: "inline-flex", alignItems: "center", gap: "0.4rem",
                  fontSize: "0.72rem", color: "#8a8a96", textDecoration: "none", transition: "color 0.2s",
                }} onMouseEnter={e => e.currentTarget.style.color = "#00e5a0"} onMouseLeave={e => e.currentTarget.style.color = "#8a8a96"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  LinkedIn
                </a>
              </div>
            </div>

            {/* Contact methods */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <a href="mailto:residata@proton.me" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "1rem", color: "#e8e8ed", transition: "color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.color = "#00e5a0"}
                onMouseLeave={e => e.currentTarget.style.color = "#e8e8ed"}>
                <span style={{ fontFamily: mono, fontSize: "0.8rem", color: "#00e5a0", width: 20, textAlign: "center", flexShrink: 0 }}>@</span>
                <span style={{ fontSize: "0.92rem" }}>residata@proton.me</span>
              </a>

              <a href="tel:+421911963909" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "1rem", color: "#e8e8ed", transition: "color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.color = "#00e5a0"}
                onMouseLeave={e => e.currentTarget.style.color = "#e8e8ed"}>
                <span style={{ fontFamily: mono, fontSize: "0.8rem", color: "#00e5a0", width: 20, textAlign: "center", flexShrink: 0 }}>☎</span>
                <span style={{ fontSize: "0.92rem" }}>+421 911 963 909</span>
              </a>

            </div>

            {/* CTA */}
            <div style={{ marginTop: "1.5rem" }}>
              <a href="https://calendar.app.google/x6vKBohYsVjNKL1A9" target="_blank" rel="noopener noreferrer" style={{
                display: "block", padding: "0.85rem 2rem", textAlign: "center",
                background: "#00e5a0", color: "#0a0a0b", fontWeight: 600,
                fontSize: "0.9rem", borderRadius: 8, textDecoration: "none",
              }}>{l.bookCall}</a>
            </div>
          </div>

          {/* Right — What to expect */}
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "2.5rem" }}>
            <div style={{ fontFamily: mono, fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.5rem" }}>{l.whatToExpect}</div>

            {l.steps.map(([num, title, desc]) => (
              <div key={num} style={{ display: "flex", gap: "1.25rem", marginBottom: "1.75rem", alignItems: "flex-start" }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: mono, fontSize: "0.75rem", color: "#00e5a0", fontWeight: 700,
                }}>{num}</div>
                <div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 500, color: "#e8e8ed", marginBottom: "0.3rem" }}>{title}</div>
                  <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </>
  );
}

function Label({ children }) {
  return <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#00e5a0", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "1rem" }}>{children}</div>;
}

// Shown when user is authenticated but profile hasn't finished loading.
// Prevents the "flash of free content" race when tier defaults to anon/pending
// before the real profile arrives.
function AuthLoadingSpinner() {
  return (
    <main style={{ padding: "8rem 2rem 4rem", textAlign: "center", color: "#8a8a96" }}>
      <div style={{ fontSize: "0.8rem", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        Loading…
      </div>
    </main>
  );
}

// F-024 fix: persist user's language choice across navigations + sessions.
// Was previously reset to "en" on every fresh mount, which made SK users
// lose their choice every time they navigated. localStorage keeps the
// pick durable; falls back to browser language on first visit so a SK
// browser lands in SK by default.
const LANG_STORAGE_KEY = "residata-lang";
function readInitialLang() {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === "en" || stored === "sk") return stored;
  } catch (_) { /* private mode etc. */ }
  // First visit: detect from browser
  const browserLang = (typeof navigator !== "undefined" && navigator.language) || "";
  if (browserLang.toLowerCase().startsWith("sk")) return "sk";
  return "en";
}

export default function App() {
  // Init page from current URL (so direct link / refresh works)
  const [current, setCurrent] = useState(() =>
    typeof window !== "undefined" ? pathToPage(window.location.pathname) : "Home"
  );
  // F-024 fix — initialize from localStorage + browser-lang detection.
  const [langRaw, setLangRaw] = useState(readInitialLang);
  const lang = langRaw === "sk" ? "sk" : "en";
  // setLang persists the choice. Wrap setLangRaw so call-sites are unchanged.
  const setLang = (newLang) => {
    setLangRaw(newLang);
    try { window.localStorage.setItem(LANG_STORAGE_KEY, newLang); } catch (_) {}
  };
  const [loginOpen, setLoginOpen] = useState(false);
  // Country-aware marketing copy: base t[lang], with per-country overrides for
  // market-named strings (hero / value prop). SK returns t[lang] unchanged.
  const { country } = useCountry();
  const l = localizedCopy(lang, country);
  const auth = useAuth();
  const caps = useCapabilities();

  // Listen to browser back/forward — sync state with URL
  useEffect(() => {
    const onPop = () => {
      setCurrent(pathToPage(window.location.pathname));
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("popstate", onPop);
    // Initial state marker so first back doesn't leave site
    if (!window.history.state) {
      window.history.replaceState({ page: current }, "");
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Track page views + engagement.
  // On every route change: emit page_view for the new page, start an
  // engagement tracker for it. The useEffect cleanup (runs BEFORE the
  // next effect on nav) stops the previous page's tracker, which
  // emits a page_leave event carrying dwell/active/visible/scroll
  // stats. This gives us at-a-glance 'did the user actually use this
  // page or just tab-opened and left' intelligence.
  useEffect(() => {
    track("page_view", { page: current, lang });
    startPageEngagement(typeof current === "string" ? current : "unknown", { lang });
    return () => {
      // When route changes, cleanup runs before the next effect's body,
      // so at this point `current` is still the OLD page. Passing the
      // incoming nav target would be nicer but we don't have it here —
      // the next page_view contains the to_page anyway.
      stopPageEngagement();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // SEO — update <title>, <meta>, canonical, hreflang on every route/lang/
  // country change. SPAs without this end up with every URL sharing the
  // homepage metadata, which makes Google unable to rank /pricing vs
  // /use-cases separately. `country` localizes the visible copy (a CZ visitor
  // sees "Praha"/"Prague" in the tab title + og tags) without changing the
  // per-route canonical/hreflang. See src/lib/seo.js for what gets set.
  useEffect(() => {
    applySeo(current, lang, country);
  }, [current, lang, country]);

  const handleNav = (page) => {
    const resolved = typeof page === "string" && page.startsWith("Project:")
      ? page
      : (pageMap[page] || page);
    if (resolved === current) return;
    setCurrent(resolved);
    pushRoute(resolved);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Note: the main Nav hides the "Get Access" button once logged in, and
  // the Home hero has its own per-tier button set (see HomePage.heroButtons).
  // So no standalone handleGetAccess is needed here.

  return (
    <div style={{ background: "#0a0a0b", color: "#e8e8ed", fontFamily: "'Outfit', -apple-system, sans-serif", minHeight: "100vh", WebkitFontSmoothing: "antialiased", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@300;400;500;600;700&display=swap');
        .sec-title { font-size: clamp(1.8rem, 3.5vw, 2.6rem); font-weight: 700; letter-spacing: -0.03em; margin-bottom: 1rem; line-height: 1.15; }
        .sec-desc { font-size: 1.05rem; color: #8a8a96; max-width: 600px; font-weight: 300; line-height: 1.7; }
        .btn-p { display: inline-block; padding: 0.75rem 2rem; background: #00e5a0; color: #0a0a0b; font-weight: 600; font-size: 0.9rem; border: none; border-radius: 8px; cursor: pointer; text-decoration: none; transition: all 0.2s; }
        .btn-p:hover { opacity: 0.85; transform: translateY(-1px); }
        .btn-s { display: inline-block; padding: 0.75rem 2rem; background: transparent; color: #e8e8ed; font-weight: 500; font-size: 0.9rem; border: 1px solid #222228; border-radius: 8px; cursor: pointer; text-decoration: none; transition: all 0.2s; }
        .btn-s:hover { border-color: #55555f; transform: translateY(-1px); }
        
        @keyframes ticker-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes pageFade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .page-transition { animation: pageFade 0.35s ease-out both; }

        /* Use Cases cards — hover zoom on image + border glow */
        .use-case-card { transition: border-color 0.3s, box-shadow 0.3s; }
        .use-case-card:hover { border-color: rgba(0,229,160,0.35) !important; box-shadow: 0 8px 32px rgba(0,229,160,0.08); }
        .use-case-card:hover .use-case-img { transform: scale(1.05); filter: saturate(1) brightness(0.7) contrast(1.05) !important; }

        /* Responsive — stackuj image nad content */
        @media (max-width: 820px) {
          .use-case-card { grid-template-columns: 1fr !important; }
          .use-case-card > div:first-child { min-height: 240px !important; grid-column: 1 !important; grid-row: 1 !important; }
          .use-case-card > div:last-child { grid-column: 1 !important; grid-row: 2 !important; padding: 2rem !important; }
        }
        @keyframes flowDot {
          0% { left: -10px; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        @keyframes barFill {
          from { width: 0%; }
        }
        @keyframes dp-shimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(220%); }
        }
        @media (max-width: 760px) {
          .flow-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 1.5rem !important; row-gap: 2rem !important; }
          .flow-grid > div > div:last-child { display: none !important; }
          .district-row { grid-template-columns: 1fr 70px !important; font-size: 0.85rem; }
          .district-row > div:nth-child(2) { display: none; }
        }
        @keyframes heroFadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes breathe1 { 0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); } 50% { opacity: 0.9; transform: translateX(-50%) scale(1.15); } }
        @keyframes breathe2 { 0%, 100% { opacity: 0.4; transform: translateX(-50%) scale(1.05); } 50% { opacity: 0.7; transform: translateX(-50%) scale(0.9); } }
        @keyframes breathe3 { 0%, 100% { opacity: 0.4; transform: translateX(-50%) scale(0.95); } 50% { opacity: 0.7; transform: translateX(-50%) scale(1.1); } }
        .breathing-glow-1 { animation: breathe1 8s ease-in-out infinite; }
        .breathing-glow-2 { animation: breathe2 11s ease-in-out infinite; }
        .breathing-glow-3 { animation: breathe3 14s ease-in-out infinite; }
        .hero-anim-1 { animation: heroFadeIn 0.8s ease both; }
        .hero-anim-2 { animation: heroFadeIn 0.8s ease 0.15s both; }
        .hero-anim-3 { animation: heroFadeIn 0.8s ease 0.3s both; }
        .hero-anim-4 { animation: heroFadeIn 0.8s ease 0.45s both; }
        .pulse-dot { animation: pulse 2s ease-in-out infinite; }

        /* When TrialBanner is mounted (it adds .residata-has-trial-banner
           on body), push the fixed Nav down by the banner height so the
           two stack instead of overlapping. Same offset applied to the
           fixed Ticker (Ticker positions itself relative to Nav-bottom).
           Banner height ≈ 40 px on desktop, slightly more if it wraps on
           mobile — using 44 px gives a little safety margin. */
        body.residata-has-trial-banner nav { top: 44px !important; }
        body.residata-has-trial-banner [aria-label="Live market ticker"] { top: 116px !important; }

        .card-hover { transition: border-color 0.3s, transform 0.3s, box-shadow 0.3s; }
        .card-hover:hover { border-color: #333 !important; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
        @media (max-width: 768px) {
          .nav-right .nav-link { display: none; }
          .nav-cta-btn { display: inline-block !important; }
        }
        @media (max-width: 640px) {
          .nav-right { gap: 0.75rem !important; }
          .contact-grid { grid-template-columns: 1fr !important; }
        }
        /* Responsive grids */
        @media (max-width: 900px) {
          .contact-grid { grid-template-columns: 1fr !important; }
          .value-grid { grid-template-columns: 1fr !important; }
          .wwd-hero { grid-template-columns: 1fr !important; gap: 1.5rem !important; }
          .case-card-grid { grid-template-columns: 1fr !important; }
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .insight-grid { grid-template-columns: 1fr 1fr !important; }
          .pricing-grid { grid-template-columns: 1fr !important; max-width: 420px; margin-left: auto !important; margin-right: auto !important; }
          .chart-grid { grid-template-columns: 1fr !important; }
          .schema-grid { grid-template-columns: 1fr !important; }
          .flex-scope { grid-template-columns: 1fr !important; text-align: center; }
        }
        @media (max-width: 640px) {
          .stats-grid { grid-template-columns: 1fr 1fr !important; }
          .insight-grid { grid-template-columns: 1fr !important; }
          .insight-span2 { grid-column: span 1 !important; }
        }
        @media (max-width: 768px) {
          .hero-actions-wrap { flex-direction: column; align-items: center; }
        }

        /* Project-row click affordance — whole row is clickable on /app/projects.
           Green tint on hover + green accent name + focus ring for keyboard nav.
           Tint kept subtle (7%) so data stays readable; focus ring uses the
           accent colour so it reads as "this is the active target". */
        .project-row-clickable:hover { background: rgba(0,229,160,0.06); }
        .project-row-clickable:hover .project-row-name { color: #00e5a0; text-decoration: underline; text-underline-offset: 3px; }
        .project-row-clickable:focus { outline: none; background: rgba(0,229,160,0.08); box-shadow: inset 0 0 0 1px #00e5a0; }
        .project-row-clickable:focus .project-row-name { color: #00e5a0; }
      `}</style>
      <RisingParticles />
      <div style={{ position: "relative", zIndex: 1 }}>
      {/* Platform pages (/app/*) render their own full-height shell with
          sidebar — skip the marketing Nav/Ticker/Footer chrome. */}
      {!isAppPage(current) && (
        <>
          {/* TrialBanner — slim sticky-top bar, ALWAYS visible across
              marketing pages until dismissed (7-day localStorage flag).
              Sits ABOVE the Nav so the layout pushes Nav down by the
              banner's height when present. The banner self-hides for
              users who don't qualify (paid, mid-trial, used trial). */}
          <TrialBanner
            lang={lang}
            onCta={() => {
              if (auth.user) handleNav("App:Billing");
              else setLoginOpen(true);
            }}
          />
          <Nav current={current} setCurrent={handleNav} lang={lang} setLang={setLang} auth={auth} onLogin={() => setLoginOpen(true)} caps={caps} />
          <Ticker lang={lang} />
          {/* Spacer for fixed Nav (72px) + Ticker (36px) */}
          <div style={{ height: 36 }} />
        </>
      )}

      {/*
        "profile-loading" gate — only show spinner during the INITIAL auth
        hydration (`auth.loading === true`). Previously we kept the spinner
        visible whenever `user && !profile && !profileError`, but that state
        can also be permanent (stale session after DB user-delete). useAuth
        now detects stale sessions and force-signs out, so by the time
        loading flips to false we have either a real profile or the user is
        cleanly anon.

        Important: when inside the platform shell we DON'T wrap in a
        key={current} remount-on-nav div — PlatformShell itself stays
        mounted across /app/* navigation, which keeps the sidebar stable
        and stops hooks (useProjects, useMarketTotals…) from re-firing from a
        cold "zeros" state on every page change. The platform's own content
        area handles the page-fade animation internally.
      */}
      {auth.loading && auth.user ? (
        <div key={current} className="page-transition">
          <AuthLoadingSpinner />
        </div>
      ) : isAppPage(current) ? (
        <Suspense fallback={<AuthLoadingSpinner />}>
          <PlatformShell
            page={current}
            projectId={typeof current === "string" && current.startsWith("App:ProjectDetail:")
              ? current.slice("App:ProjectDetail:".length) : null}
            lang={lang}
            setLang={setLang}
            setCurrent={handleNav}
            openLogin={() => setLoginOpen(true)}
          />
        </Suspense>
      ) : (
        <div key={current} className="page-transition">
          <>
            {current === "Home" && <HomePage setCurrent={handleNav} l={l} lang={lang} onLogin={() => setLoginOpen(true)} />}

            {/* Live dashboard — pending gets stopped, ostatní vidia (verejnú alebo plnú verziu podľa tier-u) */}
            {current === "Live" && (
              <Suspense fallback={<AuthLoadingSpinner />}>
                {caps.tier === "pending"
                  ? <PendingGate setCurrent={handleNav} lang={lang} />
                  : <LiveDashboard setCurrent={handleNav} openLogin={() => setLoginOpen(true)} lang={lang} />}
              </Suspense>
            )}

            {current === "Use Cases" && <UseCasesPage setCurrent={handleNav} l={l} lang={lang} />}
            {current === "Data" && <DataPage setCurrent={handleNav} l={l} lang={lang} />}
            {current === "Pricing" && <PricingPage setCurrent={handleNav} l={l} lang={lang} onLogin={() => setLoginOpen(true)} />}
            {current === "Contact" && <ContactPage l={l} />}
            {/* F-051 (Boss 2026-05-31) — legal pages */}
            {current === "Privacy" && <PrivacyPage lang={lang} />}
            {current === "Imprint" && <ImprintPage lang={lang} />}
            {/* Hidden hero-variant preview page — not in Nav, only reachable via /hero-lab URL */}
            {current === "HeroLab" && (
              <Suspense fallback={<AuthLoadingSpinner />}>
                <HeroLabPage setCurrent={handleNav} lang={lang} />
              </Suspense>
            )}

            {/* /admin and /analytics are handled by the PlatformShell branch above.
                pathToPage() maps those legacy URLs to App:Admin / App:Analytics
                so admin links from emails land users inside the platform shell
                with proper sidebar + sign-in prompt for anon. */}

            {/* Project detail */}
            {typeof current === "string" && current.startsWith("Project:") && (
              <Suspense fallback={<AuthLoadingSpinner />}>
                {caps.tier === "pending"
                  ? <PendingGate setCurrent={handleNav} lang={lang} />
                  : <LiveProjectDetail projectId={current.slice(8)} setCurrent={handleNav} openLogin={() => setLoginOpen(true)} lang={lang} />}
              </Suspense>
            )}
          </>
        </div>
      )}
      {!isAppPage(current) && <Footer lang={lang} setCurrent={handleNav} />}
      {/* F-051 (Boss 2026-05-31) — cookie consent banner. Shows on first
          visit, persists choice in localStorage. Footer "Cookie settings"
          link reopens it any time. */}
      <CookieBanner lang={lang} />
      {/* Floating AI chat bubble — marketing pages only. The platform
          has its own /app/ask entry in the sidebar, and rendering it
          twice would cause two chat instances to share the same
          localStorage key and fight. */}
      {!isAppPage(current) && (
        <FloatingChat lang={lang} onNavigate={handleNav} />
      )}
      {/* TrialPopup — marketing pages only. Once-per-day modal that
          fires 1.5s after page load. Self-suppresses for non-eligible
          users (paid / mid-trial / trial-used). CTA opens the login
          modal for anon, jumps to Billing for free signed-in. */}
      {!isAppPage(current) && (
        <TrialPopup
          lang={lang}
          onCta={() => {
            if (auth.user) handleNav("App:Billing");
            else setLoginOpen(true);
          }}
        />
      )}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} lang={lang} />
      {/* Force profile completion after login */}
      {auth.user && auth.profile && !auth.profile.profile_completed && (
        <CompleteProfile lang={lang} />
      )}
      </div>
    </div>
  );
}
