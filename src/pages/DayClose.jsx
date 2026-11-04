import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle, ArrowRight, Banknote, CalendarDays, CheckCircle2, ClipboardCopy,
  CreditCard, Download, IndianRupee, Lock, LockOpen, Receipt, RotateCcw, Sun,
  TrendingUp, Users, Wallet,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import {
  useToast, Badge, Button, Card, CardHead, EmptyState, Field, Input, Kpi, StatRow, Textarea,
} from '../components/ui.jsx';
import {
  closeFor, closeSnapshot, closeSummary, closeVariance, collectionsFor, dayTotals,
  isClosed, missedCharges,
} from '../lib/daybook.mjs';
import {
  downloadFile, formatDate, formatMoney, moneyToPaise, paiseToInput, relativeDay, toCSV, today,
} from '../lib/logic.mjs';
import { can } from '../lib/permissions.js';

// Day sheets are read in whole rupees: a stray paise in a drawer total reads as
// a mistake, and the precise figure is still on every invoice.
const amount = (paise) => formatMoney(Math.round((Number(paise) || 0) / 100) * 100);

export default function DayClose() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const t = today();
  const [iso, setIso] = useState(t);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const dayCloses = store.day_closes ?? [];
  const canClose = can(store.role ?? 'owner', 'invoice:collect');

  const canReadConsults = can(store.role ?? 'owner', 'consultation:read');
  const totals = useMemo(() => dayTotals({
    invoices: store.invoices, consultations: store.consultations,
    patients: store.patients, appointments: store.appointments, iso,
    canSeeConsultations: canReadConsults,
  }), [store.invoices, store.consultations, store.patients, store.appointments, iso, canReadConsults]);

  const leaks = useMemo(() => missedCharges({
    appointments: store.appointments, consultations: store.consultations,
    invoices: store.invoices, patients: store.patients, doctors: store.doctors,
    clinic: store.clinic, iso,
  }), [store.appointments, store.consultations, store.invoices, store.patients, store.doctors, store.clinic, iso]);

  const existing = closeFor(dayCloses, iso);
  const closed = isClosed(existing);
  const personality = store.currentStaff?.full_name ?? 'the front desk';

  // A day that has been closed shows what was closed, not what the numbers are
  // now — the snapshot is the record.
  useEffect(() => {
    if (existing) {
      setCounted(existing.counted_cash_paise === null || existing.counted_cash_paise === undefined
        ? '' : paiseToInput(existing.counted_cash_paise));
      setNote(existing.note ?? '');
    } else {
      setCounted('');
      setNote('');
    }
  }, [iso, existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const countedPaise = (() => {
    if (String(counted).trim() === '') return null;
    try { return moneyToPaise(counted); } catch { return null; }
  })();
  const variance = closeVariance({ expectedPaise: totals.cash, countedPaise });

  const visibleLeaks = showAll ? leaks.items : leaks.items.slice(0, 6);
  const money = collectionsFor({ invoices: store.invoices, iso });

  async function closeDay() {
    if (!canClose) return;
    setBusy(true);
    const snapshot = closeSnapshot({
      totals, variance, note, closedBy: store.currentStaff?.id ?? null,
    });
    try {
      if (existing) {
        await store.update('day_closes', existing.id, {
          ...snapshot, status: 'closed', closed_at: new Date().toISOString(),
        });
        toast.success(`${formatDate(iso, { weekday: true })} updated.`);
      } else {
        await store.create('day_closes', {
          closed_on: iso, ...snapshot, status: 'closed',
          closed_at: new Date().toISOString(),
        });
        toast.success(`${formatDate(iso, { weekday: true })} closed — ${amount(totals.collected)} collected.`);
      }
    } catch (e) {
      toast.error(e.message ?? 'Could not close the day.');
    } finally {
      setBusy(false);
    }
  }

  async function reopenDay() {
    if (!existing) return;
    setBusy(true);
    try {
      await store.update('day_closes', existing.id, { status: 'reopened' });
      toast.success('Reopened — close it again when the drawer is right.');
    } catch (e) {
      toast.error(e.message ?? 'Could not reopen the day.');
    } finally {
      setBusy(false);
    }
  }

  function copySummary() {
    const text = closeSummary({ clinic: store.clinic, totals, variance, note, closedAt: existing?.closed_at });
    navigator.clipboard?.writeText(text)
      .then(() => toast.success('Day sheet copied — paste it into the clinic group.'))
      .catch(() => toast.error('Clipboard blocked by the browser.'));
  }

  function exportSheet() {
    const rows = totals.byMethod.rows.map((r) => ({ ...r }));
    const csv = toCSV(rows, [
      { label: 'Method', key: 'label' },
      { label: 'Payments', key: 'count' },
      { label: 'Amount', value: (r) => (r.amount / 100).toFixed(2) },
    ]);
    const footer = [
      '',
      `Day,${iso}`,
      `Visits,${totals.visits}`,
      `New patients,${totals.newPatients}`,
      `Billed,${(totals.billed / 100).toFixed(2)}`,
      `Collected,${(totals.collected / 100).toFixed(2)}`,
      `Cash expected,${(variance.expected / 100).toFixed(2)}`,
      `Cash counted,${variance.counted === null ? '' : (variance.counted / 100).toFixed(2)}`,
      `Variance,${variance.variance === null ? '' : (variance.variance / 100).toFixed(2)}`,
      `Note,"${String(note).replace(/"/g, '""')}"`,
    ].join('\n');
    downloadFile(`myclinic-day-close-${iso}.csv`, `${csv}\n${footer}`);
    toast.success('Day sheet exported.');
  }

  const Action = ({ item }) => (
    <Button
      size="sm" variant="subtle" icon={ArrowRight}
      onClick={() => {
        if (item.invoice_id) navigate(`/invoice/${item.invoice_id}`);
        else navigate(`/app/billing?new=1&patient=${item.patient_id}`);
      }}
    >
      {item.action === 'collect' ? 'Collect' : 'Bill'}
    </Button>
  );

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2>Day close</h2>
          <div className="sub">
            {relativeDay(iso) === 'Today' ? 'Today' : formatDate(iso, { weekday: true })} ·{' '}
            {closed ? `closed at ${new Date(existing.closed_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : 'counting the drawer'}
          </div>
        </div>
        <Field label="Day" className="day-picker">
          <Input type="date" value={iso} max={t} onChange={(e) => setIso(e.target.value || t)} aria-label="Day to close" />
        </Field>
        <Button variant="subtle" icon={ClipboardCopy} onClick={copySummary}>Copy sheet</Button>
        <Button variant="subtle" icon={Download} onClick={exportSheet}>Export</Button>
      </div>

      {store.mode === 'live' && store.schemaReady === false ? (
        <Card className="pad" style={{ borderColor: 'var(--warn, #b45309)' }}>
          <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <AlertTriangle size={16} style={{ marginTop: 2, color: 'var(--warn, #b45309)' }} />
            <div>
              <strong className="small">The database is one migration behind.</strong>
              <p className="tiny muted" style={{ margin: '3px 0 0' }}>
                Day close and the reminder log need schema 7. Run <code>supabase/schema.sql</code> in the
                Supabase SQL editor — it is additive and safe to re-run. Everything else keeps working meanwhile.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid kpis kpi-compactable">
        <Kpi label="Collected" value={amount(totals.collected)} icon={IndianRupee} meta={`${money.count} payments · ${money.average ? `${amount(money.average)} average` : 'none yet'}`} accent />
        <Kpi label="Cash in drawer" value={amount(totals.cash)} icon={Banknote} meta={variance.state === 'uncounted' ? 'not counted yet' : variance.label} />
        <Kpi label="Billed" value={amount(totals.billed)} icon={Receipt} meta={`${totals.invoices} invoices`} />
        <Kpi label="Still owed" value={amount(totals.dues)} icon={Wallet} meta={`${totals.duesCount} open bills · ${amount(totals.balanceToday)} from today`} />
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead
              title="Money in" icon={CreditCard}
              sub={`Payments recorded on ${formatDate(iso, { weekday: true })} — including part payments on older bills`}
              action={<Badge tone={money.total ? 'success' : 'neutral'}>{amount(money.total)}</Badge>}
            />
            <div className="card-body" style={{ paddingTop: 6 }}>
              {money.used.length ? (
                <div className="table-wrap">
                  <table className="data compact">
                    <thead>
                      <tr><th>Method</th><th className="num">Payments</th><th className="num">Amount</th></tr>
                    </thead>
                    <tbody>
                      {money.rows.map((row) => (
                        <tr key={row.method} style={{ opacity: row.count ? 1 : 0.45 }}>
                          <td><strong className="small">{row.label}</strong></td>
                          <td className="num mono small">{row.count}</td>
                          <td className="num mono small">{amount(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td>
                        <td className="num mono small"><strong>{money.count}</strong></td>
                        <td className="num mono small"><strong>{amount(money.total)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                  <p className="tiny faint" style={{ margin: '8px 0 0' }}>
                    An invoice carries the date of the last payment taken on it, so a part payment
                    collected today counts here even when the bill was raised earlier.
                  </p>
                </div>
              ) : (
                <EmptyState
                  icon={IndianRupee} title="No money recorded for this day"
                  description="Invoices raised and payments collected appear here as the desk records them."
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHead
              title="Missed charges" icon={AlertTriangle}
              sub="Seen but never billed, billed but never paid, and dues that are running late"
              action={<Badge tone={leaks.clean ? 'success' : 'danger'}>{leaks.items.length ? `${leaks.items.length} to fix` : 'Nothing open'}</Badge>}
            />
            <div className="card-body" style={{ paddingTop: 6 }}>
              {leaks.items.length ? (
                <>
                  {leaks.totals.leaks ? (
                    <div className="notice warn leak-summary">
                      <strong className="small">{leaks.totals.leaks} visit{leaks.totals.leaks === 1 ? '' : 's'} with no bill</strong>
                      <span className="tiny">{amount(leaks.totals.leakValue)} of work is not on any invoice.</span>
                    </div>
                  ) : null}
                  <div className="leak-list">
                    {visibleLeaks.map((item) => (
                      <div key={item.key} className="list-item" style={{ cursor: 'default' }}>
                        <span className={`leak-dot ${item.tone}`} aria-hidden="true" />
                        <div className="li-main">
                          <span className="li-title">{item.patient_name}</span>
                          <span className="li-sub">{item.label} · {item.hint}</span>
                        </div>
                        <span className="mono small">{amount(item.amount)}</span>
                        <div className="row-actions no-print"><Action item={item} /></div>
                      </div>
                    ))}
                  </div>
                  {leaks.items.length > 6 ? (
                    <button className="btn ghost block list-more" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Show fewer' : `Show ${leaks.items.length - 6} more`}
                    </button>
                  ) : null}
                  {leaks.totals.staleCount > leaks.staleDues.length ? (
                    <button className="btn ghost block list-more" onClick={() => navigate('/app/billing')}>
                      {leaks.totals.staleCount - leaks.staleDues.length} more bills overdue · {amount(leaks.totals.staleValue)} in all
                    </button>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  icon={CheckCircle2}
                  title={totals.visits || totals.invoices ? 'Every visit is on a bill' : `Nothing to fix on ${formatDate(iso, { withYear: false })}`}
                  description={totals.visits || totals.invoices
                    ? 'Nothing was seen without a charge and no bill from this day is still open. Dues older than a week would appear here too.'
                    : 'No visits, no bills and nothing owed from this day. Dues older than a week would appear here too.'}
                />
              )}
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead
              title={closed ? 'Closed' : 'Reconcile & close'} icon={closed ? Lock : LockOpen}
              sub={closed ? 'The snapshot below is what was closed. Reopen to amend it.' : 'Count the cash, note the difference, close the day'}
              action={closed ? <Badge tone="success">Closed</Badge> : existing ? <Badge tone="warn">Reopened</Badge> : null}
            />
            <div className="card-body stack" style={{ gap: 12 }}>
              <StatRow items={[
                { label: 'Cash expected', value: amount(variance.expected) },
                { label: 'Cash counted', value: variance.counted === null ? '—' : amount(variance.counted) },
                { label: 'Difference', value: variance.variance === null ? '—' : `${variance.variance > 0 ? '+' : ''}${amount(variance.variance)}` },
              ]} />

              {closed ? (
                <div className="notice success">
                  <strong className="small">Closed {relativeDay(iso) === 'Today' ? 'today' : 'that day'} at {new Date(existing.closed_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</strong>
                  <span className="tiny">
                    {existing.counted_cash_paise === null
                      ? 'Cash was not counted.'
                      : `Cash counted ${amount(existing.counted_cash_paise)} against ${amount(existing.expected_cash_paise)} expected — ${closeVariance({ expectedPaise: existing.expected_cash_paise, countedPaise: existing.counted_cash_paise }).label}.`}
                  </span>
                  {existing.note ? <span className="tiny muted">“{existing.note}”</span> : null}
                  <span className="tiny faint">
                    {amount(existing.totals?.collected ?? 0)} collected · {existing.totals?.visits ?? 0} visits ·{' '}
                    {existing.totals?.invoices ?? 0} invoices
                  </span>
                </div>
              ) : null}

              {!closed ? (
                <>
                  <Field label="Cash counted in the drawer" hint={`Expected ${amount(variance.expected)}. Leave blank if you are not counting today.`}>
                    <div className="row" style={{ gap: 8 }}>
                      <Input
                        inputMode="decimal" placeholder="0"
                        value={counted} onChange={(e) => setCounted(e.target.value)}
                        aria-label="Cash counted"
                      />
                      <Button
                        variant="ghost" size="sm" type="button"
                        onClick={() => setCounted(paiseToInput(variance.expected))}
                      >
                        Same as expected
                      </Button>
                    </div>
                  </Field>
                  <div className={`variance-chip ${variance.state}`}>
                    <span className="tiny">{variance.state === 'uncounted' ? 'Cash not counted' : variance.label}</span>
                    {variance.variance !== null ? (
                      <strong className="mono small">{variance.variance > 0 ? '+' : ''}{amount(variance.variance)}</strong>
                    ) : null}
                  </div>
                  <Field label="Note for the day" hint="Shown on the closed sheet — for example a late card settlement.">
                    <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                  </Field>
                  <Button variant="primary" block icon={CheckCircle2} loading={busy} disabled={!canClose} onClick={closeDay}>
                    {existing ? 'Update the close' : `Close ${relativeDay(iso) === 'Today' ? 'today' : formatDate(iso, { withYear: false })}`}
                  </Button>
                  {!canClose ? <p className="tiny faint">Only an owner or the front desk can close the day.</p> : null}
                  <p className="tiny faint" style={{ margin: 0 }}>
                    Closing stores a snapshot: these figures stay as they are even after tomorrow's invoices arrive.
                  </p>
                </>
              ) : (
                <Button variant="subtle" block icon={RotateCcw} loading={busy} disabled={!canClose} onClick={reopenDay}>
                  Reopen the day
                </Button>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="The day at a glance" icon={CalendarDays} sub="People through the door" />
            <div className="card-body" style={{ paddingTop: 6 }}>
              <div className="day-figures">
                <Figure icon={Users} label="Visits" value={totals.visits} />
                <Figure icon={Sun} label="New patients" value={totals.newPatients} />
                <Figure icon={CalendarDays} label="Appointments" value={totals.appointments} />
                <Figure icon={TrendingUp} label="No shows" value={totals.noShows} />
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                {totals.seen} of {totals.appointments} appointments were completed
                {totals.cancelled ? `, ${totals.cancelled} cancelled` : ''}. Average payment{' '}
                {money.average ? amount(money.average) : '—'}.
              </p>
            </div>
          </Card>

          <Card>
            <CardHead title="Cash vs bank" icon={Banknote} sub="What to deposit tomorrow" />
            <div className="card-body" style={{ paddingTop: 6 }}>
              {money.used.length ? money.used.filter((r) => r.method !== 'cash').length ? (
                money.used.filter((r) => r.method !== 'cash').map((row) => (
                  <div key={row.method} className="row small" style={{ padding: '5px 0', justifyContent: 'space-between' }}>
                    <span className="muted">{row.label} settled</span>
                    <span className="mono">{amount(row.amount)}</span>
                  </div>
                ))
              ) : <p className="small muted">Everything came in as cash today.</p> : <p className="small muted">Nothing collected yet.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Figure({ icon: Icon, label, value }) {
  return (
    <div className="day-figure">
      <span className="kpi-icon"><Icon size={14} /></span>
      <strong className="mono">{value}</strong>
      <span className="tiny muted">{label}</span>
    </div>
  );
}
