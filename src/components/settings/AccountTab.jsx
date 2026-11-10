/**
 * My account: the signed-in person's details, the password form and sign-out.
 * Extracted verbatim from Settings.jsx in v1.30.0 (docs/ARCHITECTURE.md §3 step 4) —
 * markup and copy unchanged.
 */

import { Button, Card, CardHead, Field, Input } from '../ui.jsx';
import { ExternalLink, LogOut, Save, ShieldCheck, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useToast } from '../ui.jsx';
import { useAuth } from '../../lib/auth-context.jsx';

export default function AccountTab({ profile, setProfile, pw, setPw, saveProfile, saving }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, configured, updatePassword, signOut } = useAuth();
  return (
    <>
        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead title="My account" sub={user?.email ?? 'Demo workspace — no live account'} icon={UserRound}
              action={<Button size="sm" variant="primary" icon={Save} onClick={saveProfile} loading={saving}>Save</Button>} />
            <div className="card-body">
              <div className="form-grid">
                <Field label="Full name"><Input value={profile.full_name} onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))} /></Field>
                <Field label="Designation"><Input value={profile.designation} onChange={(e) => setProfile((p) => ({ ...p, designation: e.target.value }))} placeholder="Consultant Physician" /></Field>
                <Field label="Phone"><Input value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} inputMode="tel" /></Field>
                <Field label="Email" hint={configured ? 'Change this in Supabase Auth' : 'Available once Supabase is connected'}>
                  <Input value={user?.email ?? 'demo@myclinic.app'} disabled />
                </Field>
              </div>
            </div>
          </Card>

          {configured ? (
            <Card>
              <CardHead title="Password" sub="Use at least 8 characters" icon={ShieldCheck} />
              <div className="card-body stack">
                <div className="form-grid">
                  <Field label="New password"><Input type="password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} autoComplete="new-password" /></Field>
                  <Field label="Confirm password"><Input type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" /></Field>
                </div>
                <div>
                  <Button variant="subtle" icon={Save} onClick={async () => {
                    if (pw.next.length < 8) { toast.error('Use at least 8 characters.'); return; }
                    if (pw.next !== pw.confirm) { toast.error('Passwords do not match.'); return; }
                    try { await updatePassword(pw.next); toast.success('Password updated.'); setPw({ next: '', confirm: '' }); }
                    catch (e) { toast.error(e.message ?? 'Could not update the password.'); }
                  }}>Update password</Button>
                </div>
                <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <span className="small muted">Signed in as {user?.email}</span>
                  <span className="spacer" />
                  <Button size="sm" variant="ghost" icon={LogOut} onClick={async () => { await signOut(); navigate('/'); }}>Sign out</Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="pad">
              <p className="small muted">Signing in, password changes and email confirmation activate once Supabase keys are configured.</p>
              <Button size="sm" variant="subtle" icon={ExternalLink} style={{ marginTop: 10 }} onClick={() => navigate('/setup')}>Open setup guide</Button>
            </Card>
          )}
        </div>
    </>
  );
}
