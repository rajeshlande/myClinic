import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  CalendarPlus, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, LogIn,
  Pencil, PlayCircle, Search, Trash2, UserX, X, Phone, LayoutGrid, List,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Avatar, Badge, Button, Card, CardHead, EmptyState, IconButton, Input, Modal, Segmented, Select, Tabs, SearchInput } from '../components/ui.jsx';
import AppointmentForm from '../components/AppointmentForm.jsx';
import ConsultationForm from '../components/ConsultationForm.jsx';
import PatientForm from '../components/PatientForm.jsx';
import {
  addDays, appointmentMatchesQuery, appointmentsForDate, formatDate, formatMoney, formatSlotRange,
  generateSlots, relativeDay, sortAppointments, statusMeta, timeToMinutes, today, doctorPerformance,
} from '../lib/logic.mjs';

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

  // React Router reuses the component when only the query string changes, so this
  // must react to the parameter instead of running once on mount.
  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const dayAppts = useMemo(() => appointmentsForDate(store.appointments, date, doctorId), [store.appointments, date, doctorId]);
  const filtered = useMemo(() => {
    const base = status === 'all' ? dayAppts : dayAppts.filter((a) => a.status === status);
    return base.filter((a) => appointmentMatchesQuery(a, store.patients, query));
  }, [dayAppts, status, query, store.patients]);

  const patientOf = (id) => store.patients.find((p) => p.id === id);
  const doctorOf = (id) => store.doctors.find((d) => d.id === id);

  const counts = useMemo(() => ({
    all: dayAppts.length,
    booked: dayAppts.filter((a) => a.status === 'booked').length,
    live: dayAppts.filter((a) => ['checked-in', 'in-consult'].includes(a.status)).length,
    completed: dayAppts.filter((a) => a.status === 'completed').length,
    missed: dayAppts.filter((a) => ['no-show', 'cancelled'].includes(a.status)).length,
  }), [dayAppts]);

  const revenueDay = dayAppts.filter((a) => a.status === 'completed').length;

  async function setApptStatus(appt, next, label) {
    try {
      await store.update('appointments', appt.id, { status: next });
      toast.success(label);
    } catch (e) { toast.error(e.message ?? 'Could not update.'); }
  }

  async function confirmCancel() {
    if (!cancelFor) return;
    try {
      await store.update('appointments', cancelFor.id, { status: 'cancelled' });
      toast.info('Appointment cancelled. The slot is free again.');
      setCancelFor(null);
    } catch (e) { toast.error(e.message ?? 'Could not cancel.'); }
  }

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(date, i - 3)), [date]);

  return (
    <div className="page stack" style={{ gap: 16 }}>
      {/* toolbar */}
      <div className="row wrap toolbar">
        <div className="row" style={{ gap: 4 }}>
          <IconButton icon={ChevronLeft} label="Previous day" onClick={() => setDate(addDays(date, -1))} />
          <div style={{ textAlign: 'center', minWidth: 132 }}>
            <div className="strong" style={{ fontSize: '0.95rem' }}>{relativeDay(date)}</div>
            <div className="tiny faint">{formatDate(date)}</div>
          </div>
          <IconButton icon={ChevronRight} label="Next day" onClick={() => setDate(addDays(date, 1))} />
          <Button size="sm" variant="subtle" onClick={() => setDate(today())}>Today</Button>
        </div>
        <div className="row wrap toolbar-actions">
          <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ minWidth: 150, maxWidth: 200 }} aria-label="Filter by doctor">
            <option value="all">All doctors</option>
            {store.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </Select>
          <div className="segmented no-print">
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}><LayoutGrid size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Day</button>
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={13} style={{ marginRight: 4, verticalAlign: -2 }} />List</button>
          </div>
          <Button variant="primary" icon={CalendarPlus} onClick={() => { setEditing(null); setFormOpen(true); }}>New</Button>
        </div>
      </div>

      {/* week strip */}
      <div className="weekstrip">
        {weekDays.map((iso) => {
          const count = store.appointments.filter((a) => a.scheduled_on === iso && a.status !== 'cancelled').length;
          const active = iso === date;
          return (
            <button
              key={iso} onClick={() => setDate(iso)} className="card"
              style={{
                padding: '8px 4px', textAlign: 'center', cursor: 'pointer', minHeight: 62,
                borderColor: active ? 'var(--brand-500)' : 'var(--border)',
                background: active ? 'var(--brand-50)' : 'var(--surface)',
                boxShadow: active ? '0 0 0 1px var(--brand-500)' : 'var(--shadow-xs)',
              }}
            >
              <div className="tiny faint">{new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })}</div>
              <div className="strong mono" style={{ fontSize: '1rem', color: active ? 'var(--brand-600)' : 'var(--text)' }}>{iso.slice(8)}</div>
              <div className="tiny" style={{ color: count ? 'var(--brand-500)' : 'var(--faint)' }}>{count ? `${count} appt` : 'free'}</div>
            </button>
          );
        })}
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <Tabs
          value={status} onChange={setStatus}
          tabs={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'booked', label: 'Booked', count: counts.booked },
            { value: 'checked-in', label: 'In clinic', count: counts.live },
            { value: 'completed', label: 'Completed', count: counts.completed },
            { value: 'no-show', label: 'Missed', count: counts.missed },
          ]}
        />
        <span className="spacer" />
        <div style={{ width: 'min(280px, 100%)' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Find a patient in this day" />
        </div>
      </div>

      {view === 'day' ? (
        <DaySchedule
          date={date} doctorId={doctorId} doctors={store.doctors} appointments={filtered}
          patientOf={patientOf} doctorOf={doctorOf}
          onNew={(slot, doctor) => { setEditing({ scheduled_on: date, scheduled_at: slot, doctor_id: doctor }); setFormOpen(true); }}
          onEdit={(a) => { setEditing(a); setFormOpen(true); }}
          onStatus={setApptStatus}
          onConsult={(a) => setConsultFor(a)}
          onCancel={(a) => setCancelFor(a)}
          onPatient={(id) => navigate(`/app/patients/${id}`)}
        />
      ) : (
        <Card>
          <CardHead title={`${filtered.length} appointment${filtered.length === 1 ? '' : 's'}`} sub={formatDate(date, { weekday: true })} icon={CalendarDays}
            action={<Badge tone="brand">{revenueDay} completed</Badge>} />
          <div className="card-body" style={{ paddingTop: 8 }}>
            {filtered.length ? filtered.map((appt) => {
              const patient = patientOf(appt.patient_id);
              const doctor = doctorOf(appt.doctor_id);
              const meta = statusMeta(appt.status);
              return (
                <div key={appt.id} className={`appt ${['checked-in', 'in-consult'].includes(appt.status) ? 'live' : ''}`}>
                  <div className="when">{appt.scheduled_at}</div>
                  <Avatar name={patient?.full_name} size="sm" tone={doctor?.color} />
                  <button className="who" onClick={() => onPatientClick(navigate, appt.patient_id)} style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', padding: 0 }}>
                    <b>{patient?.full_name ?? 'Patient'}</b>
                    <span className="tiny muted truncate" style={{ display: 'block' }}>{appt.kind} · {doctor?.full_name} · {appt.reason || 'no reason noted'}</span>
                  </button>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="appt-actions no-print">
                    {appt.status === 'booked' ? <>
                      <IconButton icon={LogIn} label="Check in" size={15} onClick={() => setApptStatus(appt, 'checked-in', 'Patient checked in.')} />
                      <IconButton icon={Pencil} label="Reschedule" size={15} onClick={() => { setEditing(appt); setFormOpen(true); }} />
                    </> : null}
                    {appt.status === 'checked-in' ? <Button size="sm" variant="primary" icon={PlayCircle} onClick={() => setConsultFor(appt)}>Start</Button> : null}
                    {appt.status === 'in-consult' ? <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => setConsultFor(appt)}>Resume</Button> : null}
                    {appt.status === 'completed' ? <Button size="sm" variant="subtle" onClick={() => navigate(`/app/patients/${appt.patient_id}`)}>Chart</Button> : null}
                  </div>
                </div>
              );
            }) : (
              <EmptyState icon={CalendarDays} title="No appointments match" description="Try another status filter, clear the search, or book a new appointment for this day."
                action={<Button size="sm" variant="primary" icon={CalendarPlus} onClick={() => setFormOpen(true)}>Book appointment</Button>} />
            )}
          </div>
        </Card>
      )}

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
        footer={<>
          <Button variant="ghost" onClick={() => setCancelFor(null)}>Keep it</Button>
          <Button variant="danger" onClick={confirmCancel}>Cancel appointment</Button>
        </>}
      >
        <p className="small muted">
          {cancelFor ? `${patientOf(cancelFor.patient_id)?.full_name ?? 'This patient'} at ${cancelFor.scheduled_at} will be marked cancelled and the slot released. The record stays in the patient’s history.` : ''}
        </p>
      </Modal>
    </div>
  );
}

const onPatientClick = (navigate, id) => navigate(`/app/patients/${id}`);

function DaySchedule({ date, doctorId, doctors, appointments, patientOf, doctorOf, onNew, onEdit, onStatus, onConsult, onCancel, onPatient }) {
  const shown = doctorId === 'all' ? doctors : doctors.filter((d) => d.id === doctorId);
  if (!shown.length) return <Card><div className="card-body"><EmptyState title="No doctors configured" description="Add a doctor under Doctors &amp; staff to start booking slots." /></div></Card>;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {shown.map((doctor) => {
        const start = timeToMinutes(doctor.day_start || '09:00');
        const end = timeToMinutes(doctor.day_end || '13:00');
        const slots = generateSlots({ start: doctor.day_start || '09:00', end: doctor.day_end || '13:00', duration: doctor.slot_minutes || 15 });
        const booked = appointments.filter((a) => a.doctor_id === doctor.id);
        const freeCount = slots.length - booked.filter((a) => a.status !== 'cancelled').length;
        return (
          <Card key={doctor.id}>
            <CardHead
              title={doctor.full_name} icon={Clock}
              sub={`${doctor.specialty} · ${doctor.day_start}–${doctor.day_end} · ${doctor.slot_minutes || 15} min slots`}
              action={
                <div className="row" style={{ gap: 8 }}>
                  <Badge tone={freeCount > 0 ? 'success' : 'warn'}>{freeCount} free</Badge>
                  <Badge tone="neutral">{booked.length} booked</Badge>
                  <Button size="sm" variant="subtle" icon={CalendarPlus} onClick={() => onNew(slots.find((s) => !booked.some((b) => b.scheduled_at === s && b.status !== 'cancelled')) ?? slots[0], doctor.id)}>Add</Button>
                </div>
              }
            />
            <div className="card-body" style={{ paddingTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
                {slots.map((slot) => {
                  const appt = booked.find((a) => a.scheduled_at === slot && a.status !== 'cancelled');
                  const cancelled = booked.find((a) => a.scheduled_at === slot && a.status === 'cancelled');
                  if (!appt) {
                    return (
                      <button key={slot} onClick={() => onNew(slot, doctor.id)} className="card" style={{ padding: '8px 10px', textAlign: 'left', cursor: 'pointer', background: 'var(--surface-2)', boxShadow: 'none', minHeight: 52 }}>
                        <div className="tiny mono faint">{slot}</div>
                        <div className="tiny" style={{ color: 'var(--brand-500)', fontWeight: 600 }}>{cancelled ? 'Freed slot — book' : 'Available'}</div>
                      </button>
                    );
                  }
                  const patient = patientOf(appt.patient_id);
                  const meta = statusMeta(appt.status);
                  const live = ['checked-in', 'in-consult'].includes(appt.status);
                  return (
                    <div key={slot} className="card" style={{ padding: '8px 10px', minHeight: 52, borderColor: live ? 'var(--brand-500)' : 'var(--border)', background: live ? 'var(--brand-50)' : 'var(--surface)', boxShadow: 'none' }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="tiny mono faint">{slot}</span>
                        <span className="spacer" />
                        <span className="tiny" style={{ color: `var(--${meta.tone === 'neutral' ? 'muted' : meta.tone})`, fontWeight: 700 }}>{meta.label}</span>
                      </div>
                      <button onClick={() => onPatient(appt.patient_id)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                        <div className="small strong truncate" style={{ marginTop: 2 }}>{patient?.full_name ?? 'Patient'}</div>
                        <div className="tiny muted truncate">{appt.kind}</div>
                      </button>
                      <div className="row no-print" style={{ gap: 4, marginTop: 6 }}>
                        {appt.status === 'booked' ? <button className="btn sm" style={{ padding: '2px 7px', minHeight: 24, fontSize: '0.7rem' }} onClick={() => onStatus(appt, 'checked-in', 'Patient checked in.')}>Check in</button> : null}
                        {live ? <button className="btn sm primary" style={{ padding: '2px 7px', minHeight: 24, fontSize: '0.7rem' }} onClick={() => onConsult(appt)}>Consult</button> : null}
                        {appt.status === 'completed' ? <button className="btn sm subtle" style={{ padding: '2px 7px', minHeight: 24, fontSize: '0.7rem' }} onClick={() => onPatient(appt.patient_id)}>Chart</button> : null}
                        <span className="spacer" />
                        <IconButton icon={Pencil} label="Edit" size={12} className="plain sm" onClick={() => onEdit(appt)} />
                        {appt.status === 'booked' ? <IconButton icon={X} label="Cancel" size={12} className="plain sm" onClick={() => onCancel(appt)} /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
