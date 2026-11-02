import { useState } from 'react';
import { Clock, Plus, Pencil, Stethoscope, Users, UserRound, ShieldCheck, Copy, Mail, Phone, Power } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Avatar, Badge, Button, Card, CardHead, Field, IconButton, Input, Modal, Select, Tabs } from '../components/ui.jsx';
import { ROLES, formatMoney, moneyToPaise, paiseToInput, slugify } from '../lib/logic.mjs';

export default function Team() {
  const store = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('doctors');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: '', role: 'frontdesk' });
  const [saving, setSaving] = useState(false);

  const doctors = store.doctors;
  const staff = store.frontDesk;

  const blank = {
    full_name: '', role: 'doctor', specialty: 'General Physician', qualification: 'MBBS',
    registration_no: '', phone: '', email: '', color: '#0f766e',
    day_start: '09:00', day_end: '13:00', slot_minutes: 15, fee: '500', follow_up_fee: '250', active: true,
  };
  const [draft, setDraft] = useState(blank);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target?.value ?? e }));

  function openNew() {
    setEditing(null);
    setDraft({ ...blank, fee: paiseToInput(store.clinic?.consultation_fee_paise ?? 50000), follow_up_fee: paiseToInput(store.clinic?.follow_up_fee_paise ?? 25000) });
    setFormOpen(true);
  }
  function openEdit(member) {
    setEditing(member);
    setDraft({
      ...blank, ...member,
      fee: paiseToInput(member.fee_paise ?? 0),
      follow_up_fee: paiseToInput(member.follow_up_fee_paise ?? 0),
    });
    setFormOpen(true);
  }

  async function save() {
    if (!draft.full_name.trim()) { toast.error('Add the person’s name.'); return; }
    setSaving(true);
    try {
      let fee = 0, followUp = 0;
      try { fee = moneyToPaise(draft.fee || 0); followUp = moneyToPaise(draft.follow_up_fee || 0); } catch { /* ignore */ }
      const payload = {
        full_name: draft.full_name.trim(),
        role: draft.role,
        specialty: draft.specialty,
        qualification: draft.qualification,
        registration_no: draft.registration_no,
        phone: draft.phone,
        email: draft.email,
        color: draft.color,
        day_start: draft.day_start,
        day_end: draft.day_end,
        slot_minutes: Number(draft.slot_minutes) || 15,
        fee_paise: fee,
        follow_up_fee_paise: followUp,
        active: draft.active !== false,
      };
      if (editing) {
        // A role change is an owner operation and is mirrored by staff_guard() in Postgres.
        await store.update('staff', editing.id, payload);
        toast.success('Staff record updated.');
      } else if (store.mode === 'demo') {
        await store.create('staff', payload);
        toast.success(`${payload.full_name} added to the clinic.`);
      } else {
        // Live: membership is granted through a SECURITY DEFINER function, never a
        // direct staff insert (the RLS policy refuses self-enrolment).
        if (!payload.email) { toast.error('An email address is needed so the person can claim the seat.'); setSaving(false); return; }
        await store.inviteStaff({ email: payload.email, role: payload.role === 'owner' ? 'doctor' : payload.role, name: payload.full_name });
        toast.success(`Invitation sent to ${payload.email}. They appear here once they sign in.`);
      }
      setFormOpen(false);
    } catch (e) { toast.error(e.message ?? 'Could not save.'); } finally { setSaving(false); }
  }

  async function toggleActive(member) {
    try {
      await store.update('staff', member.id, { active: !member.active });
      toast.info(`${member.full_name} ${member.active ? 'deactivated' : 'reactivated'}.`);
    } catch (e) { toast.error(e.message ?? 'Could not update.'); }
  }

  async function sendInvite() {
    if (!invite.email.trim()) { toast.error('Add the person’s work email.'); return; }
    setSaving(true);
    try {
      if (store.mode === 'demo') {
        // Demo keeps everything local: create the seat immediately.
        await store.create('staff', {
          full_name: invite.email.split('@')[0], role: invite.role, email: invite.email,
          specialty: '', qualification: '', active: true, color: '#0f766e',
        });
        toast.success('Seat added in the demo workspace.');
      } else {
        await store.inviteStaff({ email: invite.email.trim(), role: invite.role });
        toast.success(`Invite created for ${invite.email}. It activates when they sign in.`);
      }
      setInvite({ email: '', role: 'frontdesk' });
      setInviteOpen(false);
    } catch (e) {
      toast.error(e.message ?? 'Could not create the invite.');
    } finally { setSaving(false); }
  }

  const inviteLink = `${window.location.origin}${window.location.pathname}#/signup?clinic=${slugify(store.clinic?.name ?? 'clinic')}&role=${invite.role}`;

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 1, flex: 1, minWidth: 200 }}>
          <h2>{store.clinic?.name}</h2>
          <span className="tiny muted">{doctors.length} doctor{doctors.length === 1 ? '' : 's'} · {staff.length} front-desk seat{staff.length === 1 ? '' : 's'} · {store.clinic?.plan ?? 'growth'} plan</span>
        </div>
        <Button variant="subtle" icon={Mail} onClick={() => setInviteOpen(true)}>Invite staff</Button>
        <Button variant="primary" icon={Plus} onClick={openNew}>Add doctor / staff</Button>
      </div>

      <Tabs
        value={tab} onChange={setTab}
        tabs={[{ value: 'doctors', label: 'Doctors', count: doctors.length }, { value: 'frontdesk', label: 'Front desk', count: staff.length }, { value: 'roles', label: 'Roles & access' }]}
      />

      {tab !== 'roles' ? (
        <div className="grid two" style={{ gap: 14 }}>
          {(tab === 'doctors' ? doctors : staff).map((member) => (
            <Card key={member.id} className="pad">
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <Avatar name={member.full_name} size="lg" tone={member.color} />
                <div className="stack" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <strong style={{ fontSize: '0.98rem' }}>{member.full_name}</strong>
                    <Badge tone={member.role === 'owner' ? 'brand' : member.role === 'doctor' ? 'info' : 'neutral'}>{ROLES.find((r) => r.id === member.role)?.label ?? member.role}</Badge>
                    {member.active === false ? <Badge tone="neutral">Inactive</Badge> : null}
                  </div>
                  <span className="tiny muted">{member.specialty}{member.qualification ? ` · ${member.qualification}` : ''}</span>
                  {member.registration_no ? <span className="tiny faint mono">Reg. {member.registration_no}</span> : null}
                  <div className="row wrap tiny faint" style={{ gap: 10, marginTop: 2 }}>
                    {member.phone ? <span className="row" style={{ gap: 4 }}><Phone size={11} /> {member.phone}</span> : null}
                    {member.email ? <span className="row" style={{ gap: 4 }}><Mail size={11} /> {member.email}</span> : null}
                  </div>
                  {member.role !== 'frontdesk' ? (
                    <div className="row wrap tiny" style={{ gap: 8, marginTop: 6 }}>
                      <span className="badge neutral"><Clock size={10} /> {member.day_start}–{member.day_end}</span>
                      <span className="badge neutral">{member.slot_minutes ?? 15} min slots</span>
                      <span className="badge brand">{formatMoney(member.fee_paise ?? 0)}</span>
                      <span className="badge neutral">F/U {formatMoney(member.follow_up_fee_paise ?? 0)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <IconButton icon={Pencil} label="Edit" size={15} onClick={() => openEdit(member)} />
                  {member.role !== 'owner' ? <IconButton icon={Power} label={member.active === false ? 'Reactivate' : 'Deactivate'} size={15} onClick={() => toggleActive(member)} /> : null}
                </div>
              </div>
            </Card>
          ))}
          {!(tab === 'doctors' ? doctors : staff).length ? (
            <Card className="pad"><p className="small muted">No one in this group yet.</p></Card>
          ) : null}
        </div>
      ) : (
        <div className="grid three" style={{ gap: 14 }}>
          {ROLES.map((role) => (
            <Card key={role.id} className="pad">
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <span className="kpi-icon">{role.id === 'owner' ? <ShieldCheck size={15} /> : role.id === 'doctor' ? <Stethoscope size={15} /> : <UserRound size={15} />}</span>
                <strong className="small">{role.label}</strong>
              </div>
              <p className="tiny muted" style={{ marginBottom: 10 }}>{role.hint}</p>
              <div className="stack" style={{ gap: 6 }}>
                {[
                  ['Dashboard & reports', true],
                  ['Patient charts', role.id !== 'frontdesk' || true],
                  ['Consultations & prescriptions', role.id !== 'frontdesk'],
                  ['Billing & payments', role.id !== 'doctor'],
                  ['Clinic settings & plan', role.id === 'owner'],
                  ['Invite or remove staff', role.id === 'owner'],
                ].map(([label, allowed]) => (
                  <div key={label} className="row tiny" style={{ gap: 7, color: allowed ? 'var(--text-2)' : 'var(--faint)' }}>
                    <span style={{ color: allowed ? 'var(--success)' : 'var(--faint)', fontWeight: 800 }}>{allowed ? '✓' : '—'}</span>
                    {label}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="pad">
        <div className="row wrap" style={{ gap: 10 }}>
          <span className="kpi-icon"><Users size={15} /></span>
          <div className="stack" style={{ gap: 1, flex: 1, minWidth: 200 }}>
            <strong className="small">Seats on your plan</strong>
            <span className="tiny muted">{store.clinic?.plan === 'solo' ? '1 doctor + 1 front desk' : store.clinic?.plan === 'chain' ? 'Unlimited seats' : '5 doctors + 3 front desk'}</span>
          </div>
          <Badge tone="brand">{doctors.length + staff.length} in use</Badge>
        </div>
      </Card>

      <Modal
        open={formOpen} onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.full_name}` : 'Add a doctor or staff member'}
        sub="Doctors get bookable slots; front desk can register patients and take payments"
        footer={<><Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button><Button variant="primary" onClick={save} loading={saving}>{editing ? 'Save changes' : 'Add to clinic'}</Button></>}
      >
        <div className="form-grid">
          <Field label="Full name *" className="span-2"><Input value={draft.full_name} onChange={set('full_name')} placeholder="Dr. Imran Sheikh" autoFocus /></Field>
          <Field label="Role">
            <Select value={draft.role} onChange={set('role')} disabled={editing?.role === 'owner'}>
              {ROLES.filter((r) => r.id !== 'owner').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Specialty"><Input value={draft.specialty} onChange={set('specialty')} placeholder="Paediatrics" /></Field>
          <Field label="Qualification"><Input value={draft.qualification} onChange={set('qualification')} placeholder="MBBS, DCH" /></Field>
          <Field label="Registration no."><Input value={draft.registration_no} onChange={set('registration_no')} placeholder="MH-2014-71290" /></Field>
          <Field label="Phone"><Input value={draft.phone} onChange={set('phone')} inputMode="tel" placeholder="+91 98200 00000" /></Field>
          <Field label="Email"><Input value={draft.email} onChange={set('email')} type="email" placeholder="name@clinic.in" /></Field>
          {draft.role !== 'frontdesk' ? (
            <>
              <Field label="Day starts"><Input type="time" value={draft.day_start} onChange={set('day_start')} /></Field>
              <Field label="Day ends"><Input type="time" value={draft.day_end} onChange={set('day_end')} /></Field>
              <Field label="Slot length">
                <Select value={draft.slot_minutes} onChange={set('slot_minutes')}>
                  {[5, 10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </Select>
              </Field>
              <Field label="Consultation fee ₹"><Input value={draft.fee} onChange={set('fee')} inputMode="decimal" /></Field>
              <Field label="Follow-up fee ₹"><Input value={draft.follow_up_fee} onChange={set('follow_up_fee')} inputMode="decimal" /></Field>
              <Field label="Calendar colour">
                <div className="row" style={{ gap: 6 }}>
                  {['#0f766e', '#7c5cd6', '#c2872b', '#3d7fb8', '#c0455a', '#5d7c5a'].map((c) => (
                    <button key={c} type="button" onClick={() => setDraft((d) => ({ ...d, color: c }))} aria-label={`Colour ${c}`}
                      style={{ width: 26, height: 26, borderRadius: 8, background: c, border: draft.color === c ? '2px solid var(--text)' : '1px solid var(--border)', cursor: 'pointer' }} />
                  ))}
                </div>
              </Field>
            </>
          ) : null}
          <label className="check span-2" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={draft.active !== false} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} />
            <span>Active — appears in booking and rota</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a staff member"
        sub="They keep their own login — you grant the seat"
        footer={<>
          <Button variant="ghost" onClick={() => setInviteOpen(false)}>Close</Button>
          <Button variant="subtle" icon={Copy} onClick={() => {
            const text = `Join ${store.clinic?.name} on myClinic: ${inviteLink}`;
            navigator.clipboard?.writeText(text).then(() => toast.success('Invite link copied.')).catch(() => toast.error('Clipboard blocked.'));
          }}>Copy link</Button>
          <Button variant="primary" icon={Mail} loading={saving} onClick={sendInvite} disabled={!invite.email.trim()}>Send invite</Button>
        </>}
      >
        <div className="stack">
          <div className="form-grid">
            <Field label="Work email *"><Input value={invite.email} onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))} placeholder="priya@clinic.in" autoFocus /></Field>
            <Field label="Role">
              <Select value={invite.role} onChange={(e) => setInvite((i) => ({ ...i, role: e.target.value }))}>
                {ROLES.filter((r) => r.id !== 'owner').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </Field>
          </div>
          <p className="tiny muted" style={{ marginTop: 2 }}>
            {ROLES.find((r) => r.id === invite.role)?.hint}
          </p>
          <pre className="tiny mono" style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{inviteLink}</pre>
          <p className="tiny muted">
            They sign in with this email and the seat is granted server-side by <code>accept_invite()</code>.
            Nobody — including an existing member — can add themselves to a clinic, so this step cannot be skipped.
          </p>
        </div>
      </Modal>
    </div>
  );
}
