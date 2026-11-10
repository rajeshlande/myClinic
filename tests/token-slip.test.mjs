import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SLIP_WIDTH, SLIP_HEIGHT, safeColor, tint, clipText, xmlEscape,
  tokenSlipModel, tokenSlipSvg, tokenSlipDataUrl, tokenSlipFilename, slipAlt, slipCaption,
} from '../src/lib/token-slip.mjs';
import { tokenMessage } from '../src/lib/messages.mjs';

/*
 * v1.35.3 — WhatsApp at token issue, a redesigned slip, and the slip as an image.
 *
 * "Print slip" used to call window.print() on a modal while `.slip` was a CSS
 * class no JSX element used. These tests hold the one-SVG contract (preview,
 * print and PNG all come from tokenSlipSvg), the escaping that makes rendering
 * that SVG as markup safe, and the wiring that puts a real send at issue time.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const code = (p) => readFileSync(join(root, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const base = {
  clinic: { name: 'Sunrise Clinic', phone: '022 1234 5678', address: 'Bandra West, Mumbai', brand_color: '#7c5cd6' },
  doctor: { full_name: 'Dr. Anita Rao' },
  patient: { full_name: 'Aarav Sharma', code: 'P-001', phone: '9820000001' },
  appointment: { id: 'a1', token_no: 14, scheduled_on: '2026-11-02', scheduled_at: '10:30', kind: 'New consultation' },
  feePaise: 50000, ahead: 3, etaMinutes: 45,
};
const model = () => tokenSlipModel(base);

test('only real hex colours reach an SVG attribute', () => {
  assert.equal(safeColor('#7c5cd6'), '#7c5cd6');
  assert.equal(safeColor('#abc'), '#abc');
  assert.equal(safeColor('red'), '#0f766e');
  assert.equal(safeColor('#0f766e" onload="alert(1)'), '#0f766e', 'an attribute injection is not a colour');
  assert.equal(safeColor('var(--brand-500)'), '#0f766e');
  assert.equal(tint('#000000'), '#e0e0e0');
  assert.equal(tint('#0f766e'), '#e2efee');
  assert.match(tint('#7c5cd6'), /^#[0-9a-f]{6}$/);
});

test('text is collapsed and clipped so a long name cannot overflow the slip', () => {
  assert.equal(clipText('  Aarav   Sharma ', 30), 'Aarav Sharma');
  assert.equal(clipText('', 30), '—');
  assert.equal(clipText('A'.repeat(80), 26).length, 26);
  assert.ok(clipText('A'.repeat(80), 26).endsWith('…'));
  assert.equal(xmlEscape(`A & B <clinic> "hi" 'bye'`), 'A &amp; B &lt;clinic&gt; &quot;hi&quot; &#39;bye&#39;');
});

test('the model reads the domain helpers, not the clock', () => {
  const m = model();
  assert.equal(m.token, 'T-14');
  assert.equal(m.clinicName, 'Sunrise Clinic');
  assert.equal(m.initials, 'SC');
  assert.equal(m.accent, '#7c5cd6');
  assert.equal(m.patientName, 'Aarav Sharma');
  assert.equal(m.doctorName, 'Dr. Anita Rao');
  assert.equal(m.visitKind, 'New consultation');
  assert.equal(m.feeLabel, '₹500');
  assert.equal(m.dateISO, '2026-11-02');
  assert.equal(m.timeLabel, '10:30 am');
  assert.equal(m.queueLabel, '3 patients are ahead · about 45 min');
  assert.equal(m.width, SLIP_WIDTH);
  assert.equal(m.height, SLIP_HEIGHT);
  const again = model();
  assert.deepEqual(m, again, 'same input, same slip, every time');
  assert.equal(tokenSlipModel({ ahead: 0 }).queueLabel, 'You are next — please wait here');
  assert.equal(tokenSlipModel({}).queueLabel, 'Please wait for your number');
  assert.equal(tokenSlipModel({ feePaise: null }).feeLabel, '—');
});

test('the SVG is standalone: no external font, image, stylesheet or script', () => {
  const svg = tokenSlipSvg(model());
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, new RegExp(`width="${SLIP_WIDTH}" height="${SLIP_HEIGHT}"`));
  assert.match(svg, /viewBox="0 0 320 520"/);
  assert.match(svg, /font-family="Arial, Helvetica, sans-serif"/);
  // The one URI an SVG must carry is its own namespace, not an external asset.
  const body = svg.replace('xmlns="http://www.w3.org/2000/svg"', 'xmlns=""');
  assert.doesNotMatch(body, /<image|@import|<style|<script|url\(|https?:\/\/|href=/i);
  assert.ok(svg.endsWith('</svg>'));
  for (const text of ['T-14', 'Aarav Sharma', 'Dr. Anita Rao', 'Sunrise Clinic', '₹500', 'YOUR NUMBER', 'Show this slip at the desk']) {
    assert.ok(svg.includes(text), `the slip shows ${text}`);
  }
});

test('every human-supplied value is escaped before it becomes markup', () => {
  const evil = { ...base, patient: { full_name: 'A & "B" <b>', code: `P'001` } };
  const svg = tokenSlipSvg(tokenSlipModel(evil));
  const long = tokenSlipSvg(tokenSlipModel({ ...base, patient: { full_name: '<script>alert(1)</script>', code: 'P-1' } }));
  assert.doesNotMatch(svg, /<script|<b>/i);
  assert.doesNotMatch(long, /<script/i);
  assert.match(long, /&lt;script&gt;/);
  assert.match(svg, /&amp;/);
  assert.match(svg, /&quot;/);
  assert.match(svg, /&#39;001/);
  // A colour is clinic data too: the injected one never reaches an attribute.
  const injected = tokenSlipSvg(tokenSlipModel({ ...base, clinic: { ...base.clinic, brand_color: '#fff" onload="x' } }));
  assert.doesNotMatch(injected, /onload=/);
  assert.match(injected, /fill="#0f766e"/);
});

test('the data URI is a decodable, self-contained image source', () => {
  const url = tokenSlipDataUrl(model());
  assert.ok(url.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.equal(decodeURIComponent(url.slice('data:image/svg+xml;charset=utf-8,'.length)), tokenSlipSvg(model()));
  assert.doesNotMatch(url, /["<>#]/, 'a raw quote, tag or fragment cannot break an attribute');
});

test('the filename is readable, deterministic and cannot escape a directory', () => {
  const name = tokenSlipFilename(model());
  assert.equal(name, 'Token-T-14-Aarav-Sharma-2026-11-02.png');
  assert.doesNotMatch(name, /[\\/\s]/);
  assert.equal(tokenSlipFilename(tokenSlipModel({ patient: { full_name: '../../etc/passwd' } })).startsWith('Token-'), true);
  assert.doesNotMatch(tokenSlipFilename(tokenSlipModel({ patient: { full_name: '../../etc/passwd' } })), /\.\./);
  assert.ok(name.length <= 100);
});

test('the alt text and caption say what the image is', () => {
  const m = model();
  assert.match(slipAlt(m), /Aarav Sharma/);
  assert.match(slipAlt(m), /T-14/);
  assert.match(slipCaption(m), /T-14/);
  assert.match(slipCaption(m), /attached as an image/);
});

test('a token message with a slip adds one line and keeps the privacy rule', () => {
  const args = { clinic: base.clinic, doctor: base.doctor, patient: base.patient, appointment: { ...base.appointment, reason: 'bleeding piles' }, ahead: 3, etaMinutes: 45 };
  const plain = tokenMessage(args);
  const withSlip = tokenMessage({ ...args, withSlip: true });
  assert.doesNotMatch(plain.text, /attached as an image/);
  assert.match(withSlip.text, /Your token slip \(T-14\) is attached as an image/);
  assert.equal(withSlip.key, plain.key, 'the same message, so the log still refuses a second send');
  assert.doesNotMatch(withSlip.text, /bleeding|piles/i);
  assert.ok(withSlip.text.length <= 1200);
});

/* -------------------------------------------------------------- wiring ratchets */
test('token issue wires the slip, the print and the WhatsApp composer', () => {
  const q = code('src/components/TokenForm.jsx');
  assert.match(q, /from '\.\/TokenSlip\.jsx'/, 'the redesigned slip component is used');
  assert.match(q, /from '\.\.\/lib\/token-slip\.mjs'/, 'the layout rules come from the pure module');
  assert.match(q, /from '\.\/MessageSheet\.jsx'/, 'the existing consent-aware composer is reused');
  assert.match(q, /<TokenIssuedPanel/, 'the issued state has its own panel');
  assert.match(q, /<TokenSlipPrintPortal/, 'a print-only copy lives outside #root');
  assert.match(q, /onWhatsapp=\{\(\) => setMsgOpen\(true\)\}/, 'Send on WhatsApp opens the composer');
  assert.match(q, /onPrint=\{printTokenSlip\}/, 'Print slip prints only the slip');
  assert.match(q, /onDownload=\{downloadImage\}/, 'the PNG can be downloaded');
  assert.match(q, /withSlip: true/, 'the message says the slip is attached');
  assert.match(q, /slip=\{issuedModel\}/, 'the composer receives the same slip model');
  assert.doesNotMatch(q, /window\.print\(\)/, 'no bare print of the whole app any more');
  assert.match(q, /setIssued\(\{[\s\S]{0,300}patient, doctor, fee, kind, ahead, slot/,
    'the issued context is captured so Next patient cannot change the slip');
});

test('the composer sends the image with the message, and is unchanged without a slip', () => {
  const q = code('src/components/MessageSheet.jsx');
  assert.match(q, /slip = null/, 'the slip is optional — four other screens keep their composer');
  assert.match(q, /slipPngFile\(slip\)/, 'the PNG is built from the same model');
  assert.match(q, /shareSlip\(\{ file, text, title:/, 'the image and the exact text travel together');
  assert.match(q, /canShareFiles\(file\)/, 'devices that cannot share files fall back');
  assert.match(q, /Download slip PNG/, 'a desktop can still attach the slip by hand');
  assert.match(q, /AbortError/, 'a cancelled share is not logged as sent');
  assert.match(q, /<TokenSlip model=\{slip\}/, 'the composer previews the very same slip');
  assert.match(q, /disabled=\{!consent\.ok/, 'opt-out and bad numbers still win');
});

test('the slip component renders one SVG and the print portal is SSR-safe', () => {
  const q = code('src/components/TokenSlip.jsx');
  assert.match(q, /tokenSlipDataUrl\(model\)/, 'the very same SVG is used as an image source');
  assert.match(q, /<img className="token-slip-img"/);
  assert.doesNotMatch(q, /dangerouslySetInnerHTML|innerHTML/, 'no raw HTML opt-out anywhere in the app');
  assert.match(q, /createPortal\(/, 'the print copy is outside #root');
  assert.match(q, /typeof document === 'undefined'\) return null/, 'server rendering is safe');
  assert.match(q, /Send on WhatsApp/, 'the issue-time send is in the panel');
  assert.match(q, /Print slip/);
  assert.match(q, /Download slip image/);
  assert.match(q, /role="alert"/, 'a consent refusal is spoken');
});

test('the browser helper shares files, draws a canvas and cleans up after printing', async () => {
  const q = code('src/lib/token-slip-image.js');
  assert.match(q, /navigator\.share\(\{ files: \[file\], text, title \}\)/);
  assert.match(q, /canvas\.getContext\('2d'\)/);
  assert.match(q, /toBlob\(resolve, 'image\/png'\)/);
  assert.match(q, /@page \{ size: 80mm 170mm; margin: 3mm; \}/);
  assert.match(q, /window\.addEventListener\('afterprint', cleanup\)/);
  assert.match(q, /URL\.revokeObjectURL\(url\)/);
  // Importing this DOM-only module must be harmless in Node (SSR smokes import it).
  const mod = await import('../src/lib/token-slip-image.js');
  assert.equal(typeof mod.slipPngFile, 'function');
  assert.equal(mod.canShareFiles(), false, 'no navigator, no file sharing');
});

test('print CSS shows only the slip and the dead .slip rule is gone', () => {
  const q = code('src/styles.css');
  assert.match(q, /body\[data-token-print='true'\] #root \{ display: none !important; \}/);
  assert.match(q, /body\[data-token-print='true'\] \.token-slip-print img/);
  assert.match(q, /width: 74mm/);
  assert.doesNotMatch(q, /^\.slip \{/m, 'the unused class is removed, not left behind');
  assert.doesNotMatch(q, /\.slip \{ position: fixed/);
});
