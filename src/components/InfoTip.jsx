import HoverCard from "./HoverCard";

/* InfoTip — the small "i" icon that reveals a styled explanation.
 *
 * It is now nothing but a trigger: the popover behaviour (portal, viewport
 * clamping, flip-above, hover / keyboard focus / tap-to-pin, Escape and
 * outside-pointer dismissal) lives in components/HoverCard.jsx, which the
 * project-specifics marks use as well. One popover in the app means a fix to
 * any of that reaches every explanation at once. */
export default function InfoTip({ text, label }) {
  return (
    <HoverCard
      label={label ? `${label} — info` : "info"}
      maxWidth={280}
      trigger={(p) => (
        <span
          {...p}
          style={{
            display: "grid", placeItems: "center", width: 17, height: 17,
            borderRadius: "50%", border: "1px solid var(--border)",
            background: "transparent", color: "var(--text-faint)",
            cursor: "pointer", lineHeight: 0, outlineOffset: 2,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
      )}
    >
      {text}
    </HoverCard>
  );
}
