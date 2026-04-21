/**
 * ============================================================
 *  CAPABILITY-BASED ACCESS CONTROL
 * ============================================================
 * Jediné miesto kde sa rozhoduje čo ktorý tier môže robiť / vidieť.
 *
 * PATTERN:
 *   1. Definuj capability tu (kebab-case, slovesná forma — `view_x`, `export_x`)
 *   2. Pridaj ju do príslušných tier-ov
 *   3. V komponente: `const { can } = useCapabilities();`
 *      → `{can('view_analytics') && <AnalyticsChart />}`
 *
 * KDE sa to NESMIE robiť (anti-pattern):
 *   ❌ `if (tier === 'paid') ...`  → hľadanie v 50 miestach keď meníme pravidlá
 *   ❌ `if (isPaid || isAdmin) ...` → rovnako
 *   ❌ kopírovanie `can()` výsledku a checkovanie inej capability inde
 *      → vždy volaj `can(X)` pre konkrétnu vec
 *
 * BACKEND GATING:
 *   Toto je IBA UI vrstva. Dáta chráni Supabase RLS.
 *   Ak free user hackuje frontend → DB mu stále nevráti paid dáta.
 *
 * NOVÝ TIER / NOVÁ FEATURE:
 *   - Nová capability: pridaj string do CAPABILITY_KEYS a priraď k tierom
 *   - Nový tier: pridaj kľúč do TIERS a zadefinuj jeho zoznam capabilities
 * ============================================================
 */

// Zoznam všetkých known capabilities (pre runtime kontrolu typov)
export const CAPABILITY_KEYS = [
  // Verejný obsah (marketing + ticker + základný dashboard)
  'view_public_content',         // Home, Pricing, Use Cases, Contact — pre každého
  'view_ticker',                 // Bloomberg ticker pod nav-om
  'view_dashboard_public',       // /live — summary cards + top 20 projektov
  'view_market_pulse',           // MarketPulse sekcia na home
  'view_district_pulse',         // DistrictPulse sekcia na home
  'view_how_it_works',           // pipeline animácia

  // Plný list projektov (>20)
  'view_all_projects_list',      // všetkých 55+ projektov namiesto top 20

  // Detail projektu
  'view_chosen_project_detail',  // detail svojho 1 vybraného projektu (free)
  'view_any_project_detail',     // detail ľubovoľného projektu (paid)
  'choose_project',              // one-time výber svojho 1 projektu (free)

  // Paid features
  'view_analytics',              // grafy, trendy
  'view_historical_data',        // mesiac-na-mesiac
  'view_sold_velocity',          // sold_last_month column (kľúčová metrika rýchlosti predaja)
  'export_data',                 // CSV / JSON download
  'view_monthly_reports',        // PDF reporty

  // Profile
  'change_own_profile',          // edit svojho full_name, company, ...
  'access_pending_gate',         // zobraziť "waiting for approval"

  // Admin
  'manage_users',                // /admin — flip tier
  'manage_premium_domains',      // /admin — CRUD domén
  'view_activity_log',           // /admin — event feed
  'view_admin_nav',              // zobraziť "ADMIN" link v nav

  // UI prompts (len pre príslušné tiery)
  'prompt_signup',               // "Sign up / Get Access" CTA — len pre anonymných
  'prompt_upgrade_to_paid',      // "Upgrade to paid" CTA — len pre free (nie pending/paid)
  'see_early_access_badge',      // "X slots remaining" — všetci okrem paid/admin

  // Meta / convenience
  'has_paid_access',             // paid+admin — pre generické "user platí" checky
];

// === TIER → CAPABILITIES MAPPING ===
// Každý tier dostane explicitný zoznam (žiadne dedenie, nech je viditeľné čo má).
// Radíme abecedne pre diff-friendly kontroly.

const ANON_CAPS = [
  'prompt_signup',
  'see_early_access_badge',
  'view_dashboard_public',
  'view_district_pulse',
  'view_how_it_works',
  'view_market_pulse',
  'view_public_content',
  'view_ticker',
];

const PENDING_CAPS = [
  // Zaregistrovaný + vyplnený profil, čaká na admin schválenie.
  // NEmá prístup k dátam okrem verejných. NEukazujeme "Sign up" (už je prihlásený).
  'access_pending_gate',
  'change_own_profile',
  'see_early_access_badge',
  'view_dashboard_public',
  'view_district_pulse',
  'view_how_it_works',
  'view_market_pulse',
  'view_public_content',
  'view_ticker',
];

const FREE_CAPS = [
  'change_own_profile',
  'choose_project',
  'prompt_upgrade_to_paid',      // pre free je relevantný upgrade prompt
  'see_early_access_badge',
  'view_all_projects_list',      // vidí kompletný zoznam
  'view_chosen_project_detail',  // iba svoj 1 projekt
  'view_dashboard_public',
  'view_district_pulse',
  'view_how_it_works',
  'view_market_pulse',
  'view_public_content',
  'view_ticker',
];

const PAID_CAPS = [
  'change_own_profile',
  'export_data',
  'has_paid_access',
  'view_all_projects_list',
  'view_analytics',
  'view_any_project_detail',
  'view_chosen_project_detail',   // backward compat — paid samozrejme vidí aj "svoj" projekt
  'view_dashboard_public',
  'view_district_pulse',
  'view_historical_data',
  'view_how_it_works',
  'view_market_pulse',
  'view_monthly_reports',
  'view_public_content',
  'view_sold_velocity',
  'view_ticker',
  // NIE: prompt_signup, prompt_upgrade_to_paid, see_early_access_badge, access_pending_gate
];

const ADMIN_CAPS = [
  ...PAID_CAPS,
  'manage_premium_domains',
  'manage_users',
  'view_activity_log',
  'view_admin_nav',
];

export const TIER_CAPABILITIES = {
  anon:    ANON_CAPS,
  pending: PENDING_CAPS,
  free:    FREE_CAPS,
  paid:    PAID_CAPS,
  admin:   ADMIN_CAPS,
};

// Precomputed Sets pre O(1) lookup
const TIER_CAPABILITY_SETS = Object.fromEntries(
  Object.entries(TIER_CAPABILITIES).map(([k, v]) => [k, new Set(v)])
);

// Dev-time sanity check: caps definované v tieroch sa musia zhodovať s CAPABILITY_KEYS
if (typeof window !== "undefined" && import.meta.env.DEV) {
  const known = new Set(CAPABILITY_KEYS);
  for (const [tier, caps] of Object.entries(TIER_CAPABILITIES)) {
    for (const c of caps) {
      if (!known.has(c)) {
        // eslint-disable-next-line no-console
        console.warn(`[capabilities] Unknown cap '${c}' in tier '${tier}' — add to CAPABILITY_KEYS`);
      }
    }
  }
}

/**
 * Pure function (nie hook) — užitočné mimo React kontextu (napr. v utility fn).
 */
export function canForTier(tier, cap) {
  const set = TIER_CAPABILITY_SETS[tier] || TIER_CAPABILITY_SETS.anon;
  return set.has(cap);
}

export function capsForTier(tier) {
  return TIER_CAPABILITY_SETS[tier] || TIER_CAPABILITY_SETS.anon;
}
