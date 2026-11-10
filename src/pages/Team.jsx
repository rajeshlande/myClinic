import { useState } from 'react';
import {
  Clock, Plus, Pencil, Stethoscope, Users, UserRound, ShieldCheck, Copy, Mail, Phone, Power,
  Trash2, Link2, UserPlus, Hourglass, GitBranch,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Avatar, Badge, Button, Card, CardHead, Field, IconButton, Input, Modal, Select, Tabs } from '../components/ui.jsx';
import { ROLES, formatMoney, moneyToPaise, paiseToInput } from '../lib/logic.mjs';
import { canAddSeat } from '../lib/license.mjs';
import { PLAN_SEATS, planLabel } from '../lib/plans.mjs';
import { currentPlan } from '../lib/current-plan.mjs';
import { branchForPlan, branchTone, staffBranchLabel } from '../lib/staff-branch.mjs';
import { ROLE_OWNER, branchesForStaff, staffBranchBadge } from '../lib/branch-config.mjs';
import { branchScopeLabel } from '../lib/branch-scope.mjs';
import BranchAssignmentModal from '../components/BranchAssignmentModal.jsx';
import { can, roleMatrixFor } from '../lib/permissions.js';
import { SessionEditor, DayOffEditor } from '../components/HoursEditor.jsx';
import {
  WEEKDAYS, clinicSessions, doctorSessions, normaliseDates, normaliseWeekdays, sessionsSummary,
  validateDoctorSessions,
} from '../lib/hours.mjs';

/** 'Mon Tue' from weekday numbers, for the day-off badge. */
const WEEKDAY_SHORT = Object.fromEntries(WEEKDAYS.map((d) => [d.id, d.short]));
import { rememberError } from '../lib/errors.mjs';
import {
  daysLeft, inviteDefaults, inviteEmailError, inviteLink as buildInviteLink, pendingInvites, rememberInviteToken,
} from '../lib/invites.mjs';
import { guardWrite } from '../components/LicenseBanner.jsx';

export default function Team() {
  const store = useStore();
  const toast = useToast();
  const plan = currentPlan(store);
  const [tab, setTab] = useState('doctors');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const activeBranchRows = (store.branches ?? []).filter((b) => b?.id && b.active !== false);
  const blankInvite = () => ({
    email: '', role: 'frontdesk', name: '', specialty: '', qualification: '',
    branchId: store.activeBranchId ?? activeBranchRows[0]?.id ?? '',
  });
  const [invite, setInvite] = useState(blankInvite);
  const [saving, setSaving] = useState(false);
  const [sentInvite, setSentInvite] = useState(null);
  const [branchMember, setBranchMember] = useState(null);

  const doctors = store.doctors;
  const staff = store.frontDesk;

  const blank = {
    full_name: '', role: 'doctor', specialty: 'General Physician', qualification: 'MBBS',
    registration_no: '', phone: '', email: '', color: '#0f766e',
    day_start: '09:00', day_end: '13:00', slot_minutes: 15, fee: '500', follow_up_fee: '250', active: true,
    // Schema 12: a doctor sits inside one of the clinic's sessions and can have
    // their own days off. Both start empty and inherit the clinic.
    sessions: [], closed_weekdays: [], closed_dates: [],
  };
  const [draft, setDraft] = useState(blank);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target?.value ?? e }));

  function openNew() {
    setEditing(null);
    setDraft({
      ...blank,
      fee: paiseToInput(store.clinic?.consultation_fee_paise ?? 50000),
      follow_up_fee: paiseToInput(store.clinic?.follow_up_fee_paise ?? 25000),
      // Start from the clinic's first session so a new doctor is bookable at once,
      // and they can be narrowed to it (or to the other one) from here.
      sessions: clinicSessions(store.clinic).slice(0, 1),
      closed_weekdays: [], closed_dates: [],
    });
    setFormOpen(true);
  }
  function openEdit(member) {
    setEditing(member);
    setDraft({
      ...blank, ...member,
      fee: paiseToInput(member.fee_paise ?? 0),
      follow_up_fee: paiseToInput(member.follow_up_fee_paise ?? 0),
      sessions: doctorSessions(member, store.clinic),
      closed_weekdays: normaliseWeekdays(member.closed_weekdays),
      closed_dates: normaliseDates(member.closed_dates),
    });
    setFormOpen(true);
  }

  async function save() {
    if (!draft.full_name.trim()) { toast.error('Add the person’s name.'); return; }
    if (!seasonCheck(draft.role)) return;

    // A doctor's hours must sit inside one of the clinic's sessions: the evening
    // doctor cannot be booked at 10 AM because the screen offered it.
    let hours = null;
    if (draft.role !== 'frontdesk') {
      hours = validateDoctorSessions(draft.sessions, clinicSessions(store.clinic), { label: `${draft.full_name.trim() || 'Doctor'}'s hours` });
      if (!hours.ok) { toast.error(hours.error); return; }
    }
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
        // The legacy pair stays written as the outer edges of the doctor's day so
        // an older screen — and the pre-1.13 public booking page — still agrees.
        day_start: hours?.sessions?.[0]?.start ?? draft.day_start,
        day_end: hours?.sessions?.[hours.sessions.length - 1]?.end ?? draft.day_end,
        sessions: hours?.sessions ?? [],
        closed_weekdays: normaliseWeekdays(draft.closed_weekdays),
        closed_dates: normaliseDates(draft.closed_dates),
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
        await store.inviteStaff({
          email: payload.email, role: payload.role === 'owner' ? 'doctor' : payload.role,
          name: payload.full_name, branchId: store.activeBranchId,
        });
        toast.success(`Invitation sent to ${payload.email}. They appear here once they sign in.`);
      }
      setFormOpen(false);
    } catch (e) {
      const explained = rememberError(e, `${draft.full_name.trim() || 'A staff member'} · save`);
      toast.error(explained.message, explained.hint);
    } finally { setSaving(false); }
  }

  /** Licence gate: read-only clinics and full plans cannot take a new seat. */
  function seasonCheck(role) {
    if (!guardWrite(store, toast, 'add or change staff')) return false;
    const kind = role === 'frontdesk' ? 'frontdesk' : 'doctors';
    const verdict = canAddSeat(store.license, store.licenseUsage, kind);
    if (!verdict.allowed) { toast.error(verdict.message); return false; }
    return true;
  }

  async function toggleActive(member) {
    try {
      await store.update('staff', member.id, { active: !member.active });
      toast.info(`${member.full_name} ${member.active ? 'deactivated' : 'reactivated'}.`);
    } catch (e) { toast.error(e.message ?? 'Could not update.'); }
  }

  async function sendInvite() {
    const emailError = inviteEmailError(invite.email);
    if (emailError) { toast.error(emailError); return; }
    if (!seasonCheck(invite.role)) return;
    setSaving(true);
    try {
      if (store.mode === 'demo') {
        // The demo has no server to invite anyone into, so the seat is created
        // immediately — complete, because a doctor without hours or a fee breaks
        // the day board and the invoice defaults.
        const seat = inviteDefaults({
          role: invite.role, email: invite.email, name: invite.name,
          clinic: store.clinic ?? {}, staff: store.staff ?? [],
        });
        const seatRow = await store.create('staff', seat);
        if (invite.branchId && seatRow?.id) await store.assignStaffBranches(seatRow.id, [invite.branchId]);
        toast.success(invite.role === 'frontdesk'
          ? `${seat.full_name} has the front desk.`
          : `${seat.full_name} is on the rota with the clinic's hours — set their own in Doctors & staff.`);
      } else {
        const row = await store.inviteStaff({
          email: invite.email, role: invite.role, name: invite.name,
          specialty: invite.specialty, qualification: invite.qualification,
          branchId: invite.branchId || store.activeBranchId,
        });
        setSentInvite(row);
        toast.success(row?.alreadyPending
          ? `An invitation for ${invite.email} is already open — copy the link again.`
          : `Invitation for ${invite.email} is ready. Send them the link.`);
      }
      setInvite(blankInvite());
      setInviteOpen(false);
    } catch (e) {
      const message = String(e.message ?? '');
      toast.error(/row-level security|policy/i.test(message)
        ? 'Only the clinic owner can invite staff.'
        : (message || 'Could not create the invite.'));
    } finally { setSaving(false); }
  }

  async function revokeInvite(row) {
    try {
      await store.revokeInvite(row.id);
      toast.info(`Invitation for ${row.email} withdrawn.`);
    } catch (e) { toast.error(e.message ?? 'Could not withdraw the invitation.'); }
  }

  function copyInvite(inviteRow, role, email) {
    const link = buildInviteLink(inviteRow?.token ?? '', {});
    if (!inviteRow?.token) { toast.error('This invitation has no link — invite them again.'); return; }
    rememberInviteToken(inviteRow.token);
    const text = `Join ${store.clinic?.name} on myClinic as ${(role ?? inviteRow.role) === 'doctor' ? 'a doctor' : 'front desk'}: ${link}`;
    navigator.clipboard?.writeText(text)
      .then(() => toast.success('Invitation link copied — send it on WhatsApp or email.'))
      .catch(() => toast.error('Clipboard blocked — select the link and copy it.'));
    void email;
  }

  const pending = pendingInvites(store.invites ?? []);
  const canInvite = can(store.role ?? 'owner', 'team:write');
  const branchRows = store.branches ?? [];
  const assignments = store.staffBranches ?? [];
  const isOwner = store.role === ROLE_OWNER;
  /** Real assignments win; the label-only badge remains a pre-migration fallback. */
  const memberBranchBadge = (member) => (
    branchesForStaff(member.id, assignments, branchRows).length
      ? staffBranchBadge(member.id, assignments, branchRows)
      : branchRows.length ? 'No branch' : staffBranchLabel(plan, member)
  );
  const inviteLink = sentInvite?.token
    ? buildInviteLink(sentInvite.token, {})
    : buildInviteLink('', {});

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 1, flex: 1, minWidth: 200 }}>
          <h2>{store.clinic?.name}</h2>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="tiny muted">{doctors.length} doctor{doctors.length === 1 ? '' : 's'} · {staff.length} front-desk seat{staff.length === 1 ? '' : 's'} · {planLabel(plan)} plan</span>
            <Badge tone={branchTone(plan)}>{branchForPlan(plan)}</Badge>
          </div>
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
                    <Badge tone={branchTone(plan)}>{memberBranchBadge(member)}</Badge>
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
                      <span className="badge neutral"><Clock size={10} /> {sessionsSummary(doctorSessions(member, store.clinic)) || 'No hours set'}</span>
                      {normaliseWeekdays(member.closed_weekdays).length || normaliseDates(member.closed_dates).length ? (
                        <span className="badge warn">{normaliseWeekdays(member.closed_weekdays).map((d) => WEEKDAY_SHORT[d]).join(' ')}{normaliseDates(member.closed_dates).length ? ` +${normaliseDates(member.closed_dates).length} day off` : ''} off</span>
                      ) : null}
                      <span className="badge neutral">{member.slot_minutes ?? 15} min slots</span>
                      <span className="badge brand">{formatMoney(member.fee_paise ?? 0)}</span>
                      <span className="badge neutral">F/U {formatMoney(member.follow_up_fee_paise ?? 0)}</span>
                    </div>
                  ) : null}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {isOwner ? <IconButton icon={GitBranch} label="Assign branches" size={15} onClick={() => setBranchMember(member)} /> : null}
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
                {roleMatrixFor(role.id).map(({ label, capability, allowed }) => (
                  <div key={capability} className="row tiny" style={{ gap: 7, color: allowed ? 'var(--text-2)' : 'var(--faint)' }}>
                    <span style={{ color: allowed ? 'var(--success)' : 'var(--faint)', fontWeight: 800 }}>{allowed ? '✓' : '—'}</span>
                    {label}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {canInvite ? (
        <Card>
          <CardHead
            title="Pending invitations" icon={Mail}
            sub={store.mode === 'demo'
              ? 'Demo seats are created immediately — nothing waits here'
              : 'A seat is granted the first time they sign in with that email'}
            action={<Badge tone={pending.length ? 'info' : 'neutral'}>{pending.length} open</Badge>}
          />
          <div className="card-body stack" style={{ gap: 8 }}>
            {store.mode === 'demo' ? (
              <p className="small muted" style={{ margin: 0 }}>
                Inviting someone in the demo adds them to the clinic at once, so there is nothing to
                wait for. In a live clinic an invitation stays here until it is claimed — or until it
                expires after fourteen days.
              </p>
            ) : pending.length ? (
              pending.map((row) => (
                <div key={row.id} className="invite-row">
                  <Avatar name={row.full_name || row.email} size="sm" />
                  <div className="stack" style={{ gap: 1, minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <strong className="small">{row.full_name || row.email}</strong>
                      <Badge tone={row.role === 'doctor' ? 'info' : 'neutral'}>
                        {row.role === 'doctor' ? 'Doctor' : 'Front desk'}
                      </Badge>
                      <span className="tiny faint row" style={{ gap: 4 }}>
                        <Hourglass size={10} /> {daysLeft(row) === 0 ? 'expires today' : `${daysLeft(row)} day${daysLeft(row) === 1 ? '' : 's'} left`}
                      </span>
                    </div>
                    <span className="tiny muted mono" style={{ wordBreak: 'break-all' }}>{row.email}</span>
                    {row.specialty || row.qualification ? (
                      <span className="tiny faint">{[row.specialty, row.qualification].filter(Boolean).join(' · ')}</span>
                    ) : null}
                    {row.branch_id ? (
                      <span className="tiny faint">{branchScopeLabel(branchRows, row.branch_id)}</span>
                    ) : null}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <Button size="sm" variant="subtle" icon={Copy} onClick={() => copyInvite(row)}>Link</Button>
                    <IconButton icon={Trash2} label={`Withdraw the invitation for ${row.email}`} size={15} onClick={() => revokeInvite(row)} />
                  </div>
                </div>
              ))
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                No one is waiting to join. Press <strong>Invite staff</strong> to offer a seat.
              </p>
            )}
          </div>
        </Card>
      ) : null}

      <Card className="pad">
        <div className="row wrap" style={{ gap: 10 }}>
          <span className="kpi-icon"><Users size={15} /></span>
          <div className="stack" style={{ gap: 1, flex: 1, minWidth: 200 }}>
            <strong className="small">Seats on your plan</strong>
            <span className="tiny muted">{PLAN_SEATS[plan]} · {branchForPlan(plan)}</span>
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
              <div className="span-2">
                <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                  <Clock size={14} className="muted" />
                  <strong className="small" style={{ whiteSpace: 'nowrap' }}>Day starts and ends</strong>
                  <span className="small muted">Inside one of the clinic's sessions — a doctor is not bookable across the clinic's break.</span>
                </div>
                <SessionEditor
                  label={`${draft.full_name.trim() || 'Doctor'}'s hours`}
                  value={draft.sessions}
                  clinicHours={clinicSessions(store.clinic)}
                  onChange={(sessions) => setDraft((d) => ({ ...d, sessions }))}
                  hint={`Clinic hours: ${sessionsSummary(clinicSessions(store.clinic)) || 'not set yet'}.`}
                />
              </div>
              <Field label="Slot length">
                <Select value={draft.slot_minutes} onChange={set('slot_minutes')}>
                  {[5, 10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </Select>
              </Field>
              <Field label="Consultation fee ₹"><Input value={draft.fee} onChange={set('fee')} inputMode="decimal" /></Field>
              <Field label="Follow-up fee ₹"><Input value={draft.follow_up_fee} onChange={set('follow_up_fee')} inputMode="decimal" /></Field>
              <div className="span-2" style={{ marginTop: 6 }}>
                <strong className="small">Days off</strong>
                <DayOffEditor
                  label="This doctor's days off"
                  weekdays={draft.closed_weekdays}
                  dates={draft.closed_dates}
                  onWeekdays={(closed_weekdays) => setDraft((d) => ({ ...d, closed_weekdays }))}
                  onDates={(closed_dates) => setDraft((d) => ({ ...d, closed_dates }))}
                  inheritNote="The clinic's own closed days always apply on top of these."
                />
              </div>
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
          <Button
            variant="subtle" icon={Copy} disabled={!sentInvite?.token}
            onClick={() => copyInvite(sentInvite, invite.role, invite.email)}
          >
            Copy link
          </Button>
          <Button variant="primary" icon={Mail} loading={saving} onClick={sendInvite} disabled={!invite.email.trim()}>Send invite</Button>
        </>}
      >
        <div className="stack">
          <div className="form-grid">
            <Field label="Work email *" error={invite.email ? inviteEmailError(invite.email) : ''}>
              <Input value={invite.email} onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))} placeholder="priya@clinic.in" autoFocus inputMode="email" />
            </Field>
            <Field label="Role">
              <Select value={invite.role} onChange={(e) => setInvite((i) => ({ ...i, role: e.target.value }))}>
                {ROLES.filter((r) => r.id !== 'owner').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </Field>
            <Field label="Name" hint="Optional — otherwise we use the part before the @" className="span-2">
              <Input value={invite.name} onChange={(e) => setInvite((i) => ({ ...i, name: e.target.value }))} placeholder={invite.role === 'doctor' ? 'Dr. Priya Kamble' : 'Priya Kamble'} />
            </Field>
            <Field label="Branch" hint="The seat starts here" className="span-2">
              <Select value={invite.branchId} onChange={(e) => setInvite((i) => ({ ...i, branchId: e.target.value }))}>
                {activeBranchRows.map((b) => <option key={b.id} value={b.id}>{branchScopeLabel(activeBranchRows, b.id)}</option>)}
              </Select>
            </Field>
            {invite.role !== 'frontdesk' ? (
              <>
                <Field label="Specialty"><Input value={invite.specialty} onChange={(e) => setInvite((i) => ({ ...i, specialty: e.target.value }))} placeholder="Paediatrics" /></Field>
                <Field label="Qualification"><Input value={invite.qualification} onChange={(e) => setInvite((i) => ({ ...i, qualification: e.target.value }))} placeholder="MBBS, DCH" /></Field>
              </>
            ) : null}
          </div>
          <p className="tiny muted" style={{ marginTop: 2 }}>
            {ROLES.find((r) => r.id === invite.role)?.hint}
          </p>

          {store.mode === 'demo' ? (
            <div className="notice tiny">
              <span className="row" style={{ gap: 7, alignItems: 'flex-start' }}>
                <UserPlus size={14} style={{ flex: 'none', marginTop: 1 }} />
                <span>
                  The demo has no server to invite anyone into, so this adds the seat straight away —
                  with the clinic's hours and fees if it is a doctor. In a live clinic the seat is
                  granted the moment they sign in with this email.
                </span>
              </span>
            </div>
          ) : (
            <>
              <div className="notice tiny">
                <span className="row" style={{ gap: 7, alignItems: 'flex-start' }}>
                  <Link2 size={14} style={{ flex: 'none', marginTop: 1 }} />
                  <span>
                    The link is created with the invitation. Send it on WhatsApp or email — they sign up
                    with this address and the seat is granted by <code>accept_invite()</code> the first
                    time they open the app. A doctor starts on the clinic's default hours; set their own
                    afterwards in Doctors &amp; staff.
                  </span>
                </span>
              </div>
              {sentInvite?.token ? (
                <pre className="tiny mono" style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{inviteLink}</pre>
              ) : (
                <p className="tiny faint" style={{ margin: 0 }}>
                  The invitation is created when you press Send invite; the link appears here and in
                  Pending invitations.
                </p>
              )}
            </>
          )}
        </div>
      </Modal>

      <BranchAssignmentModal
        open={Boolean(branchMember)}
        onClose={() => setBranchMember(null)}
        member={branchMember}
        branches={branchRows}
        assignments={assignments}
        onSave={store.assignStaffBranches}
      />
    </div>
  );
}
