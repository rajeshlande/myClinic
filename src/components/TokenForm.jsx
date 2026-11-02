import { useEffect, useMemo, useState } from 'react';
import { Check, Ticket, UserPlus, AlertTriangle, Printer, Phone } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Avatar, Badge, Button, Field, Input, Modal, Select, Textarea, Segmented } from './ui.jsx';
import {
  APPOINTMENT_TYPES, formatMoney, formatTime, nextTokenNo, patientSearch, tokenLabel, today,
} from '../lib/logic.mjs';
import PatientForm from './PatientForm.jsx';

/**
 * Front-desk token issue. One screen: pick patient (or register), pick doctor,
 * pick visit type → the next token number is reserved and printed.
 */
export default function TokenForm({ open, onClose, defaults = {}, onIssued }) {
  const store = useStore();
  const toast = useToast();
  const doctors = store.doctors.filter((d) => d.active !== false);
  const [patientId, setPatientId] = useState(defaults.patient_id ?? '');
  const [doctorId, setDoctorId] = useState(defaults.doctor_id ?? doctors[0]?.id ?? '');
  const [kind, setKind] = useState('New consultation');
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [issued, setIssued] = useState(null);

  useEffect(() => {
    if (!open) { setIssued(null); setReason(''); setQuery(''); }
  }, [open]);

  const doctor = doctors.find((d) => d.id === doctorId);
  const patient = store.patients.find((p) => p.id === patientId);
  const token = useMemo(
    () => nextTokenNo(store.appointments, doctorId, today()),
    [store.appointments, doctorId],
  );
  const dayCount = store.appointments.filter((a) => a.scheduled_on === today() && a.doctor_id === doctorId && a.token_no).length;
  const ahead = store.appointments.filter((a) => a.scheduled_on === today() && a.doctor_id === doctorId && ['booked', 'checked-in'].includes(a.status) && a.token_no).length;
  const fee = kind === 'Follow-up' ? (doctor?.follow_up_fee_paise ?? store.clinic?.follow_up_fee_paise ?? 0) : (doctor?.fee_paise ?? store.clinic?.consultation_fee_paise ?? 0);

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return store.patients.slice(0, 5);
    return patientSearch(store.patients, q).slice(0, 6);
  }, [store.patients, query]);

  async function issue() {
    if (!patientId) { toast.error('Choose or register a patient first.'); return; }
    if (!doctorId) { toast.error('Choose the doctor this token is for.'); return; }
    setSaving(true);
    try {
      const now = new Date();
      const startAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const record = await store.create('appointments', {
        patient_id: patientId,
        doctor_id: doctorId,
        scheduled_on: today(),
        scheduled_at: startAt,
        duration_minutes: doctor?.slot_minutes ?? store.clinic?.slot_minutes ?? 15,
        kind,
        source: 'walk-in',
        reason: reason.trim() || (priority === 'urgent' ? 'Urgent — seen out of turn' : ''),
        notes: priority === 'urgent' ? 'Priority token' : '',
        status: 'checked-in',
        token_no: token,
      });
      setIssued({ record, token });
      toast.success(`Token ${tokenLabel(token)} issued to ${patient?.full_name ?? 'patient'}.`);
      onIssued?.(record);
    } catch (e) {
      toast.error(e.message ?? 'Could not issue the token.');
    } finally {
      setSaving(false);
    }
  }

  const waitingLabel = ahead ? `${ahead} patient${ahead > 1 ? 's' : ''} ahead · roughly ${ahead * (doctor?.slot_minutes ?? 15)} min` : 'Next to be called';

  return (
    <>
      <Modal
        open={open} onClose={onClose}
        title={issued ? 'Token issued' : 'Issue a token'}
        sub={issued ? 'Hand this number to the patient — the doctor sees it on their queue' : 'Walk-ins and booked patients both get a number at the desk'}
        footer={issued ? (
          <>
            <Button variant="ghost" onClick={onClose}>Done</Button>
            <Button variant="subtle" icon={Printer} onClick={() => window.print()}>Print slip</Button>
            <Button variant="primary" icon={Ticket} onClick={() => { setIssued(null); setQuery(''); setReason(''); setPatientId(''); }}>
              Next patient
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={Check} onClick={issue} loading={saving} disabled={!patientId}>
              Issue {tokenLabel(token)}
            </Button>
          </>
        )}
      >
        {issued ? (
          <div className="stack" style={{ gap: 14 }}>
            <div className="card pad center" style={{ background: 'linear-gradient(160deg, var(--brand-50), var(--surface) 70%)' }}>
              <span className="eyebrow">Token number</span>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '3.4rem', fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1 }}>{tokenLabel(issued.token)}</div>
              <p className="small strong" style={{ marginTop: 6 }}>{patient?.full_name}</p>
              <p className="tiny muted">{patient?.code} · {doctor?.full_name} · {formatTime(issued.record.scheduled_at)}</p>
              <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}>
                <Badge tone="brand">{kind}</Badge>
                <Badge tone="neutral">{formatMoney(fee)}</Badge>
                {patient?.phone ? <Badge tone="neutral"><Phone size={10} /> {patient.phone}</Badge> : null}
              </div>
            </div>
            <div className="row small" style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11, gap: 8 }}>
              <AlertTriangle size={14} className="muted" />
              <span className="muted">Tell the patient their number will be called on the display / by name. They can wait in the lounge.</span>
            </div>
          </div>
        ) : (
          <div className="stack">
            <Field label="Patient *">
              {patient ? (
                <div className="appt" style={{ background: 'var(--surface-2)' }}>
                  <Avatar name={patient.full_name} />
                  <div className="who">
                    <b>{patient.full_name}</b>
                    <span className="tiny muted">{patient.code} · {patient.phone || 'no phone'}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setPatientId('')}>Change</Button>
                </div>
              ) : (
                <>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Phone number, name or patient ID" autoFocus />
                  <div className="stack" style={{ gap: 2, maxHeight: 190, overflowY: 'auto', marginTop: 4 }}>
                    {matches.map((p) => (
                      <button key={p.id} type="button" className="list-item" onClick={() => setPatientId(p.id)}>
                        <Avatar name={p.full_name} size="sm" />
                        <span className="li-main">
                          <span className="li-title">{p.full_name}</span>
                          <span className="li-sub">{p.code} · {p.phone || 'no phone'}</span>
                        </span>
                      </button>
                    ))}
                    <button type="button" className="list-item" onClick={() => setRegisterOpen(true)}>
                      <span className="kpi-icon" style={{ width: 30, height: 30 }}><UserPlus size={14} /></span>
                      <span className="li-main">
                        <span className="li-title">Register a new patient</span>
                        <span className="li-sub">Creates the chart and returns here</span>
                      </span>
                    </button>
                  </div>
                </>
              )}
            </Field>

            <div className="form-grid">
              <Field label="Doctor *">
                <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name} — {d.specialty}</option>)}
                </Select>
              </Field>
              <Field label="Visit type">
                <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {APPOINTMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Priority" hint="Urgent tokens are still numbered in order" className="span-2">
                <Segmented value={priority} onChange={setPriority} options={[{ value: 'normal', label: 'Normal' }, { value: 'urgent', label: 'Urgent / senior citizen' }]} />
              </Field>
              <Field label="Reason (optional)" className="span-2">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Fever since 2 days · BP review · report follow-up" />
              </Field>
            </div>

            <div className="card pad" style={{ background: 'var(--surface-2)' }}>
              <div className="row wrap" style={{ gap: 14 }}>
                <div>
                  <span className="eyebrow">Next token</span>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 800, lineHeight: 1.1 }}>{tokenLabel(token)}</div>
                </div>
                <div className="stack" style={{ gap: 2 }}>
                  <span className="tiny muted">{doctor?.full_name}</span>
                  <span className="tiny muted">{waitingLabel}</span>
                  <span className="tiny faint">{dayCount} token{dayCount === 1 ? '' : 's'} issued today · fee {formatMoney(fee)}</span>
                </div>
                <span className="spacer" />
                <Badge tone={ahead > 5 ? 'warn' : 'success'}>{ahead ? `${ahead} waiting` : 'Queue empty'}</Badge>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <PatientForm
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={(p) => { setRegisterOpen(false); setPatientId(p.id); }}
      />
    </>
  );
}
