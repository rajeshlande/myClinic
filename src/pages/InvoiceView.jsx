import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeft, CheckCircle2, Download, HandCoins, MessageSquare, Printer, ShieldCheck, Wallet,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Badge, Button, Card, EmptyState } from '../components/ui.jsx';
import {
  PAYMENT_METHODS, amountInWords, downloadFile, formatDate, formatMoney, invoiceBalance, invoiceStatus, toCSV,
} from '../lib/logic.mjs';
import { DocumentHeader } from '../components/Branding.jsx';
import { logoOnDocuments } from '../lib/branding.mjs';
import { UPI_APPS, invoiceUpiLink, isValidUpiId, normaliseVpa, upiPayeeName } from '../lib/upi.mjs';
import { invoiceMessage } from '../lib/messages.mjs';
import MessageSheet from '../components/MessageSheet.jsx';
import UpiQr from '../components/UpiQr.jsx';
import CollectPayment from '../components/CollectPayment.jsx';

/** A labelled block used across the document: uppercase eyebrow over a value. */
function DocField({ label, children, align = 'left' }) {
  return (
    <div className="doc-field" style={{ textAlign: align }}>
      <span className="doc-eyebrow">{label}</span>
      <div className="doc-field-value">{children}</div>
    </div>
  );
}

export default function InvoiceView() {
  useEffect(() => {
    document.body.dataset.printview = 'true';
    return () => { delete document.body.dataset.printview; };
  }, []);

  const { id } = useParams();
  const store = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [collectOpen, setCollectOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const invoice = store.invoices.find((i) => i.id === id);

  if (!invoice) {
    return <div className="page"><Card><div className="card-body"><EmptyState icon={Printer} title="Invoice not found" description="It may belong to another clinic." action={<Button variant="primary" onClick={() => navigate('/app/billing')}>Back to billing</Button>} /></div></Card></div>;
  }

  const patient = store.patients.find((p) => p.id === invoice.patient_id);
  const doctor = store.doctors.find((d) => d.id === invoice.doctor_id);
  const clinic = store.clinic ?? {};
  const meta = invoiceStatus(invoice);
  const balance = invoiceBalance(invoice);
  const settled = balance <= 0;
  const upiConfigured = isValidUpiId(clinic.upi_id);
  const showQr = !settled && clinic.upi_qr_on_invoices !== false && upiConfigured;
  const upiLink = showQr ? invoiceUpiLink(invoice, clinic, balance) : null;
  const methodLabel = PAYMENT_METHODS.find((m) => m.id === invoice.method)?.label ?? invoice.method;

  const printSheet = () => {
    toast.info('Use your browser’s “Save as PDF” in the print dialog.');
    setTimeout(() => window.print(), 250);
  };

  const exportCsv = () => {
    const csv = toCSV(invoice.lines ?? [], [
      { label: 'Service', key: 'name' },
      { label: 'Category', key: 'category' },
      { label: 'Qty', key: 'qty' },
      { label: 'Rate', value: (l) => (Number(l.rate_paise) / 100).toFixed(2) },
      { label: 'Discount', value: (l) => (Number(l.discount || 0) / 100).toFixed(2) },
      { label: 'Total', value: (l) => (Number(l.total) / 100).toFixed(2) },
    ]);
    downloadFile(`${invoice.number.replace(/\//g, '-')}.csv`, csv);
  };

  // The bill goes to the patient on WhatsApp: number, total, what is still owed
  // and the clinic's UPI id. Built by messages.mjs so the wording lives in one
  // place and the send log records it like every other patient message.
  const message = invoiceMessage({ clinic, patient, invoice, balancePaise: balance });

  return (
    <div className="doc-page">
      {/* ------------------------------------------------------------ toolbar */}
      <div className="doc-toolbar no-print">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => navigate('/app/billing')}>Billing</Button>
        <span className="spacer" />
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <Button size="sm" variant="ghost" icon={MessageSquare} onClick={() => setMsgOpen(true)}>WhatsApp</Button>
        <Button size="sm" variant="subtle" icon={Download} onClick={exportCsv}>CSV</Button>
        <Button size="sm" variant="primary" icon={Printer} onClick={printSheet}>Print / PDF</Button>
      </div>

      {/* ------------------------------------------------------------- sheet */}
      <article className="print-sheet invoice-sheet">
        <DocumentHeader
          clinic={clinic}
          logo={logoOnDocuments(clinic)}
          accent={clinic.brand_color}
          right={(
            <div className="doc-title-block">
              <div className="doc-kind">Tax invoice</div>
              <div className="doc-number mono">{invoice.number}</div>
              <div className="doc-date">{formatDate(invoice.issued_on)}</div>
              <span className={`doc-stamp ${settled ? 'paid' : 'due'}`}>
                {invoice.status === 'void' ? 'Void' : settled ? 'Paid in full' : meta.label}
              </span>
            </div>
          )}
        />

        {/* who / what — one row on paper, stacked on a phone */}
        <div className="inv-parties">
          <DocField label="Billed to">
            <strong>{patient?.full_name ?? 'Patient'}</strong>
            <span className="doc-sub">
              {patient?.code}{patient?.phone ? ` · ${patient.phone}` : ''}
              {patient?.address ? <><br />{patient.address}</> : null}
            </span>
          </DocField>
          <DocField label="Consulting doctor">
            <strong>{doctor?.full_name ?? '—'}</strong>
            <span className="doc-sub">
              {doctor?.qualification || '—'}
              {doctor?.registration_no ? <><br />Reg. {doctor.registration_no}</> : null}
            </span>
          </DocField>
          <DocField label="Payment">
            <strong>{methodLabel}</strong>
            <span className="doc-sub">
              {settled
                ? `Settled${invoice.paid_on ? ` on ${formatDate(invoice.paid_on)}` : ''}`
                : `Due ${formatMoney(balance)}`}
              {invoice.payment_ref ? <><br />Ref {invoice.payment_ref}</> : null}
            </span>
          </DocField>
        </div>

        {/* ------------------------------------------------------------- lines */}
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th style={{ width: '46%' }}>Service</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Disc.</th>
                <th className="num">GST</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lines ?? []).map((line, i) => (
                <tr key={i}>
                  <td>
                    <div className="doc-line-name">{line.name}</div>
                    <div className="doc-line-meta">{line.category}</div>
                  </td>
                  <td className="num">{line.qty}</td>
                  <td className="num">{formatMoney(line.rate_paise)}</td>
                  <td className="num">{line.discount ? formatMoney(line.discount) : '—'}</td>
                  <td className="num">{line.tax_rate ? `${line.tax_rate}%` : '—'}</td>
                  <td className="num strong">{formatMoney(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* phones: the same lines, stacked — a six-column table cannot be read
            on a 390px screen and horizontal scrolling inside a bill is worse
            than a taller one. */}
        <div className="doc-lines">
          {(invoice.lines ?? []).map((line, i) => (
            <div key={i} className="doc-line">
              <div className="doc-line-head">
                <span className="doc-line-name">{line.name}</span>
                <span className="doc-line-amount mono">{formatMoney(line.total)}</span>
              </div>
              <div className="doc-line-meta">
                {[
                  line.category,
                  `${line.qty} × ${formatMoney(line.rate_paise)}`,
                  line.discount ? `−${formatMoney(line.discount)}` : null,
                  line.tax_rate ? `GST ${line.tax_rate}%` : null,
                ].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
        </div>

        {/* ------------------------------------------------- totals + payment */}
        <div className="inv-settle">
          {/* left: how to pay (only while money is owed) */}
          <div className="inv-pay">
            {!settled && showQr && upiLink ? (
              <div className="inv-upi">
                <UpiQr value={upiLink} size={132} className="inv-upi-code" label={`Scan to pay ${formatMoney(balance)} to ${upiPayeeName(clinic)}`} />
                <div className="inv-upi-text">
                  <span className="doc-eyebrow">Scan to pay</span>
                  <div className="inv-upi-amount mono">{formatMoney(balance)}</div>
                  <div className="tiny">{upiPayeeName(clinic)}</div>
                  <div className="inv-vpa mono">{normaliseVpa(clinic.upi_id)}</div>
                  <div className="tiny faint">{UPI_APPS.slice(0, 4).join(' · ')}</div>
                </div>
              </div>
            ) : !settled ? (
              <div className="inv-pay-note">
                <Wallet size={15} />
                <div>
                  <strong className="small">Pay at the front desk</strong>
                  <div className="tiny faint">
                    {upiConfigured ? 'Ask the front desk to open this invoice and show the QR.' : 'Cash, card and UPI accepted at the counter.'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="inv-pay-note paid">
                <CheckCircle2 size={15} />
                <div>
                  <strong className="small">Paid in full — thank you</strong>
                  <div className="tiny faint">
                    {methodLabel}{invoice.paid_on ? ` · ${formatDate(invoice.paid_on)}` : ''}{invoice.payment_ref ? ` · Ref ${invoice.payment_ref}` : ''}
                  </div>
                </div>
              </div>
            )}
            {invoice.notes ? <p className="inv-notes"><strong>Notes:</strong> {invoice.notes}</p> : null}
          </div>

          {/* right: the money */}
          <div className="inv-totals">
            {[
              ['Subtotal', invoice.subtotal_paise],
              ...(invoice.discount_paise ? [['Discount', -invoice.discount_paise]] : []),
              ...(invoice.tax_paise ? [['GST', invoice.tax_paise]] : []),
            ].map(([label, value]) => (
              <div key={label} className="inv-total-row">
                <span>{label}</span>
                <span className="mono">{value < 0 ? '−' : ''}{formatMoney(Math.abs(value))}</span>
              </div>
            ))}
            <div className="inv-total-row grand">
              <span>Total</span>
              <span className="mono">{formatMoney(invoice.total_paise)}</span>
            </div>
            <div className="inv-total-row">
              <span>Paid · {methodLabel}</span>
              <span className="mono">{formatMoney(invoice.paid_paise)}</span>
            </div>
            <div className={`inv-total-row ${settled ? 'due-settled' : 'due'}`}>
              <span>{settled ? 'Balance' : 'Balance due'}</span>
              <span className="mono">{formatMoney(balance)}</span>
            </div>
            <p className="inv-in-words">{amountInWords(invoice.total_paise)}</p>
          </div>
        </div>

        {/* ------------------------------------------------------------ footer */}
        <footer className="doc-foot">
          <div>
            <strong>{clinic.name ?? 'Clinic'}</strong>
            {clinic.address ? <span>{clinic.address}</span> : null}
            <span>{[clinic.phone, clinic.email].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="doc-foot-right">
            {clinic.gstin ? <span>GSTIN {clinic.gstin}</span> : null}
            <span>Invoice {invoice.number} · {formatDate(invoice.issued_on)}</span>
            <span className="doc-foot-fine">Computer-generated invoice · amounts in INR · retain for insurance claims</span>
          </div>
        </footer>

        {/* repeating footer for printed pages */}
        <div className="print-foot">
          <span>{clinic.name ?? 'Clinic'} · {[clinic.phone, clinic.email].filter(Boolean).join(' · ')}</span>
          <span>{invoice.number}</span>
        </div>
      </article>

      {/* ------------------------------------------------------- on-screen actions */}
      <div className="doc-actions no-print">
        <Card className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small muted">
            {settled ? 'Settled' : `${formatMoney(balance)} outstanding`} · issued {formatDate(invoice.issued_on)}
          </span>
          <span className="spacer" />
          {!settled && invoice.status !== 'void' ? (
            <Button size="sm" variant="primary" icon={HandCoins} onClick={() => setCollectOpen(true)}>Collect payment</Button>
          ) : null}
          <Button size="sm" variant="subtle" icon={ShieldCheck} onClick={() => navigate(`/app/patients/${invoice.patient_id}`)}>Patient chart</Button>
        </Card>
      </div>

      <MessageSheet
        open={msgOpen}
        onClose={() => setMsgOpen(false)}
        patient={patient}
        message={message}
      />

      <CollectPayment
        invoice={invoice}
        open={collectOpen}
        onClose={() => setCollectOpen(false)}
        onDone={() => setCollectOpen(false)}
      />
    </div>
  );
}
