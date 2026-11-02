import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, MailCheck, TriangleAlert } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Button, Field, Input } from '../components/ui.jsx';
import { useAuth } from '../lib/auth-context.jsx';

export default function ForgotPassword() {
  const { resetPassword, configured, error } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { await resetPassword(email.trim()); setSent(true); } catch { /* surfaced */ } finally { setBusy(false); }
  }

  return (
    <AuthShell title="Reset your password" sub="We will email you a secure link that opens in this browser." aside={{ heading: 'Locked out mid-OPD? It happens.', body: 'A reset link is valid for a short window and must be opened in the same browser that requested it.' }}>
      {sent ? (
        <div className="stack">
          <div className="card pad" style={{ background: 'var(--success-bg)' }}>
            <div className="row" style={{ gap: 9, color: 'var(--success)' }}><MailCheck size={16} /><strong>Check your inbox</strong></div>
            <p className="small" style={{ marginTop: 6, color: 'var(--text-2)' }}>
              If an account exists for {email}, a reset link is on its way. Do not forward it — it expires and only works once.
            </p>
          </div>
          <Button variant="subtle" className="block" onClick={() => setSent(false)}>Use a different email</Button>
          <Link to="/login" className="small center">Back to sign in</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {!configured ? (
            <div className="row" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '10px 12px', borderRadius: 12 }}>
              <TriangleAlert size={15} /><span className="tiny">Password reset needs a configured Supabase project.</span>
            </div>
          ) : null}
          {error ? (
            <div className="row" style={{ gap: 8, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '10px 12px', borderRadius: 12 }} role="alert">
              <TriangleAlert size={15} /><span className="small">{error}</span>
            </div>
          ) : null}
          <Field label="Work email" htmlFor="reset-email">
            <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@clinic.in" autoComplete="email" required disabled={!configured} />
          </Field>
          <Button type="submit" variant="primary" className="block" size="lg" loading={busy} disabled={!configured} icon={ArrowRight}>Send reset link</Button>
          <Link to="/login" className="small center">Back to sign in</Link>
        </form>
      )}
    </AuthShell>
  );
}
