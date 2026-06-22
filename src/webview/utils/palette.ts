/**
 * Single source of truth for the dashboard's visual identity.
 *
 * Brand accents are deliberately theme-agnostic (legible on both light and dark
 * VS Code themes). Structural colors (grid lines, ticks, tooltips, surfaces) are
 * derived from VS Code theme variables at runtime via {@link cssVar} so the UI
 * adapts to the active color theme instead of assuming a dark background.
 */

/** Semantic brand palette. Use these instead of scattering raw hex values. */
export const PALETTE = {
  accent: "#4fc3f7", // primary / cyan
  success: "#81c784", // good / under budget
  warning: "#ffb74d", // caution / approaching limits
  danger: "#e57373", // bad / over budget
  purple: "#ba68c8", // secondary accent (workspaces, activity)
} as const;

/** Ordered colors for multi-series charts and breakdown bars. */
export const SERIES_COLORS: string[] = [
  PALETTE.accent,
  PALETTE.success,
  PALETTE.warning,
  PALETTE.purple,
  PALETTE.danger,
];

/**
 * Extended categorical palette (8 colors) for pie/bar charts that may render
 * many slices at once. Starts with the brand colors, then adds distinct hues.
 */
export const CHART_COLORS: string[] = [
  PALETTE.accent,
  PALETTE.success,
  PALETTE.warning,
  PALETTE.danger,
  PALETTE.purple,
  "#4db6ac", // teal
  "#fff176", // yellow
  "#90a4ae", // blue-grey
];

/**
 * Read a VS Code theme CSS custom property from the document root.
 * Falls back to <body> (older webview hosts) and finally to the supplied default.
 */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") {
    return fallback;
  }
  const root = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (root) {
    return root;
  }
  const body = getComputedStyle(document.body).getPropertyValue(name).trim();
  return body || fallback;
}

/** Convert a #rrggbb hex color to an rgba() string with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    return hex;
  }
  const r = Number.parseInt(match[1], 16);
  const g = Number.parseInt(match[2], 16);
  const b = Number.parseInt(match[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Pick a status color (success / warning / danger) for a 0–100 score where
 * higher is better. Shared by the efficiency grade, budget bars, and alerts.
 */
export function scoreColor(score: number): string {
  if (score >= 70) {
    return PALETTE.success;
  }
  if (score >= 40) {
    return PALETTE.warning;
  }
  return PALETTE.danger;
}
