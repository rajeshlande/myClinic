import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  CreditCard, Download, IndianRupee, Plus, Wallet, Search, ChevronRight, HandCoins, FileText, Receipt, TrendingUp,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Avatar, Badge, Button, Card, CardHead, EmptyState, Kpi, SearchInput, Select, Tabs } from '../components/ui.jsx';
import CollectPayment from '../components/CollectPayment.jsx';
import InvoiceForm from '../components/InvoiceForm.jsx';
import {
  PAYMENT_METHODS, currentMonth, downloadFile, formatDate, formatMoney, invoiceBalance, invoiceStatus,
  monthLabel, sumBy, toCSV, today,
} from '../lib/logic.mjs';

export default function Billing() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState('all');
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState(null);
  const [payFor, setPayFor] = useState(null);
  // Long lists are paged: 80 invoice rows is a 10,000px column on a phone.
  const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches ? 12 : 80);
  const [shown, setShown] = useState(pageSize);
  const presetPatient = store.patients.find((p) => p.id === params.get('patient')) ?? null;

  // React Router reuses the component when only the query string changes, so this
  // must react to the parameter instead of running once on mount.
  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const patientOf = (id) => store.patients.find((p) => p.id === id);
  const doctorOf = (id) => store.doctors.find((d) => d.id === id);
  const month = currentMonth();

  const monthInvoices = useMemo(() => store.invoices.filter((i) => i.status !== 'void' && i.issued_on.startsWith(month)), [store.invoices, month]);
  const billed = sumBy(monthInvoices, (i) => i.total_paise);
  const collected = sumBy(monthInvoices, (i) => i.paid_paise);
  const outstanding = useMemo(() => store.invoices.filter((i) => i.status !== 'void').reduce((s, i) => s + invoiceBalance(i), 0), [store.invoices]);
  const collectedToday = sumBy(store.invoices.filter((i) => i.issued_on === today() && i.status !== 'void'), (i) => i.paid_paise);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.invoices
      .filter((i) => {
        if (tab === 'unpaid') return invoiceBalance(i) > 0 && i.status !== 'void';
        if (tab === 'paid') return i.status === 'paid';
        if (tab === 'today') return i.issued_on === today();
        if (tab === 'month') return i.issued_on.startsWith(month);
        return true;
      })
      .filter((i) => method === 'all' || i.method === method)
      .filter((i) => {
        if (!q) return true;
        const patient = patientOf(i.patient_id);
        return [i.number, patient?.full_name, patient?.phone, patient?.code].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => `${b.issued_on}${b.created_at ?? ''}`.localeCompare(`${a.issued_on}${a.created_at ?? ''}`));
  }, [store.invoices, tab, method, query, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    const csv = toCSV(rows, [
      { label: 'Invoice', key: 'number' },
      { label: 'Date', key: 'issued_on' },
      { label: 'Patient', value: (i) => patientOf(i.patient_id)?.full_name ?? '' },
      { label: 'Patient ID', value: (i) => patientOf(i.patient_id)?.code ?? '' },
      { label: 'Doctor', value: (i) => doctorOf(i.doctor_id)?.full_name ?? '' },
      { label: 'Charges', value: (i) => (i.lines ?? []).map((l) => `${l.name} x${l.qty}`).join('; ') },
      { label: 'Total', value: (i) => (Number(i.total_paise) / 100).toFixed(2) },
      { label: 'Paid', value: (i) => (Number(i.paid_paise) / 100).toFixed(2) },
      { label: 'Balance', value: (i) => (invoiceBalance(i) / 100).toFixed(2) },
      { label: 'Method', key: 'method' },
      { label: 'Status', key: 'status' },
    ]);
    downloadFile(`myclinic-invoices-${today()}.csv`, csv);
    toast.success(`${rows.length} invoices exported.`);
  };

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2>Billing &amp; collections</h2>
          <div className="sub">{monthLabel(month)} · {store.branchScopeLabel ?? 'Main branch'} · {store.invoices.length} invoices in this view</div>
        </div>
        <Button variant="subtle" icon={Download} onClick={exportCsv}>Export</Button>
        <Button variant="primary" icon={Plus} onClick={() => { setEditing(null); setFormOpen(true); }}>New invoice</Button>
      </div>
      <div className="grid kpis kpi-compactable">
        <Kpi label="Collected today" value={formatMoney(collectedToday)} icon={IndianRupee} meta={`${monthLabel(month)} · ${formatMoney(collected, { compact: true })}`} accent />
        <Kpi label="Billed this month" value={formatMoney(billed, { compact: billed >= 100000 })} icon={Receipt} meta={`${monthInvoices.length} invoices`} />
        <Kpi label="Outstanding" value={formatMoney(outstanding, { compact: outstanding >= 100000 })} icon={Wallet} meta={`${store.invoices.filter((i) => invoiceBalance(i) > 0).length} open`} />
        <Kpi label="Average ticket" value={formatMoney(monthInvoices.length ? Math.round(billed / monthInvoices.length) : 0)} icon={TrendingUp} meta="per invoice this month" />
      </div>

      <div className="row wrap page-titlebar" style={{ gap: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}><SearchInput value={query} onChange={setQuery} placeholder="Search invoice number or patient" /></div>
        <Select value={method} onChange={(e) => setMethod(e.target.value)} style={{ maxWidth: 170 }} aria-label="Payment method">
          <option value="all">All methods</option>
          {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
      </div>

      <Tabs
        value={tab} onChange={setTab}
        tabs={[
          { value: 'all', label: 'All invoices', count: store.invoices.length },
          { value: 'unpaid', label: 'Unpaid', count: store.invoices.filter((i) => invoiceBalance(i) > 0 && i.status !== 'void').length },
          { value: 'paid', label: 'Paid' },
          { value: 'today', label: 'Today' },
          { value: 'month', label: 'This month' },
        ]}
      />

      <Card>
        <CardHead title={`${rows.length} invoice${rows.length === 1 ? '' : 's'}`} sub={`${formatMoney(sumBy(rows, (i) => i.total_paise))} billed · ${formatMoney(sumBy(rows, (i) => i.paid_paise))} received`} icon={CreditCard}
          action={<Badge tone="brand">{formatMoney(rows.reduce((s, i) => s + invoiceBalance(i), 0), { compact: true })} due</Badge>} />
        <div className="card-body" style={{ paddingTop: 8 }}>
          {rows.length ? rows.slice(0, shown).map((inv) => {
            const patient = patientOf(inv.patient_id);
            const meta = invoiceStatus(inv);
            return (
              <div key={inv.id} className="list-item invoice-row" style={{ cursor: 'default' }}>
                <button className="invoice-main" onClick={() => navigate(`/invoice/${inv.id}`)}>
                  <Avatar name={patient?.full_name ?? 'Patient'} size="sm" />
                  <span className="li-main">
                    <span className="li-title mono">{inv.number}</span>
                    <span className="li-sub">{patient?.full_name ?? 'Patient'} · {formatDate(inv.issued_on)} · {PAYMENT_METHODS.find((m) => m.id === inv.method)?.label ?? inv.method}</span>
                  </span>
                </button>
                <span className="invoice-meta">
                  <span className="strong mono small">{formatMoney(inv.total_paise)}</span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <button className="icon-btn plain sm invoice-open" aria-label="Open invoice" onClick={() => navigate(`/invoice/${inv.id}`)}><ChevronRight size={15} /></button>
                </span>
                <div className="invoice-actions no-print">
                  {invoiceBalance(inv) > 0 ? <Button size="sm" variant="subtle" icon={HandCoins} onClick={() => setPayFor(inv)}>Collect</Button> : null}
                </div>
              </div>
            );
          }) : (
            <EmptyState icon={FileText} title="No invoices here" description="Raise an invoice from a consultation or directly from this screen."
              action={<Button size="sm" variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>New invoice</Button>} />
          )}
          {rows.length > shown ? (
            <div className="list-more">
              <Button variant="subtle" onClick={() => setShown((n) => n + pageSize())}>Show {Math.min(pageSize(), rows.length - shown)} more</Button>
              <span className="tiny faint">{rows.length - shown} left of {rows.length}</span>
            </div>
          ) : null}
        </div>
      </Card>

      <InvoiceForm
        open={formOpen}
        invoice={editing}
        patient={presetPatient}
        onClose={() => { setFormOpen(false); if (params.get('patient')) { params.delete('patient'); params.delete('new'); setParams(params, { replace: true }); } }}
        onCreated={(created) => {
          // A brand-new invoice opens as a document: QR, totals and the collect
          // button are all there, which is where the conversation continues.
          if (created?.id && !editing) navigate(`/invoice/${created.id}`);
          setEditing(null);
        }}
      />
      <CollectPayment
        invoice={payFor}
        open={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        onDone={() => setPayFor(null)}
      />
    </div>
  );
}
