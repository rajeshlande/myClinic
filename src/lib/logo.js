/**
 * Browser-side logo intake: read → verify → re-encode → data URL.
 *
 * Re-encoding through a canvas is what makes this safe and small:
 *   · EXIF (including GPS from a phone photo of a signboard) is dropped, because
 *     the canvas only carries pixels.
 *   · Anything that is not pixels — script in an SVG, a polyglot file — never
 *     reaches the store, because we only ever write out what `toDataURL` returns.
 *   · A 3 MB phone photo becomes a ~40 KB PNG, so the clinic row and the offline
 *     snapshot stay small.
 *
 * SVG skips the canvas: rasterising a vector logo would throw away the detail
 * that made it worth uploading. It is validated as text instead.
 */
import {
  acceptLogo, dataUrlBytes, fitWithin, formatBytes, LOGO_TARGET_BYTES, maxEdgeFor,
  sniffImageMime, validateLogoFile,
} from './branding.mjs';

const readAsArrayBuffer = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result));
  reader.onerror = () => reject(new Error('Could not read that file.'));
  reader.readAsArrayBuffer(file);
});

const readAsText = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(new Error('Could not read that file.'));
  reader.readAsText(file);
});

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('That image could not be opened. Try re-saving it as PNG.'));
  img.src = url;
});

/**
 * Turn a picked File into `{ dataUrl, ...meta }` ready to store, or throw a
 * message a receptionist can act on.
 *
 * @param {File} file
 * @param {'square'|'wide'} kind
 */
export async function processLogoFile(file, kind = 'square') {
  if (!file) throw new Error('No file selected.');

  const pre = validateLogoFile({ name: file.name, type: file.type, size: file.size });
  if (!pre.ok) throw new Error(pre.error);

  const bytes = await readAsArrayBuffer(file);
  const mime = sniffImageMime(bytes);
  const isSvg = pre.isSvg && !mime;

  // SVG is text, not bytes we can sniff with a magic number.
  if (isSvg) {
    const text = await readAsText(file);
    const verdict = acceptLogo({ mime: 'image/svg+xml', size: file.size, svgText: text });
    if (!verdict.ok) throw new Error(verdict.error);
    // Re-assert the viewBox-only contract: an SVG with external refs was already
    // rejected; percent-encode so a stray quote cannot break the data URL.
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    return {
      dataUrl, mime: 'image/svg+xml', mode: 'vector', scaled: false,
      width: null, height: null, bytes: dataUrlBytes(dataUrl),
      label: file.name,
    };
  }

  const verdict = acceptLogo({ mime, size: file.size });
  if (!verdict.ok) throw new Error(verdict.error);

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const box = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, maxEdgeFor(kind));

    const canvas = document.createElement('canvas');
    canvas.width = box.width;
    canvas.height = box.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the image.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, box.width, box.height);

    // PNG keeps hard edges (wordmarks, thin rules) crisp; JPEG is used only when
    // the PNG would be too heavy to keep the clinic row small.
    let dataUrl = canvas.toDataURL('image/png');
    let outMime = 'image/png';
    if (dataUrlBytes(dataUrl) > LOGO_TARGET_BYTES) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      outMime = 'image/jpeg';
    }
    // White behind a transparent logo, which is what a printed letterhead needs
    // if the tenant forces a dark background onto a JPEG.
    if (dataUrlBytes(dataUrl) > LOGO_TARGET_BYTES) {
      dataUrl = canvas.toDataURL('image/webp', 0.84);
      outMime = 'image/webp';
    }

    return {
      dataUrl,
      mime: outMime,
      mode: 'raster',
      scaled: box.scaled,
      sourceWidth: img.naturalWidth,
      sourceHeight: img.naturalHeight,
      width: box.width,
      height: box.height,
      bytes: dataUrlBytes(dataUrl),
      label: file.name,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * One-line description shown under a stored logo: "512 × 512 PNG · 38 KB".
 * Vector logos have no pixel size, so they report as such.
 */
export function describeLogo(meta = {}) {
  if (meta.mode === 'vector' || /svg/.test(meta.mime ?? '')) {
    return meta.label ? `SVG · ${meta.label}` : 'SVG vector';
  }
  const size = meta.width && meta.height ? `${meta.width} × ${meta.height}` : null;
  const type = (meta.mime ?? '').split('/')[1]?.toUpperCase() ?? '';
  const weight = meta.bytes ? formatBytes(meta.bytes) : null;
  return [size, type, weight].filter(Boolean).join(' · ');
}
