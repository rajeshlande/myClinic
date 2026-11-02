import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Building2, Check, Clock, Stethoscope, TriangleAlert, UserRound } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useAuth } from '../lib/auth-context.jsx';
import { Button, Field, Input, Select, Badge, Progress } from '../components/ui.jsx';
import { CLINIC_TYPES, moneyToPaise, paiseToInput } from '../lib/logic.mjs';

const STEPS = [
  { id: 'clinic', title: 'Clinic details', icon: Building2 },
  { id: 'doctor', title: 'Lead doctor', icon: Stethoscope },
  { id: 'hours', title: 'Hours & fees', icon: Clock },
];

export default function Onboarding() {
  const store = useStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: store.clinic?.name?.startsWith('Sunrise') ? '' : store.clinic?.name ?? '',
    clinic_type: CLINIC_TYPES[0],
    phone: '', email: user?.email ?? '', address: '',
    owner_name: store.profile?.full_name ?? '', specialty: 'General Physician', qualification: 'MBBS', registration_no: '',
    open_time: '09:00', close_time: '20:00', slot_minutes: 15,
    fee: '500', follow_up_fee: '250', follow_up_days: 15,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function finish() {
    if (!form.name.trim()) { setError('Give the clinic a name.'); setStep(0); return; }
    if (!form.owner_name.trim()) { setError('Add the doctor’s name.'); setStep(1); return; }
    setSaving(true);
    setError('');
    try {
      let fee = 50000, followUp = 25000;
      try { fee = moneyToPaise(form.fee); followUp = moneyToPaise(form.follow_up_fee); } catch { /* keep defaults */ }
      await store.createClinic({
        clinic: {
          name: form.name.trim(), clinic_type: form.clinic_type, phone: form.phone.trim(),
          email: form.email.trim(), address: form.address.trim(),
          consultation_fee_paise: fee, follow_up_fee_paise: followUp,
          follow_up_days: Number(form.follow_up_days) || 15,
          slot_minutes: Number(form.slot_minutes) || 15,
          open_time: form.open_time, close_time: form.close_time,
        },
        owner: {
          full_name: form.owner_name.trim(), specialty: form.specialty,
          qualification: form.qualification, registration_no: form.registration_no.trim(),
          phone: form.phone.trim(), email: form.email.trim(),
          day_start: form.open_time, day_end: form.close_time,
          slot_minutes: Number(form.slot_minutes) || 15,
          fee_paise: fee, follow_up_fee_paise: followUp,
        },
      });
      navigate('/app/dashboard');
    } catch (e) {
      setError(e.message ?? 'Could not create the clinic.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <div className="card" style={{ width: 'min(680px, 100%)', overflow: 'hidden' }}>
        <div style={{ padding: '22px 22px 0' }}>
          <div className="row" style={{ gap: 10, marginBottom: 14 }}>
            <span className="brand-mark"><Stethoscope size={18} /></span>
            <div>
              <div className="brand-name">Set up your clinic</div>
              <div className="tiny faint">Step {step + 1} of {STEPS.length} · about 2 minutes</div>
            </div>
            <span className="spacer" />
            <Badge tone="brand">{store.mode === 'demo' ? 'Demo' : 'Live'}</Badge>
          </div>
          <Progress value={(step + 1) / STEPS.length} />
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            {STEPS.map((s, i) => (
              <span key={s.id} className={`badge ${i === step ? 'brand' : i < step ? 'success' : 'neutral'}`}>
                {i < step ? <Check size={11} /> : <s.icon size={11} />} {s.title}
              </span>
            ))}
          </div>
        </div>

        <div style={{ padding: 22 }} className="stack">
          {error ? (
            <div className="row" style={{ gap: 8, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '10px 12px', borderRadius: 12 }}>
              <TriangleAlert size={15} /><span className="small">{error}</span>
            </div>
          ) : null}

          {step === 0 ? (
            <div className="form-grid">
              <Field label="Clinic name *" className="span-2"><Input value={form.name} onChange={set('name')} placeholder="Sunrise Multispecialty OPD" autoFocus /></Field>
              <Field label="Clinic type"><Select value={form.clinic_type} onChange={set('clinic_type')}>{CLINIC_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Clinic phone"><Input value={form.phone} onChange={set('phone')} placeholder="+91 22 4000 1200" inputMode="tel" /></Field>
              <Field label="Front-desk email"><Input value={form.email} onChange={set('email')} type="email" placeholder="front.desk@clinic.in" /></Field>
              <Field label="Address" className="span-2"><Input value={form.address} onChange={set('address')} placeholder="Floor, building, street, area, city" /></Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="form-grid">
              <Field label="Doctor’s full name *" className="span-2"><Input value={form.owner_name} onChange={set('owner_name')} placeholder="Dr. Anita Rao" autoFocus /></Field>
              <Field label="Specialty"><Input value={form.specialty} onChange={set('specialty')} placeholder="Internal Medicine" /></Field>
              <Field label="Qualification"><Input value={form.qualification} onChange={set('qualification')} placeholder="MBBS, MD" /></Field>
              <Field label="Registration number" hint="State medical council number"><Input value={form.registration_no} onChange={set('registration_no')} placeholder="MH-2011-48213" /></Field>
              <Field label="Doctor’s phone"><Input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="+91 98200 00000" /></Field>
              <div className="span-2">
                <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
                  <UserRound size={14} className="faint" />
                  <span className="muted">You are signed in as the clinic owner. Add reception and other doctors later from <strong>Doctors &amp; staff</strong>.</span>
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="form-grid">
              <Field label="Opens at"><Input type="time" value={form.open_time} onChange={set('open_time')} /></Field>
              <Field label="Closes at"><Input type="time" value={form.close_time} onChange={set('close_time')} /></Field>
              <Field label="Slot length">
                <Select value={form.slot_minutes} onChange={set('slot_minutes')}>
                  {[5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </Select>
              </Field>
              <Field label="Follow-up valid for">
                <Select value={form.follow_up_days} onChange={set('follow_up_days')}>
                  {[7, 10, 15, 21, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
                </Select>
              </Field>
              <Field label="Consultation fee ₹"><Input value={form.fee} onChange={set('fee')} inputMode="decimal" placeholder="500" /></Field>
              <Field label="Follow-up fee ₹"><Input value={form.follow_up_fee} onChange={set('follow_up_fee')} inputMode="decimal" placeholder="250" /></Field>
              <div className="span-2 tiny muted">
                Fees are suggestions only — the front desk can change them on each invoice. All amounts are stored in paise.
              </div>
            </div>
          ) : null}
        </div>

        <div className="modal-foot" style={{ position: 'static', borderRadius: 0 }}>
          {step > 0 ? <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button> : <span />}
          <span className="spacer" />
          {step < STEPS.length - 1
            ? <Button variant="primary" icon={ArrowRight} onClick={() => { setError(''); setStep((s) => s + 1); }}>Continue</Button>
            : <Button variant="primary" icon={Check} onClick={finish} loading={saving}>Create clinic</Button>}
        </div>
      </div>
    </div>
  );
}
