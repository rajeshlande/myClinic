import { createPortal } from 'react-dom';
import { AlertTriangle, Download, MessageSquare, Printer } from 'lucide-react';
import { Badge, Button } from './ui.jsx';
import { tokenSlipDataUrl, slipAlt } from '../lib/token-slip.mjs';

/**
 * The redesigned token slip. One SVG string from `token-slip.mjs` is used three
 * times: this on-screen preview, the print portal below and the PNG the composer
 * attaches to WhatsApp. Rendering it as markup (rather than rebuilding the design
 * in JSX) is deliberate — a second copy of the layout would immediately drift.
 * `tokenSlipSvg()` XML-escapes every human-supplied value; the data URI keeps
 * React's own escaping intact, so nothing is ever injected as markup.
 */
export function TokenSlip({ model, className = '' }) {
  return (
    <div className={`token-slip-preview ${className}`.trim()}>
      <img className="token-slip-img" src={tokenSlipDataUrl(model)} alt={slipAlt(model)} />
    </div>
  );
}

/**
 * A print-only copy outside `#root`. The print CSS hides `#root` while
 * `body[data-token-print]` is set, so the sheet that reaches the printer is just
 * this 74 mm-wide slip — not the app behind a modal, which is what v1.35.2 did.
 */
export function TokenSlipPrintPortal({ model }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="token-slip-print" aria-hidden="true">
      <img src={tokenSlipDataUrl(model)} alt="" />
    </div>,
    document.body,
  );
}

/**
 * Everything the desk can do at the moment the token is issued. A component of
 * its own so the whole issued state — slip, note and all three actions — can be
 * server-rendered in a smoke without clicking through the form first.
 */
export function TokenIssuedPanel({ model, consent = { ok: true, reason: '' }, onWhatsapp, onPrint, onDownload }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="token-slip-frame">
        <TokenSlip model={model} />
      </div>

      <div className="token-issue-actions">
        <Button variant="primary" icon={MessageSquare} onClick={onWhatsapp} disabled={!consent.ok}>
          Send on WhatsApp
        </Button>
        <Button variant="subtle" icon={Printer} onClick={onPrint}>Print slip</Button>
        <Button variant="ghost" icon={Download} onClick={onDownload}>Download slip image</Button>
      </div>

      {!consent.ok ? (
        <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{consent.reason}</p>
      ) : null}

      <div className="row small" style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11, gap: 8 }}>
        <AlertTriangle size={14} className="muted" />
        <span className="muted">
          Tell the patient their number will be called on the display / by name. The slip image can be shared
          with the message on a phone; on a desktop it downloads as a PNG to attach in WhatsApp.
        </span>
      </div>

      <div className="row wrap tiny faint" style={{ gap: 8 }}>
        <Badge tone="brand">{model.token}</Badge>
        <span>{model.clinicName}</span>
        <span className="spacer" />
        <span>{model.dateLabel} · {model.timeLabel}</span>
      </div>
    </div>
  );
}
