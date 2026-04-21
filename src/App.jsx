import { useState, useEffect, useRef } from "react";
import Ticker from "./components/Ticker";
import LoginModal from "./components/LoginModal";
import CompleteProfile from "./components/CompleteProfile";
import PendingGate from "./components/PendingGate";
import Feature from "./components/Feature";
import UpgradePrompt from "./components/UpgradePrompt";
import { LiveDashboard, LiveProjectDetail, LiveAnalytics, LiveAdmin, EarlyAccessBadge } from "./pages/LivePages";
import { MarketPulse, DistrictPulse, HowItWorksFlow } from "./pages/HomeExtras";
import { useAuth } from "./lib/useAuth";
import { useCapabilities } from "./lib/useCapabilities";
import { pushRoute, pathToPage } from "./lib/routing";
import { track } from "./lib/track";

const pagesEN = ["Home", "Live", "Use Cases", "Pricing", "Contact"];
const pagesSK = ["Domov", "Live", "Využitie", "Cenník", "Kontakt"];
const pageMap = { "Domov": "Home", "Využitie": "Use Cases", "Dáta": "Data", "Cenník": "Pricing", "Kontakt": "Contact" };

const t = {
  en: {
    // Nav
    getAccess: "Get Access",
    // Hero
    heroBadge: "Live — tracking 140+ developments",
    heroTitle1: "Bratislava residential market,",
    heroTitle2: "fully transparent.",
    heroSub: "We monitor every new residential development in Bratislava and turn scattered listings into actionable market intelligence — so you can make pricing, investment, and portfolio decisions based on data.",
    heroBtn1: "Get Access",
    heroBtn2: "See Sample Data",
    // Value prop
    valueLabel: "What We Deliver",
    valueTitle: "Not just data. Answers.",
    valueDesc: "Every month you get a full snapshot of the Bratislava new-build market — unit-level data across 140+ projects, plus the insights you need to act on it.",
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
    useCasesTitle: "Built for anyone who needs\nto understand the market.",
    useCasesDesc: "Different roles, same problem — you need reliable, current data on the Bratislava residential market. Here's how each team uses Residata.",
    useCases: [
      { tag: "Developers & Sales Teams", title: "Know exactly where to price.",
        desc: "You're launching a new phase and need to set prices. But what are comparable projects actually charging? How fast are they selling? Are you leaving money on the table — or pricing yourself out?",
        benefits: [["Side-by-side competitor pricing", "see €/m² across every comparable project in your district — broken down by unit type, floor, and phase"], ["Sell-through velocity ranking", "know which projects moved the most units last month — and which ones are sitting still"], ["Inventory countdown", "track how many units your competitors have left — time your launches to hit gaps in supply"]] },
      { tag: "Investors & Private Equity", title: "Underwrite with market reality.",
        desc: "You're evaluating a resi development deal. The developer says demand is strong and prices are rising. But is that true — and is it true for this specific district, unit mix, and price point?",
        benefits: [["Absorption rates by segment", "how many units actually sell per month in each district — the number that makes or breaks your IRR"], ["Historical price trajectories", "6–12 months of €/m² movement so you can model scenarios based on real trends, not assumptions"], ["Feasibility stress test", "compare your target sell price against what the market is actually paying — by m², type, and location"]] },
      { tag: "Banks & Valuers", title: "Comparable data, ready to use.",
        desc: "You need market comparables for a valuation or collateral assessment — but gathering them manually from 50+ developer websites takes days. We've already done it.",
        benefits: [["Structured comparable listings", "pricing by location, unit type, floor area, and availability — filterable and exportable"], ["Market depth overview", "how many active projects and units exist in a given district — essential context for any valuation"], ["Monthly refresh", "your comparables are never more than 30 days old — no more working with stale data from last quarter"]] },
      { tag: "Consultants & Analysts", title: "Hours of research, done for you.",
        desc: "Your client needs a market overview for Bratislava residential. You can spend 2–4 weeks clicking through developer websites, copy-pasting into spreadsheets, fighting inconsistent formats, chasing down broken links, and cleaning messy data — or open a single sheet with everything already structured, normalized, and ready to analyze.",
        benefits: [["Presentation-ready data", "25 normalized columns across 140+ projects — drop straight into models, charts, or client decks"], ["Trend analysis built in", "monthly snapshots mean you can show pricing direction and market shifts without extra work"], ["Full market coverage", "apartments, houses, retail, semidetached — across every active district. No gaps to fill manually"]] },
    ],
    useCasesCta: "Different need?",
    useCasesCtaDesc: "The pipeline is flexible. If your use case isn't listed, reach out — we likely already have what you need, or can configure it.",
    useCasesCtaBtn: "See Pricing",
    whatYouGet: "What you get",
    // Data page
    dataLabel: "Sample Output",
    dataTitle: "This is what you get.",
    dataDesc: "Real data, real insights. Same depth every month.",
    dataContext: "Bratislava New-Build Market — March 2026",
    dataContextSub: "Monthly snapshot · all active residential projects",
    stats: [
      ["4,218", "Units Tracked", "Total units across all projects", "+312 vs Feb"],
      ["142", "Active Projects", "Developments currently selling", "+6 new this month"],
      ["5,482", "Avg. Price per m²", "Weighted across all unit types", "+12% YoY"],
      ["263", "Units Sold in March", "Across all tracked projects", "+14% vs Feb"],
    ],
    insightsLabel: "Market Insights",
    insightsTitle: "What the data tells you.",
    insightsDesc: "Examples of the insights you can extract from each monthly delivery. The kind of edge that's hard to build in-house — and expensive to live without.",
    insightsBadge: "Sample data for illustration",
    rawLabel: "Raw Data",
    unitSample: "Unit-level sample",
    showing: "Showing 8 of 4,218 records",
    schemaLabel: "Schema",
    schemaTitle: "Up to 25 columns per unit — key fields below.",
    schemaDesc: "Additional fields include orientation, balcony area, parking, storage, and project-level metadata.",
    schemaNote: "Note: Field availability varies by project. Not all developers publish all data points.",
    wantFull: "Want the full dataset?",
    wantFullDesc: "This is a sample. The full output covers 4,200+ units across 140+ projects, updated monthly.",
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
        features: [[true, "Full market report with insights"], [true, "Unit-level data — all 140+ projects"], [true, "Pricing benchmarks & visualizations"], [false, "No historical data"], [false, "No ongoing updates"]], cta: "Get Started" },
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
    heroBadge: "Live — sledujeme 140+ projektov",
    heroTitle1: "Novostavby v Bratislave.",
    heroTitle2: "Celý trh v jednom prehľade.",
    heroSub: "Ceny, dostupnosť, rýchlosť predaja. Všetko v prehľadných reportoch, na základe ktorých môžete robiť dátami podložené rozhodnutia.",
    heroBtn1: "Kontaktujte nás",
    heroBtn2: "Ukážka dát",
    valueLabel: "Čo dodávame",
    valueTitle: "Nie len dáta. Odpovede.",
    valueDesc: "Každý mesiac dostanete kompletný prehľad trhu novostavieb v Bratislave — každý byt, každý projekt. A to aj s insightmi, na základe ktorých viete hneď konať.",
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
    useCasesTitle: "Pre každého, kto potrebuje\nrozumieť trhu.",
    useCasesDesc: "Rôzne role, rovnaká potreba — aktuálne a spoľahlivé dáta o bratislavských novostavbách.",
    useCases: [
      { tag: "Developeri a obchodné tímy", title: "Spoľahlivé podklady na nacenenie.",
        desc: "Spúšťate novú fázu a riešite ceny. Koľko si účtuje konkurencia? Ako rýchlo sa podobný projekt predáva? Naceňujete byty správne?",
        benefits: [["Prehľady cien konkurencie", "€/m² za každý porovnateľný projekt vo vami zvolenej lokalite — podľa typu, poschodia a fázy"], ["Kto predáva najrýchlejšie", "ktoré projekty predali najviac bytov minulý mesiac — a ktoré stoja"], ["Koľko kapacity zostáva u konkurencie voľnej?", "sledujte voľné jednotky a medzery na trhu"]] },
      { tag: "Investori a Private Equity", title: "Investícia podložená dátami.",
        desc: "Posudzujete development deal. Developer tvrdí, že dopyt je silný a ceny rastú. Platí to aj pre tento okres a cenovú hladinu?",
        benefits: [["Absorpcia podľa segmentu", "koľko bytov sa reálne predá mesačne v každom okrese — číslo, na ktorom stojí vaše IRR"], ["Vývoj cien za 6–12 mesiacov", "reálne trendy €/m² pre modelovanie scenárov — nie odhady, ale dáta"], ["Stress test feasibility", "porovnajte cieľovú cenu s tým, čo trh reálne platí"]] },
      { tag: "Banky a znalci", title: "Komparatívy hotové na použitie.",
        desc: "Potrebujete trhové komparatívy na ocenenie alebo kolaterál — ale zbierať ich ručne z 50+ webov trvá dni až týždne. Residata robí túto prácu za vás.",
        benefits: [["Štruktúrované ponuky", "ceny podľa lokality, typu, plochy a dostupnosti — filtrovateľné a exportovateľné"], ["Hĺbka trhu", "koľko projektov a bytov je v okrese aktívnych — kontext pre každé ocenenie"], ["Vždy aktuálne", "komparatívy nikdy nie sú staršie ako 30 dní"]] },
      { tag: "Konzultanti a analytici", title: "Hodiny práce, hotové za vás.",
        desc: "Klient chce prehľad bratislavského trhu. Buď strávite týždne zbieraním dát po weboch — alebo otvoríte jeden sheet, kde je všetko pripravené.",
        benefits: [["Dáta na prezentáciu", "25 stĺpcov naprieč 140+ projektmi — rovno do modelov, grafov alebo klientskych prezentácií"], ["Trendy zahrnuté", "cenový smer a trhové posuny ukážete bez ďalšej práce"], ["Kompletné pokrytie", "byty, domy, apartmány — žiadne medzery"]] },
    ],
    useCasesCta: "Hľadáte riešenie na mieru?",
    useCasesCtaDesc: "Systém je flexibilný. Ak tu nevidíte riešenie na svoj špecifický problém, ozvite sa — veľmi pravdepodobne vám vieme pomôcť riešením na mieru.",
    useCasesCtaBtn: "Pozrieť cenník",
    whatYouGet: "Čo dostanete",
    dataLabel: "Ukážka výstupu",
    dataTitle: "Takto vyzerá výstup.",
    dataDesc: "Reálne dáta, reálne insighty. Rovnaká hĺbka každý mesiac.",
    dataContext: "Trh novostavieb Bratislava — Marec 2026",
    dataContextSub: "Mesačný prehľad · všetky aktívne projekty",
    stats: [
      ["4,218", "Sledovaných bytov", "Celkom naprieč všetkými projektmi", "+312 vs Feb"],
      ["142", "Aktívnych projektov", "Projekty aktuálne v predaji", "+6 nových"],
      ["5,482", "Priem. cena za m²", "Vážený priemer všetkých jednotiek", "+12% medziročne"],
      ["263", "Predaných jednotiek v marci", "Naprieč všetkými projektmi", "+14% vs Feb"],
    ],
    insightsLabel: "Trhové insighty",
    insightsTitle: "Čo z toho vidíte.",
    insightsDesc: "Príklady insightov z mesačnej dodávky. Informačná výhoda proti konkurencii.",
    insightsBadge: "Ilustračné dáta",
    rawLabel: "Surové dáta",
    unitSample: "Ukážka na úrovni bytov",
    showing: "Zobrazených 8 z 4 218 záznamov",
    schemaLabel: "Schéma",
    schemaTitle: "Až 25 stĺpcov na byt — kľúčové polia nižšie.",
    schemaDesc: "Ďalšie polia: orientácia, balkón, parkovanie, sklad a metadáta projektu.",
    schemaNote: "Poznámka: Nie všetci developeri zverejňujú všetky údaje — dostupnosť polí sa líši.",
    wantFull: "Máte záujem o kompletný dataset?",
    wantFullDesc: "Toto je ukážka. Celý výstup pokrýva 4 200+ bytov v 140+ projektoch, aktualizovaný každý mesiac.",
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
        features: [[true, "Kompletný trhový prehľad s insightmi"], [true, "Dáta za každý byt — 140+ projektov"], [true, "Cenové porovnania a vizualizácie"], [false, "Bez historických dát"], [false, "Bez priebežných aktualizácií"]], cta: "Mám záujem" },
      { tier: "Standard", name: "Mesačné doručenie", price: "€349", priceSuffix: "/mes", note: "Fakturované mesačne, zrušenie kedykoľvek",
        features: [[true, "Mesačná správa s kompletnými insightmi"], [true, "Surové + vyčistené datasety"], [true, "Historické dáta a vývoj trendov"], [true, "Absorpcia a sledovanie vypredania"], [true, "Google Sheets, CSV alebo API"]], featured: true, cta: "Mám záujem" },
      { tier: "Custom", name: "On-Demand & Enterprise", price: "Ozvite sa.", isCustom: true, note: "Rozsah a frekvencia podľa vás",
        features: [[true, "Všetko v Standard"], [true, "Týždenné alebo dvojtýždenné aktualizácie"], [true, "Pokrytie akejkoľvek lokality (aj mimo Slovenska)"], [true, "Ďalšie trhy alebo typy nehnuteľností"], [true, "Vlastné integrácie a formáty"]], cta: "Kontaktovať" },
    ],
    mostPopular: "Najobľúbenejší",
    seePricing: "Pozrieť cenník",
  },
};

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

function AnimatedCounter({ end, suffix = "", prefix = "" }) {
  const [ref, visible] = useScrollReveal();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const num = parseInt(end.replace(/[^0-9]/g, ""));
    const duration = 1200;
    const steps = 40;
    const increment = num / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= num) { setCount(num); clearInterval(timer); }
      else setCount(Math.floor(current));
    }, duration / steps);
    return () => clearInterval(timer);
  }, [visible, end]);
  const formatted = count.toLocaleString();
  return <span ref={ref}>{prefix}{formatted}{suffix}</span>;
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
            return (
              <a key={key} className="nav-link" onClick={() => setCurrent(key)} style={{
                color: current === key ? "#e8e8ed" : "#8a8a96", textDecoration: "none",
                fontSize: "0.875rem", cursor: "pointer", transition: "color 0.2s",
              }}>{p}</a>
            );
          })}
          {/* Language toggle */}
          <div style={{
            display: "flex", borderRadius: 6, overflow: "hidden",
            border: "1px solid #222228", fontSize: "0.72rem",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <button onClick={() => setLang("en")} style={{
              padding: "0.3rem 0.6rem", border: "none", cursor: "pointer",
              background: lang === "en" ? "#222228" : "transparent",
              color: lang === "en" ? "#e8e8ed" : "#55555f",
              fontFamily: "inherit", fontSize: "inherit", transition: "all 0.2s",
            }}>EN</button>
            <button onClick={() => setLang("sk")} style={{
              padding: "0.3rem 0.6rem", border: "none", cursor: "pointer",
              borderLeft: "1px solid #222228",
              background: lang === "sk" ? "#222228" : "transparent",
              color: lang === "sk" ? "#e8e8ed" : "#55555f",
              fontFamily: "inherit", fontSize: "inherit", transition: "all 0.2s",
            }}>SK</button>
          </div>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              {showAdminLink && (
                <a onClick={() => setCurrent("Admin")} style={{
                  color: current === "Admin" ? "#f5a623" : "#8a8a96", textDecoration: "none",
                  fontSize: "0.8rem", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
                }}>ADMIN</a>
              )}
              <span style={{ fontSize: "0.75rem", color: "#8a8a96", fontFamily: "'JetBrains Mono', monospace", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user.email}
              </span>
              <button onClick={() => auth.signOut()} style={{
                padding: "0.4rem 0.9rem", background: "transparent", color: "#e8e8ed",
                fontWeight: 500, borderRadius: 6, fontSize: "0.75rem", cursor: "pointer",
                border: "1px solid #222228", fontFamily: "inherit",
              }}>{lang === "sk" ? "Odhlásiť" : "Sign out"}</button>
            </div>
          ) : (
            <a onClick={onLogin} className="nav-cta-btn" style={{
              padding: "0.5rem 1.25rem", background: "#00e5a0", color: "#0a0a0b",
              fontWeight: 600, borderRadius: 6, fontSize: "0.8rem", cursor: "pointer",
              letterSpacing: "0.02em", textDecoration: "none",
            }}>{l.getAccess}</a>
          )}
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer style={{
      padding: "2.5rem 2rem", borderTop: "1px solid #222228",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      maxWidth: 1100, margin: "0 auto",
    }}>
      <span style={{ fontSize: "0.78rem", color: "#55555f" }}>© 2026 Residata · Krasovského 13, Bratislava</span>
      <div style={{ display: "flex", gap: "1.5rem" }}>
        <a href="mailto:residata@proton.me" style={{ fontSize: "0.78rem", color: "#55555f", textDecoration: "none" }}>residata@proton.me</a>
        <a href="tel:+421911963909" style={{ fontSize: "0.78rem", color: "#55555f", textDecoration: "none" }}>+421 911 963 909</a>
      </div>
    </footer>
  );
}

/* ─────── Terminal Animation ─────── */
function TerminalLines() {
  const [ref, visible] = useScrollReveal();
  const mono = "'JetBrains Mono', monospace";
  const lines = [
    [["$", "#00e5a0"], [" residata run --region bratislava --month 2026-03", "#e8e8ed"]],
    [["// Loading registry... 142 projects found", "#55555f"]],
    [["→ Parsing ", "#8a8a96"], ["Slnečnice Viladomy", "#00e5a0"], [" ... 48 units", "#8a8a96"]],
    [["→ Parsing ", "#8a8a96"], ["Nový Ružinov II", "#00e5a0"], [" ... 126 units", "#8a8a96"]],
    [["→ Parsing ", "#8a8a96"], ["RNDZ Residence", "#00e5a0"], [" ... 64 units", "#8a8a96"]],
    [["// Processing complete.", "#55555f"]],
    [["✓ Total: ", "#8a8a96"], ["4,218", "#f5a623"], [" units across ", "#8a8a96"], ["142", "#f5a623"], [" projects", "#8a8a96"]],
    [["✓ Pushed to ", "#8a8a96"], ["residata-clean-master", "#00e5a0"]],
  ];
  return (
    <div ref={ref} style={{ padding: "1.5rem", fontFamily: mono, fontSize: "0.78rem", lineHeight: 1.9 }}>
      {lines.map((line, i) => (
        <div key={i} style={{
          display: "flex",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateX(0)" : "translateX(-8px)",
          transition: `opacity 0.4s ease ${i * 0.2}s, transform 0.4s ease ${i * 0.2}s`,
        }}>
          {line.map(([text, color], j) => (
            <span key={j} style={{ color }}>{text}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─────── HOME ─────── */
function HomePage({ setCurrent, l, lang, onLogin }) {
  const { can, tier } = useCapabilities();
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
    heroButtons = (
      <>
        <a onClick={() => setCurrent("Live")} className="btn-p">{lang === "sk" ? "Pozrieť dashboard" : "Open dashboard"}</a>
        <a onClick={() => setCurrent("Pricing")} className="btn-s">{lang === "sk" ? "Cenník" : "See pricing"}</a>
      </>
    );
  } else if (can("prompt_upgrade_to_paid")) {
    // free — upgrade prompt
    heroButtons = (
      <>
        <a onClick={() => setCurrent("Live")} className="btn-p">{lang === "sk" ? "Pozrieť dashboard" : "Open dashboard"}</a>
        <a onClick={() => setCurrent("Pricing")} className="btn-s">{lang === "sk" ? "Upgrade na paid" : "Upgrade to paid"}</a>
      </>
    );
  } else {
    // paid / admin — ideme rovno do dashboardu
    heroButtons = (
      <>
        <a onClick={() => setCurrent("Live")} className="btn-p">{lang === "sk" ? "Pozrieť dashboard" : "Open dashboard"}</a>
        {can("view_analytics") && <a onClick={() => setCurrent("Analytics")} className="btn-s">{lang === "sk" ? "Analytika" : "Analytics"}</a>}
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
          Live — tracking 140+ developments
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

      {/* Terminal */}
      <FadeIn style={{ padding: "0 2rem 5rem", display: "flex", justifyContent: "center" }}>
        <div style={{
          width: "100%", maxWidth: 860, background: "#16161a",
          border: "1px solid #222228", borderRadius: 12, overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.875rem 1.25rem", background: "#111113", borderBottom: "1px solid #222228" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
            <span style={{ flex: 1, textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#55555f", marginRight: "2rem" }}>residata — pipeline run</span>
          </div>
          <TerminalLines />
        </div>
      </FadeIn>

      {/* Live market data — real numbers from Supabase */}
      <FadeIn delay={0.1}>
        <MarketPulse lang={lang} setCurrent={setCurrent} />
      </FadeIn>

      {/* Bratislava pricing map */}
      <FadeIn delay={0.15}>
        <DistrictPulse lang={lang} setCurrent={setCurrent} />
      </FadeIn>

      {/* How it works — animated pipeline */}
      <FadeIn delay={0.2}>
        <HowItWorksFlow lang={lang} />
      </FadeIn>

      {/* Value Prop — Questions left, What you get right */}
      <FadeIn style={{ padding: "5rem 2rem 0", maxWidth: 1100, margin: "0 auto" }}>
        <Label>{l.valueLabel}</Label>
        <h2 className="sec-title">{l.valueTitle}</h2>
        <p className="sec-desc" style={{ marginBottom: "3rem" }}>
          {l.valueDesc}
        </p>
      </FadeIn>

      <FadeIn delay={0.1} style={{ padding: "0 2rem 0", maxWidth: 1100, margin: "0 auto" }}>
        <div className="value-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          {/* Left — Questions */}
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "2rem" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.25rem" }}>{l.questionsLabel}</div>
            {l.questions.map((q, i) => (
              <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: "0.85rem", alignItems: "flex-start" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", color: "#00e5a0", marginTop: "0.15rem", flexShrink: 0 }}>→</span>
                <span style={{ fontSize: "0.84rem", color: "#8a8a96", lineHeight: 1.55 }}>{q}</span>
              </div>
            ))}
          </div>

          {/* Right — What you get */}
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "2rem" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.25rem" }}>{l.deliveryLabel}</div>
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
      </FadeIn>

      {/* Flexible Scope — standalone */}
      <FadeIn style={{ padding: "1.5rem 2rem 5rem", maxWidth: 1100, margin: "0 auto" }}>
        <div className="flex-scope" style={{
          border: "1px solid #222228", borderRadius: 12, background: "#16161a",
          padding: "2.5rem", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2rem", alignItems: "center",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10,
            background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "1.1rem", color: "#00e5a0", fontWeight: 700,
          }}>↗</div>
          <div>
            <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "#e8e8ed", marginBottom: "0.4rem" }}>{l.flexTitle}</div>
            <p style={{ fontSize: "0.85rem", color: "#8a8a96", lineHeight: 1.65, maxWidth: 700 }}>
              {l.flexDesc}
            </p>
          </div>
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

function UseCasesPage({ setCurrent, l }) {
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
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: "1rem" }}>{l.useCasesCta}</h2>
        <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>{l.useCasesCtaDesc}</p>
        <a onClick={() => setCurrent("Pricing")} className="btn-p">{l.useCasesCtaBtn}</a>
      </div>
    </>
  );
}

/* ─────── DATA ─────── */
function DataPage({ setCurrent, l }) {
  const mono = "'JetBrains Mono', monospace";
  const rows = [
    ["Slnečnice Viladomy", "Petržalka", "byt", "A2-304", "68.4", "249,660", "3,650", "3", "V"],
    ["Slnečnice Viladomy", "Petržalka", "byt", "A2-412", "45.2", "167,240", "3,700", "4", "P"],
    ["Nový Ružinov II", "Ružinov", "byt", "B1-205", "82.1", "338,252", "4,120", "2", "V"],
    ["RNDZ Residence", "Nové Mesto", "apartmán", "C-101", "34.8", "159,384", "4,580", "1", "R"],
    ["Zwirn Mlyny", "Staré Mesto", "byt", "D-503", "95.6", "497,120", "5,200", "5", "P"],
    ["Bory Nový Dvor", "Lamač", "dom", "RD-18", "142.0", "479,960", "3,380", "—", "V"],
    ["Eurovea City", "Ružinov", "byt", "T2-1804", "56.3", "310,214", "5,510", "18", "V"],
    ["Čerešne Dúbravka", "Dúbravka", "byt", "E-207", "73.9", "243,870", "3,300", "2", "V"],
  ];
  const statusStyle = { V: { color: "#00e5a0", bg: "rgba(0,229,160,0.08)" }, P: { color: "#f5a623", bg: "rgba(245,166,35,0.08)" }, R: { color: "#55555f", bg: "rgba(85,85,95,0.15)" } };

  // Trend data — 12% YoY, roughly 1% per month
  const trendData = [
    { month: "Oct", value: 3480 },
    { month: "Nov", value: 3540 },
    { month: "Dec", value: 3610 },
    { month: "Jan", value: 3690 },
    { month: "Feb", value: 3760 },
    { month: "Mar", value: 5482 },
  ];
  const minV = 3350; const maxV = 3980;
  const chartW = 520; const chartH = 180;
  const padL = 50; const padR = 20; const padT = 20; const padB = 30;
  const innerW = chartW - padL - padR; const innerH = chartH - padT - padB;
  const points = trendData.map((d, i) => ({
    x: padL + (i / (trendData.length - 1)) * innerW,
    y: padT + innerH - ((d.value - minV) / (maxV - minV)) * innerH,
    ...d,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = linePath + ` L${points[points.length-1].x},${padT + innerH} L${points[0].x},${padT + innerH} Z`;

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

      <div style={{ padding: "8rem 2rem 3rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>{l.dataLabel}</Label>
        <h1 className="sec-title">{l.dataTitle}</h1>
        <p className="sec-desc">{l.dataDesc}</p>
      </div>

      {/* Stats */}
      <div style={{ padding: "0 2rem 0.75rem", maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 500, color: "#e8e8ed" }}>{l.dataContext}</div>
        <div style={{ fontFamily: mono, fontSize: "0.68rem", color: "#55555f" }}>{l.dataContextSub}</div>
      </div>
      <div style={{ padding: "0 2rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "#222228", border: "1px solid #222228", borderRadius: 12, overflow: "hidden" }}>
          {l.stats.map(([n, label, sub, d], idx) => (
            <div key={label} style={{ background: "#16161a", padding: "1.75rem 1.5rem", textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: "2rem", fontWeight: 700, color: "#00e5a0" }}>
                <AnimatedCounter end={n} prefix={idx === 2 ? "€" : ""} />
              </div>
              <div style={{ fontSize: "0.8rem", color: "#e8e8ed", marginTop: "0.25rem", fontWeight: 500 }}>{label}</div>
              <div style={{ fontSize: "0.68rem", color: "#55555f", marginTop: "0.15rem" }}>{sub}</div>
              <span style={{
                fontFamily: mono, fontSize: "0.65rem", marginTop: "0.6rem",
                padding: "0.15rem 0.5rem", borderRadius: 4, display: "inline-block",
                color: d.startsWith("-") || d.startsWith("−") ? "#ff4d4d" : "#00e5a0",
                background: d.startsWith("-") || d.startsWith("−") ? "rgba(255,77,77,0.08)" : "rgba(0,229,160,0.08)",
              }}>{d}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trend Chart + District */}
      <div style={{ padding: "1rem 2rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <div className="chart-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "1.5rem 1.5rem 1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Avg. €/m² Trend</div>
                <div style={{ fontSize: "0.72rem", color: "#55555f", marginTop: "0.15rem" }}>Bratislava — last 6 months</div>
              </div>
              <span style={{ fontFamily: mono, fontSize: "0.65rem", color: "#00e5a0", background: "rgba(0,229,160,0.08)", padding: "0.15rem 0.5rem", borderRadius: 4 }}>+12% YoY</span>
            </div>
            <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: "100%", height: "auto" }}>
              {[3500, 3600, 3700, 3800, 3900].map(v => {
                const y = padT + innerH - ((v - minV) / (maxV - minV)) * innerH;
                return (<g key={v}><line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#1a1a1f" strokeWidth="1" /><text x={padL - 8} y={y + 3} textAnchor="end" fill="#55555f" fontSize="9" fontFamily={mono}>{(v/1000).toFixed(1)}k</text></g>);
              })}
              <path d={areaPath} fill="url(#areaGrad2)" />
              <defs><linearGradient id="areaGrad2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00e5a0" stopOpacity="0.15" /><stop offset="100%" stopColor="#00e5a0" stopOpacity="0" /></linearGradient></defs>
              <path d={linePath} fill="none" stroke="#00e5a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((p, i) => (<g key={i}><circle cx={p.x} cy={p.y} r="3.5" fill="#0a0a0b" stroke="#00e5a0" strokeWidth="2" /><text x={p.x} y={padT + innerH + 18} textAnchor="middle" fill="#55555f" fontSize="9" fontFamily={mono}>{p.month}</text></g>))}
            </svg>
          </div>

          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "1.5rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.15rem" }}>By District</div>
            <div style={{ fontSize: "0.72rem", color: "#55555f", marginBottom: "1.25rem" }}>Average €/m² — last 3 months change</div>
            {[
              ["Staré Mesto", "5,200", "+4.1%", true],
              ["Ružinov", "4,580", "+3.6%", true],
              ["Nové Mesto", "4,320", "+2.9%", true],
              ["Petržalka", "3,650", "+2.4%", true],
              ["Dúbravka", "3,300", "+1.8%", true],
              ["Lamač", "3,380", "+1.2%", true],
            ].map(([district, price, delta, up]) => (
              <div key={district} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0", borderBottom: "1px solid #1a1a1f" }}>
                <span style={{ fontSize: "0.8rem", color: "#e8e8ed" }}>{district}</span>
                <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                  <span style={{ fontFamily: mono, fontSize: "0.73rem", color: "#8a8a96" }}>€{price}</span>
                  <span style={{ fontFamily: mono, fontSize: "0.62rem", color: up ? "#00e5a0" : "#ff4d4d", minWidth: 42, textAlign: "right" }}>{delta}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ INSIGHTS ═══ */}
      <div style={{ padding: "2rem 2rem 1rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>{l.insightsLabel}</Label>
        <h2 className="sec-title" style={{ marginBottom: "0.5rem" }}>{l.insightsTitle}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginBottom: "2rem" }}>
          <p className="sec-desc" style={{ marginBottom: 0 }}>{l.insightsDesc}</p>
          <span style={{ fontFamily: mono, fontSize: "0.6rem", color: "#55555f", background: "#111113", border: "1px solid #222228", padding: "0.3rem 0.75rem", borderRadius: 6, whiteSpace: "nowrap", flexShrink: 0 }}>{l.insightsBadge}</span>
        </div>
      </div>

      <div className="insight-grid" style={{ padding: "0 2rem 2rem", maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>

        {/* 1 — Top Seller */}
        <InsightCard label="Top Seller — March" title="Bory Bývanie sold 34 units last month.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Highest single-month takeup across all tracked projects. Phase 4B is now 78% sold out — 46 units remaining from the original 210.
          </div>
          <div style={{ display: "flex", gap: "1.5rem" }}>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#00e5a0" }}>34</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Units sold</div></div>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#e8e8ed" }}>€3,380</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Avg. €/m²</div></div>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#f5a623" }}>78%</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Sold out</div></div>
          </div>
        </InsightCard>

        {/* 2 — New Supply */}
        <InsightCard label="Supply Watch" title="312 new units entered the market.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            6 new projects launched in March, adding 312 units to the active pipeline. Ružinov and Petržalka saw the largest additions.
          </div>
          <div style={{ fontSize: "0.75rem", color: "#8a8a96", lineHeight: 1.8 }}>
            {[["Einpark Residence", "Ružinov", 84], ["Slnečnice Zóna M", "Petržalka", 96], ["Nové Lido Phase 1", "Petržalka", 52], ["Other (3 projects)", "—", 80]].map(([p, d, u]) => (
              <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0", borderBottom: "1px solid #1a1a1f" }}>
                <span><span style={{ color: "#e8e8ed" }}>{p}</span> <span style={{ color: "#55555f" }}>· {d}</span></span>
                <span style={{ fontFamily: mono, fontSize: "0.7rem" }}>{u} units</span>
              </div>
            ))}
          </div>
        </InsightCard>

        {/* 3 — Absorption Rate */}
        <InsightCard label="Absorption Rate" title="How fast are districts selling?">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Monthly sell-through as % of available units. Higher = faster absorption, tighter market.
          </div>
          <Bar label="Staré Mesto" value={8.2} max={10} color="#00e5a0" />
          <Bar label="Ružinov" value={6.8} max={10} color="#00e5a0" />
          <Bar label="Nové Mesto" value={5.4} max={10} color="#00e5a0" />
          <Bar label="Petržalka" value={4.1} max={10} color="#00e5a0" />
          <Bar label="Dúbravka" value={3.2} max={10} color="#55555f" />
          <Bar label="Lamač" value={2.8} max={10} color="#55555f" />
        </InsightCard>

        {/* 4 — District Spotlight (span 2) */}
        <InsightCard label="District Spotlight — Ružinov" title="Ružinov: 892 tracked units across 18 projects." span2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
            <div>
              <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.65, marginBottom: "1rem" }}>
                Most active district by transaction volume. Average unit price sits at €310k with 90% of transactions falling between €215k–€420k. Premium outliers above €500k driven by Eurovea City tower units.
              </div>
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#00e5a0" }}>€310k</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Avg. unit price</div></div>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#e8e8ed" }}>€4,580</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Avg. €/m²</div></div>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#e8e8ed" }}>6.8%</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Monthly absorption</div></div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.78rem", color: "#55555f", marginBottom: "0.5rem" }}>Price range distribution</div>
              {/* Mini histogram */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80, paddingBottom: 4 }}>
                {[
                  { range: "<200k", h: 8 }, { range: "200-250k", h: 22 }, { range: "250-300k", h: 45 },
                  { range: "300-350k", h: 72 }, { range: "350-400k", h: 58 }, { range: "400-450k", h: 28 },
                  { range: "450-500k", h: 14 }, { range: "500k+", h: 8 },
                ].map((b, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{ width: "100%", height: b.h, background: i >= 2 && i <= 5 ? "#00e5a0" : "#333", borderRadius: "2px 2px 0 0", opacity: i >= 2 && i <= 5 ? 0.7 : 0.4 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem" }}>
                <span style={{ fontFamily: mono, fontSize: "0.58rem", color: "#55555f" }}>{"<200k"}</span>
                <span style={{ fontFamily: mono, fontSize: "0.58rem", color: "#55555f" }}>500k+</span>
              </div>
              <div style={{ fontSize: "0.7rem", color: "#8a8a96", marginTop: "0.5rem" }}>
                <span style={{ color: "#00e5a0" }}>■</span> 90th percentile: €215k – €420k
              </div>
            </div>
          </div>
        </InsightCard>

        {/* 5 — Sell-out Watch */}
        <InsightCard label="Sell-out Watch" title="5 projects approaching sell-out.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Projects with less than 15% of units remaining. Last chance for clients or investors — these won't be on the market next quarter.
          </div>
          {[
            ["Zwirn Mlyny", "Staré Mesto", 92, 4, "96%"],
            ["Panorama Towers", "Ružinov", 168, 12, "93%"],
            ["Urban Residence", "Nové Mesto", 74, 8, "89%"],
            ["River Park II", "Staré Mesto", 56, 7, "88%"],
            ["Nový Ružinov I", "Ružinov", 110, 16, "85%"],
          ].map(([name, district, total, remaining, pct]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid #1a1a1f" }}>
              <div>
                <span style={{ fontSize: "0.8rem", color: "#e8e8ed", fontWeight: 500 }}>{name}</span>
                <span style={{ fontSize: "0.72rem", color: "#55555f", marginLeft: "0.5rem" }}>· {district}</span>
              </div>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <span style={{ fontFamily: mono, fontSize: "0.68rem", color: "#8a8a96" }}>{remaining} left of {total}</span>
                <span style={{ fontFamily: mono, fontSize: "0.62rem", color: "#f5a623", background: "rgba(245,166,35,0.08)", padding: "0.1rem 0.4rem", borderRadius: 4 }}>{pct}</span>
              </div>
            </div>
          ))}
        </InsightCard>
      </div>

      {/* Unit Table */}
      <div style={{ padding: "2rem 2rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1rem" }}>
          <div>
            <Label>{l.rawLabel}</Label>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600 }}>{l.unitSample}</h3>
          </div>
          <span style={{ fontFamily: mono, fontSize: "0.7rem", color: "#55555f" }}>{l.showing}</span>
        </div>
        <div className="dark-scroll" style={{ border: "1px solid #222228", borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "#111113" }}>
                {["Project", "District", "Typ", "Label", "m²", "Price €", "€/m²", "Floor", "Stav"].map(h => (
                  <th key={h} style={{ padding: "0.875rem 1rem", textAlign: "left", fontFamily: mono, fontSize: "0.65rem", color: "#55555f", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, borderBottom: "1px solid #222228", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: i < rows.length - 1 ? "1px solid #1a1a1f" : "none" }}>
                  {r.map((cell, j) => (
                    <td key={j} style={{
                      padding: "0.75rem 1rem", whiteSpace: "nowrap",
                      color: j === 0 ? "#e8e8ed" : "#8a8a96",
                      fontWeight: j === 0 ? 500 : 400,
                      fontFamily: j >= 2 ? mono : "inherit",
                      fontSize: j >= 2 ? "0.73rem" : "0.8rem",
                    }}>
                      {j === 8 ? (
                        <span style={{
                          fontFamily: mono, fontSize: "0.65rem",
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
      </div>

      {/* Schema — Terminal (tech flex at bottom) */}
      <div style={{ padding: "2rem 2rem 5rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>{l.schemaLabel}</Label>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{l.schemaTitle}</h3>
        <p className="sec-desc" style={{ marginBottom: "1.5rem" }}>{l.schemaDesc}</p>

        <div style={{ border: "1px solid #222228", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", background: "#111113", borderBottom: "1px solid #222228" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
            <span style={{ flex: 1, textAlign: "center", fontFamily: mono, fontSize: "0.68rem", color: "#55555f", marginRight: "2rem" }}>residata.schema.yml</span>
          </div>
          <div style={{ background: "#0d0d0f", padding: "1.25rem 1.5rem", fontFamily: mono, fontSize: "0.74rem", lineHeight: 1.85 }}>
            <div style={{ color: "#55555f", marginBottom: "0.25rem" }}># residata output schema v2.4</div>
            <div style={{ color: "#55555f", marginBottom: "0.75rem" }}># 25 fields per unit — key fields shown</div>
            <div style={{ color: "#55555f", marginBottom: "0.5rem" }}>---</div>
            <div style={{ marginBottom: "0.25rem" }}><span style={{ color: "#f5a623" }}>fields</span><span style={{ color: "#55555f" }}>:</span></div>
            {schemaLines.map((s, i) => (
              <div key={i} style={{ paddingLeft: "1.25rem", display: "flex", gap: "0.5rem" }}>
                <span style={{ color: "#55555f" }}>-</span>
                <span style={{ color: "#00e5a0" }}>{s.field}</span>
                <span style={{ color: "#55555f" }}>:</span>
                <span style={{ color: "#e8e8ed" }}>{s.type}</span>
                <span style={{ color: "#55555f", marginLeft: "auto", fontSize: "0.68rem" }}>  # {s.desc}</span>
              </div>
            ))}
            <div style={{ marginTop: "0.75rem", color: "#55555f" }}>---</div>
            <div style={{ marginTop: "0.25rem" }}><span style={{ color: "#f5a623" }}>total_fields</span><span style={{ color: "#55555f" }}>: </span><span style={{ color: "#e8e8ed" }}>25</span></div>
            <div><span style={{ color: "#f5a623" }}>output</span><span style={{ color: "#55555f" }}>: </span><span style={{ color: "#e8e8ed" }}>google_sheets | csv | xlsx</span></div>
            <div><span style={{ color: "#f5a623" }}>encoding</span><span style={{ color: "#55555f" }}>: </span><span style={{ color: "#e8e8ed" }}>utf-8</span></div>
          </div>
        </div>
        <div style={{ marginTop: "0.75rem", fontFamily: mono, fontSize: "0.62rem", color: "#55555f", lineHeight: 1.6 }}>
          {l.schemaNote}
        </div>
      </div>

      <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>{l.wantFull}</h2>
        <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>{l.wantFullDesc}</p>
        <a onClick={() => setCurrent("Pricing")} className="btn-p">{l.seePricing}</a>
      </div>
    </>
  );
}

/* ─────── PRICING ─────── */
function PricingPage({ setCurrent, l, lang }) {
  const mono = "'JetBrains Mono', monospace";
  const tiers = l.tiers;
  const faqs = l.faqs;
  const { can } = useCapabilities();
  const showEarlyAccessBlock = can("see_early_access_badge");
  const isAlreadyPaid = can("has_paid_access");
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

        {/* Early access CTA — len pre tých ktorí ešte nie sú paid */}
        {showEarlyAccessBlock && (
          <div style={{
            marginTop: "2rem", padding: "1.5rem 2rem", maxWidth: 680,
            background: "linear-gradient(135deg, rgba(0,229,160,0.08), rgba(0,229,160,0.02))",
            border: "1px solid rgba(0,229,160,0.25)", borderRadius: 12, width: "100%",
          }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
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
              <a
                onClick={() => setCurrent("Contact")}
                className={t.featured ? "btn-p" : "btn-s"}
                style={{
                  display: "block", textAlign: "center",
                  fontSize: "0.9rem", padding: "0.85rem 2rem",
                }}
              >{t.cta}</a>
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

              <a href="https://calendar.app.google/x6vKBohYsVjNKL1A9" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "1rem", color: "#e8e8ed", transition: "color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.color = "#00e5a0"}
                onMouseLeave={e => e.currentTarget.style.color = "#e8e8ed"}>
                <span style={{ fontFamily: mono, fontSize: "0.8rem", color: "#00e5a0", width: 20, textAlign: "center", flexShrink: 0 }}>▶</span>
                <span style={{ fontSize: "0.92rem" }}>{l.bookCall}</span>
              </a>
            </div>

            {/* CTA */}
            <div style={{ marginTop: "1.5rem" }}>
              <a href="mailto:residata@proton.me?subject=Residata%20Inquiry" style={{
                display: "block", padding: "0.85rem 2rem", textAlign: "center",
                background: "#00e5a0", color: "#0a0a0b", fontWeight: 600,
                fontSize: "0.9rem", borderRadius: 8, textDecoration: "none",
              }}>{l.sendEmail}</a>
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

export default function App() {
  // Init page from current URL (so direct link / refresh works)
  const [current, setCurrent] = useState(() =>
    typeof window !== "undefined" ? pathToPage(window.location.pathname) : "Home"
  );
  const [lang, setLang] = useState("en");
  const [loginOpen, setLoginOpen] = useState(false);
  const l = t[lang];
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

  // Track page views
  useEffect(() => {
    track("page_view", { page: current, lang });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const handleNav = (page) => {
    const resolved = typeof page === "string" && page.startsWith("Project:")
      ? page
      : (pageMap[page] || page);
    if (resolved === current) return;
    setCurrent(resolved);
    pushRoute(resolved);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // "Get Access" button → login modal if anon, or go to Pricing if logged in
  const handleGetAccess = () => {
    if (auth.user) handleNav("Pricing");
    else setLoginOpen(true);
  };

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
      `}</style>
      <RisingParticles />
      <div style={{ position: "relative", zIndex: 1 }}>
      <Nav current={current} setCurrent={handleNav} lang={lang} setLang={setLang} auth={auth} onLogin={() => setLoginOpen(true)} caps={caps} />
      <Ticker lang={lang} />
      {/* Spacer for fixed Nav (72px) + Ticker (36px) */}
      <div style={{ height: 36 }} />

      {/* Keyed wrapper — re-mounts on route change so CSS animation replays */}
      <div key={current} className="page-transition">
        {current === "Home" && <HomePage setCurrent={handleNav} l={l} lang={lang} onLogin={() => setLoginOpen(true)} />}

        {/* Live dashboard — pending gets stopped, ostatní vidia (verejnú alebo plnú verziu podľa tier-u) */}
        {current === "Live" && (
          caps.tier === "pending"
            ? <PendingGate setCurrent={handleNav} lang={lang} />
            : <LiveDashboard setCurrent={handleNav} openLogin={() => setLoginOpen(true)} lang={lang} />
        )}

        {current === "Use Cases" && <UseCasesPage setCurrent={handleNav} l={l} />}
        {current === "Data" && <DataPage setCurrent={handleNav} l={l} />}
        {current === "Pricing" && <PricingPage setCurrent={handleNav} l={l} lang={lang} />}
        {current === "Contact" && <ContactPage l={l} />}

        {/* Analytics — paid only, inak UpgradePrompt */}
        {current === "Analytics" && (
          <Feature
            requires="view_analytics"
            fallback={
              caps.tier === "pending"
                ? <PendingGate setCurrent={handleNav} lang={lang} />
                : <main style={{ padding: "5rem 2rem" }}>
                    <UpgradePrompt
                      feature={lang === "sk" ? "analytika a trendy" : "analytics & trends"}
                      variant="card"
                      lang={lang}
                      onLogin={() => setLoginOpen(true)}
                      onGoPricing={() => handleNav("Pricing")}
                    />
                  </main>
            }
          >
            <LiveAnalytics setCurrent={handleNav} openLogin={() => setLoginOpen(true)} lang={lang} />
          </Feature>
        )}

        {/* Admin — admin only, inak 403 / redirect */}
        {current === "Admin" && (
          <Feature
            requires="manage_users"
            fallback={<main style={{ padding: "5rem 2rem", textAlign: "center" }}>
              <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>403</h1>
              <p style={{ color: "#8a8a96" }}>{lang === "sk" ? "Prístup zamietnutý." : "Access denied."}</p>
            </main>}
          >
            <LiveAdmin setCurrent={handleNav} lang={lang} />
          </Feature>
        )}

        {/* Project detail */}
        {typeof current === "string" && current.startsWith("Project:") && (
          caps.tier === "pending"
            ? <PendingGate setCurrent={handleNav} lang={lang} />
            : <LiveProjectDetail projectId={current.slice(8)} setCurrent={handleNav} openLogin={() => setLoginOpen(true)} lang={lang} />
        )}
      </div>
      <Footer />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} lang={lang} />
      {/* Force profile completion after login */}
      {auth.user && auth.profile && !auth.profile.profile_completed && (
        <CompleteProfile lang={lang} />
      )}
      </div>
    </div>
  );
}
