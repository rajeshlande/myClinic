import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowUpRight, BellRing, CalendarPlus, CheckCircle2, ChevronRight, Clock, CreditCard,
  IndianRupee, LogIn, PlayCircle, Stethoscope, TrendingUp, UserPlus, Users, Wallet, AlertTriangle,
  Ticket, Volume2, Sunset,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { can } from '../lib/permissions.js';
import { useToast, Badge, Button, Card, CardHead, Kpi, EmptyState, Avatar, Modal } from '../components/ui.jsx';
import { TrendChart, BarList, Donut, WeekStrip, Columns } from '../components/Charts.jsx';
import AppointmentForm from '../components/AppointmentForm.jsx';
import TokenForm from '../components/TokenForm.jsx';
import PatientForm from '../components/PatientForm.jsx';
import ConsultationForm from '../components/ConsultationForm.jsx';
import {
  addDays, appointmentsForDate, categoryRevenue, currentMonth, formatMoney, formatTime,
  followUpDue, monthTotals, monthLabel, patientVisits, revenueSeries, relativeDay, statusMeta,
  today, doctorPerformance, footfallSeries, outstandingByPatient, shiftMonth, formatDate,
  queueBoard, tokenLabel, humanWait, waitedMinutes, averageWait,
} from '../lib/logic.mjs';

export default function Dashboard() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [apptOpen, setApptOpen] = useState(false);
  const [patientOpen, setPatientOpen] = useState(false);
  const [consultFor, setConsultFor] = useState(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const t = today();
  const month = currentMonth();

  // Who is looking decides what is on the page: a doctor sees the clinic's work,
  // the front desk sees its money. Both see today's diary.
  const role = store.role ?? 'owner';
  const canReadConsults = can(role, 'consultation:read');
  const canSeeMoney = can(role, 'clinic:reports:money');
  const canCollect = can(role, 'day:close');

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

  const todayAppts = useMemo(() => appointmentsForDate(store.appointments, t), [store.appointments, t]);
  const seenToday = todayAppts.filter((a) => a.status === 'completed').length;
  const queue = todayAppts.filter((a) => ['booked', 'checked-in', 'in-consult'].includes(a.status));
  const waited = todayAppts.filter((a) => a.status === 'checked-in');

  const collectedToday = useMemo(() => store.invoices.filter((i) => i.issued_on === t && i.status !== 'void').reduce((sum, i) => sum + Number(i.paid_paise || 0), 0), [store.invoices, t]);
  const dues = useMemo(() => [...outstandingByPatient(store.invoices).entries()].reduce((s, [, v]) => s + v, 0), [store.invoices]);
  const duesCount = useMemo(() => [...outstandingByPatient(store.invoices).values()].filter((v) => v > 0).length, [store.invoices]);

  const revSeries = useMemo(() => revenueSeries({ invoices: store.invoices, month, count: 6 }), [store.invoices, month]);
  const footfall = useMemo(() => footfallSeries({
    consultations: store.consultations, appointments: store.appointments, month, count: 6,
    canSeeConsultations: canReadConsults,
  }), [store.consultations, store.appointments, month, canReadConsults]);
  const cats = useMemo(() => categoryRevenue({ invoices: store.invoices, month }).slice(0, 5), [store.invoices, month]);
  const recalls = useMemo(() => followUpDue(store.consultations, { withinDays: 7 }).slice(0, 5), [store.consultations]);
  const performers = useMemo(() => doctorPerformance({ appointments: store.appointments, consultations: store.consultations, invoices: store.invoices, doctors: store.doctors, month }), [store.appointments, store.consultations, store.invoices, store.doctors, month]);

  const board = useMemo(() => queueBoard({ appointments: store.appointments, patients: store.patients, doctors: store.doctors, iso: t }), [store.appointments, store.patients, store.doctors, t]);
  const avgWait = useMemo(() => averageWait(store.consultations, store.appointments, t), [store.consultations, store.appointments, t]);
  const nextToken = useMemo(() => {
    const firstDoctor = board.rows[0];
    return firstDoctor ? tokenLabel(firstDoctor.nextToken) : 'T-01';
  }, [board]);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(t, i - 3);
    return {
      label: new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'narrow' }),
      value: store.appointments.filter((a) => a.scheduled_on === iso && a.status !== 'cancelled').length,
      today: iso === t,
    };
  }), [store.appointments, t]);

  const revenueDelta = prev.collected ? (totals.collected - prev.collected) / prev.collected : null;
  const collectedRate = totals.billed ? Math.round((totals.collected / totals.billed) * 100) : 0;
  const name = (store.profile?.full_name ?? 'Doctor').replace(/^Dr\.?\s*/i, '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  async function setStatus(appt, status, label) {
    try {
      await store.update('appointments', appt.id, { status });
      toast.success(`${store.patients.find((p) => p.id === appt.patient_id)?.full_name ?? 'Patient'} · ${label}`);
    } catch (e) { toast.error(e.message ?? 'Could not update the appointment.'); }
  }

  const patientOf = (id) => store.patients.find((p) => p.id === id);
  const doctorOf = (id) => store.doctors.find((d) => d.id === id);

  return (
    <div className="page stack" style={{ gap: 16 }}>
      {/* greeting band */}
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <span className="eyebrow">{formatDate(t, { weekday: true })} · {monthLabel(month)}</span>
          <h2 style={{ fontSize: 'clamp(1.25rem, 1.05rem + 0.7vw, 1.6rem)' }}>{greeting}, Dr. {name}</h2>
          <div className="sub">
            {queue.length ? `${queue.length} patient${queue.length > 1 ? 's' : ''} still to be seen` : 'The queue is clear.'}
            {recalls.length ? ` · ${recalls.length} follow-up${recalls.length > 1 ? 's' : ''} due this week` : ''}
            {canSeeMoney && duesCount ? ` · ${duesCount} invoice${duesCount > 1 ? 's' : ''} unpaid` : ''}.
          </div>
        </div>
        <div className="row wrap hero-actions" style={{ gap: 8 }}>
          <Button variant="subtle" icon={UserPlus} onClick={() => setPatientOpen(true)}>Register patient</Button>
          <Button variant="subtle" icon={CalendarPlus} onClick={() => setApptOpen(true)}>Book appointment</Button>
          {canCollect ? <Button variant="ghost" icon={Sunset} onClick={() => navigate('/app/day-close')}>Day close</Button> : null}
          <Button variant="primary" icon={Ticket} onClick={() => setTokenOpen(true)}>Issue token</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid kpis kpi-compactable">
        <Kpi label="Today’s appointments" value={todayAppts.length} icon={CalendarPlus} meta={`${seenToday} seen · ${queue.length} waiting`} />
        {canSeeMoney ? (
          <>
            <Kpi label="Collected this month" value={formatMoney(totals.collected, { compact: totals.collected >= 100000 })} icon={IndianRupee}
              trend={revenueDelta == null ? null : { dir: revenueDelta >= 0 ? 'up' : 'down', label: `${revenueDelta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(revenueDelta * 100))}% vs last month` }}
              meta={`${formatMoney(collectedToday, { compact: true })} today`} accent />
            <Kpi label="Outstanding dues" value={formatMoney(dues, { compact: dues >= 100000 })} icon={Wallet} meta={`${duesCount} open invoice${duesCount === 1 ? '' : 's'}`} />
          </>
        ) : (
          <Kpi label="Waiting now" value={waited.length} icon={Users} meta={`${seenToday} seen today`} />
        )}
        <Kpi label="Visits this month" value={totals.visits} icon={Stethoscope} meta={`${totals.newPatients} new patients`} />
      </div>

      {/* live token strip */}
      <Card className="pad token-strip" style={{ background: 'linear-gradient(120deg, var(--brand-50), var(--surface) 62%)', borderColor: 'var(--brand-100)' }}>
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 9 }}>
            <span className="kpi-icon" style={{ background: 'var(--brand-500)', color: '#fff' }}><Ticket size={16} /></span>
            <div>
              <div className="eyebrow">Token queue</div>
              <div className="small strong">{board.totals.waiting} waiting · {board.totals.serving} in the room · {board.totals.done} done</div>
            </div>
          </div>
          <span className="spacer" />
          {board.rows.filter((r) => r.serving || r.next).slice(0, 2).map((r) => (
            <div key={r.doctor.id} className="row" style={{ gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '7px 11px' }}>
              <span className="tiny faint truncate" style={{ maxWidth: 92 }}>{r.doctor.full_name.replace(/^Dr\.?\s*/i, 'Dr ')}</span>
              <span className="mono strong small">{tokenLabel((r.serving ?? r.next)?.token_no)}</span>
              <Badge tone={r.serving ? 'accent' : 'warn'}>{r.serving ? 'In room' : 'Next'}</Badge>
            </div>
          ))}
          <div className="row wrap" style={{ gap: 6, minWidth: 0 }}>
            <Badge tone="neutral">Avg wait {avgWait == null ? '—' : humanWait(avgWait)}</Badge>
            <Button size="sm" variant="subtle" icon={Volume2} onClick={() => navigate('/app/queue')}>Open queue</Button>
            <Button size="sm" variant="primary" icon={Ticket} onClick={() => setTokenOpen(true)}>Issue token</Button>
          </div>
        </div>
      </Card>

      <div className="split">
        {/* Queue */}
        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead
              title="Today’s OPD queue" icon={Clock}
              sub={`${waited.length} checked in · ${todayAppts.filter((a) => a.status === 'booked').length} yet to arrive`}
              action={<Button size="sm" variant="subtle" icon={ArrowUpRight} onClick={() => navigate('/app/appointments')}>Full calendar</Button>}
            />
            <div className="card-body" style={{ paddingTop: 12 }}>
              {todayAppts.length ? (
                <div>
                  {queue.length ? queue.slice(0, 7).map((appt) => {
                    const patient = patientOf(appt.patient_id);
                    const doctor = doctorOf(appt.doctor_id);
                    const meta = statusMeta(appt.status);
                    return (
                      <div key={appt.id} className={`appt ${appt.status !== 'booked' ? 'live' : ''}`}>
                        <div className="when">{formatTime(appt.scheduled_at)}</div>
                        <Avatar name={patient?.full_name} size="sm" tone={doctor?.color} />
                        <button className="who" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer', minWidth: 0 }} onClick={() => navigate(`/app/patients/${appt.patient_id}`)}>
                          <b className="row" style={{ gap: 6, alignItems: 'center' }}>
                            {appt.token_no ? <span className="badge brand tiny" style={{ flex: 'none' }}>{tokenLabel(appt.token_no)}</span> : null}
                            <span className="truncate">{patient?.full_name ?? 'Patient'}</span>
                          </b>
                          <span className="tiny muted truncate" style={{ display: 'block' }}>
                            {appt.kind} · {doctor?.full_name?.split(' ').slice(-1)[0] ?? '—'} · {appt.reason || 'no reason noted'}
                          </span>
                        </button>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <div className="appt-actions no-print">
                          {appt.status === 'booked' ? <Button size="sm" variant="subtle" icon={LogIn} onClick={() => setStatus(appt, 'checked-in', 'checked in')}>Check in</Button> : null}
                          {appt.status === 'checked-in' ? <Button size="sm" variant="primary" icon={PlayCircle} onClick={() => setConsultFor(appt)}>Start</Button> : null}
                          {appt.status === 'in-consult' ? <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => setConsultFor(appt)}>Resume</Button> : null}
                        </div>
                      </div>
                    );
                  }) : (
                    <EmptyState icon={CheckCircle2} title="Queue is clear" description="Every booked patient has been seen. New walk-ins will appear here the moment reception checks them in." />
                  )}
                  {todayAppts.filter((a) => a.status === 'completed').length ? (
                    <div className="row tiny muted" style={{ marginTop: 12, gap: 6 }}>
                      <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
                      {seenToday} completed today · {formatMoney(collectedToday)} collected
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyState icon={CalendarPlus} title="No appointments today" description="The day is empty. Book a patient or register a walk-in." action={<Button size="sm" variant="primary" icon={CalendarPlus} onClick={() => setApptOpen(true)}>Book appointment</Button>} />
              )}
            </div>
          </Card>

          {canSeeMoney ? (
          <Card>
            <CardHead title="Revenue vs billed" sub="Last six months · collected is what actually landed" icon={TrendingUp}
              action={<div className="legend"><span><i className="swatch" style={{ background: '#0f766e' }} />Collected</span><span><i className="swatch" style={{ background: '#a5d9d0' }} />Billed</span></div>} />
            <div className="card-body">
              <TrendChart series={revSeries} valueKey="collected" secondaryKey="billed" height={190} />
              <div className="row wrap" style={{ gap: 18, marginTop: 6 }}>
                <div><span className="eyebrow">Billed</span><div className="strong mono">{formatMoney(totals.billed)}</div></div>
                <div><span className="eyebrow">Collected</span><div className="strong mono">{formatMoney(totals.collected)}</div></div>
                <div><span className="eyebrow">Collected rate</span><div className="strong mono">{collectedRate}%</div></div>
                <span className="spacer" />
                <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => navigate('/app/reports')}>Reports</Button>
              </div>
            </div>
          </Card>
          ) : null}

          <div className="grid two">
            <Card>
              <CardHead title="Footfall" sub="Visits per month" icon={Users} />
              <div className="card-body"><Columns series={footfall} height={140} /></div>
            </Card>
            <Card>
              <CardHead title="This week" sub="Booked appointments" icon={CalendarPlus} />
              <div className="card-body"><WeekStrip days={week} /></div>
            </Card>
          </div>
        </div>

        {/* Right rail */}
        <div className="stack" style={{ gap: 16 }}>
          {canReadConsults ? (
          <Card className="pad">
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <span className="kpi-icon"><BellRing size={15} /></span>
              <div><h3 style={{ fontSize: '0.95rem' }}>Follow-ups due</h3><span className="tiny muted">Recalls set inside consultations</span></div>
              <span className="spacer" />
              <Badge tone={recalls.length ? 'warn' : 'success'}>{recalls.length}</Badge>
            </div>
            {recalls.length ? (
              <div className="stack" style={{ gap: 2 }}>
                {recalls.map((c) => {
                  const patient = patientOf(c.patient_id);
                  return (
                    <button key={c.id} className="list-item" onClick={() => navigate(`/app/patients/${c.patient_id}`)}>
                      <Avatar name={patient?.full_name} size="sm" />
                      <span className="li-main">
                        <span className="li-title">{patient?.full_name ?? 'Patient'}</span>
                        <span className="li-sub">Due {relativeDay(c.follow_up_on)} · {(c.diagnoses ?? [])[0] ?? 'follow-up'}</span>
                      </span>
                      <ChevronRight size={14} className="faint" />
                    </button>
                  );
                })}
                <Button size="sm" variant="ghost" className="block" style={{ marginTop: 6 }} onClick={() => navigate('/app/follow-ups')}>All recalls</Button>
              </div>
            ) : (
              <p className="small muted">Nothing due in the next week. Follow-up dates set during consultations show up here automatically.</p>
            )}
          </Card>
          ) : null}

          {canSeeMoney ? (
            <Card>
              <CardHead title="Revenue mix" sub={monthLabel(month)} icon={CreditCard} />
              <div className="card-body">
                <Donut
                  items={cats.map((c) => ({ label: c.category, value: c.amount }))}
                  centerValue={formatMoney(totals.collected, { compact: true })}
                  centerLabel="collected"
                />
              </div>
            </Card>
          ) : null}

          {canReadConsults && canSeeMoney ? (
          <Card>
            <CardHead title="Doctor performance" sub={monthLabel(month)} icon={Stethoscope}
              action={<Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => navigate('/app/team')}>Team</Button>} />
            <div className="card-body" style={{ paddingTop: 8 }}>
              <BarList
                items={performers.filter((d) => d.role !== 'frontdesk').map((d) => ({
                  label: d.full_name.replace(/^Dr\.?\s*/i, 'Dr '),
                  value: d.collected,
                  color: d.color,
                }))}
                format={(v) => formatMoney(v, { compact: true })}
              />
              <div className="row tiny muted" style={{ marginTop: 12, gap: 6 }}>
                <AlertTriangle size={12} />
                {performers.reduce((s, d) => s + d.noShows, 0)} no-shows this month
              </div>
            </div>
          </Card>
          ) : null}

          <Card className="pad" style={{ background: 'linear-gradient(160deg, var(--brand-50), var(--surface) 65%)' }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="kpi-icon"><UserPlus size={15} /></span>
              <strong className="small">Quick register</strong>
            </div>
            <p className="tiny muted" style={{ marginBottom: 10 }}>Walk-in at the desk? Register and book in one flow.</p>
            <div className="stack" style={{ gap: 7 }}>
              <Button size="sm" variant="primary" icon={Ticket} className="block" onClick={() => setTokenOpen(true)}>Issue token</Button>
              <Button size="sm" variant="subtle" icon={UserPlus} className="block" onClick={() => setPatientOpen(true)}>New patient</Button>
              <Button size="sm" variant="subtle" icon={CalendarPlus} className="block" onClick={() => setApptOpen(true)}>Book appointment</Button>
              {canSeeMoney ? <Button size="sm" variant="ghost" icon={CreditCard} className="block" onClick={() => navigate('/app/billing?new=1')}>Raise invoice</Button> : null}
            </div>
          </Card>
        </div>
      </div>

      <TokenForm open={tokenOpen} onClose={() => setTokenOpen(false)} />
      <AppointmentForm open={apptOpen} onClose={() => setApptOpen(false)} onRegisterPatient={() => { setApptOpen(false); setPatientOpen(true); }} />
      <PatientForm open={patientOpen} onClose={() => setPatientOpen(false)} onCreated={(p) => { setPatientOpen(false); setApptOpen(true); navigate(`/app/patients/${p.id}`); }} />
      {consultFor ? (
        <ConsultationForm
          open={Boolean(consultFor)} onClose={() => setConsultFor(null)}
          appointment={consultFor} patient={patientOf(consultFor.patient_id)}
          onSaved={() => { setConsultFor(null); toast.info('Chart updated. Billing is one tap away.'); }}
        />
      ) : null}
    </div>
  );
}
