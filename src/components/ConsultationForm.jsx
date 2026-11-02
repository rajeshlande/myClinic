import { useMemo, useState } from 'react';
import { Activity, HeartPulse, Languages, Pill, Plus, Stethoscope, Trash2, Thermometer } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Button, Field, Input, Select, Textarea, Modal, Avatar, Badge, IconButton } from './ui.jsx';
import { addDays, ageLabel, formatMoney, today, validateConsultation } from '../lib/logic.mjs';
import { FREQUENCIES, RELATIONS, RX_LANGUAGES, patientInstruction } from '../lib/rx-language.js';

const blankVitals = { temperature_c: '', pulse_bpm: '', bp_systolic: '', bp_diastolic: '', spo2: '', weight_kg: '', height_cm: '' };
const newDrug = () => ({ drug: '', dose: '1 tablet', frequency: 'Twice a day', duration: '5 days', instructions: 'After food' });
const DURATIONS = ['3 days', '5 days', '7 days', '10 days', '14 days', '1 month', '2 months'];
const DOSES = ['1 tablet', '½ tablet', '2 tablets', '5 ml', '10 ml', '1 puff', '1 capsule', '1 sachet', 'As directed'];

export default function ConsultationForm({ open, onClose, appointment, patient, onSaved }) {
  const store = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState(() => ({
    complaint: appointment?.reason ?? '',
    examination: '',
    diagnoses: '',
    advice: '',
    vitals: { ...blankVitals },
    prescription: [newDrug()],
    follow_up_on: '',
    rx_language: patient?.preferred_language ?? 'en',
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const last = useMemo(() => {
    const list = store.consultations.filter((c) => c.patient_id === patient?.id).sort((a, b) => b.visited_on.localeCompare(a.visited_on));
    return list[0] ?? null;
  }, [store.consultations, patient]);

  const doctor = store.doctors.find((d) => d.id === appointment?.doctor_id) ?? store.currentStaff;
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target?.value ?? e }));
  const setVital = (key) => (e) => setDraft((d) => ({ ...d, vitals: { ...d.vitals, [key]: e.target.value } }));
  const setDrug = (index, key) => (e) => setDraft((d) => ({ ...d, prescription: d.prescription.map((rx, i) => (i === index ? { ...rx, [key]: e.target.value } : rx)) }));

  async function submit(createInvoice = false) {
    const found = validateConsultation({ ...draft, complaint: draft.complaint });
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const vitals = Object.fromEntries(Object.entries(draft.vitals).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)]));
      const payload = {
        patient_id: patient.id,
        doctor_id: doctor?.id,
        appointment_id: appointment?.id ?? null,
        visited_on: today(),
        complaint: draft.complaint.trim(),
        examination: draft.examination.trim(),
        diagnoses: draft.diagnoses.split(',').map((d) => d.trim()).filter(Boolean),
        advice: draft.advice.trim(),
        vitals,
        prescription: draft.prescription.filter((rx) => rx.drug.trim()),
        rx_language: draft.rx_language,
        follow_up_on: draft.follow_up_on || addDays(today(), store.clinic?.follow_up_days ?? 15),
        follow_up_done: false,
      };
      const saved = await store.create('consultations', payload);
      if (appointment) await store.update('appointments', appointment.id, { status: 'completed' });

      if (createInvoice) {
        const fee = appointment?.kind === 'Follow-up' ? (doctor?.follow_up_fee_paise ?? 25000) : (doctor?.fee_paise ?? 50000);
        const count = store.invoices.length + 1;
        await store.create('invoices', {
          number: `INV/2526/${String(count).padStart(4, '0')}`,
          patient_id: patient.id,
          doctor_id: doctor?.id ?? null,
          appointment_id: appointment?.id ?? null,
          issued_on: today(),
          lines: [{ service_id: 'svc-consult', name: 'Consultation', category: 'Consultation', qty: 1, rate_paise: fee, discount: 0, tax_rate: 0, total: fee }],
          subtotal_paise: fee, discount_paise: 0, tax_paise: 0, total_paise: fee, paid_paise: 0,
          method: 'cash', status: 'unpaid', notes: '',
        });
        toast.success('Consultation saved and an invoice was raised.');
      } else {
        toast.success('Consultation saved to the patient chart.');
      }
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toast.error(e.message ?? 'Could not save the consultation.');
    } finally {
      setSaving(false);
    }
  }

  const fee = appointment?.kind === 'Follow-up' ? (doctor?.follow_up_fee_paise ?? 0) : (doctor?.fee_paise ?? 0);

  return (
    <Modal
      open={open} onClose={onClose} wide
      title="Consultation notes"
      sub={patient ? `${patient.full_name} · ${ageLabel(patient)} · ${patient.code}` : 'Select a patient first'}
      footer={<>
        <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
        <Button variant="subtle" onClick={() => submit(false)} loading={saving} type="button">Save notes</Button>
        <Button variant="primary" onClick={() => submit(true)} loading={saving} type="button" icon={Plus}>Save &amp; bill {formatMoney(fee)}</Button>
      </>}
    >
      <div className="stack">
        {last ? (
          <div className="row small" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '9px 11px', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="info">Last visit</Badge>
            <span className="muted">{last.visited_on} · {(last.diagnoses ?? []).join(', ') || 'no diagnosis recorded'}</span>
            {last.vitals?.bp_systolic ? <span className="spacer tiny faint">BP {last.vitals.bp_systolic}/{last.vitals.bp_diastolic}</span> : null}
          </div>
        ) : null}

        <Field label="Presenting complaint *" error={errors.complaint}>
          <Textarea value={draft.complaint} onChange={set('complaint')} rows={2} placeholder="Onset, duration, severity, associated symptoms" />
        </Field>

        <div>
          <span className="label" style={{ marginBottom: 6, display: 'block' }}><HeartPulse size={13} /> Vitals</span>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
            <Field label="Temp °F" error={errors.temperature_c}><Input value={draft.vitals.temperature_c} onChange={setVital('temperature_c')} inputMode="decimal" placeholder="e.g. 98.6" /></Field>
            <Field label="Pulse bpm" error={errors.pulse_bpm}><Input value={draft.vitals.pulse_bpm} onChange={setVital('pulse_bpm')} inputMode="numeric" placeholder="e.g. 78" /></Field>
            <Field label="BP sys"><Input value={draft.vitals.bp_systolic} onChange={setVital('bp_systolic')} inputMode="numeric" placeholder="e.g. 120" /></Field>
            <Field label="BP dia"><Input value={draft.vitals.bp_diastolic} onChange={setVital('bp_diastolic')} inputMode="numeric" placeholder="e.g. 80" /></Field>
            <Field label="SpO₂ %" error={errors.spo2}><Input value={draft.vitals.spo2} onChange={setVital('spo2')} inputMode="numeric" placeholder="e.g. 98" /></Field>
            <Field label="Weight kg"><Input value={draft.vitals.weight_kg} onChange={setVital('weight_kg')} inputMode="decimal" placeholder="e.g. 64" /></Field>
          </div>
        </div>

        <Field label="Examination findings">
          <Textarea value={draft.examination} onChange={set('examination')} rows={2} placeholder="Systemic examination, local findings" />
        </Field>

        <div className="form-grid">
          <Field label="Diagnosis / impression" hint="Comma separated"><Input value={draft.diagnoses} onChange={set('diagnoses')} placeholder="Acute pharyngitis, Vitamin D deficiency" /></Field>
          <Field label="Follow-up on" hint={`Default: ${store.clinic?.follow_up_days ?? 15} days`}>
            <Input type="date" value={draft.follow_up_on} min={today()} onChange={set('follow_up_on')} />
          </Field>
        </div>

        <Field label="Advice / plan">
          <Textarea value={draft.advice} onChange={set('advice')} rows={2} placeholder="Investigations, lifestyle, red-flag instructions" />
        </Field>

        <div>
          <div className="row wrap" style={{ marginBottom: 8, gap: 8 }}>
            <span className="label"><Pill size={13} /> Prescription</span>
            <span className="spacer" />
            <span className="row tiny muted" style={{ gap: 5 }}><Languages size={12} /> Instructions in</span>
            <Select
              value={draft.rx_language}
              onChange={(e) => setDraft((d) => ({ ...d, rx_language: e.target.value }))}
              style={{ width: 'auto', minWidth: 130 }}
            >
              {RX_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label} — {l.native}</option>)}
            </Select>
            <Button size="sm" variant="subtle" icon={Plus} onClick={() => setDraft((d) => ({ ...d, prescription: [...d.prescription, newDrug()] }))} type="button">Add drug</Button>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {draft.prescription.map((rx, i) => (
              <div key={i} className="card pad" style={{ padding: 10, background: 'var(--surface-2)' }}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="tiny eyebrow">Drug {i + 1}</span>
                  <span className="spacer" />
                  {draft.prescription.length > 1 ? (
                    <IconButton icon={Trash2} label="Remove drug" size={14} className="plain sm" onClick={() => setDraft((d) => ({ ...d, prescription: d.prescription.filter((_, j) => j !== i) }))} />
                  ) : null}
                </div>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                  <Field label="Drug" className="span-2"><Input value={rx.drug} onChange={setDrug(i, 'drug')} placeholder="Paracetamol 650mg" /></Field>
                  <Field label="Dose">
                    <Input value={rx.dose} onChange={setDrug(i, 'dose')} placeholder="1 tablet" list="rx-doses" />
                    <datalist id="rx-doses">{DOSES.map((x) => <option key={x} value={x} />)}</datalist>
                  </Field>
                  <Field label="How often">
                    <Select value={rx.frequency} onChange={setDrug(i, 'frequency')}>
                      {FREQUENCIES.map((f) => <option key={f.value}>{f.value}</option>)}
                    </Select>
                  </Field>
                  <Field label="For">
                    <Input value={rx.duration} onChange={setDrug(i, 'duration')} placeholder="5 days" list="rx-durations" />
                    <datalist id="rx-durations">{DURATIONS.map((x) => <option key={x} value={x} />)}</datalist>
                  </Field>
                  <Field label="Food relation" className="span-2">
                    <Select value={rx.instructions} onChange={setDrug(i, 'instructions')}>
                      {['', ...RELATIONS.map((r) => r.value)].map((f) => <option key={f || 'none'} value={f}>{f || '— none —'}</option>)}
                    </Select>
                  </Field>
                </div>
                {rx.drug.trim() ? (
                  <div className="tiny" style={{ marginTop: 6, color: 'var(--brand-600)', fontWeight: 600 }}>
                    {patientInstruction(rx, draft.rx_language)} 
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <p className="tiny faint"><Stethoscope size={11} /> Saved to this patient’s chart. The printed slip shows these directions in {RX_LANGUAGES.find((l) => l.code === draft.rx_language)?.native} — medicine names stay in English for the chemist.</p>
      </div>
    </Modal>
  );
}
