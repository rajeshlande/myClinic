import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, UserPlus, AlertTriangle, Check, ChevronLeft, ChevronRight, Sparkles, Sun, Sunrise, Sunset, Clock } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Button, Field, IconButton, Input, Select, Textarea, Modal, Avatar, Badge } from './ui.jsx';
import {
  APPOINTMENT_TYPES, addDays, formatMoney, formatSlotRange, relativeDay, sortAppointments,
  today, validateAppointment,
} from '../lib/logic.mjs';
import { availableSlots, detectClashes, explainConflict, groupSlots, suggestNext } from '../lib/schedule.mjs';
import { doctorSessions } from '../lib/hours.mjs';

export default function AppointmentForm({ open, onClose, appointment, defaults = {}, onCreated, onRegisterPatient }) {
  const store = useStore();
  const toast = useToast();
  const doctors = store.doctors.filter((d) => d.active !== false);
  const [draft, setDraft] = useState(() => ({
    patient_id: '', doctor_id: doctors[0]?.id ?? '', scheduled_on: today(), scheduled_at: '09:00',
    duration_minutes: store.clinic?.slot_minutes ?? 15, kind: 'New consultation',
    source: 'walk-in', reason: '', notes: '', ...defaults, ...(appointment ?? {}),
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  // Re-seed the whole draft every time the sheet opens. A click on an empty board
  // slot, "New", a reschedule and "register patient then book" all arrive here —
  // previously only the doctor and patient were carried over, so the slot the
  // receptionist clicked was silently replaced by the 09:00 default.
  useEffect(() => {
    if (!open) return;
    const seed = appointment?.id
      ? { ...appointment }
      : {
          patient_id: '', doctor_id: doctors[0]?.id ?? '', scheduled_on: today(), scheduled_at: '09:00',
          duration_minutes: store.clinic?.slot_minutes ?? 15, kind: 'New consultation',
          source: 'walk-in', reason: '', notes: '', token_no: null, ...defaults,
        };
    setDraft((d) => ({ ...d, ...seed, doctor_id: seed.doctor_id || doctors[0]?.id || d.doctor_id }));
    setErrors({});
    setQuery('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target?.value ?? e }));
  const doctor = doctors.find((d) => d.id === draft.doctor_id);
  // Interval-aware: a 30-minute visit blocks both 15-minute rows it covers.
  const slots = useMemo(() => {
    if (!doctor) return [];
    return availableSlots({
      appointments: store.appointments.filter((a) => a.id !== appointment?.id),
      doctor,
      iso: draft.scheduled_on,
      duration: Number(draft.duration_minutes) || 15,
      // Both of the clinic's sessions, the doctor's window, and the day offs.
      clinic: store.clinic,
    });
  }, [doctor, draft.scheduled_on, draft.duration_minutes, store.appointments, appointment, store.clinic]);
  const groups = useMemo(
    () => groupSlots(slots, { sessions: doctor ? doctorSessions(doctor, store.clinic) : null }),
    [slots, doctor, store.clinic],
  );
  const freeCount = slots.filter((s) => s.free).length;
  const clashes = useMemo(() => detectClashes(store.appointments, draft), [store.appointments, draft]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? store.patients.filter((p) => [p.full_name, p.phone, p.code].join(' ').toLowerCase().includes(q))
      : store.patients.slice(0, 6);
    return pool.slice(0, 8);
  }, [store.patients, query]);

  const selectedPatient = store.patients.find((p) => p.id === draft.patient_id);
  const fee = draft.kind === 'Follow-up' ? (doctor?.follow_up_fee_paise ?? store.clinic?.follow_up_fee_paise) : (doctor?.fee_paise ?? store.clinic?.consultation_fee_paise);

  async function submit() {
    const found = validateAppointment(draft);
    const startM = Number(draft.scheduled_at.slice(0, 2)) * 60 + Number(draft.scheduled_at.slice(3, 5));
    const endM = startM + (Number(draft.duration_minutes) || 15);
    const closeM = Number((doctor?.day_end || '23:59').slice(0, 2)) * 60 + Number((doctor?.day_end || '23:59').slice(3, 5));
    if (clashes.length && !(appointment && appointment.scheduled_at === draft.scheduled_at && appointment.scheduled_on === draft.scheduled_on)) {
      found.scheduled_at = explainConflict(clashes[0]);
    }
    if (endM > closeM) found.scheduled_at = 'That visit runs past the doctor’s finishing time.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = {
        patient_id: draft.patient_id,
        doctor_id: draft.doctor_id,
        scheduled_on: draft.scheduled_on,
        scheduled_at: draft.scheduled_at,
        duration_minutes: Number(draft.duration_minutes),
        kind: draft.kind,
        source: draft.source,
        reason: draft.reason.trim(),
        notes: draft.notes.trim(),
        status: appointment?.status ?? 'booked',
      };
      let saved;
      if (appointment) {
        await store.update('appointments', appointment.id, payload);
        saved = { ...appointment, ...payload };
        toast.success('Appointment updated.');
      } else {
        saved = await store.create('appointments', payload);
        toast.success(`Booked ${relativeDay(payload.scheduled_on)} at ${payload.scheduled_at}.`);
      }
      onCreated?.(saved);
      onClose();
    } catch (e) {
      toast.error(e.message ?? 'Could not save the appointment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open} onClose={onClose}
      title={appointment ? 'Reschedule appointment' : 'New appointment'}
      sub={`${doctor?.full_name ?? 'Doctor'} · ${formatMoney(fee ?? 0)} ${draft.kind === 'Follow-up' ? 'follow-up fee' : 'consultation fee'}`}
      footer={<>
        <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
        <Button variant="primary" onClick={submit} loading={saving} type="button" icon={Check}>{appointment ? 'Save' : 'Confirm booking'}</Button>
      </>}
    >
      <div className="stack">
        <Field label="Patient *" error={errors.patient_id}>
          {selectedPatient ? (
            <div className="appt" style={{ background: 'var(--surface-2)' }}>
              <Avatar name={selectedPatient.full_name} />
              <div className="who">
                <b>{selectedPatient.full_name}</b>
                <span className="tiny muted">{selectedPatient.code} · {selectedPatient.phone || 'no phone'}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, patient_id: '' }))}>Change</Button>
            </div>
          ) : (
            <>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, phone or patient ID" autoComplete="off" />
              <div className="stack" style={{ gap: 2, maxHeight: 190, overflowY: 'auto', marginTop: 4 }}>
                {matches.map((p) => (
                  <button key={p.id} type="button" className="list-item" onClick={() => { setDraft((d) => ({ ...d, patient_id: p.id })); setErrors((e) => ({ ...e, patient_id: undefined })); }}>
                    <Avatar name={p.full_name} size="sm" />
                    <span className="li-main">
                      <span className="li-title">{p.full_name}</span>
                      <span className="li-sub">{p.code} · {p.phone || 'no phone'}</span>
                    </span>
                  </button>
                ))}
                {!matches.length ? (
                  <button type="button" className="list-item" onClick={onRegisterPatient}>
                    <span className="kpi-icon" style={{ width: 30, height: 30 }}><UserPlus size={14} /></span>
                    <span className="li-main"><span className="li-title">Register a new patient</span><span className="li-sub">No match for “{query}”</span></span>
                  </button>
                ) : null}
              </div>
            </>
          )}
        </Field>

        <div className="form-grid">
          <Field label="Doctor *" error={errors.doctor_id}>
            <Select value={draft.doctor_id} onChange={set('doctor_id')} error={errors.doctor_id}>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name} — {d.specialty}</option>)}
            </Select>
          </Field>
          <Field label="Visit type">
            <Select value={draft.kind} onChange={set('kind')}>{APPOINTMENT_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          </Field>
          <Field label="Date *" error={errors.scheduled_on}>
            <Input type="date" value={draft.scheduled_on} min={today()} onChange={set('scheduled_on')} error={errors.scheduled_on} />
          </Field>
          <Field label="Duration">
            <Select value={draft.duration_minutes} onChange={set('duration_minutes')}>
              {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </Select>
          </Field>
          <Field label="Source">
            <Select value={draft.source} onChange={set('source')}>
              <option value="walk-in">Walk-in</option>
              <option value="phone">Phone</option>
              <option value="online">Online</option>
              <option value="referral">Referral</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Time"
          error={errors.scheduled_at}
          hint={doctor ? `${doctor.day_start}–${doctor.day_end} · ${freeCount} of ${slots.length} slots free` : ''}
        >
          {/* day stepper + quick jumps */}
          <div className="slot-toolbar">
            <div className="row" style={{ gap: 2 }}>
              <IconButton icon={ChevronLeft} label="Previous day" size={14} className="plain sm" onClick={() => setDraft((d) => ({ ...d, scheduled_on: addDays(d.scheduled_on, -1), scheduled_at: '' }))} />
              <span className="small mono strong">{formatSlotDate(draft.scheduled_on)}</span>
              <IconButton icon={ChevronRight} label="Next day" size={14} className="plain sm" onClick={() => setDraft((d) => ({ ...d, scheduled_on: addDays(d.scheduled_on, 1), scheduled_at: '' }))} />
            </div>
            <span className="spacer" />
            <Button
              size="sm" variant="ghost" icon={Sparkles} type="button"
              onClick={() => {
                const next = suggestNext({
                  doctors, appointments: store.appointments.filter((a) => a.id !== appointment?.id),
                  iso: draft.scheduled_on, duration: Number(draft.duration_minutes) || 15,
                  doctorId: draft.doctor_id, clinic: store.clinic,
                });
                if (next) setDraft((d) => ({ ...d, scheduled_at: next.time, doctor_id: next.doctor_id }));
              }}
            >
              Next free
            </Button>
          </div>

          {slots.length ? (
            <div className="slot-groups">
              {groups.map((group) => {
                // Session groups are named by their own window ("9:00 AM – 1:00 PM"),
                // so the icon follows the clock rather than a fixed three-slot day.
                const Icon = group.id === 'morning' ? Sunrise
                  : group.id === 'afternoon' ? Sun
                    : group.id === 'evening' ? Sunset : Clock;
                return (
                  <div key={group.id} className="slot-group">
                    <span className="slot-group-label"><Icon size={12} /> {group.label}</span>
                    <div className="slot-picker">
                      {group.slots.map((slot) => {
                        const active = draft.scheduled_at === slot.time;
                        return (
                          <button
                            key={slot.time} type="button" disabled={!slot.free}
                            className={`pick ${active ? 'active' : ''} ${slot.free ? '' : 'taken'}`}
                            onClick={() => { setDraft((d) => ({ ...d, scheduled_at: slot.time })); setErrors((er) => ({ ...er, scheduled_at: undefined })); }}
                            title={slot.free ? `Book ${formatSlotRange(slot.time, Number(draft.duration_minutes) || 15)}` : 'Already booked'}
                            aria-pressed={active}
                          >
                            <span className="pick-time">{slot.time}</span>
                            {!slot.free ? <span className="pick-note">booked</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              {slots.closed
                ? `${slots.reason || 'The clinic is closed that day'} — no slots are offered. Pick another day, or open Settings → Working hours to change the day off.`
                : `This doctor has no working hours inside the clinic's sessions for that day. Add them under Doctors & staff, or widen the clinic's hours in Settings.`}
            </p>
          )}
        </Field>

        <div className="form-grid">
          <Field label="Reason for visit" className="span-2">
            <Input value={draft.reason} onChange={set('reason')} placeholder="e.g. fever since 2 days, BP review" />
          </Field>
          <Field label="Front-desk notes" className="span-2">
            <Textarea value={draft.notes} onChange={set('notes')} rows={2} placeholder="Insurance details, mobility needs, referral source…" />
          </Field>
        </div>

        {clashes.length && draft.scheduled_at ? (
          <div className="row small" style={{ color: 'var(--warn)', background: 'var(--warn-bg)', padding: '8px 11px', borderRadius: 10, gap: 8 }}>
            <AlertTriangle size={14} /> {explainConflict(clashes[0], patientOfName(store, draft.patient_id))}
          </div>
        ) : selectedPatient && doctor ? (
          <div className="row small" style={{ color: 'var(--muted)', background: 'var(--surface-2)', padding: '9px 11px', borderRadius: 10, flexWrap: 'wrap', gap: 8 }}>
            <CalendarClock size={14} />
            <span>{relativeDay(draft.scheduled_on)} · {formatSlotRange(draft.scheduled_at, Number(draft.duration_minutes))}</span>
            <span className="spacer" />
            <Badge tone="brand">{formatMoney(fee ?? 0)}</Badge>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function formatSlotDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function patientOfName(store, id) {
  const p = store.patients.find((x) => x.id === id);
  return p?.full_name ?? 'This patient';
}

export function sortedUpcoming(appointments) { return sortAppointments(appointments.filter((a) => a.status === 'booked')); }
