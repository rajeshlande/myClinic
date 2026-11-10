/**
 * Browser-only helpers for the token slip: SVG → PNG, OS file sharing and paper.
 *
 * Everything in `token-slip.mjs` is pure; everything here needs `document`,
 * `Image`, `canvas` or `navigator`. Nothing runs at import time, so an SSR smoke
 * can import this module without a DOM. Callers must catch: a browser can refuse
 * a canvas, a download or a share sheet, and the desk needs a readable message
 * rather than an unhandled rejection.
 *
 * Why a PNG at all: a `wa.me` link can carry text but **not** an image. The only
 * browser route that hands an image and a message to WhatsApp together is the
 * Web Share API (`navigator.share({ files, text })`), which needs a real File.
 * Where that is unavailable we download the PNG and keep the text-only link.
 */

import { tokenSlipSvg, tokenSlipFilename, SLIP_WIDTH, SLIP_HEIGHT } from './token-slip.mjs';

export const SLIP_PNG_SCALE = 3;

export function slipSvgBlob(model) {
  return new Blob([tokenSlipSvg(model)], { type: 'image/svg+xml;charset=utf-8' });
}

/** Draw the very same SVG onto a canvas at 3× so the image is sharp in a chat. */
export async function slipPngBlob(model) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('This browser cannot draw the slip image.');
  }
  const scale = SLIP_PNG_SCALE;
  const url = URL.createObjectURL(slipSvgBlob(model));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The slip image could not be rendered.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = SLIP_WIDTH * scale;
    canvas.height = SLIP_HEIGHT * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw the slip image.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The slip image could not be saved as a PNG.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function slipPngFile(model) {
  if (typeof File === 'undefined') throw new Error('This browser cannot attach files.');
  const blob = await slipPngBlob(model);
  return new File([blob], tokenSlipFilename(model), { type: 'image/png' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same tick can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadSlip(model) {
  const blob = await slipPngBlob(model);
  downloadBlob(blob, tokenSlipFilename(model));
  return tokenSlipFilename(model);
}

/** Whether this device can hand a file to an app (WhatsApp) through the OS. */
export function canShareFiles(file = null) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  const candidate = file ?? (typeof File === 'undefined' ? null : new File([''], 'slip.png', { type: 'image/png' }));
  if (!candidate) return false;
  return typeof navigator.canShare !== 'function' || navigator.canShare({ files: [candidate] });
}

/** One OS share sheet: the PNG *and* the exact message text travel together. */
export async function shareSlip({ file, text = '', title = 'Token slip' }) {
  if (!canShareFiles(file)) throw new Error('This browser cannot share files.');
  await navigator.share({ files: [file], text, title });
}

/**
 * Print only the slip. `#root` is hidden by the print CSS while this attribute
 * is on; the slip lives in a portal outside `#root`. The `@page` rule has to be
 * injected here because `@page` is global and cannot be scoped by a body class —
 * injecting and removing it keeps every other screen's paper size untouched.
 */
export function printTokenSlip() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'token-slip-page-size';
  style.textContent = '@page { size: 80mm 170mm; margin: 3mm; }';
  document.head.appendChild(style);
  document.body.dataset.tokenPrint = 'true';
  let timer = 0;
  const cleanup = () => {
    delete document.body.dataset.tokenPrint;
    style.remove();
    window.removeEventListener('afterprint', cleanup);
    clearTimeout(timer);
  };
  window.addEventListener('afterprint', cleanup);
  // Some browsers never fire afterprint (and headless ones never open a dialog).
  // 30 seconds is long enough for a real print dialog, short enough not to leak.
  timer = setTimeout(cleanup, 30000);
  window.print();
}
