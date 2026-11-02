import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, TriangleAlert } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Button, Field, Input } from '../components/ui.jsx';
import { useAuth } from '../lib/auth-context.jsx';

export default function ResetPassword() {
  const { updatePassword, error, configured } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [local, setLocal] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (pw.length < 8) { setLocal('Use at least 8 characters.'); return; }
    if (pw !== confirm) { setLocal('Both passwords must match.'); return; }
    setBusy(true);
    try { await updatePassword(pw); setDone(true); setTimeout(() => navigate('/app/dashboard'), 1400); } catch { /* surfaced */ } finally { setBusy(false); }
  }

  return (
    <AuthShell title="Set a new password" sub="Choose something long and unique to this clinic account.">
      {done ? (
        <div className="card pad" style={{ background: 'var(--success-bg)' }}>
          <div className="row" style={{ gap: 9, color: 'var(--success)' }}><Check size={16} /><strong>Password updated</strong></div>
          <p className="small" style={{ marginTop: 6 }}>Taking you to the dashboard…</p>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {!configured ? (
            <div className="row" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '10px 12px', borderRadius: 12 }}>
              <TriangleAlert size={15} /><span className="tiny">Password reset needs a configured Supabase project.</span>
            </div>
          ) : null}
          {error || local ? (
            <div className="row" style={{ gap: 8, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '10px 12px', borderRadius: 12 }} role="alert">
              <TriangleAlert size={15} /><span className="small">{local || error}</span>
            </div>
          ) : null}
          <Field label="New password" htmlFor="new-pw">
            <Input id="new-pw" type="password" value={pw} onChange={(e) => { setLocal(''); setPw(e.target.value); }} autoComplete="new-password" disabled={!configured} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm-pw">
            <Input id="confirm-pw" type="password" value={confirm} onChange={(e) => { setLocal(''); setConfirm(e.target.value); }} autoComplete="new-password" disabled={!configured} />
          </Field>
          <Button type="submit" variant="primary" className="block" size="lg" loading={busy} disabled={!configured}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
