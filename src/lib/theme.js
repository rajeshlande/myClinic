/**
 * Theme system.
 *
 * Every accent colour ships with a hand-tuned light and dark palette. The CSS
 * variables in styles.css are derived from these tokens, so switching a clinic's
 * colour changes buttons, charts, focus rings and badges consistently — and the
 * dark palette is not just an inverted light one (contrast on dark backgrounds
 * needs lighter, less saturated accents).
 */

export const THEME_KEY = 'myclinic.theme';
export const ACCENT_KEY = 'myclinic.accent';

/** Accent choices: each has a light and a dark palette. */
export const ACCENTS = [
  {
    id: 'teal', label: 'Clinic teal',
    light: { 50: '#eefbf7', 100: '#d5f5ec', 200: '#aeead9', 300: '#79d8c1', 400: '#43bfa3', 500: '#0f766e', 600: '#0b605a', 700: '#0a4d49', 800: '#093e3b', 900: '#07332f' },
    dark: { 50: '#0a2422', 100: '#0d2f2c', 200: '#12413c', 300: '#17564f', 400: '#1d8a7d', 500: '#2dd4bf', 600: '#5eead4', 700: '#99f6e4', 800: '#ccfbf1', 900: '#f0fdfa' },
  },
  {
    id: 'indigo', label: 'Indigo',
    light: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#4f46e5', 600: '#4338ca', 700: '#3730a3', 800: '#312e81', 900: '#272663' },
    dark: { 50: '#1b1b3a', 100: '#232355', 200: '#2e2e70', 300: '#3f3d94', 400: '#5b57c4', 500: '#818cf8', 600: '#a5b4fc', 700: '#c7d2fe', 800: '#e0e7ff', 900: '#eef2ff' },
  },
  {
    id: 'violet', label: 'Violet',
    light: { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#7c3aed', 600: '#6d28d9', 700: '#5b21b6', 800: '#4c1d95', 900: '#3f1a7a' },
    dark: { 50: '#221636', 100: '#2e1c48', 200: '#3d2460', 300: '#543080', 400: '#7048b0', 500: '#a78bfa', 600: '#c4b5fd', 700: '#ddd6fe', 800: '#ede9fe', 900: '#f5f3ff' },
  },
  {
    id: 'rose', label: 'Rose',
    light: { 50: '#fff1f4', 100: '#ffe4e9', 200: '#fecdd6', 300: '#fda4b3', 400: '#fb7189', 500: '#e11d48', 600: '#be123c', 700: '#9f1239', 800: '#881337', 900: '#701029' },
    dark: { 50: '#33101c', 100: '#431324', 200: '#5c1a30', 300: '#7c2340', 400: '#b32d56', 500: '#fb7189', 600: '#fda4b3', 700: '#fecdd6', 800: '#ffe4e9', 900: '#fff1f4' },
  },
  {
    id: 'amber', label: 'Amber',
    light: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#b45309', 600: '#92400e', 700: '#78350f', 800: '#63300d', 900: '#4d2609' },
    dark: { 50: '#2c2109', 100: '#3d2d0c', 200: '#563e10', 300: '#7a5614', 400: '#b98520', 500: '#fbbf24', 600: '#fcd34d', 700: '#fde68a', 800: '#fef3c7', 900: '#fffbeb' },
  },
  {
    id: 'blue', label: 'Ocean blue',
    light: { 50: '#eff8ff', 100: '#dbeefe', 200: '#bfdffd', 300: '#93c9fb', 400: '#60aaf7', 500: '#0b6bcb', 600: '#0957a8', 700: '#0a4787', 800: '#0b3b6e', 900: '#0a325c' },
    dark: { 50: '#0a2233', 100: '#0d2c42', 200: '#123a56', 300: '#184d70', 400: '#1f6a9a', 500: '#60aaf7', 600: '#93c9fb', 700: '#bfdffd', 800: '#dbeefe', 900: '#eff8ff' },
  },
  {
    id: 'forest', label: 'Forest',
    light: { 50: '#f2fbf3', 100: '#e0f6e3', 200: '#c0ecc7', 300: '#93dba1', 400: '#5ec177', 500: '#2f855a', 600: '#276a49', 700: '#21543b', 800: '#1d4431', 900: '#173729' },
    dark: { 50: '#0d2117', 100: '#112b1e', 200: '#163a28', 300: '#1d4d34', 400: '#276a49', 500: '#5ec177', 600: '#93dba1', 700: '#c0ecc7', 800: '#e0f6e3', 900: '#f2fbf3' },
  },
];

export function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
  } catch { return 'system'; }
}

export function readAccent() {
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.some((a) => a.id === stored) ? stored : 'teal';
  } catch { return 'teal'; }
}

export function resolveTheme(pref) {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Write one palette's 50→900 ramp onto the document. */
export function applyAccent(accentId, resolvedTheme) {
  const accent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  const ramp = resolvedTheme === 'dark' ? accent.dark : accent.light;
  const root = document.documentElement;
  for (const [step, hex] of Object.entries(ramp)) root.style.setProperty(`--brand-${step}`, hex);
  root.dataset.accent = accent.id;
  return accent;
}

export function applyTheme(pref, accentId = readAccent()) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  applyAccent(accentId, resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  const accent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  if (meta) meta.setAttribute('content', resolved === 'dark' ? accent.dark[50] : accent.light[500]);
  return resolved;
}

export function saveTheme(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* private mode */ }
  return applyTheme(pref);
}

export function saveAccent(accentId) {
  try { localStorage.setItem(ACCENT_KEY, accentId); } catch { /* private mode */ }
  return applyTheme(readTheme(), accentId);
}

export function applyDensity(density) {
  document.body.dataset.density = density === 'compact' ? 'compact' : '';
}

export function watchSystemTheme(cb) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => cb();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
