# Platform audit — 2026-06-10

Full screen-by-screen audit of the paid platform (`/app`) on production
(`residata-gamma.vercel.app`), logged in as admin. Every screen reviewed;
every headline number cross-checked against the database. SK market scope.

## Fixed + verified live this session

| Commit | Fix | Why it mattered |
|--------|-----|-----------------|
| `4e90aeb` | **Auth deadlock + session-gate hardening** | `supabase-js` defaults to the Web Locks API (`navigator.locks`) to serialise token refresh. In incognito / some extensions / automation webviews that lock is never granted, so `auth.getSession()` hangs forever — and since every authed query awaits it, the **whole app stuck on "Loading…"**. Replaced with an in-memory auth lock (serialises within the tab, never touches `navigator.locks`). Also: 8 s loading-safety timeout (never an infinite spinner) + stop signing a valid user out on a transient profile-query error. |
| `d064bed` | **Reports no longer renders a zeroed-out report mid-load** | The loading guard checked only `projects.length === 0`. `projects` (~300 rows) resolves seconds before `flats` (~19 k current units, paginated), so for ~30 s Reports showed a *complete* report reading **"kapacitou 0 bytov · 0 voľných · 0 predaných"** — i.e. "Slovak market: 0 units" — as if final. Now the guard waits for `flats.length` too; users see the loader until real numbers exist. |

Both confirmed working on production (cold-reload test: loader shows, then
the correct full report — 148 projects · 19 261 units · 4 937 available ·
12 570 sold · 74 % · Ø 4 937 €/m²).

## Data correctness — verified against DB (anon REST counts)

- `public.projects`: **331 total** → SK **187** / CZ **144**. Active **280** → SK **148** / CZ **132**.
- Dashboard / Projects / Reports headline numbers all tie out and agree with each other.
- Reports price histogram sums to **4 603 priced units**; midpoint-weighted avg ≈ €4 915–4 937/m² — matches the displayed Ø 4 937. So **"AVG €/m² 4 937 = available count 4 937" is a genuine coincidence, NOT a bug** (re-verified independently).

## Outstanding — enhancements / decisions (NOT bugs)

1. **Perf / scalability (#1).** `Analytika` (PivotV2) and `Byt v čase`
   (UnitTracker) both fetch the **entire append-only `flats_archive`**
   client-side (`useFlatsArchive`) before they're usable — ~30–60 s today and
   it grows ~19 k rows every month. `Reports` uses `flats_current` (~19 k,
   bounded — fine). **Recommend** server-side aggregation (DB views / RPC) for
   the two archive-based screens, or at minimum lazy-load UnitTracker's
   per-unit history instead of the whole archive. This is the single most
   important scalability item before scaling the paid base.

2. **`sold_30d` / velocity / absorption is empty everywhere.** Every project
   shows `PREDANÉ 30D = —`; Dashboard "SOLD 30 DAYS" and absorption analytics
   are 0. Cause: month-over-month deltas need consecutive *real* monthly
   snapshots; today's history is backfilled. Populates naturally over the
   coming months. **The AI assistant honestly discloses this** ("sold_30d is
   empty or zero for all projects") instead of fabricating — good. But the
   velocity features are a selling point that currently shows nothing.

3. **AI assistant is NOT country-scoped.** In SK mode it returned Czech
   projects (Praha "Nový Rohan", Brno "Bytový dům Holásky") because it queries
   the global 280-active set. **Decision for Boss:** scope the AI to the active
   country, or label each project's country in answers. (Don't change blindly —
   "ask anything about the market" may be intended as cross-market.)

4. **AI arithmetic errors.** Saw "Drevný trh – 97,5 % (3 z 40 bytov)" (3/40 =
   7.5 %, not 97.5 %). Inherent to LLM arithmetic; mitigated by the disclaimer
   ("AI can make mistakes; Analytics & Reports are the source of truth").

5. **Export label "Projekty (187)".** = SK *all statuses* (incl. sold-out /
   paused) vs the platform's "148 active". Correct data, mildly confusing label.

## Screens reviewed (all render correctly)

Dashboard ✓ · Projekty ✓ · Analytika ✓ (slow) · Byt v čase ✓ (slow) ·
Reporty ✓ (fixed) · AI asistent ✓ · Exporty ✓ · Platba a tier ✓ ·
Nastavenia ✓ · Admin ✓ (4 users, telemetry).

Not deep-tested: Stripe/upgrade payment flow (admin bypasses it); the three
analytical Report sub-tabs (Predpoveď / Komparable / Cenový pomer — they
render and reuse already-loaded data, not value-verified row-by-row).
