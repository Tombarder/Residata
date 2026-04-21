import { useCapabilities } from "../lib/useCapabilities";

/**
 * Deklaratívny wrapper pre capability-based rendering.
 *
 * Základné použitie:
 *   <Feature requires="view_analytics">
 *     <AnalyticsPanel />
 *   </Feature>
 *
 * S fallbackom (napr. upgrade CTA):
 *   <Feature requires="export_data" fallback={<UpgradePrompt feature="export" />}>
 *     <ExportButton />
 *   </Feature>
 *
 * Kombinácia viacerých — ALL:
 *   <Feature requiresAll={["view_analytics", "view_historical_data"]}>
 *     <HistoryChart />
 *   </Feature>
 *
 * Kombinácia viacerých — ANY:
 *   <Feature requiresAny={["view_chosen_project_detail", "view_any_project_detail"]}>
 *     <ProjectDetail />
 *   </Feature>
 *
 * Inverted — zobraz iba ak NEMÁ capability:
 *   <Feature missing="prompt_signup" /> — nič (len negácia nebýva sama, používaj fallback)
 *   <Feature missing="view_analytics" fallback={<UpgradePrompt />}> (len keď nemá)
 */
export default function Feature({ requires, requiresAll, requiresAny, missing, fallback = null, children }) {
  const { can } = useCapabilities();

  let allow = true;
  if (requires) allow = allow && can(requires);
  if (requiresAll?.length) allow = allow && requiresAll.every(c => can(c));
  if (requiresAny?.length) allow = allow && requiresAny.some(c => can(c));
  if (missing) allow = allow && !can(missing);

  return allow ? children : fallback;
}
