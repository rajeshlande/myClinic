import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BellRing, Building2, Check, CreditCard, Download, LogOut, MoonStar, RefreshCw, Save,
  Sparkles, Sun, Trash2, UserRound, WifiOff, Monitor, ShieldCheck, ExternalLink, Smartphone,
  ImagePlus,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useAuth } from '../lib/auth-context.jsx';
import { PWAStatus } from '../components/PWAWidgets.jsx';
import { useToast, Badge, Button, Card, CardHead, Field, Input, Modal, Segmented, Select, Tabs } from '../components/ui.jsx';
import { ACCENTS, applyDensity, applyTheme, readAccent, readTheme, saveAccent, saveTheme } from '../lib/theme.js';
import { SyncCenter } from '../components/SyncCenter.jsx';
import { BrandingFields, BrandMark } from '../components/Branding.jsx';
import { APP_VERSION, BUILD_LABEL, CHANGELOG, SCHEMA_VERSION } from '../lib/version.js';
import { can, ROLE_BLURB, ROLE_LABEL } from '../lib/permissions.js';
import { CloudOff, GitBranch, History, Palette, RefreshCcw, Scale } from 'lucide-react';
import {
  CLINIC_TYPES, DEFAULT_PREFERENCES, PLANS, downloadFile, formatMoney, moneyToPaise, paiseToInput,
  today, toCSV, patientSearch,
} from '../lib/logic.mjs';

export default function Settings() {
  const store = useStore();
  const { user, signOut, configured, updatePassword } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('clinic');
  const [accent, setAccent] = useState(readAccent());
  const [syncOpen, setSyncOpen] = useState(false);
  const role = store.role ?? 'owner';
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState(readTheme());
  const [planOpen, setPlanOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pw, setPw] = useState({ next: '', confirm: '' });

  const [clinic, setClinic] = useState(() => ({
    ...(store.clinic ?? {}),
    fee: paiseToInput(store.clinic?.consultation_fee_paise ?? 50000),
    follow_up_fee: paiseToInput(store.clinic?.follow_up_fee_paise ?? 25000),
    gst_rate: String(store.clinic?.gst_rate ?? 0),
  }));
  const [profile, setProfile] = useState({
    full_name: store.profile?.full_name ?? '',
    phone: store.profile?.phone ?? '',
    designation: store.profile?.designation ?? '',
  });
  const [prefs, setPrefs] = useState({ ...DEFAULT_PREFERENCES, ...pickPrefs(store.profile) });

  useEffect(() => { applyDensity(prefs.density); }, [prefs.density]);

  async function saveClinic() {
    setSaving(true);
    try {
      let fee, followUp;
      try { fee = moneyToPaise(clinic.fee); followUp = moneyToPaise(clinic.follow_up_fee); }
      catch { toast.error('Enter valid fee amounts.'); setSaving(false); return; }
      await store.update('clinic', store.clinic.id, {
        name: clinic.name?.trim(), clinic_type: clinic.clinic_type, phone: clinic.phone, email: clinic.email,
        address: clinic.address, gstin: clinic.gstin, brand_color: clinic.brand_color,
        consultation_fee_paise: fee, follow_up_fee_paise: followUp,
        follow_up_days: Number(clinic.follow_up_days) || 15,
        slot_minutes: Number(clinic.slot_minutes) || 15,
        open_time: clinic.open_time, close_time: clinic.close_time,
        gst_enabled: Boolean(clinic.gst_enabled), gst_rate: Number(clinic.gst_rate) || 0,
        invoice_prefix: clinic.invoice_prefix || 'INV',
        // Branding travels with the clinic row so it survives offline and appears
        // on every document without a second fetch.
        logo_square_url: clinic.logo_square_url ?? null,
        logo_wide_url: clinic.logo_wide_url ?? null,
        logo_on_documents: clinic.logo_on_documents !== false,
      });
      toast.success('Clinic profile saved.');
    } catch (e) { toast.error(e.message ?? 'Could not save.'); } finally { setSaving(false); }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      if (store.mode === 'demo') {
        toast.success('Profile saved in the demo workspace.');
      } else {
        await store.update('profile', store.profile.id, { ...profile, ...prefs, theme });
        toast.success('Profile and preferences saved.');
      }
      setSaving(false);
    } catch (e) { toast.error(e.message ?? 'Could not save.'); setSaving(false); }
  }

  function changeTheme(next) {
    setTheme(next);
    saveTheme(next);
    applyTheme(next, accent);
  }

  function changeAccent(next) {
    setAccent(next);
    saveAccent(next);
    toast.success(`Accent set to ${ACCENTS.find((a) => a.id === next)?.label}.`);
  }

  function exportAll() {
    const csv = toCSV(store.patients, [
      { label: 'Patient ID', key: 'code' },
      { label: 'Name', key: 'full_name' },
      { label: 'Phone', key: 'phone' },
      { label: 'Gender', key: 'gender' },
      { label: 'DOB', key: 'dob' },
      { label: 'Visits', value: (p) => store.consultations.filter((c) => c.patient_id === p.id).length },
      { label: 'Invoices', value: (p) => store.invoices.filter((i) => i.patient_id === p.id).length },
    ]);
    downloadFile(`myclinic-patients-${today()}.csv`, csv);
    toast.success('Patient export downloaded.');
  }

  return (
    <div className="page narrow stack" style={{ gap: 16 }}>
      <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '9px 12px', borderRadius: 11 }}>
        <ShieldCheck size={14} className="muted" />
        <span className="muted">
          Signed in as <strong>{ROLE_LABEL[role]}</strong>. {ROLE_BLURB[role]}
        </span>
      </div>

      <Tabs
        value={tab} onChange={setTab}
        tabs={[
          { value: 'clinic', label: 'Clinic' },
          { value: 'branding', label: 'Logos & branding' },
          { value: 'billing', label: 'Billing & invoices' },
          { value: 'account', label: 'My account' },
          { value: 'appearance', label: 'Appearance & colours' },
          { value: 'sync', label: 'Offline & sync' },
          { value: 'about', label: 'About & version' },
          { value: 'plan', label: 'Plan & data' },
        ]}
      />

      {tab === 'branding' ? (
        <Card>
          <CardHead
            title="Logos & branding"
            sub="Used on prescriptions, invoices, and ready for WhatsApp and email"
            icon={ImagePlus}
            action={<Button size="sm" variant="primary" icon={Save} onClick={saveClinic} loading={saving}>Save</Button>}
          />
          <div className="card-body stack" style={{ gap: 14 }}>
            {!can(role, 'clinic:settings') ? (
              <div className="row small" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '9px 12px', borderRadius: 11 }}>
                <ShieldCheck size={14} />
                <span>Only the clinic owner can change branding.</span>
              </div>
            ) : null}

            <div className="branding-preview">
              <div className="row" style={{ gap: 10 }}>
                <BrandMark clinic={clinic} size={44} />
                <div>
                  <div className="strong">{clinic.name || 'Your clinic'}</div>
                  <div className="tiny faint">How the clinic appears across myClinic</div>
                </div>
              </div>
              <div className="branding-preview-note tiny muted">
                Upload a square logo for avatars and profile photos, and a wide one for letterheads.
                Either can stand in for the other, so one upload is enough to get started.
              </div>
            </div>

            <BrandingFields
              clinic={clinic}
              disabled={!can(role, 'clinic:settings') || saving}
              onChange={(patch) => setClinic((c) => ({ ...c, ...patch }))}
            />

            <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
              <ShieldCheck size={14} className="muted" />
              <span className="muted">
                Logos are resized in your browser and stored with the clinic, so they print correctly
                offline and are covered by the same access rules as the rest of your clinic data.
              </span>
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'clinic' ? (
        <Card>
          <CardHead title="Clinic profile" sub="Appears on invoices, prescriptions and reminders" icon={Building2}
            action={<Button size="sm" variant="primary" icon={Save} onClick={saveClinic} loading={saving}>Save</Button>} />
          <div className="card-body">
            <div className="form-grid">
              <Field label="Clinic name" className="span-2"><Input value={clinic.name ?? ''} onChange={(e) => setClinic((c) => ({ ...c, name: e.target.value }))} /></Field>
              <Field label="Clinic type"><Select value={clinic.clinic_type ?? CLINIC_TYPES[0]} onChange={(e) => setClinic((c) => ({ ...c, clinic_type: e.target.value }))}>{CLINIC_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Phone"><Input value={clinic.phone ?? ''} onChange={(e) => setClinic((c) => ({ ...c, phone: e.target.value }))} /></Field>
              <Field label="Email"><Input value={clinic.email ?? ''} onChange={(e) => setClinic((c) => ({ ...c, email: e.target.value }))} /></Field>
              <Field label="GSTIN" hint="Leave blank if not registered"><Input value={clinic.gstin ?? ''} onChange={(e) => setClinic((c) => ({ ...c, gstin: e.target.value }))} /></Field>
              <Field label="Address" className="span-2"><Input value={clinic.address ?? ''} onChange={(e) => setClinic((c) => ({ ...c, address: e.target.value }))} /></Field>
              <Field label="Opens at"><Input type="time" value={(clinic.open_time ?? '09:00').slice(0, 5)} onChange={(e) => setClinic((c) => ({ ...c, open_time: e.target.value }))} /></Field>
              <Field label="Closes at"><Input type="time" value={(clinic.close_time ?? '20:00').slice(0, 5)} onChange={(e) => setClinic((c) => ({ ...c, close_time: e.target.value }))} /></Field>
              <Field label="Default slot length">
                <Select value={clinic.slot_minutes ?? 15} onChange={(e) => setClinic((c) => ({ ...c, slot_minutes: Number(e.target.value) }))}>
                  {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </Select>
              </Field>
              <Field label="Follow-up validity (days)">
                <Select value={clinic.follow_up_days ?? 15} onChange={(e) => setClinic((c) => ({ ...c, follow_up_days: Number(e.target.value) }))}>
                  {[7, 10, 15, 21, 30, 45].map((d) => <option key={d} value={d}>{d} days</option>)}
                </Select>
              </Field>
              <Field label="Consultation fee ₹"><Input value={clinic.fee} onChange={(e) => setClinic((c) => ({ ...c, fee: e.target.value }))} inputMode="decimal" /></Field>
              <Field label="Follow-up fee ₹"><Input value={clinic.follow_up_fee} onChange={(e) => setClinic((c) => ({ ...c, follow_up_fee: e.target.value }))} inputMode="decimal" /></Field>
              <Field label="Brand colour">
                <div className="row" style={{ gap: 6 }}>
                  {['#0f766e', '#3d7fb8', '#7c5cd6', '#0f7d63', '#c0455a', '#c2872b'].map((c) => (
                    <button key={c} type="button" aria-label={`Brand colour ${c}`} onClick={() => setClinic((x) => ({ ...x, brand_color: c }))}
                      style={{ width: 26, height: 26, borderRadius: 8, background: c, border: clinic.brand_color === c ? '2px solid var(--text)' : '1px solid var(--border)', cursor: 'pointer' }} />
                  ))}
                </div>
              </Field>
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'billing' ? (
        <Card>
          <CardHead title="Billing & invoices" sub="GST treatment and invoice numbering" icon={CreditCard}
            action={<Button size="sm" variant="primary" icon={Save} onClick={saveClinic} loading={saving}>Save</Button>} />
          <div className="card-body stack">
            <label className="check">
              <input type="checkbox" checked={Boolean(clinic.gst_enabled)} onChange={(e) => setClinic((c) => ({ ...c, gst_enabled: e.target.checked }))} />
              <span>
                <strong className="small">Enable GST on invoices</strong>
                <span className="tiny muted" style={{ display: 'block' }}>Healthcare services are often exempt — keep this off unless you are registered and advised otherwise.</span>
              </span>
            </label>
            <div className="form-grid">
              <Field label="Default GST rate">
                <Select value={clinic.gst_rate} onChange={(e) => setClinic((c) => ({ ...c, gst_rate: e.target.value }))} disabled={!clinic.gst_enabled}>
                  {[0, 5, 12, 18].map((r) => <option key={r} value={r}>{r}%</option>)}
                </Select>
              </Field>
              <Field label="Invoice prefix" hint="Example: INV/2526/0001">
                <Input value={clinic.invoice_prefix ?? 'INV'} onChange={(e) => setClinic((c) => ({ ...c, invoice_prefix: e.target.value.toUpperCase().slice(0, 8) }))} />
              </Field>
            </div>
            <div className="row small" style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11, gap: 8 }}>
              <ShieldCheck size={14} className="muted" />
              <span className="muted">Money is stored as integer paise. Totals can never drift by a rounding error, and paid amounts are capped at the invoice total.</span>
            </div>
            <div className="grid two" style={{ gap: 10 }}>
              {[
                ['Consultation', formatMoney(store.clinic?.consultation_fee_paise ?? 0)],
                ['Follow-up', formatMoney(store.clinic?.follow_up_fee_paise ?? 0)],
                ['Invoices issued', String(store.invoices.length)],
                ['Unpaid', String(store.invoices.filter((i) => i.paid_paise < i.total_paise && i.status !== 'void').length)],
              ].map(([label, value]) => (
                <div key={label} className="row small" style={{ background: 'var(--surface-2)', padding: '9px 11px', borderRadius: 10 }}>
                  <span className="muted">{label}</span><span className="spacer" /><span className="strong mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'account' ? (
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
      ) : null}

      {tab === 'appearance' ? (
        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Appearance" sub="Applies to this device" icon={Sun} />
            <div className="card-body stack">
              <Field label="Theme">
                <Segmented
                  value={theme} onChange={changeTheme}
                  options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]}
                />
              </Field>
              <Field label="Density" hint="Compact fits more rows on a tablet at the desk">
                <Segmented value={prefs.density} onChange={(v) => setPrefs((p) => ({ ...p, density: v }))} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHead title="Reminders" sub="Follow-up recalls and review requests" icon={BellRing} />
            <div className="card-body stack">
              <label className="check">
                <input type="checkbox" checked={prefs.reminders_enabled} onChange={(e) => setPrefs((p) => ({ ...p, reminders_enabled: e.target.checked }))} />
                <span><strong className="small">Show recall reminders</strong><span className="tiny muted" style={{ display: 'block' }}>Surfaces due and overdue follow-ups on the dashboard.</span></span>
              </label>
              <div className="form-grid">
                <Field label="Remind how early">
                  <Select value={prefs.reminder_lead_hours} onChange={(e) => setPrefs((p) => ({ ...p, reminder_lead_hours: Number(e.target.value) }))}>
                    {[1, 2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h} hours before</option>)}
                  </Select>
                </Field>
                <Field label="Quiet hours" hint="No reminders are drafted in this window">
                  <Input value={prefs.quiet_hours} onChange={(e) => setPrefs((p) => ({ ...p, quiet_hours: e.target.value }))} placeholder="21:00-08:00" />
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={prefs.send_review_request} onChange={(e) => setPrefs((p) => ({ ...p, send_review_request: e.target.checked }))} />
                <span><strong className="small">Ask for a review after a completed visit</strong><span className="tiny muted" style={{ display: 'block' }}>Adds a review link to the invoice footer template.</span></span>
              </label>
              <Button variant="subtle" icon={Save} onClick={saveProfile} loading={saving}>Save preferences</Button>
            </div>
          </Card>

          <Card>
            <CardHead title="Accent colour" sub="Seven palettes — each has its own light and dark values" icon={Palette} />
            <div className="card-body stack" style={{ gap: 10 }}>
              <div className="accent-grid">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id} type="button"
                    className={`accent-swatch ${accent === a.id ? 'selected' : ''}`}
                    onClick={() => changeAccent(a.id)}
                    aria-pressed={accent === a.id}
                  >
                    <span className="accent-dot" style={{ background: `linear-gradient(135deg, ${a.light[500]}, ${a.dark[500]})` }} />
                    <span>{a.label}</span>
                    <span className="accent-preview">
                      <i style={{ background: a.light[100] }} />
                      <i style={{ background: a.light[500] }} />
                      <i style={{ background: a.dark[500] }} />
                      <i style={{ background: a.dark[100] }} />
                    </span>
                  </button>
                ))}
              </div>
              <p className="tiny faint">
                The palette follows the theme: {theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark values are active right now' : 'light values are active right now'}.
                Colour never carries meaning on its own — status is always labelled too.
              </p>
            </div>
          </Card>

          <Card>
            <CardHead title="Install myClinic" sub="Runs full-screen like a native app" icon={Smartphone} />
            <div className="card-body stack" style={{ gap: 8 }}>
              {[
                ['Android / Chrome', 'Open the browser menu and choose “Install app” or “Add to Home screen”.'],
                ['iPhone / Safari', 'Tap the Share icon, then “Add to Home Screen”.'],
                ['Desktop', 'Click the install icon in the address bar — the app opens in its own window.'],
              ].map(([label, body]) => (
                <div key={label} className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--success)', marginTop: 2 }}><Check size={14} strokeWidth={3} /></span>
                  <div><strong className="small">{label}</strong><p className="tiny muted">{body}</p></div>
                </div>
              ))}
              <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
                <WifiOff size={14} className="muted" />
                <span className="muted">The app shell is cached, so a dropped connection never leaves reception with a blank screen.</span>
              </div>
              <PWAStatus />
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'sync' ? (
        <div className="stack">
          <Card>
            <CardHead title="Offline & sync" sub="Work through a power cut or a dead hotspot" icon={CloudOff} />
            <div className="card-body stack" style={{ gap: 12 }}>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px,100%),1fr))', gap: 10 }}>
                <MiniStat label="Connection" value={store.online ? 'Online' : 'Offline'} tone={store.online ? 'success' : 'warn'} />
                <MiniStat label="Waiting to sync" value={String(store.pending.length)} tone={store.pending.length ? 'warn' : 'success'} />
                <MiniStat label="Conflicts" value={String(store.conflicts.length)} tone={store.conflicts.length ? 'danger' : 'success'} />
                <MiniStat label="Source" value={store.usingCache ? 'Device cache' : store.mode === 'demo' ? 'Demo workspace' : 'Live database'} tone="neutral" />
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="primary" icon={RefreshCcw} onClick={() => setSyncOpen(true)}>Open sync centre</Button>
                <Button variant="subtle" icon={RefreshCw} onClick={() => store.flushNow()} disabled={!store.online || !store.pending.length}>Sync now</Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="How merging works" sub="Documented policy — never silent" icon={Scale} />
            <div className="card-body stack" style={{ gap: 8 }}>
              {[
                ['Money & status', 'A change to a total, paid amount, invoice status, appointment status or token always waits for a human decision.'],
                ['Everything else', 'Merged field by field: if you edited the notes and reception edited the phone number, both survive.'],
                ['New records', 'Created on this device with an id, so replaying the queue can never duplicate a patient.'],
                ['Deleted elsewhere', 'Your offline edit cannot attach to a deleted row; it is queued for review so nothing is lost silently.'],
              ].map(([title, body]) => (
                <div key={title} className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--success)', marginTop: 2 }}><Check size={14} strokeWidth={3} /></span>
                  <div><strong className="small">{title}</strong><p className="tiny muted">{body}</p></div>
                </div>
              ))}
              <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
                <WifiOff size={14} className="muted" />
                <span className="muted">Cached data is stored per user and clinic, expires after 24 hours, and is wiped on sign out.</span>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'about' ? (
        <div className="stack">
          <Card>
            <CardHead title="Version" sub="What this device is running" icon={GitBranch} />
            <div className="card-body stack" style={{ gap: 10 }}>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px,100%),1fr))', gap: 10 }}>
                <MiniStat label="App version" value={`v${APP_VERSION}`} tone="brand" />
                <MiniStat label="Schema" value={`v${SCHEMA_VERSION}`} tone="neutral" />
                <MiniStat label="Build" value={BUILD_LABEL} tone="neutral" />
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="subtle" icon={History} onClick={() => { window.location.hash = '#/app/settings'; }}>You are up to date</Button>
                <Button variant="ghost" icon={RefreshCw} onClick={() => window.location.reload()}>Reload this build</Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="What's new" sub="Release notes for this workspace" icon={Sparkles} />
            <div className="card-body stack" style={{ gap: 14 }}>
              {CHANGELOG.map((rel) => (
                <div key={rel.version}>
                  <div className="row" style={{ gap: 8, marginBottom: 5 }}>
                    <strong className="small">v{rel.version}</strong>
                    <Badge tone={rel.version === APP_VERSION ? 'brand' : 'neutral'}>{rel.version === APP_VERSION ? 'Current' : rel.date}</Badge>
                    {rel.schema !== SCHEMA_VERSION ? <span className="tiny faint">schema v{rel.schema}</span> : null}
                  </div>
                  <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 3 }}>
                    {rel.highlights.map((h) => <li key={h}>{h}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="Your access" sub={`Role: ${ROLE_LABEL[role]}`} icon={ShieldCheck} />
            <div className="card-body stack" style={{ gap: 6 }}>
              <p className="small muted" style={{ marginBottom: 4 }}>{ROLE_BLURB[role]}</p>
              {[
                ['Register patients and book appointments', can(role, 'patient:write')],
                ['Issue tokens at the front desk', can(role, 'appointment:token')],
                ['Write consultations and prescriptions', can(role, 'consultation:write')],
                ['Collect payments', can(role, 'invoice:collect')],
                ['Void a paid invoice', can(role, 'invoice:void')],
                ['See money reports', can(role, 'clinic:reports:money')],
                ['Manage team and roles', can(role, 'team:write')],
                ['Change clinic settings', can(role, 'clinic:settings')],
              ].map(([label, allowed]) => (
                <div key={label} className="row small" style={{ gap: 8 }}>
                  <span style={{ color: allowed ? 'var(--success)' : 'var(--muted)', marginTop: 1 }}>
                    {allowed ? <Check size={14} strokeWidth={3} /> : <span style={{ display: 'inline-block', width: 14, textAlign: 'center' }}>—</span>}
                  </span>
                  <span className={allowed ? '' : 'muted'}>{label}</span>
                  {!allowed ? <Badge tone="neutral">Not for {ROLE_LABEL[role].toLowerCase()}</Badge> : null}
                </div>
              ))}
              <p className="tiny faint" style={{ marginTop: 6 }}>Enforced by row-level security in Postgres, not just by this screen.</p>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'plan' ? (
        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Your plan" sub={store.mode === 'demo' ? 'Demo workspace' : 'Live workspace'} icon={Sparkles}
              action={<Badge tone="brand">{PLANS.find((p) => p.id === (store.clinic?.plan ?? 'growth'))?.name ?? 'Growth'}</Badge>} />
            <div className="card-body">
              <div className="row wrap" style={{ gap: 14 }}>
                <div>
                  <span className="eyebrow">Current</span>
                  <div className="kpi-value mono" style={{ fontSize: '1.5rem' }}>{formatMoney(PLANS.find((p) => p.id === (store.clinic?.plan ?? 'growth'))?.price_paise ?? 0)}<span className="tiny faint"> /mo</span></div>
                </div>
                <span className="spacer" />
                <Button variant="primary" icon={Sparkles} onClick={() => setPlanOpen(true)}>Change plan</Button>
              </div>
              <div className="grid three" style={{ gap: 8, marginTop: 14 }}>
                {[
                  ['Doctors', `${store.doctors.length} / ${store.clinic?.plan === 'chain' ? '∞' : store.clinic?.plan === 'solo' ? 1 : 5}`],
                  ['Front desk', `${store.frontDesk.length} / ${store.clinic?.plan === 'chain' ? '∞' : store.clinic?.plan === 'solo' ? 1 : 3}`],
                  ['Patients', String(store.patients.length)],
                ].map(([label, value]) => (
                  <div key={label} className="card pad" style={{ padding: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
                    <span className="tiny faint">{label}</span><div className="strong mono small">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Your data" sub="Export or reset the workspace" icon={Download} />
            <div className="card-body stack">
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="subtle" icon={Download} onClick={exportAll}>Export patients (CSV)</Button>
                <Button variant="subtle" icon={Download} onClick={() => { downloadFile(`myclinic-invoices-${today()}.csv`, toCSV(store.invoices, [{ label: 'Invoice', key: 'number' }, { label: 'Date', key: 'issued_on' }, { label: 'Total', value: (i) => (i.total_paise / 100).toFixed(2) }, { label: 'Paid', value: (i) => (i.paid_paise / 100).toFixed(2) }, { label: 'Method', key: 'method' }, { label: 'Status', key: 'status' }])); toast.success('Invoice export downloaded.'); }}>Export invoices (CSV)</Button>
              </div>
              <p className="tiny muted">Exports include only this clinic’s records. No patient data leaves your account unless you download it.</p>
              {store.mode === 'demo' ? (
                <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, gap: 8, flexWrap: 'wrap' }}>
                  <Button variant="subtle" icon={RefreshCw} onClick={() => { store.resetDemo(); toast.success('Demo workspace reset.'); }}>Reset demo data</Button>
                  <Button variant="danger" icon={Trash2} onClick={() => setResetOpen(true)}>Clear this browser’s demo</Button>
                </div>
              ) : (
                <div className="row small" style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11, gap: 8 }}>
                  <ShieldCheck size={14} className="muted" />
                  <span className="muted">Live workspace — records live in your Supabase project and are never deleted by this app.</span>
                </div>
              )}
            </div>
          </Card>

          <Card className="pad">
            <div className="row" style={{ gap: 8 }}>
              <Monitor size={15} className="muted" />
              <span className="small muted">myClinic v1.0 · {store.mode === 'demo' ? 'demo mode' : 'connected'} · {store.patients.length} patients · {store.consultations.length} consultations</span>
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => navigate('/setup')}>Setup</Button>
            </div>
          </Card>
        </div>
      ) : null}

      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title="Change plan" sub="Switch any time — data stays put">
        <div className="stack">
          {PLANS.map((plan) => (
            <div key={plan.id} className="row" style={{ gap: 12, border: `1px solid ${store.clinic?.plan === plan.id ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 12, padding: 12 }}>
              <div className="stack" style={{ gap: 2, flex: 1 }}>
                <div className="row" style={{ gap: 6 }}>
                  <strong className="small">{plan.name}</strong>
                  {plan.popular ? <Badge tone="brand">Popular</Badge> : null}
                  {store.clinic?.plan === plan.id ? <Badge tone="success">Current</Badge> : null}
                </div>
                <span className="tiny muted">{plan.limits}</span>
              </div>
              <span className="strong mono small">{formatMoney(plan.price_paise, { compact: true })}/mo</span>
              <Button size="sm" variant={store.clinic?.plan === plan.id ? 'subtle' : 'primary'} disabled={store.clinic?.plan === plan.id}
                onClick={async () => {
                  try { await store.update('clinic', store.clinic.id, { plan: plan.id }); toast.success(`Switched to ${plan.name}.`); setPlanOpen(false); }
                  catch (e) { toast.error(e.message ?? 'Could not change plan.'); }
                }}>
                {store.clinic?.plan === plan.id ? 'Active' : 'Switch'}
              </Button>
            </div>
          ))}
          <p className="tiny faint">Billing is simulated in this build. Wire a payment provider before charging real clinics.</p>
        </div>
      </Modal>

      <SyncCenter open={syncOpen} onClose={() => setSyncOpen(false)} />

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Clear demo data?"
        footer={<><Button variant="ghost" onClick={() => setResetOpen(false)}>Keep it</Button><Button variant="danger" onClick={() => { localStorage.removeItem('myclinic.demo.v1'); store.resetDemo(); toast.success('Demo cleared and rebuilt.'); setResetOpen(false); }}>Clear and rebuild</Button></>}>
        <p className="small muted">This only clears the fictional demo workspace stored in this browser. Nothing is sent or deleted anywhere else.</p>
      </Modal>
    </div>
  );
}

function pickPrefs(profile) {
  if (!profile) return {};
  const out = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES)) if (profile[key] !== undefined && profile[key] !== null) out[key] = profile[key];
  return out;
}

function MiniStat({ label, value, tone = 'neutral' }) {
  return (
    <div className={`card pad sync-stat ${tone}`} style={{ padding: 11, boxShadow: 'none' }}>
      <span className="tiny muted">{label}</span>
      <div className="small strong" style={{ marginTop: 3 }}>{value}</div>
    </div>
  );
}
