/**
 * Translations for live/Supabase-backed pages (Dashboard, ProjectDetail, Analytics, Admin, LoginModal).
 * Complements the main `t` dict in App.jsx which handles marketing pages.
 */
export const liveT = {
  en: {
    // Nav / badges
    ticker_loading: "Loading live data…",
    ticker_connecting: "Connecting to data source…",
    live: "LIVE",

    // Dashboard
    live_label: "Live dashboard",
    live_title: "Current market snapshot",
    live_desc_base: "Data refreshed daily. Filter, explore, compare.",
    live_desc_anon: "Sign in for full detail on any single project (free).",
    live_desc_free: "Upgrade to paid for access to all {n} projects.",
    upgrade_to_paid: "Upgrade to paid",

    card_projects: "Projects",
    card_projects_sub: "currently on market",
    card_total_units: "Total units",
    card_total_units_sub: "across all projects",
    card_available: "Available",
    card_available_sub: "actively on sale",
    card_sold: "Sold",
    card_sold_sub_prefix: "sold-out projects:",

    projects_section_label: "Projects",
    projects_title_all: "{n} projects",
    projects_title_top: "Top {n} of {total}",
    register_for_full: "Register for full list",
    loading_generic: "Loading…",

    tbl_project: "Project",
    tbl_district: "District",
    tbl_units: "Units",
    tbl_available: "Available",
    tbl_sold: "Sold",
    tbl_sold_pct: "Sold %",
    tbl_eur_m2: "€/m²",
    tbl_sold_30d: "Sold 30d",
    tbl_sold_30d_tooltip_paid: "Units sold in the last 30 days — key sales velocity metric",
    tbl_sold_30d_tooltip_locked: "Sales velocity — available in paid tier",
    tbl_sold_30d_no_data_yet: "Populating from the next daily scrape",
    tbl_detail: "Detail →",
    hidden_projects: "Hidden {n} more projects.",
    register_free: "Register free",
    for_full_list: "for the full list.",

    // Project detail
    back_to_projects: "← Back to projects",
    snapshot_notice: "ⓘ Showing current snapshot. History and analytics are part of the",
    paid_tier: "paid tier",
    no_data: "No data available.",

    tbl_flat: "Flat",
    tbl_building: "Building",
    tbl_floor: "Floor",
    tbl_rooms: "Rooms",
    tbl_interior: "Interior",
    tbl_exterior: "Exterior",
    tbl_total: "Total",
    tbl_price: "Price",
    tbl_orientation: "Orient.",
    tbl_handover: "Handover",
    tbl_status: "Status",

    // Gates
    gate_login_title: "Sign in to view project detail",
    gate_login_body: "A free account unlocks full detail of any 1 project you choose. Paid gets you all.",
    gate_login_cta: "Sign in (free)",
    back_to_dashboard: "Back to dashboard",

    choose_label: "Free tier gate",
    choose_title: "Choose 1 project",
    choose_body_prefix: "Your free account unlocks full detail of",
    choose_body_suffix: "one project. Want to track",
    choose_current_prefix: "You're currently tracking:",
    choose_current_suffix: "This action will replace it.",
    choose_watch: "Track {name}",
    choose_back: "Back",
    choose_upgrade_hint: "Want access to all {n} projects?",
    saving: "Saving…",

    // Analytics
    analytics_gate_title: "Sign in for analytics",
    analytics_gate_body: "Analytics and trends are part of the paid account.",
    analytics_paid_title: "Analytics is a paid feature",
    analytics_paid_body: "Price trends over time, district heat maps, top developers, absorption rate, monthly PDF reports — all in paid tier.",
    analytics_see_pricing: "See pricing",
    analytics_label: "Analytics",
    analytics_title: "Trends & insights",
    analytics_desc: "Price trends over time, district heat maps, data export, and monthly reports.",
    analytics_placeholder: "Detailed charts and trend analytics — questions? email info@residata.eu",

    // Admin
    admin_label: "Admin",
    admin_title: "User tier management",
    admin_email: "Email",
    admin_tier: "Tier",
    admin_project: "Project",
    admin_created: "Created",
    admin_actions: "Actions",
    admin_403_title: "403",
    admin_403_body: "Admin only.",

    // LoginModal
    login_label: "Sign in",
    login_title: "Get instant access",
    login_desc: "Enter your email — we'll send you a one-time sign-in code. No password, no spam.",
    login_placeholder: "you@example.com",
    login_send: "Send code",
    login_sending: "Sending…",
    login_check_title: "Enter your code",
    login_check_body_prefix: "We sent a sign-in code to",
    login_check_body_suffix: ". Enter it below to sign in.",
    login_close: "Close",
    login_terms: "By signing in you agree to our basic terms. Free tier includes access to 1 full project snapshot.",
    login_biz_email_hint: "Work email required",
    login_code_placeholder: "Enter code",
    login_verify: "Verify & sign in",
    login_verifying: "Verifying…",
    login_code_invalid: "That code is invalid or has expired. Request a new one.",
    login_resend: "Send a new code",
    login_resent: "New code sent ✓",
    login_code_hint: "Check your inbox (and spam). Valid for 1 hour.",

    // Complete profile
    cp_title: "Complete your profile",
    cp_desc: "Just a few details before you get access. We only accept work emails and use this info to understand who's using Residata.",
    cp_name: "Full name",
    cp_name_ph: "Jane Doe",
    cp_company: "Company",
    cp_company_ph: "Acme Holding",
    cp_position: "Position",
    cp_position_any: "— select —",
    cp_position_dev: "Developer / Sales",
    cp_position_inv: "Investor / PE",
    cp_position_bnk: "Bank / Valuer",
    cp_position_con: "Consultant / Analyst",
    cp_position_oth: "Other",
    cp_linkedin: "LinkedIn URL (recommended)",
    cp_linkedin_ph: "https://linkedin.com/in/you",
    cp_phone: "Phone (optional)",
    cp_phone_ph: "+421 …",
    cp_submit: "Save & continue",
    cp_submitting: "Saving…",
    cp_signout: "Sign out",

    // Pending approval gate
    pending_title: "Application received",
    pending_body: "Thanks — your profile is complete. We manually approve new accounts to keep data quality high. You'll get an email once approved (usually within a few hours).",
    pending_meanwhile: "Meanwhile, you can browse the public dashboard and pricing.",
    pending_explore: "Explore dashboard",

    // Admin — pending section
    admin_pending_section: "Pending approvals",
    admin_new_section: "All users",
    admin_approve: "Approve → free",
    admin_events_section: "Recent signup events",
    admin_no_pending: "No pending approvals 🎉",
  },
  sk: {
    ticker_loading: "Načítavam dáta…",
    ticker_connecting: "Pripájame sa k dátam…",
    live: "LIVE",

    live_label: "Live dashboard",
    live_title: "Aktuálny stav trhu",
    live_desc_base: "Dáta aktualizované každý deň. Filtruj, preklikni, porovnaj.",
    live_desc_anon: "Registrácia odomkne plný detail 1 projektu (zadarmo).",
    live_desc_free: "Upgrade na paid pre prístup ku všetkým {n} projektom.",
    upgrade_to_paid: "Upgrade na paid",

    card_projects: "Projektov",
    card_projects_sub: "aktívne na trhu",
    card_total_units: "Bytov celkom",
    card_total_units_sub: "naprieč všetkými projektmi",
    card_available: "Voľné",
    card_available_sub: "aktuálne na trhu",
    card_sold: "Predané",
    card_sold_sub_prefix: "vypredaných projektov:",

    projects_section_label: "Projekty",
    projects_title_all: "{n} projektov",
    projects_title_top: "Top {n} z {total}",
    register_for_full: "Registrovať pre plný zoznam",
    loading_generic: "Načítavam…",

    tbl_project: "Projekt",
    tbl_district: "Okres",
    tbl_units: "Bytov",
    tbl_available: "Voľné",
    tbl_sold: "Vypredané",
    tbl_sold_pct: "% predané",
    tbl_eur_m2: "€/m²",
    tbl_sold_30d: "Predané 30d",
    tbl_sold_30d_tooltip_paid: "Predané byty za posledných 30 dní — kľúčový ukazovateľ rýchlosti predaja",
    tbl_sold_30d_tooltip_locked: "Rýchlosť predaja — dostupná v paid tier-e",
    tbl_sold_30d_no_data_yet: "Prvé dáta po najbližšom mesačnom scrape behu",
    tbl_detail: "Detail →",
    hidden_projects: "Skrytých {n} projektov.",
    register_free: "Zaregistruj sa zadarmo",
    for_full_list: "pre plný zoznam.",

    back_to_projects: "← Späť na projekty",
    snapshot_notice: "ⓘ Zobrazujeme aktuálny snapshot. História a analytika sú súčasťou",
    paid_tier: "paid tier-u",
    no_data: "Žiadne dáta.",

    tbl_flat: "Byt",
    tbl_building: "Budova",
    tbl_floor: "Posch.",
    tbl_rooms: "Izby",
    tbl_interior: "Interiér",
    tbl_exterior: "Exteriér",
    tbl_total: "Celk.",
    tbl_price: "Cena",
    tbl_orientation: "Orient.",
    tbl_handover: "Kolaud.",
    tbl_status: "Stav",

    gate_login_title: "Prihlás sa pre detail projektu",
    gate_login_body: "Free účet ti odomkne plný detail ľubovoľného 1 projektu. Paid účet má prístup ku všetkým.",
    gate_login_cta: "Prihlásiť sa (free)",
    back_to_dashboard: "Späť na dashboard",

    choose_label: "Free tier gate",
    choose_title: "Vyber si 1 projekt",
    choose_body_prefix: "Free účet ti odomkne plný detail",
    choose_body_suffix: "1 projektu. Chceš sledovať",
    choose_current_prefix: "Momentálne sleduješ projekt:",
    choose_current_suffix: "Touto akciou ho zmeníš.",
    choose_watch: "Sledovať {name}",
    choose_back: "Späť",
    choose_upgrade_hint: "Chceš sledovať všetkých {n} projektov naraz?",
    saving: "Ukladám…",

    analytics_gate_title: "Prihlás sa pre analytiku",
    analytics_gate_body: "Analytika a trendy sú súčasťou paid účtu.",
    analytics_paid_title: "Analytika je pre paid tier",
    analytics_paid_body: "Cenové trendy v čase, heat mapy okresov, top developers, absorption rate, mesačné PDF reporty — všetko v paid tier-e.",
    analytics_see_pricing: "Zobraziť cenník",
    analytics_label: "Analytics",
    analytics_title: "Trendy a insights",
    analytics_desc: "Grafy cien v čase, heat mapy okresov, export dát a mesačné reporty.",
    analytics_placeholder: "Detailné grafy a trend analytika — otázky? napíš na info@residata.eu",

    admin_label: "Admin",
    admin_title: "Správa tier-ov užívateľov",
    admin_email: "Email",
    admin_tier: "Tier",
    admin_project: "Projekt",
    admin_created: "Created",
    admin_actions: "Akcie",
    admin_403_title: "403",
    admin_403_body: "Len pre admin.",

    login_label: "Prihlásenie",
    login_title: "Okamžitý prístup",
    login_desc: "Zadaj email — pošleme ti jednorazový prihlasovací kód. Bez hesla, bez spamu.",
    login_placeholder: "ty@priklad.sk",
    login_send: "Poslať kód",
    login_sending: "Posielam…",
    login_check_title: "Zadaj kód",
    login_check_body_prefix: "Poslali sme prihlasovací kód na",
    login_check_body_suffix: ". Zadaj ho nižšie pre prihlásenie.",
    login_close: "Zavrieť",
    login_terms: "Prihlásením súhlasíš s našimi základnými podmienkami. Free verzia zahŕňa plný prístup k 1 projektu.",
    login_code_placeholder: "Zadaj kód",
    login_verify: "Overiť a prihlásiť",
    login_verifying: "Overujem…",
    login_code_invalid: "Kód je neplatný alebo vypršal. Vyžiadaj si nový.",
    login_resend: "Poslať nový kód",
    login_resent: "Nový kód odoslaný ✓",
    login_code_hint: "Skontroluj doručené (aj spam). Platí 1 hodinu.",
    login_biz_email_hint: "Business email povinný",

    cp_title: "Dokonči profil",
    cp_desc: "Pár údajov pred prístupom. Prijímame len business maily. Info používame len pre interné CRM.",
    cp_name: "Meno a priezvisko",
    cp_name_ph: "Janko Mrkvička",
    cp_company: "Spoločnosť",
    cp_company_ph: "Acme Holding",
    cp_position: "Pozícia",
    cp_position_any: "— vyber —",
    cp_position_dev: "Developer / Sales",
    cp_position_inv: "Investor / PE",
    cp_position_bnk: "Banka / Oceňovanie",
    cp_position_con: "Consultant / Analytik",
    cp_position_oth: "Iné",
    cp_linkedin: "LinkedIn URL (odporúčané)",
    cp_linkedin_ph: "https://linkedin.com/in/ty",
    cp_phone: "Telefón (voliteľné)",
    cp_phone_ph: "+421 …",
    cp_submit: "Uložiť a pokračovať",
    cp_submitting: "Ukladám…",
    cp_signout: "Odhlásiť",

    pending_title: "Žiadosť prijatá",
    pending_body: "Ďakujeme — profil je kompletný. Nové účty schvaľujeme manuálne aby sme udržali kvalitu. Dostaneš email po schválení (zvyčajne do pár hodín).",
    pending_meanwhile: "Medzitým si môžeš pozrieť verejný dashboard a cenník.",
    pending_explore: "Ísť na dashboard",

    admin_pending_section: "Čakajúce schválenia",
    admin_new_section: "Všetci užívatelia",
    admin_approve: "Schváliť → free",
    admin_events_section: "Nedávne signup udalosti",
    admin_no_pending: "Žiadne čakajúce schválenia 🎉",
  },
};

/** Jednoduchá interpolácia {placeholder}. */
export function ll(str, params = {}) {
  return str.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

import { applyOverrides } from "./copyOverrides";

/**
 * Resolve the live/admin-page dictionary for `lang`, with the Boss's DB
 * overrides merged on top of the code defaults. Use this instead of reading
 * `liveT[lang]` directly so edited copy shows up live.
 *
 * Fallback chain: unknown lang (e.g. 'cs' before its copy is written) falls
 * back to English defaults, then any 'cs' overrides win — so a partially
 * translated Czech site shows English where untranslated, never blank.
 */
export function getLiveT(lang) {
  const base = liveT[lang] || liveT.en;
  return applyOverrides(lang, base, "lv");
}
