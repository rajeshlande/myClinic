/**
 * The redesigned token slip, as data and as one self-contained SVG string.
 *
 * Until v1.35.3 "Print slip" called window.print() on a modal, and `.slip` was a
 * CSS rule no JSX element used. The on-screen preview, the printed sheet and the
 * image that goes with the WhatsApp message must not be three designs that drift:
 * they are all this one SVG. That is why the SVG is a *string* returned by a pure
 * function — it can be rendered by React, printed by the browser, rasterised to a
 * PNG through a canvas, asserted in a node test and server-rendered in a smoke,
 * without any of those four places owning a copy of the layout.
 *
 * Nothing here touches the DOM, the network, the clock or React. Dates, times,
 * money and the token label come from the existing domain helpers; every value
 * that a human typed is XML-escaped and clipped before it reaches the markup.
 */

import { formatDate, formatTime, tokenLabel } from './logic.mjs';
import { formatMoney } from './money.mjs';
import { brandKit } from './branding.mjs';

export const SLIP_WIDTH = 320;
export const SLIP_HEIGHT = 520;

const INK = '#101b18';
const MUTED = '#61736e';
const RULE = '#d8e3df';
const DEFAULT_ACCENT = '#0f766e';
const FONT = 'Arial, Helvetica, sans-serif';

/** Only a real hex colour reaches an SVG attribute: brand_color is clinic data. */
export function safeColor(value, fallback = DEFAULT_ACCENT) {
  const v = String(value ?? '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
}

/** A pale version of the brand colour for the queue strip — still pure. */
export function tint(hex, amount = 0.88) {
  const h = safeColor(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const ch = [0, 2, 4].map((i) => {
    const n = parseInt(full.slice(i, i + 2), 16);
    return Math.round(n + (255 - n) * amount).toString(16).padStart(2, '0');
  });
  return `#${ch.join('')}`;
}

/** One line, no surprises: collapse whitespace and refuse to overflow the box. */
export function clipText(value, max = 30) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** XML escaping, including quotes: a name like `A & B "Clinic"` is still a text node. */
export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function queueLine(ahead, etaMinutes) {
  if (typeof ahead !== 'number' || !Number.isFinite(ahead)) return 'Please wait for your number';
  if (ahead <= 0) return 'You are next — please wait here';
  const people = `${ahead} ${ahead === 1 ? 'patient is' : 'patients are'} ahead`;
  const wait = typeof etaMinutes === 'number' && etaMinutes > 0 ? ` · about ${etaMinutes} min` : '';
  return clipText(`${people}${wait}`, 40);
}

/**
 * The whole slip as plain data. `issuedOn` / `issuedAt` are passed in rather than
 * read from the clock, so the same input always produces the same SVG.
 */
export function tokenSlipModel({
  clinic = {}, doctor = {}, patient = {}, appointment = {},
  token = null, feePaise = null, ahead = null, etaMinutes = null,
  issuedOn = '', issuedAt = '', kind = '',
} = {}) {
  const brand = brandKit(clinic);
  const accent = safeColor(brand.color);
  const number = token ?? appointment?.token_no ?? null;
  const clinicLine = [brand.address, brand.phone].filter(Boolean).join(' · ');
  const on = appointment?.scheduled_on || issuedOn;
  const at = String(appointment?.scheduled_at || issuedAt || '').slice(0, 5);
  return {
    width: SLIP_WIDTH,
    height: SLIP_HEIGHT,
    accent,
    tint: tint(accent),
    initials: clipText(brand.initials, 3),
    clinicName: clipText(brand.name, 26),
    clinicLine: clinicLine ? clipText(clinicLine, 46) : 'Please show this slip at the desk',
    token: tokenLabel(number),
    dateISO: /^\d{4}-\d{2}-\d{2}$/.test(String(on)) ? String(on).slice(0, 10) : '',
    dateLabel: clipText(on ? formatDate(on, { withYear: false, weekday: true }) : '', 18),
    timeLabel: clipText(at ? formatTime(at) : '', 14),
    patientName: clipText(patient?.full_name, 26),
    patientCode: clipText(patient?.code, 16),
    doctorName: clipText(doctor?.full_name, 24),
    visitKind: clipText(kind || appointment?.kind || 'Consultation', 22),
    feeLabel: feePaise === null || feePaise === undefined ? '—' : clipText(formatMoney(feePaise), 14),
    queueLabel: queueLine(ahead, etaMinutes),
    footline1: 'Please wait in the lounge. Your number will be',
    footline2: 'called on the display or by name.',
    footer: 'Show this slip at the desk · Thank you for visiting',
  };
}

/** A sentence for screen readers and for the composer's slip preview. */
export function slipAlt(model) {
  return `Token slip for ${model?.patientName ?? 'the patient'}, ${model?.token ?? 'token'} at ${model?.clinicName ?? 'the clinic'} on ${model?.dateLabel ?? ''}.`;
}

/** A safe, readable filename for the PNG the desk attaches to WhatsApp. */
export function tokenSlipFilename(model) {
  const slug = String(model?.patientName ?? 'patient')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'patient';
  const token = String(model?.token ?? 'token').replace(/[^A-Za-z0-9-]+/g, '-');
  const day = String(model?.dateISO ?? '');
  return `Token-${token}-${slug}${day ? `-${day}` : ''}.png`.slice(0, 100);
}

/** A short line the message can carry when the slip image is attached. */
export function slipCaption(model) {
  return `Your token slip (${model?.token ?? 'token'}) is attached as an image — please show it at the desk.`;
}

/* ------------------------------------------------------------------- the SVG */

function txt(x, y, value, attrs = '') {
  return `<text x="${x}" y="${y}" ${attrs}>${xmlEscape(value)}</text>`;
}

function row(y, label, value) {
  return txt(20, y, label, `font-size="9" fill="${MUTED}" letter-spacing="0.8"`)
    + txt(300, y, value, `font-size="11.5" font-weight="600" fill="${INK}" text-anchor="end"`);
}

/**
 * The slip itself. Standalone: explicit width/height/viewBox, an xmlns, inline
 * fills and a system font stack, and no external image, font or stylesheet — the
 * SVG has to survive being loaded as a blob URL and drawn onto a canvas.
 */
/**
 * The same SVG as an image source. A percent-encoded data URI keeps React's
 * escaping intact (no raw HTML injection), and an <img> treats the SVG as an
 * image — scripts and external references inside it are never executed.
 */
export function tokenSlipDataUrl(model = {}) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tokenSlipSvg(model))}`;
}

export function tokenSlipSvg(model = {}) {
  const m = { ...tokenSlipModel(), ...model };
  const a = m.accent;
  const t = m.tint;
  const title = slipAlt(m);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}" viewBox="0 0 ${m.width} ${m.height}" role="img" aria-label="${xmlEscape(title)}">`,
    `<title>${xmlEscape(title)}</title>`,
    `<rect x="0" y="0" width="${m.width}" height="${m.height}" fill="#ffffff"/>`,
    `<g font-family="${FONT}">`,

    // --- clinic identity -----------------------------------------------------
    `<rect x="0" y="0" width="320" height="88" fill="${a}"/>`,
    `<rect x="20" y="20" width="48" height="48" rx="10" fill="#ffffff" fill-opacity="0.16"/>`,
    `<rect x="20" y="20" width="48" height="48" rx="10" fill="none" stroke="#ffffff" stroke-opacity="0.6"/>`,
    txt(44, 51, m.initials, 'text-anchor="middle" font-size="17" font-weight="700" fill="#ffffff"'),
    txt(80, 39, m.clinicName, 'font-size="16" font-weight="700" fill="#ffffff"'),
    txt(80, 57, m.clinicLine, 'font-size="9" fill="#ffffff" fill-opacity="0.88"'),
    txt(300, 39, 'TOKEN', `text-anchor="end" font-size="9" font-weight="700" letter-spacing="2" fill="#ffffff" fill-opacity="0.8"`),

    // --- the number ----------------------------------------------------------
    txt(20, 112, 'YOUR NUMBER', `font-size="9" font-weight="700" letter-spacing="1.8" fill="${MUTED}"`),
    txt(18, 176, m.token, `font-size="62" font-weight="800" letter-spacing="-2" fill="${INK}"`),
    txt(300, 118, m.dateLabel, `text-anchor="end" font-size="11" font-weight="700" fill="${INK}"`),
    txt(300, 136, m.timeLabel, `text-anchor="end" font-size="10" fill="${MUTED}"`),
    `<line x1="20" y1="190" x2="300" y2="190" stroke="${RULE}" stroke-width="1" stroke-dasharray="4 4"/>`,

    // --- where they are in the queue ----------------------------------------
    `<rect x="20" y="202" width="280" height="46" rx="10" fill="${t}"/>`,
    txt(32, 230, m.queueLabel, `font-size="12" font-weight="700" fill="${a}"`),

    // --- patient -------------------------------------------------------------
    txt(20, 274, 'PATIENT', `font-size="8.5" font-weight="700" letter-spacing="1.6" fill="${MUTED}"`),
    txt(20, 299, m.patientName, `font-size="19" font-weight="700" fill="${INK}"`),
    txt(20, 316, m.patientCode, `font-size="9.5" fill="${MUTED}"`),

    // --- details -------------------------------------------------------------
    row(344, 'DOCTOR', m.doctorName),
    row(374, 'VISIT', m.visitKind),
    row(404, 'FEE', m.feeLabel),
    `<line x1="20" y1="422" x2="300" y2="422" stroke="${RULE}" stroke-width="1" stroke-dasharray="4 4"/>`,

    // --- what to do ----------------------------------------------------------
    txt(20, 446, m.footline1, 'font-size="9.5" fill="#445a55"'),
    txt(20, 461, m.footline2, 'font-size="9.5" fill="#445a55"'),
    `<line x1="20" y1="482" x2="300" y2="482" stroke="${RULE}" stroke-width="1"/>`,
    txt(160, 502, m.footer, `text-anchor="middle" font-size="8.5" fill="${MUTED}"`),
    `<line x1="20" y1="512" x2="300" y2="512" stroke="${RULE}" stroke-width="1" stroke-dasharray="3 5"/>`,

    '</g></svg>',
  ].join('');
}
