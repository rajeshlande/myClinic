import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Button, Field, Input } from '../components/ui.jsx';
import { useAuth } from '../lib/auth-context.jsx';

export default function Signup() {
  const { signUp, configured, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', clinicName: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState('');

  const set = (k) => (e) => { clearError(); setLocalError(''); setForm((f) => ({ ...f, [k]: e.target.value })); };

  async function submit(e) {
    e.preventDefault();
    if (form.password.length < 8) { setLocalError('Use a password with at least 8 characters.'); return; }
    if (!form.fullName.trim()) { setLocalError('Tell us the doctor’s or owner’s name.'); return; }
    setBusy(true);
    try {
      const data = await signUp(form.email.trim(), form.password, form.fullName.trim());
      if (data?.session) navigate('/onboarding');
      else setSent(true);
    } catch { /* surfaced via context */ } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <AuthShell title="Confirm your email" sub={`We sent a confirmation link to ${form.email}.`}>
        <div className="card pad" style={{ background: 'var(--success-bg)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)' }}>
          <div className="row" style={{ gap: 9, color: 'var(--success)' }}><Check size={16} /><strong>Almost there</strong></div>
          <p className="small" style={{ marginTop: 6, color: 'var(--text-2)' }}>
            Open the link in the same browser. You will land on clinic setup, where you name your clinic and add the first doctor.
          </p>
        </div>
        <Button variant="subtle" className="block" onClick={() => navigate('/login')}>Back to sign in</Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your clinic account"
      sub="Fourteen days on Growth, no card. Set up the clinic in about two minutes."
      aside={{ heading: 'Start with one doctor. Grow to a polyclinic.', body: 'Solo and multi-doctor clinics run the same workflow — you just add seats later.' }}
      footer={<p className="small muted center">Already have an account? <Link to="/login">Sign in</Link></p>}
    >
      {!configured ? (
        <div className="row" style={{ gap: 9, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '11px 12px', borderRadius: 12, alignItems: 'flex-start' }}>
          <TriangleAlert size={15} style={{ marginTop: 2, flex: 'none' }} />
          <div className="tiny">
            <strong style={{ display: 'block', marginBottom: 2 }}>Supabase is not configured on this build</strong>
            Account creation is disabled. <Link to="/app/dashboard">Open the demo clinic</Link> to try every feature.
          </div>
        </div>
      ) : null}
      {error || localError ? (
        <div className="row" style={{ gap: 8, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '10px 12px', borderRadius: 12 }} role="alert">
          <TriangleAlert size={15} /> <span className="small">{localError || error}</span>
        </div>
      ) : null}

      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Your name" htmlFor="fullName" hint="Shown to staff as the clinic owner">
          <Input id="fullName" value={form.fullName} onChange={set('fullName')} placeholder="Dr. Anita Rao" autoComplete="name" disabled={!configured} />
        </Field>
        <Field label="Clinic name" htmlFor="clinicName">
          <Input id="clinicName" value={form.clinicName} onChange={set('clinicName')} placeholder="Sunrise Multispecialty OPD" autoComplete="organization" disabled={!configured} />
        </Field>
        <Field label="Work email" htmlFor="signup-email">
          <Input id="signup-email" type="email" value={form.email} onChange={set('email')} placeholder="you@clinic.in" autoComplete="email" disabled={!configured} />
        </Field>
        <Field label="Password" htmlFor="signup-password" hint="At least 8 characters">
          <Input id="signup-password" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" autoComplete="new-password" disabled={!configured} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="block" loading={busy} disabled={!configured} icon={ArrowRight}>
          Create clinic account
        </Button>
        <p className="tiny faint">
          By continuing you agree to keep patient data accurate and share only with authorised staff. myClinic never sells clinic or patient data.
        </p>
      </form>
    </AuthShell>
  );
}
