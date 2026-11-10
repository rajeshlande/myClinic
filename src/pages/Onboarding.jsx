import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight, Building2, Check, Clock, Pencil, Stethoscope, Sun, TriangleAlert, UserRound,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useAuth } from '../lib/auth-context.jsx';
import { Button, Field, Input, Select, Badge, Progress } from '../components/ui.jsx';
import { CLINIC_TYPES } from '../lib/logic.mjs';
import { recallInviteError, rememberInviteError } from '../lib/invites.mjs';
import {
  FOLLOW_UP_CHOICES, SLOT_CHOICES, WEEKDAYS, clearDraft, clinicPayload, emptyForm, loadDraft,
  ownerPayload, resumeStep, saveDraft, summaryRows, validateStep,
} from '../lib/onboarding.mjs';

const STEPS = [
  { id: 'clinic', title: 'Clinic details', icon: Building2 },
  { id: 'doctor', title: 'Lead doctor', icon: Stethoscope },
  { id: 'hours', title: 'Hours & fees', icon: Clock },
  { id: 'review', title: 'Review', icon: Check },
];

/**
 * The review step: a plain list of what pressing the button creates.
 *
 * Pulled out of the page so it can be rendered on its own — the last screen before
 * a clinic exists is the one worth looking at before it does.
 */
export function ReviewStep({ form, onEdit }) {
  const editFor = { Clinic: 0, 'Lead doctor': 1, Hours: 2 };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row small" style={{ gap: 8 }}>
        <Check size={15} style={{ color: 'var(--brand-500)' }} />
        <span className="strong">Everything below is created when you press Create clinic</span>
      </div>
      <div className="stack" style={{ gap: 0, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {summaryRows(form).map((row, i) => (
          <div
            key={row.label}
            className="row small"
            style={{ gap: 10, padding: '9px 12px', background: i % 2 ? 'var(--surface)' : 'var(--surface-2)', alignItems: 'flex-start' }}
          >
            <span className="muted" style={{ width: 104, flex: 'none' }}>{row.label}</span>
            <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{row.value}</span>
            {editFor[row.label] !== undefined ? (
              <button
                type="button" className="icon-btn plain sm"
                aria-label={`Edit ${row.label.toLowerCase()}`} title="Edit"
                onClick={() => onEdit(editFor[row.label])}
              >
                <Pencil size={13} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
        <Sun size={14} className="muted" />
        <span className="muted">
          Everything here can be changed later: <strong>Settings → Clinic</strong> for the details,
          hours and fees, and <strong>Doctors &amp; staff</strong> for the doctor’s row.
        </span>
      </div>
    </div>
  );
}

/**
 * First run: the three things a clinic cannot start without, then a review.
 *
 * The shape is unchanged (clinic → doctor → hours); what changed in v1.34.0 is that
 * every answer now survives: the clinic phone and the doctor's phone are two fields
 * instead of one, hours and the follow-up window are persisted by `create_clinic()`
 * instead of being dropped, a fee that cannot be read is a field error instead of a
 * silent ₹500, and the half-filled form is kept in localStorage so a reload does not
 * cost the person the address and the fees they just typed.
 */
export default function Onboarding() {
  const store = useStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  // If an invitation was refused on the way in, say why here — this screen is the
  // first thing the person sees, and otherwise it reads as if nothing happened.
  const [inviteError] = useState(() => recallInviteError());
  const [saving, setSaving] = useState(false);
  const errorRef = useRef(null);

  const initial = useMemo(() => {
    const blank = emptyForm({
      email: user?.email ?? '',
      ownerName: store.profile?.full_name ?? '',
    });
    const draft = loadDraft(undefined, blank);
    // A draft is only "resumed" if something in it was actually typed.
    return Object.keys(blank).some((k) => JSON.stringify(draft[k]) !== JSON.stringify(blank[k])) ? draft : blank;
  }, [user?.email, store.profile?.full_name]);
  const [resumed] = useState(() => Object.keys(validateStep(0, initial)).length === 0 && initial.name !== '');
  // Open on the step the draft got to. Computed in the initialiser rather than in an
  // effect, so the first paint is already the right step and nothing jumps.
  const [step, setStep] = useState(() => (resumed ? resumeStep(initial) : 0));
  const [form, setForm] = useState(initial);
  useEffect(() => { rememberInviteError(''); }, []);
  // Every keystroke is kept: a reload, a flat battery and a phone call are normal here.
  useEffect(() => { saveDraft(form); }, [form]);

  const set = (k) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: value }));
    setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  };

  function toggleDay(id) {
    setForm((f) => {
      const has = f.closed_weekdays.includes(id);
      return { ...f, closed_weekdays: has ? f.closed_weekdays.filter((d) => d !== id) : [...f.closed_weekdays, id] };
    });
    setErrors((prev) => (prev.closed_weekdays ? { ...prev, closed_weekdays: undefined } : prev));
  }

  /** Advance only when this step is clean; the error is the field's, not a toast. */
  function next() {
    const found = validateStep(step, form);
    setErrors(found);
    if (Object.keys(found).length) {
      setError('');
      requestAnimationFrame(() => errorRef.current?.focus?.());
      return;
    }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function finish() {
    for (let s = 0; s < 3; s += 1) {
      const found = validateStep(s, form);
      if (Object.keys(found).length) {
        setErrors(found);
        setError('Something in this step needs fixing before the clinic can be created.');
        setStep(s);
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      await store.createClinic({ clinic: clinicPayload(form), owner: ownerPayload(form) });
      clearDraft();
      navigate('/app/dashboard');
    } catch (e) {
      setError(e.message ?? 'Could not create the clinic.');
    } finally {
      setSaving(false);
    }
  }

  const errorFor = (key) => errors[key];
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <div className="card" style={{ width: 'min(680px, 100%)', overflow: 'hidden' }}>
        <div style={{ padding: '22px 22px 0' }}>
          <div className="row" style={{ gap: 10, marginBottom: 14 }}>
            <span className="brand-mark"><Stethoscope size={18} /></span>
            <div>
              <div className="brand-name">Set up your clinic</div>
              <div className="tiny faint">
                Step {step + 1} of {STEPS.length} · {step === 3 ? 'one check, then it is ready' : 'about 2 minutes'}
              </div>
            </div>
            <span className="spacer" />
            <Badge tone="brand">{store.mode === 'demo' ? 'Demo' : 'Live'}</Badge>
          </div>
          <Progress value={(step + 1) / STEPS.length} />
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            {STEPS.map((s, i) => (
              <button
                key={s.id} type="button"
                className={`badge ${i === step ? 'brand' : i < step ? 'success' : 'neutral'}`}
                style={{ cursor: i < step ? 'pointer' : 'default', border: 0 }}
                onClick={() => { if (i < step) { setError(''); setStep(i); } }}
                aria-current={i === step ? 'step' : undefined}
                disabled={i > step}
              >
                {i < step ? <Check size={11} /> : <s.icon size={11} />} {s.title}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 22 }} className="stack">
          {inviteError ? (
            <div className="row" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '10px 12px', borderRadius: 12, alignItems: 'flex-start' }}>
              <TriangleAlert size={15} style={{ flex: 'none', marginTop: 2 }} />
              <span className="small">
                <strong style={{ display: 'block' }}>Your invitation could not be accepted</strong>
                {inviteError}. Ask the clinic’s owner to re-invite you — or set up a clinic of your own below.
              </span>
            </div>
          ) : null}

          {resumed && step === 0 ? (
            <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
              <Clock size={14} className="muted" />
              <span className="muted">Picked up where you left off — nothing you typed was lost.</span>
            </div>
          ) : null}

          {error ? (
            <div className="row" role="alert" style={{ gap: 8, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '10px 12px', borderRadius: 12 }}>
              <TriangleAlert size={15} /><span className="small">{error}</span>
            </div>
          ) : null}

          {/* Screen-reader and keyboard users get the first failure announced, not a
              red border somewhere above the fold. */}
          <div ref={errorRef} tabIndex={-1} aria-live="polite" className="sr-only">
            {Object.keys(errors).length
              ? `${Object.keys(errors).length} field${Object.keys(errors).length === 1 ? '' : 's'} need${Object.keys(errors).length === 1 ? 's' : ''} attention`
              : ''}
          </div>

          {step === 0 ? (
            <form className="form-grid" onSubmit={(e) => { e.preventDefault(); next(); }}>
              <Field label="Clinic name *" className="span-2" error={errorFor('name')}>
                <Input value={form.name} onChange={set('name')} placeholder="Sunrise Multispecialty OPD" autoFocus error={errorFor('name')} autoComplete="organization" />
              </Field>
              <Field label="Clinic type">
                <Select value={form.clinic_type} onChange={set('clinic_type')}>
                  {CLINIC_TYPES.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="GSTIN" hint="Leave blank if not registered" error={errorFor('gstin')}>
                <Input value={form.gstin} onChange={set('gstin')} placeholder="27AABCU9603R1ZM" autoComplete="off" />
              </Field>
              <Field label="Contact number" hint="Mobile or landline the front desk answers" error={errorFor('clinic_phone')}>
                <Input value={form.clinic_phone} onChange={set('clinic_phone')} placeholder="022 4000 1200" inputMode="tel" error={errorFor('clinic_phone')} />
              </Field>
              <Field label="Front-desk email" hint="Where reminders appear to come from" error={errorFor('email')}>
                <Input value={form.email} onChange={set('email')} type="email" placeholder="front.desk@clinic.in" error={errorFor('email')} autoComplete="email" />
              </Field>
              <Field label="Address" className="span-2" hint="Floor, building, street, area, city" error={errorFor('address')}>
                <Input value={form.address} onChange={set('address')} placeholder="2nd floor, Shanti Complex, Andheri West, Mumbai 400058" error={errorFor('address')} autoComplete="street-address" />
              </Field>
            </form>
          ) : null}

          {step === 1 ? (
            <form className="form-grid" onSubmit={(e) => { e.preventDefault(); next(); }}>
              <Field label="Doctor’s full name *" className="span-2" error={errorFor('owner_name')}>
                <Input value={form.owner_name} onChange={set('owner_name')} placeholder="Dr. Anita Rao" autoFocus error={errorFor('owner_name')} />
              </Field>
              <Field label="Specialty">
                <Input value={form.specialty} onChange={set('specialty')} placeholder="Internal Medicine" />
              </Field>
              <Field label="Qualification" error={errorFor('qualification')}>
                <Input value={form.qualification} onChange={set('qualification')} placeholder="MBBS, MD" error={errorFor('qualification')} />
              </Field>
              <Field label="Registration number" hint="State medical council number" error={errorFor('registration_no')}>
                <Input value={form.registration_no} onChange={set('registration_no')} placeholder="MH-2011-48213" />
              </Field>
              <Field label="Doctor’s own number" hint="Kept apart from the clinic’s" error={errorFor('doctor_phone')}>
                <Input value={form.doctor_phone} onChange={set('doctor_phone')} inputMode="tel" placeholder="+91 98200 00000" error={errorFor('doctor_phone')} />
              </Field>
              <div className="span-2">
                <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
                  <UserRound size={14} className="faint" />
                  <span className="muted">You are signed in as the clinic owner. Add reception and other doctors later from <strong>Doctors &amp; staff</strong>.</span>
                </div>
              </div>
            </form>
          ) : null}

          {step === 2 ? (
            <form className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); next(); }}>
              <div className="form-grid">
                <Field label="First session from" error={errorFor('open_time')}>
                  <Input type="time" value={form.open_time} onChange={set('open_time')} error={errorFor('open_time')} />
                </Field>
                <Field label="First session to" error={errorFor('close_time')}>
                  <Input type="time" value={form.close_time} onChange={set('close_time')} error={errorFor('close_time')} />
                </Field>
                <Field label="Second session from" hint="Leave both blank for one session a day" error={errorFor('second_open')}>
                  <Input type="time" value={form.second_open} onChange={set('second_open')} error={errorFor('second_open')} />
                </Field>
                <Field label="Second session to" error={errorFor('second_close')}>
                  <Input type="time" value={form.second_close} onChange={set('second_close')} error={errorFor('second_close')} />
                </Field>
              </div>
              {/* Overlaps and too-short sessions are the database's rules too, so the
                  message is shown where the times are, not as a toast that vanishes. */}
              {errorFor('sessions') ? (
                <div className="row small" role="alert" style={{ gap: 8, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '9px 11px', borderRadius: 10 }}>
                  <TriangleAlert size={14} /><span>{errorFor('sessions')}</span>
                </div>
              ) : null}

              <div className="stack" style={{ gap: 6 }}>
                <span className="small strong">Days the clinic is closed</span>
                <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Days the clinic is closed">
                  {WEEKDAYS.map((d) => {
                    const closed = (form.closed_weekdays ?? []).includes(d.id);
                    return (
                      <button
                        key={d.id} type="button"
                        onClick={() => toggleDay(d.id)}
                        aria-pressed={closed}
                        className={`badge ${closed ? 'danger' : 'neutral'}`}
                        style={{ cursor: 'pointer', border: 0, minWidth: 54 }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                {errorFor('closed_weekdays') ? (
                  <span className="tiny" style={{ color: 'var(--danger)' }}>{errorFor('closed_weekdays')}</span>
                ) : (
                  <span className="tiny faint">Red is closed. Only these days are refused when booking.</span>
                )}
              </div>

              <div className="form-grid">
                <Field label="Slot length">
                  <Select value={form.slot_minutes} onChange={set('slot_minutes')}>
                    {SLOT_CHOICES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  </Select>
                </Field>
                <Field label="Follow-up valid for" error={errorFor('follow_up_days')}>
                  <Select value={form.follow_up_days} onChange={set('follow_up_days')} error={errorFor('follow_up_days')}>
                    {FOLLOW_UP_CHOICES.map((d) => <option key={d} value={d}>{d} days</option>)}
                  </Select>
                </Field>
                <Field label="Consultation fee ₹" error={errorFor('fee')}>
                  <Input value={form.fee} onChange={set('fee')} inputMode="decimal" placeholder="500" error={errorFor('fee')} />
                </Field>
                <Field label="Follow-up fee ₹" error={errorFor('follow_up_fee')}>
                  <Input value={form.follow_up_fee} onChange={set('follow_up_fee')} inputMode="decimal" placeholder="250" error={errorFor('follow_up_fee')} />
                </Field>
              </div>
              <div className="tiny muted">
                Fees are suggestions only — the front desk can change them on each invoice. All amounts are stored in paise.
              </div>
            </form>
          ) : null}

          {step === 3 ? <ReviewStep form={form} onEdit={setStep} /> : null}
        </div>

        <div className="modal-foot" style={{ position: 'static', borderRadius: 0 }}>
          {step > 0 ? <Button variant="ghost" onClick={() => { setError(''); setStep((s) => s - 1); }}>Back</Button> : <span />}
          <span className="spacer" />
          {step < STEPS.length - 1
            ? <Button variant="primary" icon={ArrowRight} onClick={next}>Continue</Button>
            : <Button variant="primary" icon={Check} onClick={finish} loading={saving}>Create clinic</Button>}
        </div>
      </div>
    </div>
  );
}
