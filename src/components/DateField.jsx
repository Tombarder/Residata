/* DateField — the platform's date input.
   Chrome comes from the shared `.rd-field` class (styles/ui.css §3), which also
   themes native number/text inputs — so a date box, a min/max box and a Picker
   in the same toolbar row are the same height, radius and colour in both themes.
   The native calendar popup + picker icon follow the page `color-scheme` (set on
   :root / :root[data-theme="light"] in index.css), so only the box needs styling. */
export default function DateField({ value, onChange, title, width = 140, ariaLabel, small = false, style }) {
  const cls = ["rd-field", small ? "rd-field--sm" : null, value ? null : "rd-field--unset"].filter(Boolean).join(" ");
  return (
    <input
      type="date"
      className={cls}
      value={value || ""}
      onChange={onChange}
      title={title}
      aria-label={ariaLabel || title}
      style={{ width, ...style }}
    />
  );
}
