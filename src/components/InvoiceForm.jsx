import { useMemo, useState } from 'react';
import { Plus, Trash2, Receipt } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Button, Field, Input, Select, Textarea, Modal, Avatar, Badge, IconButton } from './ui.jsx';
import {
  DEFAULT_SERVICES, PAYMENT_METHODS, computeInvoice, formatMoney, invoiceNumber, moneyToPaise,
  paiseToInput, today,
} from '../lib/logic.mjs';

export default function InvoiceForm({ open, onClose, invoice, patient: presetPatient, appointment, onCreated }) {
  const store = useStore();
  const toast = useToast();
  const catalogue = [...DEFAULT_SERVICES, ...(store.serviceCatalogue ?? [])];
  const [patientId, setPatientId] = useState(presetPatient?.id ?? invoice?.patient_id ?? '');
  const [doctorId, setDoctorId] = useState(appointment?.doctor_id ?? invoice?.doctor_id ?? store.doctors[0]?.id ?? '');
  const [issuedOn, setIssuedOn] = useState(invoice?.issued_on ?? today());
  const [method, setMethod] = useState(invoice?.method ?? 'cash');
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [payNow, setPayNow] = useState(true);
  const [partial, setPartial] = useState('');
  const [discount, setDiscount] = useState(invoice ? paiseToInput(invoice.discount_paise) : '0');
  const [lines, setLines] = useState(() => {
    if (invoice?.lines?.length) return invoice.lines.map((l) => ({ ...l, rate: paiseToInput(l.rate_paise), discount: paiseToInput(l.discount ?? 0) }));
    const fee = appointment?.kind === 'Follow-up'
      ? store.doctors.find((d) => d.id === doctorId)?.follow_up_fee_paise ?? 25000
      : store.doctors.find((d) => d.id === doctorId)?.fee_paise ?? 50000;
    return [{ service_id: 'svc-consult', name: 'Consultation', category: 'Consultation', qty: 1, rate: paiseToInput(fee), discount: '0', tax_rate: 0 }];
  });
  const [saving, setSaving] = useState(false);

  const patient = store.patients.find((p) => p.id === patientId);
  const nextNumber = invoice?.number ?? invoiceNumber(store.invoices.length + 1, issuedOn);

  const totals = useMemo(() => {
    let mapped;
    try {
      mapped = lines.map((l) => ({
        ...l,
        rate_paise: moneyToPaise(l.rate || 0),
        discount: moneyToPaise(l.discount || 0),
        qty: Number(l.qty) || 1,
      }));
    } catch { mapped = []; }
    const computed = computeInvoice({
      lines: mapped,
      discount: (() => { try { return moneyToPaise(discount || 0); } catch { return 0; } })(),
      gst_enabled: store.clinic?.gst_enabled ?? true,
      paid: 0,
    });
    return computed;
  }, [lines, discount, store.clinic]);

  const paidAmount = payNow ? (partial ? (() => { try { return moneyToPaise(partial); } catch { return 0; } })() : totals.total) : 0;

  const setLine = (index, key) => (e) => {
    const value = e.target?.value ?? e;
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [key]: value } : l)));
  };

  function pickService(index, serviceId) {
    const service = catalogue.find((s) => s.id === serviceId);
    if (!service) return;
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, service_id: service.id, name: service.name, category: service.category, rate: paiseToInput(service.price_paise) } : l)));
  }

  async function submit() {
    if (!patientId) { toast.error('Choose a patient for this invoice.'); return; }
    if (!totals.total) { toast.error('Add at least one charge.'); return; }
    setSaving(true);
    try {
      const payload = {
        number: nextNumber,
        patient_id: patientId,
        doctor_id: doctorId || null,
        appointment_id: appointment?.id ?? invoice?.appointment_id ?? null,
        issued_on: issuedOn,
        lines: totals.rows.map((r) => ({ service_id: r.service_id, name: r.name, category: r.category, qty: Number(r.qty) || 1, rate_paise: r.rate_paise, discount: r.discountPaise, tax_rate: r.tax_rate ?? 0, total: r.total })),
        subtotal_paise: totals.subtotal,
        discount_paise: totals.billDiscount,
        tax_paise: totals.tax,
        total_paise: totals.total,
        paid_paise: Math.min(paidAmount, totals.total),
        method,
        status: paidAmount >= totals.total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
        notes: notes.trim(),
      };
      let saved;
      if (invoice) {
        await store.update('invoices', invoice.id, payload);
        saved = { ...invoice, ...payload };
        toast.success('Invoice updated.');
      } else {
        saved = await store.create('invoices', payload);
        toast.success(`Invoice ${payload.number} saved.`);
      }
      onCreated?.(saved);
      onClose();
    } catch (e) {
      toast.error(e.message ?? 'Could not save the invoice.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open} onClose={onClose} wide
      title={invoice ? `Edit ${invoice.number}` : 'New invoice'}
      sub={`${nextNumber} · GST ${store.clinic?.gst_enabled ? 'enabled' : 'off'} · all amounts in INR`}
      footer={<>
        <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
        <Button variant="primary" onClick={submit} loading={saving} type="button" icon={Receipt}>{invoice ? 'Save invoice' : `Save · ${formatMoney(totals.total)}`}</Button>
      </>}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Patient *">
            {patient ? (
              <div className="appt" style={{ background: 'var(--surface-2)' }}>
                <Avatar name={patient.full_name} />
                <div className="who"><b>{patient.full_name}</b><span className="tiny muted">{patient.code} · {patient.phone || 'no phone'}</span></div>
                {!presetPatient ? <Button size="sm" variant="ghost" onClick={() => setPatientId('')}>Change</Button> : null}
              </div>
            ) : (
              <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="">Select a patient…</option>
                {store.patients.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {p.code}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Treating doctor">
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Unassigned</option>
              {store.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Invoice date"><Input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></Field>
          <Field label="Payment method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          </Field>
        </div>

        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="label">Charges</span>
            <span className="spacer" />
            <Button size="sm" variant="subtle" icon={Plus} type="button" onClick={() => setLines((prev) => [...prev, { service_id: '', name: '', category: 'Consultation', qty: 1, rate: '', discount: '0', tax_rate: 0 }])}>Add charge</Button>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {lines.map((line, i) => (
              <div key={i} className="card pad" style={{ padding: 10, background: 'var(--surface-2)' }}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="tiny eyebrow">Charge {i + 1}</span>
                  <span className="spacer" />
                  {lines.length > 1 ? <IconButton icon={Trash2} label="Remove charge" size={14} className="plain sm" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} /> : null}
                </div>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                  <Field label="Service" className="span-2">
                    <Select value={line.service_id} onChange={(e) => pickService(i, e.target.value)}>
                      <option value="">Custom charge</option>
                      {catalogue.map((s) => <option key={s.id} value={s.id}>{s.name} — {formatMoney(s.price_paise)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Description"><Input value={line.name} onChange={setLine(i, 'name')} placeholder="Consultation" /></Field>
                  <Field label="Qty"><Input type="number" min="1" value={line.qty} onChange={setLine(i, 'qty')} inputMode="numeric" /></Field>
                  <Field label="Rate ₹"><Input value={line.rate} onChange={setLine(i, 'rate')} inputMode="decimal" placeholder="500" /></Field>
                  <Field label="Discount ₹"><Input value={line.discount} onChange={setLine(i, 'discount')} inputMode="decimal" placeholder="0" /></Field>
                  <Field label="GST %">
                    <Select value={line.tax_rate ?? 0} onChange={setLine(i, 'tax_rate')}>
                      {[0, 5, 12, 18].map((r) => <option key={r} value={r}>{r}%</option>)}
                    </Select>
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="form-grid">
          <Field label="Bill discount ₹" hint="Applied after line discounts"><Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Insurance claim no., reference" /></Field>
        </div>

        <div className="card pad" style={{ background: 'var(--surface-2)' }}>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row small"><span className="muted">Subtotal</span><span className="spacer" /><span className="mono">{formatMoney(totals.subtotal)}</span></div>
            {totals.lineDiscount + totals.billDiscount ? <div className="row small"><span className="muted">Discount</span><span className="spacer" /><span className="mono">−{formatMoney(totals.lineDiscount + totals.billDiscount)}</span></div> : null}
            {totals.tax ? <div className="row small"><span className="muted">GST</span><span className="spacer" /><span className="mono">{formatMoney(totals.tax)}</span></div> : null}
            <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 7 }}>
              <span className="strong">Total payable</span>
              <span className="spacer" />
              <span className="strong mono" style={{ fontSize: '1.1rem' }}>{formatMoney(totals.total)}</span>
            </div>
          </div>
          <div className="row wrap" style={{ marginTop: 12, gap: 10 }}>
            <label className="check"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} /> Record a payment now</label>
            {payNow ? (
              <div className="row" style={{ gap: 6, flex: 1, minWidth: 180 }}>
                <span className="tiny muted">Amount ₹</span>
                <Input value={partial} onChange={(e) => setPartial(e.target.value)} placeholder={paiseToInput(totals.total)} inputMode="decimal" style={{ maxWidth: 130 }} />
                <Badge tone={paidAmount >= totals.total ? 'success' : 'warn'}>{paidAmount >= totals.total ? 'Paid in full' : `Part payment · balance ${formatMoney(Math.max(0, totals.total - paidAmount))}`}</Badge>
              </div>
            ) : <Badge tone="danger">Unpaid · added to dues</Badge>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
