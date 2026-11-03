/**
 * Clinic branding — the logo a clinic puts on its paperwork.
 *
 * Two shapes, because printed documents and messaging need different crops:
 *
 *   square  — 1:1. Letterhead corner, favicon, WhatsApp Business profile picture,
 *             social avatar. Also the fallback when only one file is uploaded.
 *   wide    — up to 4:1. Document header / letterhead strip, email signature,
 *             invoice top-left. Reads the clinic name without shrinking it.
 *
 * Stored on the clinic row as data URLs (`logo_square_url`, `logo_wide_url`) so a
 * logo travels with the clinic in the same offline snapshot as everything else:
 * no Storage bucket, no CORS, no extra fetch that can fail on clinic wifi.
 * Uploads are re-encoded down to a bounded size before they are stored.
 *
 * Nothing here touches the DOM at import time — the pure validators are unit
 * tested, the canvas helpers are only called from the browser.
 */

/** Kinds in display order. `label`/`hint` drive the uploader UI. */
export const LOGO_KINDS = [
  {
    id: 'square',
    label: 'Square logo',
    column: 'logo_square_url',
    ratio: '1:1',
    maxEdge: 512,
    hint: 'Letterhead corner, app icon, WhatsApp Business profile photo.',
  },
  {
    id: 'wide',
    label: 'Wide logo',
    column: 'logo_wide_url',
    ratio: 'up to 4:1',
    maxEdge: 1024,
    hint: 'Document header strip, email signature, invoice top row.',
  },
];

/** 2 MB in, before re-encoding. Generous enough for a phone photo of a signboard. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Re-encoded output ceilings — keeps the row (and the offline snapshot) small. */
export const LOGO_TARGET_BYTES = 220 * 1024;

/** SVG is kept as text, so it gets its own, much tighter, limit. */
export const LOGO_SVG_MAX_BYTES = 48 * 1024;

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

const KIND_BY_ID = new Map(LOGO_KINDS.map((k) => [k.id, k]));

export function logoKind(id) {
  return KIND_BY_ID.get(id) ?? LOGO_KINDS[0];
}

/** Bytes → "412 KB", for the "this will be stored as…" line. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Identify an image from its magic bytes rather than trusting the file name or
 * the browser-reported MIME type, both of which the user controls.
 * Returns a MIME type, or null when the bytes are not an image we accept.
 */
export function sniffImageMime(bytes) {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length < 4) return null;
  const b = (i) => bytes[i];
  // PNG · 89 50 4E 47 0D 0A 1A 0A
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  // JPEG · FF D8 FF
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  // WEBP · "RIFF" .... "WEBP"
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46
    && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
  // GIF is accepted by browsers but is a poor logo; leave it out on purpose.
  return null;
}

const SVG_START = /^\s*(?:<\?xml[\s\S]{0,200}?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(<svg[\s>])/i;

/**
 * SVG can carry script, event handlers and remote references. A logo is rendered
 * inside documents that get printed and emailed, so anything active is rejected
 * outright rather than sanitised — a legitimate logo never needs it.
 */
export function isSvgSafe(text) {
  if (typeof text !== 'string') return false;
  if (!SVG_START.test(text)) return false;
  const forbidden = [
    /<script[\s>]/i,
    /<foreignObject[\s>]/i,
    /<iframe[\s>]/i,
    /<embed[\s>]/i,
    /<object[\s>]/i,
    /<!ENTITY/i,
    /<!DOCTYPE[^>]*\[/i,          // internal DTD subset = entity expansion tricks
    /\son[a-z]+\s*=/i,            // onclick=, onload=, …
    /javascript:/i,
    /data:text\/html/i,
    /xlink:href\s*=\s*["']\s*(?!#)/i,
    /href\s*=\s*["']\s*(?!#)(?:https?:)?\/\//i,
    /@import/i,
  ];
  return !forbidden.some((re) => re.test(text));
}

/**
 * Cheap pre-flight check on a picked file, before reading it into memory.
 * `type` is advisory only; the real decision is made from the bytes.
 */
export function validateLogoFile({ name = '', type = '', size = 0 } = {}) {
  const kb = formatBytes(LOGO_MAX_BYTES);
  if (!size) return { ok: false, error: 'That file is empty. Pick another one.' };
  if (size > LOGO_MAX_BYTES) {
    return { ok: false, error: `That file is ${formatBytes(size)}. Keep the logo under ${kb} — scale it down and try again.` };
  }
  const isSvg = type === 'image/svg+xml' || /\.svg$/i.test(name);
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  if (type && !allowed.includes(type) && !isSvg) {
    return { ok: false, error: 'Use a PNG, JPEG, WebP or SVG file.' };
  }
  return { ok: true, error: null, isSvg };
}

/**
 * Decide what a read file actually is and whether we will store it.
 * Pure: takes the sniffed MIME + size + (for SVG) the decoded text.
 */
export function acceptLogo({ mime = null, size = 0, svgText = null } = {}) {
  if (mime === 'image/svg+xml') {
    if (!svgText) return { ok: false, error: 'That SVG could not be read.' };
    if (size > LOGO_SVG_MAX_BYTES) {
      return { ok: false, error: `That SVG is ${formatBytes(size)}. Keep vector logos under ${formatBytes(LOGO_SVG_MAX_BYTES)}.` };
    }
    if (!isSvgSafe(svgText)) {
      return { ok: false, error: 'That SVG contains script or external links. Export it from your design tool again, or upload a PNG.' };
    }
    return { ok: true, error: null, mode: 'vector' };
  }
  if (['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
    return { ok: true, error: null, mode: 'raster' };
  }
  return { ok: false, error: 'That does not look like a PNG, JPEG, WebP or SVG image.' };
}

/** Data URL for a stored logo of a given kind, or null when it has none. */
export function logoFor(clinic, kind = 'square') {
  if (!clinic) return null;
  const value = clinic[logoKind(kind).column];
  return typeof value === 'string' && value.startsWith('data:image/') ? value : null;
}

/**
 * Square logo if the clinic has one, otherwise the wide one cropped by CSS.
 * Documents use this so a clinic that uploaded only a wide banner still shows
 * something in the header.
 */
export function anyLogo(clinic) {
  return logoFor(clinic, 'square') ?? logoFor(clinic, 'wide') ?? null;
}

/** Does this clinic want the logo on printed documents? Defaults to yes. */
export function logoOnDocuments(clinic) {
  return clinic?.logo_on_documents !== false;
}

/** Up to two initials, used when no logo is uploaded. */
export function clinicInitials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'C';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Everything a channel needs to render this clinic's identity.
 * Documents read this today; an email template or a WhatsApp Business profile
 * setup screen reads exactly the same object, so nothing has to be re-plumbed.
 */
export function brandKit(clinic) {
  const name = clinic?.name ?? 'Clinic';
  return {
    name,
    initials: clinicInitials(name),
    color: clinic?.brand_color || '#0f766e',
    square: logoFor(clinic, 'square'),
    wide: logoFor(clinic, 'wide'),
    // The one to use where a single image is all a channel accepts (WhatsApp
    // Business profile, favicon, email avatar).
    primary: anyLogo(clinic),
    // What an email header or message bubble should say beside the logo.
    label: name,
    address: clinic?.address ?? '',
    phone: clinic?.phone ?? '',
    email: clinic?.email ?? '',
    gstin: clinic?.gstin ?? '',
    onDocuments: logoOnDocuments(clinic),
  };
}

/**
 * Longest edge allowed for a kind, so the canvas step has one source of truth.
 */
export function maxEdgeFor(kind) {
  return logoKind(kind).maxEdge;
}

/**
 * Fit a source image inside the allowed box without cropping, never upscaling.
 * Pure arithmetic — the caller does the drawing.
 */
export function fitWithin(width, height, maxEdge) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h, scaled: false };
  const ratio = maxEdge / longest;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)), scaled: true };
}

/** Rough stored size of a data URL, once base64 expansion is added. */
export function dataUrlBytes(dataUrl) {
  const body = String(dataUrl ?? '').split(',')[1] ?? '';
  // base64 carries 3 bytes per 4 characters; ignore padding.
  const padding = (body.match(/=+$/) ?? [''])[0].length;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}
