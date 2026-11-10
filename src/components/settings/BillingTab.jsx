/**
 * Billing & invoices: GST rate, the UPI handle that prints on the invoice, and
the receipt footer. Extracted verbatim from Settings.jsx in v1.30.0
 * (docs/ARCHITECTURE.md §3 step 4) — markup and copy unchanged.
 */

import {formatMoney} from '../../lib/logic.mjs';
import {can} from '../../lib/permissions.js';
import {UPI_APPS, buildUpiUri, isValidUpiId, normaliseVpa, upiPayeeName} from '../../lib/upi.mjs';
import UpiQr from '../UpiQr.jsx';
import {Button, Card, CardHead, Field, Input, Select} from '../ui.jsx';
import {CreditCard, QrCode, Save, ShieldCheck} from 'lucide-react';
import {useStore} from '../../lib/store.jsx';

export default function BillingTab({ clinic, setClinic, saveClinic, saving }) {
  const store = useStore();
  return (
    <>
        <Card>
          <CardHead title="Billing & invoices" sub="GST treatment and invoice numbering" icon={CreditCard}
            action={<Button size="sm" variant="primary" icon={Save} onClick={saveClinic} loading={saving}>Save</Button>} />
          <div className="card-body stack">
            <label className="check">
              <input type="checkbox" checked={Boolean(clinic.gst_enabled)} onChange={(e) => setClinic((c) => ({ ...c, gst_enabled: e.target.checked }))} />
              <span>
                <strong className="small">Enable GST on invoices</strong>
                <span className="tiny muted" style={{ display: 'block' }}>Healthcare services are often exempt — keep this off unless you are registered and advised otherwise.</span>
              </span>
            </label>
            <div className="form-grid">
              <Field label="Default GST rate">
                <Select value={clinic.gst_rate} onChange={(e) => setClinic((c) => ({ ...c, gst_rate: e.target.value }))} disabled={!clinic.gst_enabled}>
                  {[0, 5, 12, 18].map((r) => <option key={r} value={r}>{r}%</option>)}
                </Select>
              </Field>
              <Field label="Invoice prefix" hint="Example: INV/2526/0001">
                <Input value={clinic.invoice_prefix ?? 'INV'} onChange={(e) => setClinic((c) => ({ ...c, invoice_prefix: e.target.value.toUpperCase().slice(0, 8) }))} />
              </Field>
            </div>
            <div className="row small" style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11, gap: 8 }}>
              <ShieldCheck size={14} className="muted" />
              <span className="muted">Money is stored as integer paise. Totals can never drift by a rounding error, and paid amounts are capped at the invoice total.</span>
            </div>
            <div className="grid two" style={{ gap: 10 }}>
              {[
                ['Consultation', formatMoney(store.clinic?.consultation_fee_paise ?? 0)],
                ['Follow-up', formatMoney(store.clinic?.follow_up_fee_paise ?? 0)],
                ['Invoices issued', String(store.invoices.length)],
                ['Unpaid', String(store.invoices.filter((i) => i.paid_paise < i.total_paise && i.status !== 'void').length)],
              ].map(([label, value]) => (
                <div key={label} className="row small" style={{ background: 'var(--surface-2)', padding: '9px 11px', borderRadius: 10 }}>
                  <span className="muted">{label}</span><span className="spacer" /><span className="strong mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card>
          <CardHead title="Payments &amp; UPI" sub="How patients settle an unpaid invoice" icon={QrCode}
            action={<Button size="sm" variant="primary" icon={Save} onClick={saveClinic} loading={saving}>Save</Button>} />
          <div className="card-body stack" style={{ gap: 14 }}>
            <div className="form-grid">
              <Field label="Clinic UPI ID (VPA)" hint={clinic.upi_id && !isValidUpiId(clinic.upi_id) ? 'Does not look like a UPI ID — expected something like clinic@okhdfcbank' : 'Printed as a QR on every unpaid invoice, e.g. sunrise.opd@okicici'}>
                <Input
                  value={clinic.upi_id ?? ''}
                  onChange={(e) => setClinic((c) => ({ ...c, upi_id: e.target.value }))}
                  placeholder="clinic@okhdfcbank"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="email"
                />
              </Field>
              <Field label="Payee name shown in the UPI app" hint="Leave blank to use the clinic name">
                <Input
                  value={clinic.upi_payee_name ?? ''}
                  onChange={(e) => setClinic((c) => ({ ...c, upi_payee_name: e.target.value }))}
                  placeholder={clinic.name ?? 'Clinic name'}
                  maxLength={60}
                />
              </Field>
            </div>

            <label className="check">
              <input type="checkbox" checked={clinic.upi_qr_on_invoices !== false} onChange={(e) => setClinic((c) => ({ ...c, upi_qr_on_invoices: e.target.checked }))} />
              <span>
                <strong className="small">Print a UPI QR on unpaid invoices</strong>
                <span className="tiny muted" style={{ display: 'block' }}>The QR carries the invoice number and the exact balance, so the patient cannot pay the wrong amount.</span>
              </span>
            </label>

            {isValidUpiId(clinic.upi_id) ? (
              <div className="settings-upi-preview">
                <UpiQr
                  value={buildUpiUri({ vpa: clinic.upi_id, name: upiPayeeName(clinic), amountPaise: 50000, note: 'Invoice preview' }) ?? ''}
                  size={118}
                  label="Preview of the invoice UPI QR code"
                />
                <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                  <span className="eyebrow">Preview · ₹500 invoice</span>
                  <div className="strong small">{upiPayeeName(clinic)}</div>
                  <div className="pay-vpa" style={{ margin: 0, pointerEvents: 'none' }}><span className="mono">{normaliseVpa(clinic.upi_id)}</span></div>
                  <p className="tiny faint" style={{ margin: 0 }}>
                    Works with {UPI_APPS.slice(0, 4).join(', ')} and any bank app. Scan it once with your own phone before the first real patient.
                  </p>
                </div>
              </div>
            ) : (
              <div className="row small" style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11, gap: 8 }}>
                <ShieldCheck size={14} className="muted" />
                <span className="muted">Money never passes through myClinic. The QR sends the payment straight to your bank account; you record it here afterwards.</span>
              </div>
            )}
          </div>
        </Card>
    </>
  );
}
