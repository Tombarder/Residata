/* sectionMemory — where a sidebar entry takes you when its section has more than one page.
 *
 * Boss, 2026-09-28: "when i click 'projects' it doesn't remember the last page i was at".
 * Every other entry reopens its page as you left it (Analytics, Predaje, Databáza bytov
 * each remember their filters), but Projekty is TWO pages — the list and a project's
 * detail — and the sidebar always sent you to the list, so leaving a project to glance
 * at Analytics lost your place in it.
 *
 * So the Projects entry remembers the last page you were on inside its section:
 *   · from anywhere else, it reopens that page (the list, or the project you had open);
 *   · from inside the section, it goes to the list — the list stays one click away, the
 *     way a section's own entry behaves everywhere else;
 *   · and it is highlighted on a project's detail page, which it was not.
 */

export const PROJECTS_LIST = "App:Projects";
const DETAIL_PREFIX = "App:ProjectDetail:";

/** Is this page part of the Projects section (the list, or one project's detail)? */
export function inProjectsSection(page) {
  if (page === PROJECTS_LIST) return true;
  return typeof page === "string" && page.startsWith(DETAIL_PREFIX) && page.length > DETAIL_PREFIX.length;
}

/** Where a click on a sidebar entry should land. */
export function sidebarTarget(itemPage, currentPage, lastProjectsPage) {
  if (itemPage !== PROJECTS_LIST) return itemPage;
  if (inProjectsSection(currentPage)) return PROJECTS_LIST;
  return inProjectsSection(lastProjectsPage) ? lastProjectsPage : PROJECTS_LIST;
}

/** Whether a sidebar entry is the one the current page belongs to. */
export function sidebarActive(itemPage, currentPage) {
  if (itemPage === PROJECTS_LIST) return inProjectsSection(currentPage);
  return itemPage === currentPage;
}
