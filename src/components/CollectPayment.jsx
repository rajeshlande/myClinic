import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, HandCoins, Smartphone } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Badge, Button, Field, Input, Modal, Segmented } from './ui.jsx';
import UpiQr from './UpiQr.jsx';
import {
  PAYMENT_METHODS, applyPayment, formatDate, formatMoney, invoiceBalance, invoiceStatus, moneyToPaise, paiseToInput, today,
} from '../lib/logic.mjs';
import { UPI_APPS, invoiceUpiLink, isValidUpiId, normaliseVpa, upiPayeeName } from '../lib/upi.mjs';

/**
 * The counter's payment sheet.
 *
 * One component used from three places — the billing list, the invoice document
 * and the patient chart — so collecting money behaves identically wherever the
 * front desk happens to be standing. It shows the QR the patient scans *before*
 * anything is recorded, which is the order things actually happen in: scan, get
 * the confirmation tone, then type the reference and save.
 */
export default function CollectPayment({ invoice, open, onClose, onDone }) {
  const store = useStore();
  const toast = useToast();
  const clinic = store.clinic ?? {};
  const patient = store.patients.find((p) => p.id === invoice?.patient_id);
  const balance = invoice ? invoiceBalance(invoice) : 0;

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('upi');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Re-arm the sheet every time it opens on a (possibly different) invoice.
  useEffect(() => {
    if (!open || !invoice) return;
    setAmount(paiseToInput(balance));
    setMethod(invoice.method === 'credit' ? 'cash' : (invoice.method || 'upi'));
    setReference(invoice.payment_ref ?? '');
    setCopied(false);
  }, [open, invoice?.id, balance]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountPaise = useMemo(() => {
    try { return moneyToPaise(amount || '0'); } catch { return 0; }
  }, [amount]);

  const preview = invoice ? applyPayment(invoice, amountPaise) : null;
  const upiReady = isValidUpiId(clinic.upi_id);
  const upiLink = useMemo(
    () => (upiReady && preview?.applied ? invoiceUpiLink(invoice, clinic, preview.applied) : null),
    [upiReady, preview?.applied, invoice, clinic],
  );
  const settled = balance <= 0;
  const isVoid = invoice?.status === 'void';

  async function copyVpa() {
    try {
      await navigator.clipboard.writeText(normaliseVpa(clinic.upi_id));
      setCopied(true);
      toast.success('UPI ID copied.');
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error('Could not copy on this device.'); }
  }

  async function submit() {
    if (!invoice || !preview) return;
    if (isVoid) { toast.error('A void invoice cannot take a payment.'); return; }
    if (preview.applied <= 0) { toast.error('Enter an amount above zero.'); return; }
    setSaving(true);
    try {
      await store.update('invoices', invoice.id, {
        paid_paise: preview.paid,
        status: preview.status,
        method,
        paid_on: today(),
        payment_ref: reference.trim().slice(0, 60),
      });
      const label = PAYMENT_METHODS.find((m) => m.id === method)?.label ?? method;
      toast.success(
        preview.status === 'paid'
          ? `${formatMoney(preview.applied)} received by ${label}. ${invoice.number} is settled.`
          : `${formatMoney(preview.applied)} received by ${label}. ${formatMoney(preview.balance)} still due.`,
      );
      onDone?.({ ...invoice, paid_paise: preview.paid, status: preview.status, method, payment_ref: reference.trim() }, preview);
      onClose?.();
    } catch (e) {
      toast.error(e?.message ?? 'Could not record the payment.');
    } finally {
      setSaving(false);
    }
  }

  if (!invoice) return null;
  const meta = invoiceStatus(invoice);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Collect payment"
      sub={`${invoice.number} · ${patient?.full_name ?? 'Patient'}${patient?.code ? ` · ${patient.code}` : ''}`}
      footer={<>
        <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
        <Button
          variant="primary"
          icon={HandCoins}
          onClick={submit}
          loading={saving}
          disabled={settled || isVoid || preview?.applied <= 0}
          type="button"
        >
          {settled ? 'Already settled' : `Record ${formatMoney(preview?.applied ?? 0)}`}
        </Button>
      </>}
    >
      <div className="stack" style={{ gap: 14 }}>
        {/* ---------------------------------------------------------- balance */}
        <div className="pay-balance">
          <div>
            <span className="eyebrow">Amount due</span>
            <div className="pay-balance-figure mono">{formatMoney(balance)}</div>
            <div className="tiny faint">
              Invoice total {formatMoney(invoice.total_paise)} · already paid {formatMoney(invoice.paid_paise)}
              {invoice.paid_on ? ` on ${formatDate(invoice.paid_on)}` : ''}
            </div>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>

        {settled ? (
          <div className="pay-settled">
            <CheckCircle2 size={16} />
            <div>
              <strong className="small">Nothing left to collect</strong>
              <div className="tiny faint">
                {invoice.method ? `Settled by ${PAYMENT_METHODS.find((m) => m.id === invoice.method)?.label ?? invoice.method}` : 'Settled'}
                {invoice.payment_ref ? ` · ref ${invoice.payment_ref}` : ''}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* ------------------------------------------------------ amount */}
            <Field label="Amount received ₹" hint={preview?.overshoot > 0 ? `Only ${formatMoney(balance)} can be applied — the rest is ignored.` : 'Part payments are allowed; the balance stays open.'}>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus
                aria-label="Amount received"
              />
            </Field>
            <div className="row wrap" style={{ gap: 6 }}>
              <Button size="sm" variant="subtle" onClick={() => setAmount(paiseToInput(balance))} type="button">Full balance</Button>
              {balance > 1 ? <Button size="sm" variant="subtle" onClick={() => setAmount(paiseToInput(Math.round(balance / 2)))} type="button">Half</Button> : null}
              {balance > 20000 ? <Button size="sm" variant="subtle" onClick={() => setAmount(paiseToInput(Math.min(balance, 50000)))} type="button">₹500</Button> : null}
              {preview && preview.applied > 0 ? <span className="spacer" /> : null}
              {preview && preview.applied > 0 ? <span className="tiny faint">Leaves {formatMoney(preview.balance)} due</span> : null}
            </div>

            {/* ------------------------------------------------------ method */}
            <div>
              <span className="label" style={{ display: 'block', marginBottom: 6 }}>Paid by</span>
              <Segmented
                value={method}
                onChange={setMethod}
                options={PAYMENT_METHODS.filter((m) => m.id !== 'credit').map((m) => ({ value: m.id, label: m.label }))}
              />
            </div>

            {/* --------------------------------------------------- UPI QR */}
            {method === 'upi' ? (
              upiLink ? (
                <div className="pay-upi">
                  <UpiQr value={upiLink} size={150} className="pay-upi-code" label={`Scan to pay ${formatMoney(preview?.applied ?? balance)} to ${upiPayeeName(clinic)}`} />
                  <div className="pay-upi-side">
                    <span className="eyebrow">Scan to pay</span>
                    <div className="pay-upi-amount mono">{formatMoney(preview?.applied ?? balance)}</div>
                    <div className="pay-upi-name">{upiPayeeName(clinic)}</div>
                    <button type="button" className="pay-vpa" onClick={copyVpa} title="Copy UPI ID">
                      <span className="mono">{normaliseVpa(clinic.upi_id)}</span>
                      {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                    </button>
                    <p className="tiny faint" style={{ margin: 0 }}>Any UPI app — {UPI_APPS.slice(0, 4).join(', ')}. The amount is pre-filled.</p>
                  </div>
                </div>
              ) : (
                <div className="pay-hint">
                  <Smartphone size={14} />
                  <span>
                    No UPI ID set for this clinic yet. Add one in <strong>Settings → Payments</strong> to show a scannable QR on invoices.
                  </span>
                </div>
              )
            ) : null}

            <Field
              label={method === 'upi' ? 'UPI reference / UTR' : method === 'card' ? 'Card last 4 digits' : 'Reference (optional)'}
              hint="Printed on the invoice so the payment can be traced later."
            >
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === 'upi' ? 'e.g. 4023XXXX8891' : method === 'card' ? 'e.g. 4412' : 'e.g. counter receipt 118'}
                maxLength={60}
              />
            </Field>
          </>
        )}

        <p className="tiny faint" style={{ margin: 0 }}>
          Payments never exceed the invoice total, and the balance is recalculated from integer paise — no rounding drift.
        </p>
      </div>
    </Modal>
  );
}
