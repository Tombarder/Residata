/**
 * SEO — per-route <title> / <meta> / canonical / hreflang management.
 *
 * Residata is a SPA, so the same index.html is served for every URL.
 * Search engines do execute JS (Googlebot since 2019), so updating the
 * DOM <head> on route change DOES propagate into Google's index. But:
 *   · The static defaults in index.html matter for crawlers that don't
 *     execute JS (Perplexity's own crawler, some lightweight bots, and
 *     for the first paint before React hydrates).
 *   · The dynamic updates here override those defaults once the user
 *     actually lands on a specific route.
 *
 * Design choice — no external dep (no react-helmet):
 *   The app's dep footprint is deliberately tiny (4 runtime deps).
 *   A ~30-line useEffect hook does the job without adding 50 kB of
 *   library for a single feature.
 *
 * What we set per-route:
 *   · document.title
 *   · meta[name=description]
 *   · meta[name=keywords]
 *   · link[rel=canonical]
 *   · meta[property=og:title|og:description|og:url|og:locale]
 *   · meta[name=twitter:title|twitter:description]
 *   · html[lang]
 *   · link[rel=alternate][hreflang=en|sk|x-default]
 *
 * How to add a new route: extend SEO_BY_PAGE with an entry keyed on the
 * internal page name (see src/lib/routing.js). Copy is in both
 * languages; the hook picks the right one based on `lang` prop.
 */

// Production base — used for og:url / canonical. Swap when custom domain
// is live (e.g. residata.sk). Keeping it single-sourced here avoids
// scattering hardcoded URLs across the codebase.
export const SITE_BASE = "https://residata-gamma.vercel.app";

/**
 * SEO metadata per (page, lang). Kept together so the translation burden
 * of adding a route is visible — no split copy surfaces.
 * Keywords lean on what Slovak buyers actually type into Google:
 * "novostavby Bratislava", "ceny bytov", "predaj bytov novostavba", etc.
 * English keywords target cross-border investors + bank/valuer
 * terminology ("property market data Slovakia", "absorption rate").
 */
const SEO_BY_PAGE = {
  Home: {
    path: "/",
    en: {
      title: "Residata — New-Build Market Intelligence for Bratislava",
      description: "Every new residential development in Bratislava, structured and refreshed monthly. Pricing, availability, absorption, and trends — built for developers, banks, valuers, and investors.",
      keywords: "Bratislava real estate, new-build market data, residential market intelligence, absorption rate, property market Slovakia, €/m² trends",
    },
    sk: {
      title: "Residata — Dátový prehľad trhu novostavieb Bratislava",
      description: "Každý aktívny projekt novostavby v Bratislave na jednom mieste. Ceny, dostupnosť, rýchlosť predaja a trendy — aktualizované každý mesiac. Pre developerov, banky, odhadcov a investorov.",
      keywords: "novostavby Bratislava, trh novostavieb, ceny bytov, market intelligence, dáta nehnuteľnosti, €/m² trendy, rýchlosť predaja",
    },
  },
  Live: {
    path: "/live",
    en: {
      title: "Live Dashboard — Residata | Bratislava New-Build Market",
      description: "Explore every active new-build residential project in Bratislava: units available, sold percentage, €/m² by project and district, and sell-out watch list.",
      keywords: "live dashboard Bratislava real estate, new-build projects, units available, sold percentage, €/m² by project",
    },
    sk: {
      title: "Live dashboard — Residata | Trh novostavieb Bratislava",
      description: "Pozrite si každý aktívny projekt novostavby v Bratislave: voľné byty, percento predaja, €/m² podľa projektu a okresu, sledovanie blížiacich sa sell-out-ov.",
      keywords: "live dashboard Bratislava, novostavby projekty, voľné byty, % predaja, €/m² podľa projektu",
    },
  },
  "Use Cases": {
    path: "/use-cases",
    en: {
      title: "Use Cases — Residata | Market Data for Developers, Banks, Investors",
      description: "How developers price new launches, how banks source comparables, how investors spot opportunities, and how consultants build presentation-ready market reports. All from a single dataset.",
      keywords: "real estate data use cases, developer pricing, bank comparables, valuation data, investor deal sourcing, consultant market report",
    },
    sk: {
      title: "Využitie — Residata | Trhové dáta pre developerov, banky, investorov",
      description: "Ako developeri oceňujú nové projekty, ako banky hľadajú komparatívy, ako investori vyhľadávajú príležitosti a ako konzultanti pripravujú prehľady trhu — všetko z jednej dátovej sady.",
      keywords: "využitie realitných dát, oceňovanie developer, bankové komparatívy, odhad nehnuteľnosti, investor deal flow",
    },
  },
  Data: {
    path: "/sample",
    en: {
      title: "What We Deliver — Residata | Sample Market Intelligence Output",
      description: "See what a Residata delivery actually looks like — unit-level data, market insights with directional signals (sell-out forecasts, pricing tension, scarcity clock), and the full data schema.",
      keywords: "real estate data sample, market intelligence report, unit-level data schema, absorption forecast, sell-out watch",
    },
    sk: {
      title: "Čo dostanete — Residata | Ukážka výstupu",
      description: "Pozrite si ako vyzerá výstup Residata — dáta na úrovni bytu, insighty s predpoveďami (sell-out forecast, cenová tenzia, scarcity clock) a kompletná schéma dát.",
      keywords: "ukážka realitných dát, trhový report, dáta na úrovni bytu, schéma dát, sell-out predpoveď",
    },
  },
  Pricing: {
    path: "/pricing",
    en: {
      title: "Pricing — Residata | €249 One-Time · €349 Monthly",
      description: "Simple pricing: €249 for a one-time snapshot report, or €349 monthly for ongoing access to the full Bratislava new-build market dataset. Early access slots limited.",
      keywords: "Residata pricing, real estate data pricing, market intelligence subscription, €249, €349 monthly",
    },
    sk: {
      title: "Cenník — Residata | €249 jednorazovo · €349 mesačne",
      description: "Jednoduché ceny: €249 za jednorazový snapshot report, alebo €349 mesačne za priebežný prístup ku kompletným dátam novostavieb v Bratislave. Early access miesta sú obmedzené.",
      keywords: "Residata cenník, ceny dát nehnuteľnosti, market intelligence predplatné, €249, €349 mesačne",
    },
  },
  Contact: {
    path: "/contact",
    en: {
      title: "Contact — Residata",
      description: "Get in touch with Residata — for sample reports, custom delivery, API access, or enterprise pricing. Email: residata@proton.me",
      keywords: "Residata contact, real estate data contact, custom market report Bratislava",
    },
    sk: {
      title: "Kontakt — Residata",
      description: "Kontaktujte Residata — pre ukážkový report, custom dodávku, API prístup alebo enterprise ceny. Email: residata@proton.me",
      keywords: "Residata kontakt, dáta nehnuteľnosti kontakt, custom report Bratislava",
    },
  },
};

/**
 * Upsert a <meta> by name OR property. Creates the tag if missing. This
 * avoids fragile Element.setAttribute chains scattered through the hook.
 */
function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

function setLink(rel, href, hreflang) {
  // hreflang lets us update the right alternate without touching the others
  const sel = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"]`
    : `link[rel="${rel}"]`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    if (hreflang) el.setAttribute("hreflang", hreflang);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Resolve the SEO entry for a given internal page name. Project detail
 * and app/platform pages fall through to a generic entry (we don't want
 * each dynamic project page minting a unique index-worthy title — those
 * are gated content).
 */
function resolvePageSeo(page, lang) {
  // Project detail — per-project page, we just render a generic title
  // (individual project data is behind login, not useful as SEO target).
  if (typeof page === "string" && page.startsWith("Project:")) {
    return {
      path: "/live",
      ...(lang === "sk"
        ? { title: "Detail projektu — Residata", description: "Detailné dáta konkrétneho projektu novostavby v Bratislave.", keywords: "novostavba detail Bratislava" }
        : { title: "Project Detail — Residata", description: "Detailed data on a specific new-build residential project in Bratislava.", keywords: "new-build project detail Bratislava" }),
      noindex: true,
    };
  }
  // Platform / app — private, don't index
  if (typeof page === "string" && page.startsWith("App:")) {
    return {
      path: "/app",
      ...(lang === "sk"
        ? { title: "Platforma — Residata", description: "Prihlásená platforma Residata." }
        : { title: "Platform — Residata", description: "Residata authenticated platform." }),
      noindex: true,
    };
  }
  const entry = SEO_BY_PAGE[page];
  if (!entry) return null;
  return { path: entry.path, ...entry[lang === "sk" ? "sk" : "en"] };
}

/**
 * Apply SEO metadata to the document for a given (page, lang) pair.
 * Called from App.jsx inside a useEffect so it fires on every navigation.
 */
export function applySeo(page, lang) {
  if (typeof document === "undefined") return;
  const meta = resolvePageSeo(page, lang);
  if (!meta) return;

  const url = SITE_BASE + meta.path;
  const locale = lang === "sk" ? "sk_SK" : "en_US";

  // <html lang> — important for accessibility + hreflang signals
  document.documentElement.setAttribute("lang", lang === "sk" ? "sk" : "en");

  // Title + primary description
  document.title = meta.title;
  setMeta("name", "description", meta.description);
  if (meta.keywords) setMeta("name", "keywords", meta.keywords);

  // Robots control — private pages are noindex
  setMeta("name", "robots", meta.noindex
    ? "noindex, nofollow"
    : "index, follow, max-image-preview:large, max-snippet:-1");

  // Canonical URL
  setLink("canonical", url);

  // hreflang — tell Google both language versions exist at same URL
  // (we don't have /sk prefix — language is state-driven). The x-default
  // points to the primary (English).
  setLink("alternate", url, "en");
  setLink("alternate", url, "sk");
  setLink("alternate", url, "x-default");

  // Open Graph
  setMeta("property", "og:title", meta.title);
  setMeta("property", "og:description", meta.description);
  setMeta("property", "og:url", url);
  setMeta("property", "og:locale", locale);
  setMeta("property", "og:site_name", "Residata");
  setMeta("property", "og:type", "website");

  // Twitter / X
  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", meta.title);
  setMeta("name", "twitter:description", meta.description);
}
