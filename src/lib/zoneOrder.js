/**
 * zoneOrder — the ordering arithmetic behind dragging a pivot field into place.
 *
 * WHY IT IS ITS OWN FILE
 * ----------------------
 * Re-ordering a list by dragging has exactly one hard part, and it is not the
 * drag: it is that the drop index the pointer reports is measured against the
 * list AS IT LOOKS, i.e. with the dragged chip still in it. Remove the chip
 * first and every index to its right is now off by one. Getting that wrong is
 * the classic "drags one slot short when moving right" bug, and it is invisible
 * until you drag right rather than left. So the arithmetic lives here, alone,
 * with tests — the component just says "this field, this slot".
 *
 * The pivot's four zones hold two shapes: Rows/Cols are arrays of field-key
 * strings, Values/Filters are arrays of objects keyed by `.key`. `keyOf` is the
 * only difference, so both go through the same two functions.
 */

/** Insert `item` at `atIndex`; out-of-range (or null) appends. Never mutates. */
export function insertAt(list, item, atIndex) {
  const i = atIndex == null || atIndex < 0 || atIndex > list.length ? list.length : atIndex;
  return [...list.slice(0, i), item, ...list.slice(i)];
}

/**
 * Move the entry identified by `key` to `toIndex`, where `toIndex` is a slot in
 * the list AS DISPLAYED (the dragged entry still counted). Returns the same
 * array reference when nothing actually moves, so React can skip the re-render.
 */
export function moveToIndex(list, keyOf, key, toIndex) {
  const from = list.findIndex((x) => keyOf(x) === key);
  if (from < 0) return list;
  // Dropping just before or just after itself is a no-op, not a 1-slot shuffle.
  if (toIndex === from || toIndex === from + 1) return list;
  const without = [...list.slice(0, from), ...list.slice(from + 1)];
  // Every slot to the right of the removed entry has shifted left by one.
  const to = Math.max(0, Math.min(without.length, toIndex > from ? toIndex - 1 : toIndex));
  return [...without.slice(0, to), list[from], ...without.slice(to)];
}

/** Field-key accessors for the two zone shapes. */
export const keyOfString = (x) => x;
export const keyOfObject = (x) => x.key;

/**
 * Which slot is the pointer asking for? Works with wrapped rows (the chips wrap
 * onto several lines once a zone fills up), which is why the row distance
 * dominates the column distance instead of a plain nearest-centre.
 *
 * `rects` are the chips' bounding boxes in DOM order.
 * Returns an index in 0..rects.length.
 */
export function dropIndexFor(rects, x, y) {
  if (!rects.length) return 0;
  let bestIdx = rects.length;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // A chip on the pointer's own line always beats a nearer-looking chip one
    // line up or down: weight the vertical gap far above the horizontal one.
    const dist = Math.abs(y - cy) * 10000 + Math.abs(x - cx);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = x > cx ? i + 1 : i;
    }
  });
  return bestIdx;
}
