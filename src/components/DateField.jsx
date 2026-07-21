/* DateField — the platform's on-theme date input.
   Replaces the raw grey native <input type="date"> with a control that uses the
   app's CSS-var tokens (surface / border / text) and an accent focus ring, so it
   matches Picker and the rest of the toolbar in BOTH light and dark themes. The
   native calendar popup + picker icon already follow the page `color-scheme`
   (set on :root / :root[data-theme=light] in index.css), so we only theme the box
   chrome here. Behaviour is identical to a native date input. */
export default function DateField({ value, onChange, title, width = 140, ariaLabel, style }) {
  return (
    <input
      type="date"
      className="date-field"
      value={value || ""}
      onChange={onChange}
      title={title}
      aria-label={ariaLabel || title}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        color: "var(--text)",
        borderRadius: 6,
        padding: "0.4rem 0.55rem",
        fontSize: "0.78rem",
        fontFamily: "inherit",
        outline: "none",
        width,
        boxSizing: "border-box",
        ...style,
      }}
    />
  );
}
