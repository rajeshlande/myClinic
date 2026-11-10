import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Save, ShieldCheck } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useAuth } from '../lib/auth-context.jsx';
import { useToast, Select, Tabs } from '../components/ui.jsx';
import { normaliseVpa } from '../lib/upi.mjs';
import { ACCENTS, applyDensity, applyTheme, readAccent, readTheme, saveAccent, saveTheme } from '../lib/theme.js';
import { can, ROLE_BLURB, ROLE_LABEL } from '../lib/permissions.js';
import { BOOKING_HORIZON_DAYS, bookingUrl, clinicSlug } from '../lib/public-booking.mjs';
import { clinicSessions, closure, normaliseDates, normaliseWeekdays, validateFollowUpDays, validateSessions } from '../lib/hours.mjs';
import { rememberError } from '../lib/errors.mjs';
import { DEFAULT_PREFERENCES, downloadFile, moneyToPaise, paiseToInput, addDays, profilePatch, today, toCSV } from '../lib/logic.mjs';
import BrandingTab from '../components/settings/BrandingTab.jsx';
import ClinicTab from '../components/settings/ClinicTab.jsx';
import BillingTab from '../components/settings/BillingTab.jsx';
import AccountTab from '../components/settings/AccountTab.jsx';
import AppearanceTab from '../components/settings/AppearanceTab.jsx';
import SyncTab from '../components/settings/SyncTab.jsx';
import AboutTab from '../components/settings/AboutTab.jsx';
import PlanDataTab from '../components/settings/PlanDataTab.jsx';

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
    // Schema 12: a day is one or two sessions, and a clinic can close on chosen
    // weekdays or one-off dates. A clinic created before schema 12 has neither,
    // so it starts from its single open/close pair — nothing changes underfoot.
    sessions: clinicSessions(store.clinic),
    closed_weekdays: normaliseWeekdays(store.clinic?.closed_weekdays),
    closed_dates: normaliseDates(store.clinic?.closed_dates),
 }));
  const [profile, setProfile] = useState({
    full_name: store.profile?.full_name ?? '',
    phone: store.profile?.phone ?? '',
    designation: store.profile?.designation ?? '',
 });
  const [prefs, setPrefs] = useState({ ...DEFAULT_PREFERENCES, ...pickPrefs(store.profile) });

  useEffect(() => { applyDensity(prefs.density); }, [prefs.density]);

  const canEdit = can(role, 'clinic:settings');
  // A seat only sees the settings it can act on: the clinic's identity, GST setup,
  // booking link and plan are the owner's screens, so a front-desk account gets its
  // own details, the look of the app and the sync status — nothing it would only be
  // able to read and not change.
  const visibleTabs = [
    ...(canEdit ? [
      { value: 'clinic', label: 'Clinic' },
      { value: 'branding', label: 'Logos & branding' },
      { value: 'billing', label: 'Billing & invoices' },
    ] : []),
    { value: 'account', label: 'My account' },
    { value: 'appearance', label: 'Appearance & colours' },
    { value: 'sync', label: 'Offline & sync' },
    { value: 'about', label: 'About & version' },
    ...(canEdit ? [{ value: 'plan', label: 'Plan & data' }] : []),
  ];
  const activeTab = visibleTabs.some((t) => t.value === tab) ? tab : visibleTabs[0].value;
  const clinicState = clinic ?? {};
  // The link Settings hands out has to be the link that works, so it is built from
  // the slug the *database* has — not from the name, and never from the demo
  // clinic's address (which is what a clinic with no slug used to be shown).
  const savedSlug = clinicSlug(store.clinic?.slug ?? '');
  const typedSlug = clinicSlug(clinicState.slug || clinicState.name || '');
  const publicLink = savedSlug ? bookingUrl(savedSlug) : '';
  const slugPending = Boolean(typedSlug) && typedSlug !== savedSlug;

  // Validated while typing, not only on Save: a follow-up window outside 3–45
  // days is a mistake the field can point at before anything is sent.
  const followUpError = validateFollowUpDays(clinic.follow_up_days);
  // The next closure in the coming fortnight, so the owner can see the effect of
  // the day offs without opening the calendar.
  const nextClosedLine = (() => {
    for (let i = 0; i < 14; i += 1) {
      const iso = addDays(today(), i);
      const shut = closure(iso, { closedWeekdays: clinic.closed_weekdays, closedDates: clinic.closed_dates });
      if (shut.closed) {
        const label = new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
        return `Next closed day: ${i === 0 ? 'today' : label} — ${shut.reason}. No slots are offered that day.`;
     }
   }
    return 'Open every day for the next two weeks.';
 })();

  async function saveClinic() {
    setSaving(true);
    try {
      let fee, followUp;
      try { fee = moneyToPaise(clinic.fee); followUp = moneyToPaise(clinic.follow_up_fee); }
      catch { toast.error('The consultation and follow-up fees must be plain rupee amounts, for example 500.'); setSaving(false); return; }

      // Hours and the follow-up window are checked here as well as in Postgres, so
      // a bad value is answered in the field's own words rather than as a 400.
      const hours = validateSessions(clinic.sessions, { label: 'Clinic hours' });
      if (!hours.ok) { toast.error(hours.error); setSaving(false); return; }
      const followUpProblem = validateFollowUpDays(clinic.follow_up_days);
      if (followUpProblem) { toast.error(followUpProblem); setSaving(false); return; }
      await store.updateNow('clinic', store.clinic.id, {
        name: clinic.name?.trim(), clinic_type: clinic.clinic_type, phone: clinic.phone, email: clinic.email,
        address: clinic.address, gstin: clinic.gstin, brand_color: clinic.brand_color,
        consultation_fee_paise: fee, follow_up_fee_paise: followUp,
        follow_up_days: Number(clinic.follow_up_days),
        slot_minutes: Number(clinic.slot_minutes) || 15,
        // open_time/close_time stay written as the outer edges of the day, so any
        // older screen (and the public booking page on a stale cache) still reads
        // sane hours. The truth is `sessions`.
        open_time: hours.sessions[0].start,
        close_time: hours.sessions[hours.sessions.length - 1].end,
        sessions: hours.sessions,
        closed_weekdays: normaliseWeekdays(clinic.closed_weekdays),
        closed_dates: normaliseDates(clinic.closed_dates),
        gst_enabled: Boolean(clinic.gst_enabled), gst_rate: Number(clinic.gst_rate) || 0,
        invoice_prefix: clinic.invoice_prefix || 'INV',
        booking_enabled: clinicState.booking_enabled !== false,
        booking_horizon_days: Number(clinicState.booking_horizon_days) || BOOKING_HORIZON_DAYS,
        booking_note: (clinicState.booking_note ?? '').slice(0, 120),
        // Branding travels with the clinic row so it survives offline and appears
        // on every document without a second fetch.
        logo_square_url: clinic.logo_square_url ?? null,
        logo_wide_url: clinic.logo_wide_url ?? null,
        logo_on_documents: clinic.logo_on_documents !== false,
        // UPI collection — the VPA printed as a QR on unpaid invoices.
        upi_id: normaliseVpa(clinic.upi_id),
        upi_payee_name: String(clinic.upi_payee_name ?? '').trim(),
        upi_qr_on_invoices: clinic.upi_qr_on_invoices !== false,
     });
      // `slug` is written separately: set_clinic_slug() normalises it, steps aside
      // if another clinic holds the address and hands back the one that is live, so
      // the field ends up showing exactly what a patient will open.
      if (typedSlug !== savedSlug) {
        const live = await store.saveBookingSlug(typedSlug || clinicState.name);
        setClinic((c) => ({ ...c, slug: live }));
        toast.success(`Clinic profile saved. Booking link is /book/${live}.`);
     } else {
        toast.success('Clinic profile saved.');
     }
   } catch (e) {
      const explained = rememberError(e, 'Save the clinic profile');
      toast.error(explained.message, explained.hint);
      console.warn('clinic profile save failed', explained.code, explained.detail);
   } finally { setSaving(false); }
 }

  /**
   * Save my account.
   *
   * This used to send `{ ...profile, ...prefs, theme }` — every key the screen
   * happened to hold — to `profiles`. Once `prefs` grew `send_review_request`
   * (a preference the database never had a column for) PostgREST refused the
   * whole update with PGRST204 and the person saw only "Could not save.", so a
   * name change failed because of a notification toggle.
   *
   * Now the patch is built from the columns the database actually has. A new
   * preference cannot break saving again, and if a column is genuinely missing
   * the message names it and says to re-run schema.sql.
   */
  async function saveProfile() {
    setSaving(true);
    try {
      if (!profile.full_name.trim()) { toast.error('Add your name — it is printed on the prescriptions you sign.'); setSaving(false); return; }
      const patch = profilePatch(profile, prefs, theme);
      if (store.mode === 'demo') {
        toast.success('Profile saved in the demo workspace.');
     } else {
        const id = store.profile?.id ?? user?.id;
        if (!id) { toast.error('You are not signed in, so there is nothing to save to. Sign in again.'); setSaving(false); return; }
        // `updateNow` waits for the database and throws its answer, so "saved"
        // is only ever shown once the server has actually accepted the write.
        if (store.profile) await store.updateNow('profile', id, patch);
        else await store.create('profile', { id, ...patch });
        toast.success('Profile and preferences saved.');
     }
      setSaving(false);
   } catch (e) {
      const explained = rememberError(e, 'Save my account');
      toast.error(explained.message, explained.hint);
      console.warn('profile save failed', explained.code, explained.detail);
      setSaving(false);
   }
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

  // One panel per tab: the markup lives in src/components/settings/<Tab>Tab.jsx, the
  // state and the save handlers stay here, so a tab is a prop list and nothing else.
  const panels = {
    branding: <BrandingTab clinic={clinic} setClinic={setClinic} saveClinic={saveClinic} saving={saving} profile={profile} />,
    clinic: <ClinicTab clinic={clinic} setClinic={setClinic} saveClinic={saveClinic} saving={saving} followUpError={followUpError} nextClosedLine={nextClosedLine} profile={profile} savedSlug={savedSlug} publicLink={publicLink} slugPending={slugPending} />,
    billing: <BillingTab clinic={clinic} setClinic={setClinic} saveClinic={saveClinic} saving={saving} />,
    account: <AccountTab profile={profile} setProfile={setProfile} pw={pw} setPw={setPw} saveProfile={saveProfile} saving={saving} />,
    appearance: <AppearanceTab theme={theme} setTheme={setTheme} changeTheme={changeTheme} accent={accent} setAccent={setAccent} changeAccent={changeAccent} prefs={prefs} setPrefs={setPrefs} saveProfile={saveProfile} saving={saving} />,
    sync: <SyncTab syncOpen={syncOpen} setSyncOpen={setSyncOpen} clinic={clinic} />,
    about: <AboutTab />,
    plan: <PlanDataTab planOpen={planOpen} setPlanOpen={setPlanOpen} resetOpen={resetOpen} setResetOpen={setResetOpen} exportAll={exportAll} clinic={clinic} />,
 };

  return (
    <div className="page narrow stack" style={{ gap: 16 }}>
      <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '9px 12px', borderRadius: 11 }}>
        <ShieldCheck size={14} className="muted" />
        <span className="muted">
          Signed in as <strong>{ROLE_LABEL[role]}</strong>. {ROLE_BLURB[role]}
        </span>
      </div>

      <Tabs
        value={activeTab} onChange={setTab}
        tabs={visibleTabs}
      />
      {panels[activeTab] ?? null}
    </div>
  );
}

function pickPrefs(profile) {
  if (!profile) return {};
  const out = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES)) if (profile[key] !== undefined && profile[key] !== null) out[key] = profile[key];
  return out;
}

