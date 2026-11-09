import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BarChart3, Download, IndianRupee, Stethoscope, TrendingUp, Users, Wallet, CreditCard,
  CalendarRange, ArrowUpRight, PieChart, Activity, Printer,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { can } from '../lib/permissions.js';
import { useToast, Badge, Button, Card, CardHead, Kpi, Select } from '../components/ui.jsx';
import { TrendChart, BarList, Donut, Columns } from '../components/Charts.jsx';
import {
  categoryRevenue, currentMonth, doctorPerformance, downloadFile, footfallSeries, formatMoney,
  monthLabel, monthTotals, payerMix, revenueSeries, shiftMonth, sumBy, toCSV, today,
  topDiagnoses, recentMonths, occupancy, inMonth, PAYMENT_METHODS,
} from '../lib/logic.mjs';
import { leadSourceMix } from '../lib/public-booking.mjs';

export default function Reports() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const [doctorId, setDoctorId] = useState('all');

  // Both halves of the clinic may open this page (the desk needs the money, the
  // doctor needs the work). Each sees only their half — the same split schema 10
  // enforces on the tables behind it.
  const role = store.role ?? 'owner';
  const canReadConsults = can(role, 'consultation:read');
  const canSeeMoney = can(role, 'clinic:reports:money');

  const totals = useMemo(() => monthTotals({
    invoices: canSeeMoney ? store.invoices : [],
    consultations: store.consultations, patients: store.patients, appointments: store.appointments,
    month, canSeeConsultations: canReadConsults,
  }), [store.invoices, store.consultations, store.patients, store.appointments, month, canSeeMoney, canReadConsults]);
  const prev = useMemo(() => monthTotals({
    invoices: canSeeMoney ? store.invoices : [],
    consultations: store.consultations, patients: store.patients, appointments: store.appointments,
    month: shiftMonth(month, -1), canSeeConsultations: canReadConsults,
  }), [store.invoices, store.consultations, store.patients, store.appointments, month, canSeeMoney, canReadConsults]);
  const rev = useMemo(() => revenueSeries({ invoices: store.invoices, month, count: 6 }), [store.invoices, month]);
  const foot = useMemo(() => footfallSeries({
    consultations: store.consultations, appointments: store.appointments, month, count: 6,
    canSeeConsultations: canReadConsults,
  }), [store.consultations, store.appointments, month, canReadConsults]);

  const monthInvoices = useMemo(() => inMonth(store.invoices.filter((i) => i.status !== 'void'), month, 'issued_on').filter((i) => doctorId === 'all' || i.doctor_id === doctorId), [store.invoices, month, doctorId]);
  const monthConsults = useMemo(() => inMonth(store.consultations, month).filter((c) => doctorId === 'all' || c.doctor_id === doctorId), [store.consultations, month, doctorId]);

  const cats = useMemo(() => categoryRevenue({ invoices: monthInvoices, month }), [monthInvoices, month]);
  const payers = useMemo(() => payerMix({ invoices: monthInvoices, month }), [monthInvoices, month]);
  const performers = useMemo(() => doctorPerformance({ appointments: store.appointments, consultations: store.consultations, invoices: store.invoices, doctors: store.doctors, month }), [store.appointments, store.consultations, store.invoices, store.doctors, month]);
  const diagnoses = useMemo(() => topDiagnoses({ consultations: monthConsults, month, count: 6 }), [monthConsults, month]);
  // Where the diary came from — the online booking page writes source 'online'.
  const leadSources = useMemo(() => leadSourceMix({ appointments: store.appointments, month }), [store.appointments, month]);
  const onlineBookings = leadSources.find((s) => s.id === 'online')?.count ?? 0;
  const apptStats = useMemo(() => {
    const list = inMonth(store.appointments, month, 'scheduled_on');
    return {
      total: list.length,
      completed: list.filter((a) => a.status === 'completed').length,
      noShow: list.filter((a) => a.status === 'no-show').length,
      cancelled: list.filter((a) => a.status === 'cancelled').length,
    };
  }, [store.appointments, month]);

  const dailyCollection = useMemo(() => {
    const map = new Map();
    for (const inv of monthInvoices) map.set(inv.issued_on, (map.get(inv.issued_on) ?? 0) + Number(inv.paid_paise || 0));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [monthInvoices]);

  const delta = prev.collected ? Math.round(((totals.collected - prev.collected) / prev.collected) * 100) : 0;

  const exportMonthly = () => {
    const csv = toCSV(monthInvoices, [
      { label: 'Invoice', key: 'number' },
      { label: 'Date', key: 'issued_on' },
      { label: 'Patient', value: (i) => store.patients.find((p) => p.id === i.patient_id)?.full_name ?? '' },
      { label: 'Doctor', value: (i) => store.doctors.find((d) => d.id === i.doctor_id)?.full_name ?? '' },
      { label: 'Total', value: (i) => (Number(i.total_paise) / 100).toFixed(2) },
      { label: 'Paid', value: (i) => (Number(i.paid_paise) / 100).toFixed(2) },
      { label: 'Balance', value: (i) => ((Number(i.total_paise) - Number(i.paid_paise)) / 100).toFixed(2) },
      { label: 'Method', key: 'method' },
    ]);
    downloadFile(`myclinic-revenue-${month}.csv`, csv);
    toast.success('Monthly revenue exported.');
  };

  const occupancyToday = occupancy({ appointments: store.appointments, date: today(), doctors: store.doctors });

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="row wrap page-titlebar" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 1, flex: 1, minWidth: 180 }}>
          <span className="eyebrow">Reporting period</span>
          <strong style={{ fontSize: '0.95rem' }}>{monthLabel(month)}</strong>
        </div>
        <Select value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 170 }} aria-label="Month">
          {[...recentMonths(currentMonth(), 12)].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </Select>
        <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ maxWidth: 180 }} aria-label="Doctor">
          <option value="all">All doctors</option>
          {store.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </Select>
        <Button variant="subtle" icon={Download} onClick={exportMonthly}>Export</Button>
        <Button variant="primary" icon={Printer} onClick={() => window.print()}>Print</Button>
      </div>

      <div className="grid kpis kpi-compactable">
        {canSeeMoney ? (
          <>
            <Kpi label="Collected" value={formatMoney(totals.collected, { compact: totals.collected >= 100000 })} icon={IndianRupee}
              trend={prev.collected ? { dir: delta >= 0 ? 'up' : 'down', label: `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% on last month` } : null}
              meta={`${formatMoney(prev.collected, { compact: true })} last month`} accent />
            <Kpi label="Billed" value={formatMoney(totals.billed, { compact: totals.billed >= 100000 })} icon={CreditCard} meta={`${totals.invoices} invoices`} />
          </>
        ) : null}
        <Kpi label="Visits" value={totals.visits} icon={Stethoscope} meta={`${totals.newPatients} new patients`} />
        {canSeeMoney
          ? <Kpi label="Outstanding" value={formatMoney(totals.outstanding, { compact: totals.outstanding >= 100000 })} icon={Wallet} meta={`${apptStats.noShow} no-shows`} />
          : <Kpi label="No-shows" value={apptStats.noShow} icon={CalendarRange} meta={`${apptStats.total} booked`} />}
      </div>

      {canSeeMoney ? (
      <div className="split">
        <Card>
          <CardHead title="Revenue trend" sub="Six months · collected vs billed" icon={TrendingUp}
            action={<div className="legend"><span><i className="swatch" style={{ background: '#0f766e' }} />Collected</span><span><i className="swatch" style={{ background: '#a5d9d0' }} />Billed</span></div>} />
          <div className="card-body"><TrendChart series={rev} height={220} /></div>
        </Card>
        <Card>
          <CardHead title="Payer mix" sub={monthLabel(month)} icon={PieChart} />
          <div className="card-body">
            <Donut
              items={payers.map((p) => ({ label: PAYMENT_METHODS.find((m) => m.id === p.method)?.label ?? p.method, value: p.amount }))}
              centerValue={formatMoney(totals.collected, { compact: true })}
              centerLabel="collected"
              size={150}
            />
          </div>
        </Card>
      </div>
      ) : null}

      <div className="grid two" style={{ gap: 16 }}>
        {canSeeMoney ? (
        <Card>
          <CardHead title="Revenue by category" sub="Where the money comes from" icon={BarChart3} />
          <div className="card-body">
            <BarList items={cats.map((c) => ({ label: `${c.category} · ${Math.round(c.share * 100)}%`, value: c.amount }))} format={(v) => formatMoney(v, { compact: true })} />
          </div>
        </Card>
        ) : null}
        <Card>
          <CardHead title="Footfall" sub="Consultations per month" icon={Users} />
          <div className="card-body"><Columns series={foot} height={150} /></div>
        </Card>
      </div>

      {canReadConsults ? (
      <Card>
        <CardHead title="Doctor performance" sub={monthLabel(month)} icon={Stethoscope}
          action={<Badge tone="brand">{performers.reduce((s, d) => s + d.visits, 0)} total visits</Badge>} />
        <div className="card-body" style={{ paddingTop: 6 }}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th className="num">Appointments</th>
                  <th className="num">Visits</th>
                  <th className="num">No-shows</th>
                  <th className="num">Avg ticket</th>
                  <th className="num">Billed</th>
                  <th className="num">Collected</th>
                  <th className="num">Collected %</th>
                </tr>
              </thead>
              <tbody>
                {performers.filter((d) => d.role !== 'frontdesk').map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 3, background: d.color }} />
                        <div>
                          <div className="strong small">{d.full_name}</div>
                          <div className="tiny faint">{d.specialty}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{d.appointments}</td>
                    <td className="num">{d.visits}</td>
                    <td className="num">{d.noShows}</td>
                    <td className="num">{formatMoney(d.avgTicket)}</td>
                    <td className="num">{formatMoney(d.billed)}</td>
                    <td className="num">{formatMoney(d.collected)}</td>
                    <td className="num">{d.billed ? Math.round((d.collected / d.billed) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
      ) : null}

      <div className="grid" style={{ gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {canReadConsults ? (
        <Card>
          <CardHead title="Top diagnoses" sub="This month" icon={Activity} />
          <div className="card-body">
            {diagnoses.length ? <BarList items={diagnoses.map((d) => ({ label: d.diagnosis, value: d.visits }))} format={(v) => `${v} visits`} color="var(--violet)" /> : <p className="small muted">No diagnoses recorded.</p>}
          </div>
        </Card>
        ) : null}
        <Card>
          <CardHead title="Appointment outcome" sub={monthLabel(month)} icon={CalendarRange} />
          <div className="card-body">
            <BarList
              items={[
                { label: 'Completed', value: apptStats.completed, color: 'var(--success)' },
                { label: 'Booked ahead', value: Math.max(0, apptStats.total - apptStats.completed - apptStats.noShow - apptStats.cancelled), color: 'var(--info)' },
                { label: 'No-show', value: apptStats.noShow, color: 'var(--warn)' },
                { label: 'Cancelled', value: apptStats.cancelled, color: 'var(--danger)' },
              ]}
              format={(v) => `${v}`}
            />
            <p className="tiny faint" style={{ marginTop: 10 }}>{apptStats.total ? Math.round((apptStats.completed / apptStats.total) * 100) : 0}% completion rate</p>
          </div>
        </Card>
        <Card>
          <CardHead title="Where the diary comes from" sub={monthLabel(month)} icon={Users}
            action={onlineBookings ? <Badge tone="info">{onlineBookings} online</Badge> : null} />
          <div className="card-body">
            <BarList
              items={leadSources.map((s) => ({ label: s.label, value: s.count }))}
              format={(v) => `${v}`}
              color="var(--brand-500)"
            />
            <p className="tiny faint" style={{ marginTop: 10 }}>
              {apptStats.total
                ? `${Math.round(((leadSources.find((s) => s.id === 'online')?.share ?? 0) * 100))}% of this month's appointments came from the public booking page.`
                : 'No appointments in this month yet.'}
            </p>
          </div>
        </Card>
        <Card>
          <CardHead title="Today’s utilisation" sub="Booked vs capacity" icon={TrendingUp} />
          <div className="card-body">
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className="kpi-value mono" style={{ fontSize: '1.7rem' }}>{Math.round(occupancyToday.ratio * 100)}%</span>
              <span className="tiny muted">{occupancyToday.booked} of {occupancyToday.capacity} slots today</span>
            </div>
            <div className="progress" style={{ marginTop: 10, height: 9 }}><span style={{ width: `${occupancyToday.ratio * 100}%` }} /></div>
            <Button size="sm" variant="ghost" icon={ArrowUpRight} style={{ marginTop: 10 }} onClick={() => navigate('/app/appointments')}>Open calendar</Button>
          </div>
        </Card>
      </div>

      {canSeeMoney ? (
      <Card>
        <CardHead title="Daily collection" sub={`${dailyCollection.length} collecting day${dailyCollection.length === 1 ? '' : 's'} in ${monthLabel(month)}`} icon={Download}
          action={<Badge tone="success">{formatMoney(sumBy(monthInvoices, (i) => i.paid_paise))}</Badge>} />
        <div className="card-body" style={{ paddingTop: 6 }}>
          {dailyCollection.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Date</th><th className="num">Received</th><th className="num">Invoices</th></tr></thead>
                <tbody>
                  {dailyCollection.map(([date, amount]) => (
                    <tr key={date}>
                      <td>{new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                      <td className="num strong">{formatMoney(amount)}</td>
                      <td className="num">{monthInvoices.filter((i) => i.issued_on === date).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="small muted">No collections recorded for this month.</p>}
        </div>
      </Card>
      ) : null}
    </div>
  );
}
