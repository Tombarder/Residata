/**
 * copyGroups — the human map of the website's copy: which text lives on which
 * PAGE and SECTION. The Texts editor uses this to present the ~200 copy keys the
 * way the site is actually organized (Home ▸ Hero, Pricing ▸ Plans, Login modal…)
 * instead of one long alphabetical wall of cryptic keys.
 *
 * Two namespaces, mirroring the two code dictionaries:
 *   · "mk" = marketing site  (t       in lib/marketingCopy.js)
 *   · "lv" = platform & app  (liveT   in lib/liveLang.js)
 *
 * Any key NOT listed here still shows up — the editor collects leftovers into an
 * "Other" page per namespace, so a newly-added string can never silently vanish.
 * Keep this in sync when copy keys are added; it's display-only (never gates data).
 */

export const PAGES = [
  // ─────────────────────────── Marketing site ───────────────────────────
  {
    ns: "mk", group: "Marketing site", id: "mk-home",
    label: "Home", blurb: "Landing page — hero + what you deliver",
    sections: [
      { label: "Header", keys: ["getAccess"] },
      { label: "Hero (top of page)", keys: ["heroTitle1", "heroTitle2", "heroSub", "heroBtn1", "heroBtn2"] },
      { label: "What we deliver", keys: ["whatYouGet", "valueLabel", "valueTitle", "valueDesc", "questionsLabel", "questions", "deliveryLabel", "deliveryItems", "flexTitle", "flexDesc"] },
    ],
  },
  {
    ns: "mk", group: "Marketing site", id: "mk-usecases",
    label: "Use Cases", blurb: "Who it's for + their benefits",
    sections: [
      { label: "Use cases", keys: ["useCasesLabel", "useCasesTitle", "useCasesDesc", "useCases", "useCasesCta", "useCasesCtaDesc", "useCasesCtaBtn"] },
    ],
  },
  {
    ns: "mk", group: "Marketing site", id: "mk-sample",
    label: "Sample data", blurb: "The /sample preview page",
    sections: [
      { label: "Data preview", keys: ["dataLabel", "dataTitle", "dataDesc", "dataContext", "dataContextSub"] },
      { label: "Insights", keys: ["insightsLabel", "insightsTitle", "insightsDesc"] },
      { label: "Raw sample", keys: ["rawLabel", "unitSample", "showing"] },
      { label: "Schema", keys: ["schemaLabel", "schemaTitle", "schemaDesc", "schemaNote"] },
      { label: "Call to action", keys: ["wantFull", "wantFullDesc"] },
    ],
  },
  {
    ns: "mk", group: "Marketing site", id: "mk-pricing",
    label: "Pricing", blurb: "Plans, testimonial, FAQ",
    sections: [
      { label: "Plans", keys: ["pricingLabel", "pricingTitle", "pricingDesc", "tiers", "mostPopular", "seePricing"] },
      { label: "Testimonial & FAQ", keys: ["testimonial", "testimonialFrom", "testimonialName", "testimonialRole", "commonQ", "faqs", "notSure", "notSureDesc"] },
    ],
  },
  {
    ns: "mk", group: "Marketing site", id: "mk-contact",
    label: "Contact", blurb: "Contact page + what to expect",
    sections: [
      { label: "Contact", keys: ["getInTouch", "contactLabel", "contactTitle", "contactDesc", "emailDesc", "phoneDesc", "bookCall", "sendEmail"] },
    ],
  },

  // ─────────────────────────── Platform & app ───────────────────────────
  {
    ns: "lv", group: "Platform & app", id: "lv-global",
    label: "Global", blurb: "Ticker + shared labels",
    sections: [
      { label: "Ticker & shared", keys: ["ticker_loading", "ticker_connecting", "live", "loading_generic"] },
    ],
  },
  {
    ns: "lv", group: "Platform & app", id: "lv-dashboard",
    label: "Dashboard", blurb: "The live market dashboard",
    sections: [
      { label: "Header & summary cards", keys: ["live_label", "live_title", "live_desc_base", "live_desc_anon", "live_desc_free", "upgrade_to_paid", "card_projects", "card_projects_sub", "card_total_units", "card_total_units_sub", "card_available", "card_available_sub", "card_sold", "card_sold_sub_prefix"] },
      { label: "Projects list", keys: ["projects_section_label", "projects_title_all", "projects_title_top", "register_for_full", "register_free", "for_full_list", "hidden_projects"] },
      { label: "Table columns", keys: ["tbl_project", "tbl_district", "tbl_units", "tbl_available", "tbl_sold", "tbl_sold_pct", "tbl_eur_m2", "tbl_sold_30d", "tbl_sold_30d_tooltip_paid", "tbl_sold_30d_tooltip_locked", "tbl_sold_30d_no_data_yet", "tbl_detail"] },
    ],
  },
  {
    ns: "lv", group: "Platform & app", id: "lv-projectdetail",
    label: "Project detail", blurb: "A single project's page",
    sections: [
      { label: "Page", keys: ["back_to_projects", "snapshot_notice", "paid_tier", "no_data"] },
      { label: "Unit table columns", keys: ["tbl_flat", "tbl_building", "tbl_floor", "tbl_rooms", "tbl_interior", "tbl_exterior", "tbl_total", "tbl_price", "tbl_orientation", "tbl_handover", "tbl_status"] },
    ],
  },
  {
    ns: "lv", group: "Platform & app", id: "lv-gates",
    label: "Sign-in gates", blurb: "Prompts to sign in / pick a project",
    sections: [
      { label: "Login gate", keys: ["gate_login_title", "gate_login_body", "gate_login_cta", "back_to_dashboard"] },
      { label: "Free project picker", keys: ["choose_label", "choose_title", "choose_body_prefix", "choose_body_suffix", "choose_current_prefix", "choose_current_suffix", "choose_watch", "choose_back", "choose_upgrade_hint", "saving"] },
    ],
  },
  {
    ns: "lv", group: "Platform & app", id: "lv-analytics",
    label: "Analytics", blurb: "Analytics page + paywall",
    sections: [
      { label: "Analytics", keys: ["analytics_gate_title", "analytics_gate_body", "analytics_paid_title", "analytics_paid_body", "analytics_see_pricing", "analytics_label", "analytics_title", "analytics_desc", "analytics_placeholder"] },
    ],
  },
  {
    ns: "lv", group: "Platform & app", id: "lv-login",
    label: "Login modal", blurb: "Email + code sign-in popup",
    sections: [
      { label: "Login modal", keys: ["login_label", "login_title", "login_desc", "login_placeholder", "login_send", "login_sending", "login_check_title", "login_check_body_prefix", "login_check_body_suffix", "login_close", "login_terms", "login_biz_email_hint", "login_code_placeholder", "login_verify", "login_verifying", "login_code_invalid", "login_resend", "login_resent", "login_code_hint"] },
    ],
  },
  {
    ns: "lv", group: "Platform & app", id: "lv-profile",
    label: "Complete profile", blurb: "Post-signup profile form",
    sections: [
      { label: "Profile form", keys: ["cp_title", "cp_desc", "cp_name", "cp_name_ph", "cp_company", "cp_company_ph", "cp_position", "cp_position_any", "cp_position_dev", "cp_position_inv", "cp_position_bnk", "cp_position_con", "cp_position_oth", "cp_linkedin", "cp_linkedin_ph", "cp_phone", "cp_phone_ph", "cp_submit", "cp_submitting", "cp_signout"] },
    ],
  },
  {
    ns: "lv", group: "Platform & app", id: "lv-pending",
    label: "Pending approval", blurb: "Waiting-for-approval screen",
    sections: [
      { label: "Pending screen", keys: ["pending_title", "pending_body", "pending_meanwhile", "pending_explore"] },
    ],
  },
  {
    ns: "lv", group: "Platform & app", id: "lv-admin",
    label: "Admin screens", blurb: "Internal admin tool labels",
    sections: [
      { label: "User management", keys: ["admin_label", "admin_title", "admin_email", "admin_tier", "admin_project", "admin_created", "admin_actions", "admin_403_title", "admin_403_body", "admin_pending_section", "admin_new_section", "admin_approve", "admin_events_section", "admin_no_pending"] },
    ],
  },
];

/** Turn a raw key into a readable field label: heroTitle1 → "Hero title 1". */
export function humanizeKey(key) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}
