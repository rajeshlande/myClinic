import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Printer, Download, CheckCircle2, HandCoins } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Badge, Button, Card, EmptyState } from '../components/ui.jsx';
import {
  PAYMENT_METHODS, downloadFile, formatDate, formatMoney, invoiceBalance, invoiceStatus,
  toCSV, today,
} from '../lib/logic.mjs';
import { DocumentHeader } from '../components/Branding.jsx';
import { logoOnDocuments } from '../lib/branding.mjs';

export default function InvoiceView() {
  useEffect(() => {
    document.body.dataset.printview = 'true';
    return () => { delete document.body.dataset.printview; };
  }, []);

  const { id } = useParams();
  const store = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const invoice = store.invoices.find((i) => i.id === id);

  if (!invoice) {
    return <div className="page"><Card><div className="card-body"><EmptyState icon={Printer} title="Invoice not found" description="It may belong to another clinic." action={<Button variant="primary" onClick={() => navigate('/app/billing')}>Back to billing</Button>} /></div></Card></div>;
  }

  const patient = store.patients.find((p) => p.id === invoice.patient_id);
  const doctor = store.doctors.find((d) => d.id === invoice.doctor_id);
  const clinic = store.clinic ?? {};
  const meta = invoiceStatus(invoice);

  const exportPdfHint = () => {
    toast.info('Use your browser’s “Save as PDF” in the print dialog.');
    setTimeout(() => window.print(), 300);
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

  return (
    <div style={{ minHeight: '100dvh', padding: 'clamp(12px, 3vw, 32px)' }}>
      <div className="no-print" style={{ maxWidth: 860, margin: '0 auto 14px' }} >
        <div className="row wrap" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => navigate('/app/billing')}>Billing</Button>
          <span className="spacer" />
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <Button size="sm" variant="subtle" icon={Download} onClick={exportCsv}>CSV</Button>
          <Button size="sm" variant="primary" icon={Printer} onClick={exportPdfHint}>Print / PDF</Button>
        </div>
      </div>

      <div className="print-sheet card" style={{ maxWidth: 860, margin: '0 auto', padding: 'clamp(18px, 3vw, 38px)' }}>
        <DocumentHeader
          clinic={clinic}
          logo={logoOnDocuments(clinic)}
          accent={clinic.brand_color}
          right={(
            <div style={{ textAlign: 'right', minWidth: 190 }}>
              <div style={{ fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5a6b66', fontWeight: 700 }}>Tax invoice</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 800, marginTop: 2 }}>{invoice.number}</div>
              <div style={{ fontSize: '0.78rem', color: '#5a6b66' }}>{formatDate(invoice.issued_on)}</div>
            </div>
          )}
        />

        <div className="row wrap" style={{ gap: 26, margin: '16px 0' }}>
          <div style={{ flex: 1, minWidth: 210 }}>
            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7b8b86', fontWeight: 700 }}>Billed to</div>
            <div style={{ fontWeight: 700, marginTop: 3 }}>{patient?.full_name ?? 'Patient'}</div>
            <div style={{ fontSize: '0.78rem', color: '#5a6b66', lineHeight: 1.6 }}>
              {patient?.code}{patient?.phone ? ` · ${patient.phone}` : ''}<br />
              {patient?.address || patient?.city || ''}
            </div>
          </div>
          <div style={{ minWidth: 190 }}>
            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7b8b86', fontWeight: 700 }}>Consulting doctor</div>
            <div style={{ fontWeight: 700, marginTop: 3 }}>{doctor?.full_name ?? '—'}</div>
            <div style={{ fontSize: '0.78rem', color: '#5a6b66', lineHeight: 1.6 }}>
              {doctor?.qualification ?? ''}<br />
              {doctor?.registration_no ? `Reg. ${doctor.registration_no}` : ''}
            </div>
          </div>
        </div>

        <div className="doc-table-wrap">
        <table>
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
                  <div style={{ fontWeight: 600 }}>{line.name}</div>
                  <div style={{ fontSize: '0.72rem', color: '#7b8b86' }}>{line.category}</div>
                </td>
                <td className="num">{line.qty}</td>
                <td className="num">{formatMoney(line.rate_paise)}</td>
                <td className="num">{line.discount ? formatMoney(line.discount) : '—'}</td>
                <td className="num">{line.tax_rate ? `${line.tax_rate}%` : '—'}</td>
                <td className="num" style={{ fontWeight: 600 }}>{formatMoney(line.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <div style={{ minWidth: 260, width: 'min(320px, 100%)' }}>
            {[
              ['Subtotal', invoice.subtotal_paise],
              ...(invoice.discount_paise ? [['Discount', -invoice.discount_paise]] : []),
              ...(invoice.tax_paise ? [['GST', invoice.tax_paise]] : []),
            ].map(([label, value]) => (
              <div key={label} className="row" style={{ fontSize: '0.84rem', padding: '3px 0', color: '#5a6b66' }}>
                <span>{label}</span><span className="spacer" />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value < 0 ? '−' : ''}{formatMoney(Math.abs(value))}</span>
              </div>
            ))}
            <div className="row" style={{ borderTop: '1px solid #dfe8e4', marginTop: 6, paddingTop: 8 }}>
              <strong>Total</strong><span className="spacer" />
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>{formatMoney(invoice.total_paise)}</strong>
            </div>
            <div className="row" style={{ fontSize: '0.84rem', padding: '3px 0', color: '#5a6b66' }}>
              <span>Paid · {PAYMENT_METHODS.find((m) => m.id === invoice.method)?.label ?? invoice.method}</span><span className="spacer" />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(invoice.paid_paise)}</span>
            </div>
            {invoiceBalance(invoice) > 0 ? (
              <div className="row" style={{ fontSize: '0.88rem', color: '#b23b4e', fontWeight: 700 }}>
                <span>Balance due</span><span className="spacer" /><span>{formatMoney(invoiceBalance(invoice))}</span>
              </div>
            ) : (
              <div className="row" style={{ gap: 6, color: '#0f7d63', fontSize: '0.82rem', fontWeight: 700 }}>
                <CheckCircle2 size={13} /> Paid in full — thank you
              </div>
            )}
          </div>
        </div>

        {invoice.notes ? <p style={{ marginTop: 18, fontSize: '0.78rem', color: '#5a6b66' }}><strong>Notes:</strong> {invoice.notes}</p> : null}

        <div style={{ marginTop: 22, borderTop: '1px solid #eef3f1', paddingTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between', fontSize: '0.7rem', color: '#7b8b86' }}>
          <span>Computer-generated invoice · myClinic</span>
          <span>Amounts in INR. Retain this invoice for insurance claims.</span>
        </div>
      </div>

      <div className="no-print" style={{ maxWidth: 860, margin: '14px auto 0' }}>
        <Card className="pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small muted">Recorded {formatDate(invoice.issued_on)} · generated by {clinic.name}</span>
          <span className="spacer" />
          {invoiceBalance(invoice) > 0 ? <Button size="sm" variant="primary" icon={HandCoins} onClick={() => navigate('/app/billing')}>Collect balance</Button> : null}
          <Button size="sm" variant="subtle" onClick={() => navigate(`/app/patients/${invoice.patient_id}`)}>Open patient chart</Button>
        </Card>
      </div>
    </div>
  );
}
