import { useMemo, useState, useEffect, useRef } from 'react';
import {
  Activity, HeartPulse, Languages, Pill, Plus, Stethoscope, Trash2, Thermometer, FileText, Droplets,
  ShieldAlert, Save, History, X, AlertTriangle, Info, CheckCircle2, Sparkles,
} from 'lucide-react';
import MedicinePicker from './MedicinePicker.jsx';
import {
  FORMULARY_VERSION, SCHEDULES, checkPrescriptionSafety, medicineToLine, recentMedicines, requiresAcknowledgement,
} from '../lib/medicines.mjs';
import { useStore } from '../lib/store.jsx';
import { can } from '../lib/permissions.js';
import { useToast, Button, Field, Input, Select, Textarea, Modal, Avatar, Badge, IconButton } from './ui.jsx';
import { addDays, ageLabel, formatDate, formatMoney, nextRxNumber, today, validateConsultation } from '../lib/logic.mjs';
import { FREQUENCIES, RELATIONS, RX_LANGUAGES, patientInstruction } from '../lib/rx-language.js';

const blankVitals = { temperature_c: '', pulse_bpm: '', bp_systolic: '', bp_diastolic: '', spo2: '', weight_kg: '', height_cm: '' };
const newDrug = () => ({
  drug: '', dose: '1 tablet', frequency: 'Twice a day', duration: '5 days', instructions: 'After food',
  medicine_id: null, salt: '', form: '', schedule: null,
});
const DURATIONS = ['3 days', '5 days', '7 days', '10 days', '14 days', '1 month', '2 months'];
const DOSES = ['1 tablet', '½ tablet', '2 tablets', '5 ml', '10 ml', '1 puff', '1 capsule', '1 sachet', 'As directed'];

// Reference ranges shown next to each vital input (adult, indicative).
const VITAL_RANGE = {
  temperature_c: { label: 'normal 97–99 °F', unit: '°F' },
  pulse_bpm: { label: 'normal 60–100 bpm', unit: 'bpm' },
  bp_systolic: { label: 'normal 90–120', unit: 'mmHg' },
  bp_diastolic: { label: 'normal 60–80', unit: 'mmHg' },
  spo2: { label: 'normal 95–100 %', unit: '%' },
  weight_kg: { label: 'adult reference', unit: 'kg' },
};


export default function ConsultationForm({ open, onClose, appointment, patient, onSaved }) {
  const store = useStore();
  const toast = useToast();
  const formRef = useRef(null);
  const dirtyRef = useRef(false);

  const initialDraft = () => ({
    complaint: appointment?.reason ?? '',
    examination: '',
    diagnoses: '',
    advice: '',
    vitals: { ...blankVitals },
    prescription: [newDrug()],
    follow_up_on: '',
    rx_language: activePatient?.preferred_language ?? 'en',
  });
  const [localPatient, setLocalPatient] = useState(null);
  const activePatient = patient ?? localPatient;

  const [draft, setDraft] = useState(initialDraft());
  const [errors, setErrors] = useState({});
  const [historyOpen, setHistoryOpen] = useState(false);
  // Safety acknowledgements survive re-renders: keyed by the warning's stable id.
  const [acked, setAcked] = useState({});
  // A doctor sees the chart, not the counter (schema 10 denies them invoices), so
  // the form offers "Save notes" and nothing that would be refused.
  const canBill = can(store.role ?? 'owner', 'invoice:create');
  const recent = useMemo(() => recentMedicines(store.consultations, 40), [store.consultations]);
  const safety = useMemo(
    () => checkPrescriptionSafety(draft.prescription, { allergies: activePatient?.allergies }),
    [draft.prescription, activePatient],
  );
  const blockers = useMemo(() => requiresAcknowledgement(safety).filter((w) => !acked[w.id]), [safety, acked]);
  const [saving, setSaving] = useState(false);
  const [patientQuery, setPatientQuery] = useState('');
  const last = useMemo(() => {
    const list = store.consultations.filter((c) => c.patient_id === activePatient?.id).sort((a, b) => b.visited_on.localeCompare(a.visited_on));
    return list[0] ?? null;
  }, [store.consultations, activePatient]);

  const history = useMemo(() => store.consultations
    .filter((c) => c.patient_id === activePatient?.id)
    .sort((a, b) => String(b.visited_on).localeCompare(String(a.visited_on))), [store.consultations, activePatient]);

  const doctor = store.doctors.find((d) => d.id === appointment?.doctor_id) ?? store.currentStaff;
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target?.value ?? e }));
  const setVital = (key) => (e) => setDraft((d) => ({ ...d, vitals: { ...d.vitals, [key]: e.target.value } }));
  const setDrug = (index, key) => (e) => setDraft((d) => ({
    ...d,
    prescription: d.prescription.map((rx, i) => {
      if (i !== index) return rx;
      // Editing the name by hand detaches the line from the catalogue: a changed
      // drug must never keep the old drug's molecule, schedule or safety identity.
      if (key === 'drug') return { ...rx, drug: e.target.value, medicine_id: null, salt: '', form: '', schedule: null };
      return { ...rx, [key]: e.target.value };
    }),
  }));

  // ---- unsaved-changes guard ----
  useEffect(() => {
    const prev = JSON.stringify(initialDraft());
    const curr = JSON.stringify(draft);
    dirtyRef.current = prev !== curr;
    const onBeforeUnload = (e) => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    document.addEventListener('beforeunload', onBeforeUnload);
    return () => document.removeEventListener('beforeunload', onBeforeUnload);
  }, [draft]);

  // Cmd/Ctrl + Enter saves
  useEffect(() => {
    if (!open || !formRef.current) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit(false);
      }
    };
    formRef.current?.addEventListener('keydown', onKey);
    return () => formRef.current?.removeEventListener('keydown', onKey);
  }, [open, draft]);

  const requestClose = () => {
    if (dirtyRef.current && !window.confirm('You have unsaved consultation notes. Discard them?')) return;
    onClose();
  };

  async function submit(createInvoice = false) {
    if (!activePatient) { toast.error('Choose a patient first.'); return; }
    const found = validateConsultation({ ...draft, complaint: draft.complaint });
    setErrors(found);
    if (Object.keys(found).length) return;
    // A high-severity finding has to be seen and accepted — never silently sent.
    if (blockers.length) {
      toast.error(`Review ${blockers.length} safety alert${blockers.length === 1 ? '' : 's'} before saving.`);
      return;
    }
    setSaving(true);
    try {
      const vitals = Object.fromEntries(Object.entries(draft.vitals).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)]));
      const payload = {
        patient_id: activePatient?.id,
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
        // The prescription gets its own numbered series, independent of the invoice.
        rx_number: nextRxNumber(store.consultations),
        rx_version: 1,
        // What the safety engine said, and which findings the doctor accepted.
        rx_safety: {
          formulary: FORMULARY_VERSION,
          checked_at: new Date().toISOString(),
          warnings: safety.map(({ id, severity, title }) => ({ id, severity, title })),
          acknowledged: safety.filter((w) => acked[w.id]).map((w) => w.id),
        },
        follow_up_on: draft.follow_up_on || addDays(today(), store.clinic?.follow_up_days ?? 15),
        follow_up_done: false,
      };
      const saved = await store.create('consultations', payload);
      if (appointment) await store.update('appointments', appointment.id, { status: 'completed' });

      let raised = null;
      if (createInvoice && canBill) {
        const fee = appointment?.kind === 'Follow-up' ? (doctor?.follow_up_fee_paise ?? 25000) : (doctor?.fee_paise ?? 50000);
        const count = store.invoices.length + 1;
        raised = await store.create('invoices', {
          number: `INV/2526/${String(count).padStart(4, '0')}`,
          patient_id: activePatient?.id,
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
      dirtyRef.current = false;
      // The caller gets both records: the chart shows the consultation, the
      // counter continues straight into collecting on the invoice it raised.
      onSaved?.(saved, raised);
      onClose();
    } catch (e) {
      toast.error(e.message ?? 'Could not save the consultation.');
    } finally {
      setSaving(false);
    }
  }

  const fee = appointment?.kind === 'Follow-up' ? (doctor?.follow_up_fee_paise ?? 0) : (doctor?.fee_paise ?? 0);

  // Patient not explicitly chosen yet — show a selector instead of silently defaulting.
  const patientSelector = !patient ? (
    <Field label="Patient *">
      <Select
        value={patientQuery}
        onChange={(e) => {
          setPatientQuery(e.target.value);
          const picked = store.patients.find((p) => p.full_name === e.target.value || p.code === e.target.value);
          if (picked) { setLocalPatient(picked); setDraft((d) => ({ ...d, rx_language: picked.preferred_language ?? 'en' })); }
        }}
        style={{ minWidth: 260 }}
      >
        <option value="">Choose a patient…</option>
        {store.patients.map((p) => <option key={p.id} value={p.full_name}>{p.full_name} · {p.code}</option>)}
      </Select>
      {patientQuery && !store.patients.find((p) => p.full_name === patientQuery || p.code === patientQuery) ? <span className="err">Not found</span> : null}
    </Field>
  ) : null;

  const ageSex = activePatient ? (
    <span className="tiny muted">{ageLabel(activePatient)} · {activePatient.gender}</span>
  ) : null;
  const bloodGroup = activePatient?.blood_group ? <span className="tiny muted">Blood group {activePatient.blood_group}</span> : null;
  const allergies = activePatient?.allergies ? (
    <span className="tiny" style={{ color: 'var(--danger)', fontWeight: 600 }}>
      <ShieldAlert size={11} /> ALLERGY: {activePatient.allergies}
    </span>
  ) : null;

  return (
    <Modal
      open={open} onClose={requestClose} wide
      title="Consultation notes"
      sub={activePatient ? `${activePatient.full_name} · ${activePatient.code}` : 'Select a patient first'}
      ref={formRef}
      footer={<>
        <kbd style={{ fontSize: 11, opacity: 0.6, marginRight: 8 }}>⌘/Ctrl + Enter to save</kbd>
        <Button variant="ghost" onClick={requestClose} type="button">Cancel</Button>
        <Button variant="subtle" onClick={() => submit(false)} loading={saving} disabled={!activePatient} type="button">
          <Save size={14} /> Save notes
        </Button>
        {canBill ? (
          <Button variant="primary" onClick={() => submit(true)} loading={saving} disabled={!activePatient} type="button" icon={Plus}>Save &amp; bill {formatMoney(fee)}</Button>
        ) : null}
      </>}
    >
      <div className="stack" ref={formRef}>
        {patientSelector}

        {activePatient ? (
          <div className="patient-context">
            <Badge tone="info" size="sm">Patient context</Badge>
            {ageSex} {bloodGroup} {allergies}
            {last ? (
              <span className="tiny faint ctx-last">
                <FileText size={11} /> Last visit {last.visited_on} · {(last.diagnoses ?? []).join(', ') || 'no diagnosis recorded'}
                {last.vitals?.bp_systolic ? ` · BP ${last.vitals.bp_systolic}/${last.vitals.bp_diastolic}` : ''}
              </span>
            ) : null}
            <Button
              size="sm" variant="subtle" icon={History} type="button"
              className="ctx-history"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((v) => !v)}
            >
              {historyOpen ? 'Hide history' : `History (${history.length})`}
            </Button>
          </div>
        ) : null}

        {historyOpen && activePatient ? (
          <section className="history-panel" aria-label="Previous patient history">
            <header className="history-head">
              <span className="label" style={{ margin: 0 }}><History size={13} /> Previous visits · {activePatient.full_name}</span>
              <span className="spacer" />
              <span className="tiny faint">{history.length} visit{history.length === 1 ? '' : 's'} on record</span>
              <button type="button" className="icon-btn plain sm" aria-label="Close history" onClick={() => setHistoryOpen(false)}>
                <X size={14} />
              </button>
            </header>
            {history.length ? (
              <div className="history-list">
                {history.map((v) => {
                  const vDate = v.visited_on;
                  const vit = v.vitals ?? {};
                  const drugs = (v.prescription ?? []).filter((r) => r?.drug);
                  const doctorName = store.doctors.find((d) => d.id === v.doctor_id)?.full_name ?? 'Doctor';
                  return (
                    <article key={v.id} className="history-visit">
                      <div className="history-visit-top">
                        <span className="strong small">{formatDate(vDate)}</span>
                        {vDate === today() ? <Badge tone="success" size="sm">Today</Badge> : null}
                        <span className="tiny faint">{doctorName}</span>
                        <span className="spacer" />
                        {v.follow_up_on ? (
                          <span className="tiny faint">
                            {v.follow_up_done ? 'Follow-up done' : `Follow-up ${formatDate(v.follow_up_on)}`}
                          </span>
                        ) : null}
                      </div>
                      {v.complaint ? <p className="history-line"><span className="history-key">Complaint</span> {v.complaint}</p> : null}
                      {(v.diagnoses ?? []).length ? (
                        <p className="history-line">
                          <span className="history-key">Diagnosis</span>
                          {(v.diagnoses ?? []).map((d) => <span key={d} className="tag">{d}</span>)}
                        </p>
                      ) : null}
                      {vit.bp_systolic || vit.pulse_bpm || vit.temperature_c || vit.spo2 || vit.weight_kg ? (
                        <p className="history-line">
                          <span className="history-key">Vitals</span>
                          <span className="tiny">
                            {[
                              vit.bp_systolic ? `BP ${vit.bp_systolic}/${vit.bp_diastolic}` : null,
                              vit.pulse_bpm ? `Pulse ${vit.pulse_bpm} bpm` : null,
                              vit.temperature_c ? `Temp ${vit.temperature_c} °F` : null,
                              vit.spo2 ? `SpO₂ ${vit.spo2}%` : null,
                              vit.weight_kg ? `Wt ${vit.weight_kg} kg` : null,
                            ].filter(Boolean).join(' · ')}
                          </span>
                        </p>
                      ) : null}
                      {drugs.length ? (
                        <p className="history-line">
                          <span className="history-key">Rx ({drugs.length})</span>
                          <span className="tiny">{drugs.map((r) => r.drug).join(' · ')}</span>
                        </p>
                      ) : null}
                      {v.examination ? <p className="history-line"><span className="history-key">Exam</span> <span className="tiny">{v.examination}</span></p> : null}
                      {v.advice ? <p className="history-line"><span className="history-key">Advice</span> <span className="tiny">{v.advice}</span></p> : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="tiny faint" style={{ margin: '10px 0 2px' }}>No previous visits recorded for this patient — this is their first consultation.</p>
            )}
          </section>
        ) : null}

        <Field label="Presenting complaint *" error={errors.complaint}>
          <Textarea value={draft.complaint} onChange={set('complaint')} rows={2} placeholder="Onset, duration, severity, associated symptoms" />
        </Field>

        <div>
          <span className="label" style={{ marginBottom: 6, display: 'block' }}><HeartPulse size={13} /> Vitals</span>
          <div className="form-grid vitals-grid">
            <Field label="Temp °F" error={errors.temperature_c}>
              <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                <Input value={draft.vitals.temperature_c} onChange={setVital('temperature_c')} inputMode="decimal" placeholder="e.g. 98.6" />
                <span className="tiny faint">{VITAL_RANGE.temperature_c.label}</span>
              </div>
            </Field>
            <Field label="Pulse bpm" error={errors.pulse_bpm}>
              <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                <Input value={draft.vitals.pulse_bpm} onChange={setVital('pulse_bpm')} inputMode="numeric" placeholder="e.g. 78" />
                <span className="tiny faint">{VITAL_RANGE.pulse_bpm.label}</span>
              </div>
            </Field>
            <Field label="BP sys">
              <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                <Input value={draft.vitals.bp_systolic} onChange={setVital('bp_systolic')} inputMode="numeric" placeholder="e.g. 120" />
                <span className="tiny faint">{VITAL_RANGE.bp_systolic.label}</span>
              </div>
            </Field>
            <Field label="BP dia">
              <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                <Input value={draft.vitals.bp_diastolic} onChange={setVital('bp_diastolic')} inputMode="numeric" placeholder="e.g. 80" />
                <span className="tiny faint">{VITAL_RANGE.bp_diastolic.label}</span>
              </div>
            </Field>
            <Field label="SpO₂ %" error={errors.spo2}>
              <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                <Input value={draft.vitals.spo2} onChange={setVital('spo2')} inputMode="numeric" placeholder="e.g. 98" />
                <span className="tiny faint">{VITAL_RANGE.spo2.label}</span>
              </div>
            </Field>
            <Field label="Weight kg">
              <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                <Input value={draft.vitals.weight_kg} onChange={setVital('weight_kg')} inputMode="decimal" placeholder="e.g. 64" />
                <span className="tiny faint">{VITAL_RANGE.weight_kg.label}</span>
              </div>
            </Field>
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

          {/* What this clinic actually prescribes — not a generic template list. */}
          {recent.length ? (
            <div style={{ marginBottom: 8 }}>
              <span className="tiny eyebrow" style={{ marginBottom: 4, display: 'block' }}>
                <Sparkles size={10} /> Recently prescribed here
              </span>
              <div className="row wrap recent-chips" style={{ gap: 6 }}>
                {recent.slice(0, 6).map((line, i) => (
                  <Button
                    key={`${line.drug}-${i}`} size="sm" variant="subtle" type="button"
                    title={line.salt || line.drug}
                    onClick={() => setDraft((d) => ({ ...d, prescription: [...d.prescription, { ...newDrug(), ...line }] }))}
                  >
                    {line.drug}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Safety findings sit above the drugs, where they are read before writing. */}
          {safety.length ? (
            <div className="rx-safety" role="status" aria-live="polite">
              {safety.map((w) => {
                const Icon = w.severity === 'high' ? AlertTriangle : w.severity === 'moderate' ? ShieldAlert : Info;
                const needsAck = w.severity === 'high';
                return (
                  <div key={w.id} className={`rx-safety-item ${w.severity} ${acked[w.id] ? 'acknowledged' : ''}`}>
                    <Icon size={15} className="rx-safety-icon" />
                    <div className="rx-safety-body">
                      <strong className="small">{w.title}</strong>
                      <p className="tiny" style={{ margin: '1px 0 0' }}>{w.detail}</p>
                      {needsAck ? (
                        <label className="rx-safety-ack">
                          <input
                            type="checkbox"
                            checked={Boolean(acked[w.id])}
                            onChange={(e) => setAcked((a) => ({ ...a, [w.id]: e.target.checked }))}
                          />
                          <span>I have reviewed this and want to prescribe anyway (recorded)</span>
                        </label>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : draft.prescription.some((r) => r.drug.trim()) ? (
            <div className="rx-safety-clear">
              <CheckCircle2 size={13} /> No duplicate molecules, class clashes or recorded allergies found.
            </div>
          ) : null}

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
                <div className="form-grid rx-drug-grid">
                  <Field label="Drug" className="span-2">
                    <MedicinePicker
                      value={rx.drug}
                      clinicHistory={recent}
                      onChange={(text) => setDrug(i, 'drug')({ target: { value: text } })}
                      // Picking a medicine replaces the whole line: name, molecule,
                      // form, schedule and the dose/frequency/duration defaults.
                      onSelect={(med) => {
                        const next = medicineToLine(med);
                        if (!next) return;
                        setDraft((d) => ({
                          ...d,
                          prescription: d.prescription.map((row, j) => (j === i ? { ...row, ...next } : row)),
                        }));
                      }}
                      ariaLabel={`Medicine ${i + 1}`}
                    />
                    {rx.salt ? (
                      <span className="rx-salt-line">
                        {rx.salt}
                        {rx.schedule && SCHEDULES[rx.schedule] ? (
                          <span className={`med-schedule ${rx.schedule.toLowerCase()}`} title={SCHEDULES[rx.schedule].note}>
                            {SCHEDULES[rx.schedule].label}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </Field>
                  <Field label="Dose"><Input value={rx.dose} onChange={setDrug(i, 'dose')} placeholder="1 tablet" list="rx-doses" /><datalist id="rx-doses">{DOSES.map((x) => <option key={x} value={x} />)}</datalist></Field>
                  <Field label="How often"><Select value={rx.frequency} onChange={setDrug(i, 'frequency')}>{FREQUENCIES.map((f) => <option key={f.value}>{f.value}</option>)}</Select></Field>
                  <Field label="For"><Input value={rx.duration} onChange={setDrug(i, 'duration')} placeholder="5 days" list="rx-durations" /><datalist id="rx-durations">{DURATIONS.map((x) => <option key={x} value={x} />)}</datalist></Field>
                  <Field label="Food relation" className="span-2"><Select value={rx.instructions} onChange={setDrug(i, 'instructions')}>{['', ...RELATIONS.map((r) => r.value)].map((f) => <option key={f || 'none'} value={f}>{f || '— none —'}</option>)}</Select></Field>
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
