import { useCountry, ALL_COUNTRIES } from "./useCountry";
import { useCurrency } from "./useCurrency";
import { useThemeMode, setTheme } from "./theme-mode";
import { useAccountUiPref } from "./useAccountUiPref";

/**
 * AccountPrefsSync — makes the GLOBAL UI selectors (market, currency, theme) follow
 * the ACCOUNT across devices, the same way every page's filters do. Each selector
 * keeps its own localStorage as the instant per-browser cache; the account
 * (`user_profiles.ui_prefs`, via the preference store in accountPrefs.js) is the
 * cross-device source of truth.
 *
 * Renders nothing — mounted once inside the Country + Currency providers (so it can
 * read both selectors) and below AuthProvider (so it can read the profile).
 *
 * These three used to carry their own hand-rolled copy of the hydrate/debounce/save
 * dance. That is gone: a preference has exactly ONE owner now, which is what stops
 * the account and the browser from drifting apart — the failure that wiped every
 * Analytics setting on navigation (see accountPrefs.js).
 */
export default function AccountPrefsSync() {
  const { country, setCountry } = useCountry();
  const { chosen, setCurrency } = useCurrency();
  const [themeMode] = useThemeMode();

  // Market — a plain "all" is the default, so only a real market choice made on this
  // device is pushed up; a fresh device never writes noise into the account.
  useAccountUiPref("market", country, setCountry, { defaultValue: ALL_COUNTRIES });

  // Currency — `chosen` is null when the user hasn't picked one (the currency then
  // follows the market). Only an explicit ISO choice is ever stored: null is not a
  // string, so it is neither back-filled nor saved.
  useAccountUiPref("currency", chosen, setCurrency, { defaultValue: null });

  // Theme — default is "dark", so only an explicit "light" gets back-filled.
  useAccountUiPref("theme", themeMode, setTheme, { defaultValue: "dark" });

  return null;
}
