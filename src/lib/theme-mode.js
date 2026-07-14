// theme-mode.js — light / dark theme preference, persisted + applied to <html>.
// A single data-attribute (<html data-theme="light">) flips every CSS-variable
// neutral in index.css; brand/status colours are theme-invariant. Default = dark
// (the platform's original look); light is the opt-in alternative.
import { useSyncExternalStore } from "react";

const KEY = "residata.theme";
const listeners = new Set();

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(mode) {
  const m = mode === "light" ? "light" : "dark";
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", m);
  }
}

export function setTheme(mode) {
  const m = mode === "light" ? "light" : "dark";
  try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  applyTheme(m);
  listeners.forEach((fn) => fn());
}

export function toggleTheme() {
  setTheme(getTheme() === "light" ? "dark" : "light");
}

// Apply the stored theme as early as possible (also done inline in index.html to
// avoid a flash; this is the idempotent React-side backstop).
export function initTheme() {
  applyTheme(getTheme());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Hook: returns the current mode and re-renders subscribers on change.
export function useThemeMode() {
  const mode = useSyncExternalStore(subscribe, getTheme, () => "dark");
  return [mode, toggleTheme];
}
