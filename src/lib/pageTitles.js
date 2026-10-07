// The human name of each platform page — one list for the top bar (Platform.jsx
// TopBar) and for admin → a person's activity, which names the pages someone used.
// A second copy would drift the first time a page is renamed.

export const PAGE_TITLES = {
  "App:Dashboard": { en: "Dashboard",       sk: "Dashboard"    },
  "App:Projects":  { en: "Projects",        sk: "Projekty"     },
  "App:Map":       { en: "Map view",        sk: "Mapa"         },
  "App:Map2":      { en: "Market Radar",     sk: "Trhový radar" },
  "App:Analytics":    { en: "Analytics",     sk: "Analytika"    },
  "App:UnitTimeline": { en: "Unit timeline", sk: "Byt v čase"   },
  "App:Explorer":     { en: "Unit Explorer", sk: "Prieskumník"  },
  "App:Sales":        { en: "Sales",         sk: "Predaje"      },
  "App:Reports":      { en: "Reports",       sk: "Reporty"      },
  "App:Assistant": { en: "AI Assistant",    sk: "AI asistent"  },
  "App:Exports":   { en: "Exports",         sk: "Exporty"      },
  "App:Billing":   { en: "Plan & billing",  sk: "Predplatné"},
  "App:Settings":  { en: "Settings",        sk: "Nastavenia"   },
  "App:Admin":     { en: "Admin",           sk: "Admin"        },
  "App:Locations": { en: "Locations",       sk: "Polohy"       },
  "App:DataQA":    { en: "Data control",    sk: "Kontrola dát" },
  "App:Feedback":  { en: "Feedback",        sk: "Spätná väzba" },
  "App:Texts":     { en: "Website texts",   sk: "Texty na webe" },
  "App:Usage":     { en: "Usage",           sk: "Používanie"    },
  "App:Articles":  { en: "Analyses",        sk: "Analýzy"       },
};

/** "App:Map2" → "Market Radar"; a project page → "Project detail"; anything else as it is. */
export function pageTitle(key, lang = "en") {
  if (!key) return "—";
  const hit = PAGE_TITLES[key];
  if (hit) return hit[lang] || hit.en;
  if (key.startsWith("App:ProjectDetail:")) return lang === "sk" ? "Detail projektu" : "Project detail";
  if (key.startsWith("Project:")) return lang === "sk" ? "Verejná stránka projektu" : "Public project page";
  if (!key.startsWith("App:")) return lang === "sk" ? `Web: ${key}` : `Website: ${key}`;
  return key.slice(4);
}
