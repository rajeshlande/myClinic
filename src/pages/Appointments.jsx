import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Clock, LayoutGrid,
  List, LogIn, Pencil, PlayCircle, RotateCcw, Search, Sparkles, UserX, X,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import {
  useToast, Avatar, Badge, Button, Card, CardHead, EmptyState, IconButton, Modal,
  SearchInput, Segmented, Select, Tabs,
} from '../components/ui.jsx';
import AppointmentForm from '../components/AppointmentForm.jsx';
import ConsultationForm from '../components/ConsultationForm.jsx';
import PatientForm from '../components/PatientForm.jsx';
import { DayBoard, WeekGrid } from '../components/DayBoard.jsx';
import {
  addDays, appointmentMatchesQuery, appointmentsForDate, formatDate, formatSlotRange, relativeDay,
  statusMeta, today,
} from '../lib/logic.mjs';
import { LIVE_STATUSES, buildDayBoard, suggestNext, weekByDoctor, weekLoad } from '../lib/schedule.mjs';

export default function Appointments() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(params.get('date') || today());
  const [doctorId, setDoctorId] = useState('all');
  const [view, setView] = useState('day');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState(null);
  const [patientOpen, setPatientOpen] = useState(false);
  const [consultFor, setConsultFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [lastCleared, setLastCleared] = useState(null);

  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const doctorsShown = useMemo(
    () => (doctorId === 'all' ? store.doctors.filter((d) => d.active !== false) : store.doctors.filter((d) => d.id === doctorId)),
    [store.doctors, doctorId],
  );

  const dayAppts = useMemo(() => appointmentsForDate(store.appointments, date, doctorId), [store.appointments, date, doctorId]);
  const board = useMemo(
    () => buildDayBoard({ doctors: doctorsShown, appointments: store.appointments, iso: date }),
    [doctorsShown, store.appointments, date],
  );

  const filtered = useMemo(() => {
    const base = status === 'all' ? dayAppts : dayAppts.filter((a) => a.status === status);
    return base.filter((a) => appointmentMatchesQuery(a, store.patients, query));
  }, [dayAppts, status, query, store.patients]);

  // Patient joined onto each appointment once, so the board and list share it.
  const decorated = useMemo(() => store.appointments.map((a) => ({
    ...a,
    patient: store.patients.find((p) => p.id === a.patient_id) ?? null,
  })), [store.appointments, store.patients]);

  const patientOf = (id) => store.patients.find((p) => p.id === id);
  const doctorOf = (id) => store.doctors.find((d) => d.id === id);
  const nextFree = useMemo(
    () => suggestNext({ doctors: doctorsShown, appointments: store.appointments, iso: date }),
    [doctorsShown, store.appointments, date],
  );

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(date, i - 3)), [date]);
  const week = useMemo(() => weekLoad({ doctors: doctorsShown, appointments: store.appointments, startIso: addDays(date, -3) }),
    [doctorsShown, store.appointments, date]);
  const weekRows = useMemo(() => weekByDoctor({ doctors: doctorsShown, appointments: store.appointments, startIso: addDays(date, -3) }),
    [doctorsShown, store.appointments, date]);

  async function setApptStatus(appt, next, label) {
    try {
      await store.update('appointments', appt.id, { status: next });
      // Cancelling or marking a no-show clears the slot on the board, so keep the
      // booking to hand: one tap must be enough to put it back.
      setLastCleared(['cancelled', 'no-show'].includes(next) ? { ...appt, from: appt.status } : null);
      toast.success(label);
    } catch (e) { toast.error(e.message ?? 'Could not update.'); }
  }

  async function undoStatus(appt) {
    try {
      await store.update('appointments', appt.id, { status: appt.from ?? 'booked' });
      setLastCleared(null);
      toast.info('Back in the booked queue.');
    } catch (e) { toast.error(e.message ?? 'Could not update.'); }
  }

  async function confirmCancel() {
    if (!cancelFor) return;
    try {
      await store.update('appointments', cancelFor.id, { status: 'cancelled' });
      setLastCleared({ ...cancelFor, from: cancelFor.status ?? 'booked' });
      toast.info('Appointment cancelled. The slot is free again.');
      setCancelFor(null);
    } catch (e) { toast.error(e.message ?? 'Could not cancel.'); }
  }

  const openNew = (slot, doctor) => {
    setEditing({ scheduled_on: date, scheduled_at: slot ?? nextFree?.time ?? '09:00', doctor_id: doctor ?? nextFree?.doctor_id, duration_minutes: store.clinic?.slot_minutes ?? 15 });
    setFormOpen(true);
  };

  return (
    <div className="page stack" style={{ gap: 16 }}>
      {/* ── command bar ─────────────────────────────────────────────── */}
      <div className="sched-bar">
        <div className="row" style={{ gap: 4 }}>
          <IconButton icon={ChevronLeft} label="Previous day" onClick={() => setDate(addDays(date, -1))} />
          <button className="date-pill" onClick={() => setDate(today())} title="Jump to today">
            <span className="strong">{relativeDay(date)}</span>
            <span className="tiny faint">{formatDate(date, { weekday: true })}</span>
          </button>
          <IconButton icon={ChevronRight} label="Next day" onClick={() => setDate(addDays(date, 1))} />
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ minWidth: 148, maxWidth: 200 }} aria-label="Filter by doctor">
            <option value="all">All doctors</option>
            {store.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </Select>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'day', label: 'Day', icon: LayoutGrid },
              { value: 'week', label: 'Week', icon: CalendarDays },
              { value: 'list', label: 'List', icon: List },
            ]}
          />
          <Button variant="primary" icon={CalendarPlus} onClick={() => openNew()}>
            New
          </Button>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <div className="sched-kpis">
        {[
          { id: 'total', label: 'Scheduled', value: board.summary.total, tone: 'neutral', hint: `${board.summary.booked} still to arrive` },
          { id: 'live', label: 'In clinic', value: board.summary.live, tone: 'brand', hint: 'checked in or in consult' },
          { id: 'done', label: 'Completed', value: board.summary.done, tone: 'success', hint: 'notes closed' },
          { id: 'free', label: 'Free slots', value: board.columns.reduce((n, c) => n + c.stats.free, 0), tone: 'warn', hint: `next at ${nextFree?.time ?? '—'}` },
          { id: 'load', label: 'Utilisation', value: `${board.summary.utilization}%`, tone: 'neutral', hint: 'of booked clinic time' },
        ].map((kpi) => (
          <div key={kpi.id} className="kpi-tile">
            <span className="tiny faint">{kpi.label}</span>
            <span className={`kpi-num tone-${kpi.tone}`}>{kpi.value}</span>
            <span className="tiny faint truncate">{kpi.hint}</span>
          </div>
        ))}
      </div>

      {/* ── week strip ─────────────────────────────────────────────── */}
      <div className="weekstrip">
        {week.map((day) => {
          const active = day.iso === date;
          return (
            <button
              key={day.iso} onClick={() => setDate(day.iso)} className={`weekstrip-day ${active ? 'active' : ''} ${day.isToday ? 'today' : ''}`}
              aria-current={active ? 'date' : undefined}
            >
              <span className="tiny faint">{day.weekday}</span>
              <span className="ws-num">{day.day}</span>
              <span className="ws-meter"><span style={{ width: `${Math.min(100, day.utilization)}%` }} /></span>
              <span className="tiny" style={{ color: day.total ? 'var(--brand-600)' : 'var(--faint)' }}>
                {day.total ? `${day.total} appt` : 'free'}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── filters ────────────────────────────────────────────────── */}
      {view !== 'week' ? (
        <div className="row wrap" style={{ gap: 10 }}>
          <Tabs
            value={status} onChange={setStatus}
            tabs={[
              { value: 'all', label: 'All', count: board.summary.total },
              { value: 'booked', label: 'Booked', count: board.summary.booked },
              { value: 'checked-in', label: 'In clinic', count: board.summary.live },
              { value: 'completed', label: 'Completed', count: board.summary.done },
              { value: 'no-show', label: 'Missed', count: board.summary.missed },
            ]}
          />
          <span className="spacer" />
          <div style={{ width: 'min(280px, 100%)' }}>
            <SearchInput value={query} onChange={setQuery} placeholder="Find a patient in this day" />
          </div>
        </div>
      ) : null}

      {/* ── undo strip ─────────────────────────────────────────────── */}
      {lastCleared && lastCleared.scheduled_on === date ? (
        <div className="undo-strip no-print" role="status">
          <RotateCcw size={14} />
          <span className="small">
            <b>{patientOf(lastCleared.patient_id)?.full_name ?? 'Patient'}</b> {lastCleared.status === 'no-show' ? 'marked as a no-show' : 'cancelled'}
            {lastCleared.scheduled_at ? ` — ${formatSlotRange(lastCleared.scheduled_at, lastCleared.duration_minutes ?? 15)} is free again` : ''}
          </span>
          <span className="spacer" />
          <Button size="sm" variant="subtle" icon={RotateCcw} onClick={() => undoStatus(lastCleared)}>Undo</Button>
          <IconButton icon={X} label="Dismiss" size={13} className="plain sm" onClick={() => setLastCleared(null)} />
        </div>
      ) : null}

      {/* ── views ──────────────────────────────────────────────────── */}
      {view === 'day' && !query && status === 'all' ? (
        <DayBoard
          doctors={doctorsShown}
          appointments={decorated}
          iso={date}
          duration={store.clinic?.slot_minutes ?? 15}
          onNew={openNew}
          onEdit={(a) => { setEditing(a); setFormOpen(true); }}
          onStatus={setApptStatus}
          onConsult={(a) => setConsultFor(a)}
          onCancel={(a) => setCancelFor(a)}
          onPatient={(id) => navigate(`/app/patients/${id}`)}
        />
      ) : null}

      {view === 'week' ? (
        <WeekGrid
          rows={weekRows}
          days={week}
          selectedDoctorId={doctorId === 'all' ? null : doctorId}
          onPick={(iso, docId) => { setDate(iso); setDoctorId(docId); setView('day'); }}
        />
      ) : null}

      {(view === 'list' || view === 'day') && (view === 'list' || query || status !== 'all') ? (
        <Card>
          <CardHead
            title={`${filtered.length} appointment${filtered.length === 1 ? '' : 's'}`}
            sub={formatDate(date, { weekday: true })}
            icon={CalendarDays}
            action={<Badge tone="brand">{board.summary.done} completed</Badge>}
          />
          <div className="card-body" style={{ paddingTop: 8 }}>
            {filtered.length ? filtered.map((appt) => {
              const patient = patientOf(appt.patient_id);
              const doctor = doctorOf(appt.doctor_id);
              const meta = statusMeta(appt.status);
              const live = LIVE_STATUSES.includes(appt.status);
              return (
                <div key={appt.id} className={`appt ${live ? 'live' : ''}`}>
                  <div className="when">
                    <span className="mono strong">{appt.scheduled_at?.slice(0, 5)}</span>
                    <span className="tiny faint">{formatSlotRange(appt.scheduled_at, appt.duration_minutes ?? 15)}</span>
                  </div>
                  <Avatar name={patient?.full_name} size="sm" tone={doctor?.color} />
                  <button className="who" onClick={() => navigate(`/app/patients/${appt.patient_id}`)}>
                    <b>{patient?.full_name ?? 'Patient'}</b>
                    <span className="tiny muted truncate" style={{ display: 'block' }}>{appt.kind} · {doctor?.full_name} · {appt.reason || 'no reason noted'}</span>
                  </button>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="appt-actions no-print">
                    {appt.status === 'booked' ? (
                      <>
                        <IconButton icon={LogIn} label="Check in" size={15} onClick={() => setApptStatus(appt, 'checked-in', 'Patient checked in.')} />
                        <IconButton icon={Pencil} label="Reschedule" size={15} onClick={() => { setEditing(appt); setFormOpen(true); }} />
                        <IconButton icon={UserX} label="No-show" size={15} onClick={() => setApptStatus(appt, 'no-show', 'Marked as a no-show.')} />
                      </>
                    ) : null}
                    {appt.status === 'checked-in' ? <Button size="sm" variant="primary" icon={PlayCircle} onClick={() => setConsultFor(appt)}>Start</Button> : null}
                    {appt.status === 'in-consult' ? <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => setConsultFor(appt)}>Resume</Button> : null}
                    {appt.status === 'completed' ? <Button size="sm" variant="subtle" onClick={() => navigate(`/app/patients/${appt.patient_id}`)}>Chart</Button> : null}
                    {['cancelled', 'no-show'].includes(appt.status) ? (
                      <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => undoStatus(appt)}>Undo</Button>
                    ) : null}
                  </div>
                </div>
              );
            }) : (
              <EmptyState
                icon={Search} title="Nothing matches this filter"
                description="Clear the search or switch back to All to see the whole day."
                action={<Button size="sm" variant="subtle" onClick={() => { setQuery(''); setStatus('all'); }}>Clear filters</Button>}
              />
            )}
          </div>
        </Card>
      ) : null}

      {/* ── dialogs ────────────────────────────────────────────────── */}
      <AppointmentForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        appointment={editing?.id ? editing : undefined}
        defaults={editing && !editing.id ? editing : {}}
        onCreated={(a) => { if (a?.scheduled_on) setDate(a.scheduled_on); }}
        onRegisterPatient={() => { setFormOpen(false); setPatientOpen(true); }}
      />
      <PatientForm open={patientOpen} onClose={() => setPatientOpen(false)} onCreated={(p) => { setEditing({ patient_id: p.id, scheduled_on: date }); setFormOpen(true); }} />
      {consultFor ? (
        <ConsultationForm open onClose={() => setConsultFor(null)} appointment={consultFor} patient={patientOf(consultFor.patient_id)} onSaved={() => setConsultFor(null)} />
      ) : null}

      <Modal
        open={Boolean(cancelFor)} onClose={() => setCancelFor(null)} title="Cancel this appointment?"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCancelFor(null)}>Keep it</Button>
            <Button variant="danger" onClick={confirmCancel}>Cancel appointment</Button>
          </>
        )}
      >
        <p className="small muted">
          {cancelFor ? `${patientOf(cancelFor.patient_id)?.full_name ?? 'This patient'} at ${formatSlotRange(cancelFor.scheduled_at, cancelFor.duration_minutes ?? 15)} will be marked cancelled and the slot released. The record stays in the patient’s history.` : ''}
        </p>
      </Modal>
    </div>
  );
}
