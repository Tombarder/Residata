/* DateField — the platform's on-theme date input.
   Replaces the raw grey native <input type="date"> with a control that uses the
   app's CSS-var tokens (bg / border / text) and an accent focus ring, so it
   matches the sibling text inputs (the `sel` style it replaced) and the rest of
   the toolbar in BOTH light and dark themes. The native calendar popup + picker
   icon already follow the page `color-scheme` (set on :root / :root[data-theme=
   light] in index.css), so we only theme the box chrome — all of which lives in
   the `.date-field` class in index.css so `:focus` can override the border. */
export default function DateField({ value, onChange, title, width = 140, ariaLabel, style }) {
  return (
    <input
      type="date"
      className="date-field"
      value={value || ""}
      onChange={onChange}
      title={title}
      aria-label={ariaLabel || title}
      style={{ width, ...style }}
    />
  );
}
