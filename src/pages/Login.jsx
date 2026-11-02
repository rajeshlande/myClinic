import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, KeyRound, Mail, TriangleAlert } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Button, Field, Input } from '../components/ui.jsx';
import { useAuth } from '../lib/auth-context.jsx';

export default function Login() {
  const { signIn, configured, error, clearError, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (configured && user) navigate('/app/dashboard', { replace: true }); }, [configured, user, navigate]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { await signIn(email.trim(), password); navigate('/app/dashboard'); } catch { /* surfaced via context */ } finally { setBusy(false); }
  }

  return (
    <AuthShell
      title="Sign in to myClinic"
      sub="Welcome back. Your clinic is exactly where you left it."
      aside={{ heading: 'The front desk opens in one click.', body: 'Sign in and the queue, the chart and today’s collections are already on screen.' }}
      footer={(
        <div className="stack" style={{ gap: 12 }}>
          <p className="small muted center">
            New to myClinic? <Link to="/signup">Create a clinic account</Link>
          </p>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="tiny faint">or</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
          <Button variant="subtle" className="block" onClick={() => navigate('/app/dashboard')} icon={ArrowRight}>
            Explore the demo clinic instead
          </Button>
          <p className="tiny faint center">
            Demo mode uses fictional patients and stores nothing on a server.
          </p>
        </div>
      )}
    >
      {!configured ? (
        <div className="row" style={{ gap: 9, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '11px 12px', borderRadius: 12, alignItems: 'flex-start' }}>
          <TriangleAlert size={15} style={{ marginTop: 2, flex: 'none' }} />
          <div className="tiny">
            <strong style={{ display: 'block', marginBottom: 2 }}>Supabase is not configured on this build</strong>
            Sign-in needs <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>. <Link to="/setup">See the setup guide</Link> — or use the demo clinic.
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="row" style={{ gap: 8, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '10px 12px', borderRadius: 12 }} role="alert">
          <TriangleAlert size={15} /> <span className="small">{error}</span>
        </div>
      ) : null}

      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Work email" htmlFor="email">
          <div style={{ position: 'relative' }}>
            <Mail size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }} />
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => { clearError(); setEmail(e.target.value); }} placeholder="you@clinic.in" required style={{ paddingLeft: 36 }} disabled={!configured} />
          </div>
        </Field>
        <Field label="Password" htmlFor="password">
          <div style={{ position: 'relative' }}>
            <KeyRound size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }} />
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => { clearError(); setPassword(e.target.value); }} placeholder="••••••••" required style={{ paddingLeft: 36 }} disabled={!configured} />
          </div>
        </Field>
        <div className="row">
          <Link to="/forgot-password" className="tiny">Forgot password?</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" className="block" loading={busy} disabled={!configured} icon={ArrowRight}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
