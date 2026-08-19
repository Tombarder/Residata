/**
 * Generates public/basemap-dark.json — the platform's dark basemap.
 *
 * WHY A FILE AND NOT A URL: Boss ran on CARTO "dark-matter" for months and liked
 * it — a quiet NEUTRAL dark grey map. On 2026-08-19 CARTO's free tiles stopped
 * carrying a map (borders and water only: 164 rendered features against 1536 from
 * a healthy source), so it had to be replaced. VersaTiles "eclipse" has the data
 * but a WARM brown palette, which Boss did not want.
 *
 * So we take eclipse's layers and pull every colour toward grey, which lands on
 * dark-matter's character. Doing it at BUILD time rather than in the browser means
 * no runtime fetch, no re-colour flash, no extra failure mode — and the basemap
 * cannot change under us again without someone re-running this.
 *
 *   node scripts/build-dark-basemap.mjs        # refresh from upstream
 *
 * Tiles, sprites and glyphs still come from VersaTiles at runtime; only the
 * styling is ours. Our own layers (pins, clusters, heat) are added after the style
 * loads and keep their full brand colour.
 */
import { writeFileSync } from "node:fs";

const SOURCE = "https://tiles.versatiles.org/assets/styles/eclipse/style.json";
const SATURATION_KEPT = 0.22;   // 0 = pure grey, 1 = untouched

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

function parseColour(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = /^#([0-9a-fA-F]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    const ex = (i) => parseInt(h.length <= 4 ? h[i].repeat(2) : h.slice(i * 2, i * 2 + 2), 16);
    const a = h.length === 4 ? ex(3) / 255 : h.length === 8 ? ex(3) / 255 : 1;
    return { r: ex(0), g: ex(1), b: ex(2), a };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  m = /^hsla?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[,/\s]+/).filter(Boolean);
    const h = parseFloat(p[0]), sat = parseFloat(p[1]) / 100, l = parseFloat(p[2]) / 100;
    const a = p.length > 3 ? parseFloat(p[3]) : 1;
    if ([h, sat, l].some(Number.isNaN)) return null;
    const c = hslToRgb(h, sat, l);
    return { ...c, a };
  }
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) { const v = clamp255(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: clamp255(hue(h + 1 / 3) * 255), g: clamp255(hue(h) * 255), b: clamp255(hue(h - 1 / 3) * 255) };
}

let touched = 0;
function neutralise(v) {
  const c = parseColour(v);
  if (!c) return v;
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  const { r, g, b } = hslToRgb(h, s * SATURATION_KEPT, l);
  touched++;
  return c.a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${c.a})`;
}

const walk = (value) =>
  typeof value === "string" ? neutralise(value)
  : Array.isArray(value) ? value.map(walk)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
  : value;

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} -> HTTP ${res.status}`);
const style = await res.json();

const out = {
  ...style,
  name: "Residata dark",
  metadata: { ...(style.metadata || {}), "residata:generated-from": SOURCE, "residata:saturation-kept": SATURATION_KEPT },
  layers: (style.layers || []).map((l) => (l.paint ? { ...l, paint: walk(l.paint) } : l)),
};

writeFileSync(new URL("../public/basemap-dark.json", import.meta.url), JSON.stringify(out));
const bg = out.layers.find((l) => l.type === "background");
console.log(`wrote public/basemap-dark.json — ${out.layers.length} layers, ${touched} colours neutralised`);
console.log(`background: ${JSON.stringify(bg?.paint)}`);
