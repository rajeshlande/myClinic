import { useMemo, useState } from 'react';
import { useStore } from '../lib/store.jsx';
import { useToast, Button, Field, Input, Select, Textarea, Modal } from './ui.jsx';
import { BLOOD_GROUPS, CHRONIC_TAGS, GENDERS, ageLabel, patientCode, validatePatient } from '../lib/logic.mjs';

const blank = {
  full_name: '', phone: '', email: '', gender: 'Female', dob: '', age_years: '',
  blood_group: '', address: '', city: '', emergency_contact: '', tags: [], allergies: '', notes: '',
};

export default function PatientForm({ open, onClose, patient, onCreated }) {
  const store = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState(() => ({ ...blank, ...(patient ?? {}) }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target?.value ?? e }));
  const toggleTag = (tag) => setDraft((d) => ({ ...d, tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag] }));

  const nextCode = useMemo(() => {
    if (patient?.code) return patient.code;
    const max = store.patients.reduce((m, p) => Math.max(m, Number(String(p.code).replace(/\D/g, '')) || 0), 0);
    return patientCode(max + 1);
  }, [store.patients, patient]);

  async function submit(e) {
    e.preventDefault();
    const found = validatePatient(draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = {
        code: nextCode,
        full_name: draft.full_name.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        gender: draft.gender,
        dob: draft.dob || null,
        age_years: draft.dob ? null : (draft.age_years ? Number(draft.age_years) : null),
        blood_group: draft.blood_group,
        address: draft.address.trim(),
        city: draft.city.trim(),
        emergency_contact: draft.emergency_contact.trim(),
        tags: draft.tags,
        allergies: draft.allergies.trim(),
        notes: draft.notes.trim(),
        archived: false,
      };
      let saved;
      if (patient) {
        await store.update('patients', patient.id, payload);
        saved = { ...patient, ...payload };
        toast.success('Patient record updated.');
      } else {
        saved = await store.create('patients', payload);
        toast.success(`${payload.full_name} registered as ${payload.code}.`);
      }
      onCreated?.(saved);
      onClose();
    } catch (err) {
      toast.error(err.message ?? 'Could not save the patient.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open} onClose={onClose} title={patient ? 'Edit patient' : 'Register a patient'} sub={`Patient ID ${nextCode} · created automatically`}
      footer={<>
        <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
        <Button variant="primary" onClick={submit} loading={saving} type="button">{patient ? 'Save changes' : 'Register patient'}</Button>
      </>}
    >
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Full name *" error={errors.full_name} className="span-2">
            <Input value={draft.full_name} onChange={set('full_name')} placeholder="e.g. Meera Iyer" error={errors.full_name} autoComplete="off" />
          </Field>
          <Field label="Mobile number" error={errors.phone} hint="Used for reminders and recalls">
            <Input value={draft.phone} onChange={set('phone')} placeholder="+91 98200 00000" inputMode="tel" error={errors.phone} />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input value={draft.email} onChange={set('email')} placeholder="name@example.com" type="email" error={errors.email} />
          </Field>
          <Field label="Gender">
            <Select value={draft.gender} onChange={set('gender')}>{GENDERS.map((g) => <option key={g}>{g}</option>)}</Select>
          </Field>
          <Field label="Date of birth" error={errors.dob} hint={draft.dob ? ageLabel(draft) : 'Age is calculated automatically'}>
            <Input type="date" value={draft.dob ?? ''} onChange={set('dob')} max={new Date().toISOString().slice(0, 10)} error={errors.dob} />
          </Field>
          {!draft.dob ? (
            <Field label="Approx. age (years)">
              <Input type="number" min="0" max="130" value={draft.age_years ?? ''} onChange={set('age_years')} placeholder="e.g. 34" />
            </Field>
          ) : null}
          <Field label="Blood group">
            <Select value={draft.blood_group} onChange={set('blood_group')}>
              <option value="">Unknown</option>
              {BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
            </Select>
          </Field>
          <Field label="City">
            <Input value={draft.city} onChange={set('city')} placeholder="Mumbai" />
          </Field>
          <Field label="Emergency contact">
            <Input value={draft.emergency_contact} onChange={set('emergency_contact')} placeholder="Name / phone" />
          </Field>
          <Field label="Address" className="span-2">
            <Input value={draft.address} onChange={set('address')} placeholder="Flat, street, area" />
          </Field>
        </div>

        <Field label="Chronic conditions & flags" hint="Visible on the patient chart and in consultations">
          <div className="row wrap" style={{ gap: 6 }}>
            {CHRONIC_TAGS.map((tag) => {
              const active = draft.tags.includes(tag);
              return (
                <button key={tag} type="button" className="badge" onClick={() => toggleTag(tag)} style={{ cursor: 'pointer', background: active ? 'var(--brand-50)' : 'var(--surface-2)', color: active ? 'var(--brand-600)' : 'var(--muted)', border: `1px solid ${active ? 'var(--brand-300)' : 'transparent'}`, minHeight: 28 }}>
                  {tag}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="form-grid">
          <Field label="Known allergies">
            <Input value={draft.allergies} onChange={set('allergies')} placeholder="Penicillin, sulfa…" />
          </Field>
          <Field label="Internal notes" className="span-2">
            <Textarea value={draft.notes} onChange={set('notes')} placeholder="Anything the next doctor should know" rows={2} />
          </Field>
        </div>

        <p className="tiny faint">
          Only your clinic’s staff can view this record. Nothing is shared with third parties, and the record is never deleted automatically.
        </p>
      </form>
    </Modal>
  );
}
