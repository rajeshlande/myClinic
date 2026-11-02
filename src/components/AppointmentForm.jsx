import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, UserPlus, AlertTriangle, Check } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Button, Field, Input, Select, Textarea, Modal, Avatar, Badge } from './ui.jsx';
import {
  APPOINTMENT_TYPES, formatMoney, formatSlotRange, relativeDay, sortAppointments,
  slotAvailability, today, validateAppointment,
} from '../lib/logic.mjs';

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

  useEffect(() => {
    if (open) setDraft((d) => ({ ...d, patient_id: appointment?.patient_id ?? defaults.patient_id ?? d.patient_id, doctor_id: appointment?.doctor_id ?? defaults.doctor_id ?? doctors[0]?.id ?? '' }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target?.value ?? e }));
  const doctor = doctors.find((d) => d.id === draft.doctor_id);
  const availability = useMemo(() => (doctor ? slotAvailability({ appointments: store.appointments.filter((a) => a.id !== appointment?.id), doctor, iso: draft.scheduled_on, duration: Number(draft.duration_minutes) }) : { all: [], taken: new Set(), free: [] }), [doctor, draft.scheduled_on, draft.duration_minutes, store.appointments, appointment]);

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
    if (availability.taken.has(draft.scheduled_at) && appointment?.scheduled_at !== draft.scheduled_at) {
      found.scheduled_at = 'That slot is already booked for this doctor.';
    }
    if (availability.all.length && !availability.all.includes(draft.scheduled_at)) {
      found.scheduled_at = 'That time is outside the doctor’s working hours.';
    }
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

        <Field label="Available slots" error={errors.scheduled_at} hint={doctor ? `${doctor.full_name.split(' ').slice(-1)[0]}’s hours ${doctor.day_start}–${doctor.day_end}` : ''}>
          <div className="row wrap" style={{ gap: 6, maxHeight: 150, overflowY: 'auto', padding: 2 }}>
            {availability.all.map((slot) => {
              const taken = availability.taken.has(slot);
              const active = draft.scheduled_at === slot;
              return (
                <button
                  key={slot} type="button" disabled={taken} onClick={() => { setDraft((d) => ({ ...d, scheduled_at: slot })); setErrors((er) => ({ ...er, scheduled_at: undefined })); }}
                  className="btn sm"
                  style={{
                    minWidth: 92, fontVariantNumeric: 'tabular-nums',
                    background: active ? 'var(--brand-500)' : taken ? 'var(--surface-3)' : 'var(--surface)',
                    color: active ? '#fff' : taken ? 'var(--faint)' : 'var(--text-2)',
                    borderColor: active ? 'transparent' : 'var(--border)',
                    textDecoration: taken ? 'line-through' : 'none',
                    opacity: taken ? 0.7 : 1,
                  }}
                  title={taken ? 'Already booked' : `Book ${formatSlotRange(slot, Number(draft.duration_minutes))}`}
                >
                  {slot}
                </button>
              );
            })}
            {!availability.all.length ? <p className="small muted">This doctor has no working hours configured. Add them under Doctors &amp; staff.</p> : null}
          </div>
        </Field>

        <div className="form-grid">
          <Field label="Reason for visit" className="span-2">
            <Input value={draft.reason} onChange={set('reason')} placeholder="e.g. fever since 2 days, BP review" />
          </Field>
          <Field label="Front-desk notes" className="span-2">
            <Textarea value={draft.notes} onChange={set('notes')} rows={2} placeholder="Insurance details, mobility needs, referral source…" />
          </Field>
        </div>

        {availability.taken.has(draft.scheduled_at) && appointment?.scheduled_at !== draft.scheduled_at ? (
          <div className="row small" style={{ color: 'var(--warn)', background: 'var(--warn-bg)', padding: '8px 11px', borderRadius: 10 }}>
            <AlertTriangle size={14} /> This slot is already taken. Pick another time to avoid a double booking.
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

export function sortedUpcoming(appointments) { return sortAppointments(appointments.filter((a) => a.status === 'booked')); }
