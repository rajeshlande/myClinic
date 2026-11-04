import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BellRing, CalendarPlus, Check, Clock, Copy, MessageSquare, Phone, Repeat, Send,
  UserX, X,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import {
  useToast, Avatar, Badge, Button, Card, CardHead, EmptyState, IconButton, Kpi, Modal, Segmented,
} from '../components/ui.jsx';
import AppointmentForm from '../components/AppointmentForm.jsx';
import {
  addDays, daysBetween, followUpDue, formatDate, relativeDay, today,
} from '../lib/logic.mjs';
import {
  reminderDrafts, reminderKind, reminderLog, reminderText, whatsappLink,
} from '../lib/daybook.mjs';

export default function FollowUps() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [window_, setWindow] = useState('7');
  const [bookFor, setBookFor] = useState(null);
  const [messageFor, setMessageFor] = useState(null);
  const [draftsShown, setDraftsShown] = useState(6);

  const t = today();
  const due = useMemo(() => followUpDue(store.consultations, { withinDays: Number(window_) }), [store.consultations, window_]);
  const overdue = due.filter((c) => c.follow_up_on < t);
  const todayDue = due.filter((c) => c.follow_up_on === t);
  const upcoming = due.filter((c) => c.follow_up_on > t);

  const lapsed = useMemo(() => {
    const cutoff = addDays(t, -60);
    const lastByPatient = new Map();
    for (const c of store.consultations) {
      if (!lastByPatient.has(c.patient_id) || c.visited_on > lastByPatient.get(c.patient_id).visited_on) lastByPatient.set(c.patient_id, c);
    }
    return [...lastByPatient.values()].filter((c) => c.visited_on < cutoff).slice(0, 8);
  }, [store.consultations, t]);

  const patientOf = (id) => store.patients.find((p) => p.id === id);
  const doctorOf = (id) => store.doctors.find((d) => d.id === id);

  /* ------------------------------------------------------------- reminder queue */
  // The queue is derived, not typed: tomorrow's appointments inside the lead
  // window, recalls that are due, and money that has been owed for a week. The
  // send log is the memory — anything logged inside its window drops out by itself.
  const log = store.reminders ?? [];
  const queue = useMemo(() => reminderDrafts({
    appointments: store.appointments,
    consultations: store.consultations,
    invoices: store.invoices,
    patients: store.patients,
    doctors: store.doctors,
    clinic: store.clinic,
    log,
    now: new Date(),
    leadHours: store.profile?.reminder_lead_hours ?? 24,
    quiet: store.profile?.quiet_hours ?? '21:00-08:00',
  }), [store.appointments, store.consultations, store.invoices, store.patients, store.doctors, store.clinic, store.profile, log]);

  const loggedToday = useMemo(
    () => reminderLog({ log, patients: store.patients, iso: t }),
    [log, store.patients, t],
  );

  async function logReminder(draft, { status, channel }) {
    try {
      await store.create('reminders', {
        patient_id: draft.patient_id,
        draft_key: draft.key,
        kind: draft.kind,
        ref_id: draft.ref_id,
        channel,
        status,
        body: String(draft.text ?? '').slice(0, 1200),
        logged_on: t,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
        sent_by: store.currentStaff?.id ?? null,
      });
      return true;
    } catch (e) {
      toast.error(e.message ?? 'Could not write to the reminder log.');
      return false;
    }
  }

  async function copyDraft(draft) {
    try {
      await navigator.clipboard.writeText(draft.text);
    } catch {
      toast.error('Clipboard blocked — open WhatsApp instead.');
      return;
    }
    if (await logReminder(draft, { status: 'copied', channel: 'copy' })) {
      toast.success(`Message copied for ${draft.patient_name}.`);
    }
  }

  async function openWhatsApp(draft) {
    const link = whatsappLink(draft.phone, draft.text);
    if (!link) { toast.error('That number is not usable in WhatsApp.'); return; }
    const win = window.open(link, '_blank', 'noopener');
    if (!win) {
      // Installed PWAs and pop-up blockers refuse the hand-off; the message is
      // still the thing the desk needs, so put it on the clipboard instead.
      try { await navigator.clipboard.writeText(draft.text); } catch { /* nothing else to try */ }
      if (await logReminder(draft, { status: 'copied', channel: 'copy' })) {
        toast.info(`WhatsApp was blocked — the message for ${draft.patient_name} is copied instead.`);
      }
      return;
    }
    if (await logReminder(draft, { status: 'opened', channel: 'whatsapp' })) {
      toast.success(`WhatsApp opened for ${draft.patient_name} — mark it sent once you hit send.`);
    }
  }

  async function markSent(draft) {
    if (await logReminder(draft, { status: 'sent', channel: 'whatsapp' })) {
      toast.success(`Reminder to ${draft.patient_name} logged as sent.`);
    }
  }

  async function skipDraft(draft) {
    if (await logReminder(draft, { status: 'skipped', channel: 'copy' })) {
      toast.info(`${draft.patient_name} skipped — it will not come back today.`);
    }
  }

  async function markDone(consultation) {
    try {
      await store.update('consultations', consultation.id, { follow_up_done: true });
      toast.success('Follow-up closed.');
    } catch (e) { toast.error(e.message ?? 'Could not update.'); }
  }

  const messageText = messageFor ? reminderText({
    kind: 'follow-up',
    patient: messageFor.patient,
    clinic: store.clinic,
    doctor: doctorOf(messageFor.consultation?.doctor_id),
    when: formatDate(messageFor.consultation?.follow_up_on, { weekday: true }),
  }) : '';

  const Row = ({ consultation, tone }) => {
    const patient = patientOf(consultation.patient_id);
    const days = daysBetween(t, consultation.follow_up_on);
    return (
      <div className="list-item" style={{ cursor: 'default' }}>
        <Avatar name={patient?.full_name ?? 'Patient'} size="sm" tone={doctorOf(consultation.doctor_id)?.color} />
        <button className="li-main" onClick={() => patient && navigate(`/app/patients/${patient.id}`)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          <span className="li-title">{patient?.full_name ?? 'Patient'}</span>
          <span className="li-sub">
            {(consultation.diagnoses ?? [])[0] ?? 'follow-up'} · {doctorOf(consultation.doctor_id)?.full_name ?? 'Doctor'}
          </span>
        </button>
        <Badge tone={tone}>{days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `in ${days}d`}</Badge>
        <div className="row-actions no-print">
          {patient?.phone ? <a className="icon-btn plain sm" aria-label="Call patient" href={`tel:${patient.phone.replace(/\s/g, '')}`}><Phone size={14} /></a> : null}
          <Button size="sm" variant="ghost" icon={MessageSquare} onClick={() => setMessageFor({ consultation, patient })}>Remind</Button>
          <Button size="sm" variant="subtle" icon={CalendarPlus} onClick={() => setBookFor({ patient_id: consultation.patient_id })}>Book</Button>
          <Button size="sm" variant="ghost" icon={Check} onClick={() => markDone(consultation)}>Done</Button>
        </div>
      </div>
    );
  };

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="grid kpis kpi-compactable">
        <Kpi label="Overdue" value={overdue.length} icon={UserX} meta="follow-ups not closed" />
        <Kpi label="Due today" value={todayDue.length} icon={Clock} meta={formatDate(t)} accent />
        <Kpi label="Next 7 days" value={upcoming.length} icon={BellRing} meta="recalls scheduled" />
        <Kpi label="Gone quiet" value={lapsed.length} icon={Repeat} meta="no visit in 60 days" />
      </div>

      <div className="row wrap page-titlebar" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 1, flex: 1, minWidth: 220 }}>
          <h2 style={{ fontSize: '1.05rem' }}>Recall list</h2>
          <span className="tiny muted">Follow-up dates set inside consultations. Closing one keeps the clinical record.</span>
        </div>
        <Segmented
          value={window_} onChange={setWindow}
          options={[{ value: '0', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]}
        />
      </div>

      {store.mode === 'live' && store.schemaReady === false ? (
        <div className="notice warn">
          <strong className="small">The reminder log needs schema 7</strong>
          <span className="tiny">Run <code>supabase/schema.sql</code> in Supabase to record what was sent. The queue below still drafts messages meanwhile.</span>
        </div>
      ) : null}

      <Card>
        <CardHead
          title="Reminder queue" icon={Send}
          sub="Tomorrow's appointments, recalls that are due, and balances older than a week — one message each"
          action={queue.total
            ? <Badge tone="info">{queue.total} to send</Badge>
            : <Badge tone="success">All clear</Badge>}
        />
        <div className="card-body stack" style={{ gap: 10, paddingTop: 10 }}>
          {queue.total ? (
            <div className="row wrap" style={{ gap: 6 }}>
              {queue.counts.appointment ? <Badge tone="info">{queue.counts.appointment} booked</Badge> : null}
              {queue.counts['follow-up'] ? <Badge tone="warn">{queue.counts['follow-up']} recall</Badge> : null}
              {queue.counts.balance ? <Badge tone="danger">{queue.counts.balance} balance</Badge> : null}
              {queue.held ? <Badge tone="neutral">held for morning</Badge> : null}
            </div>
          ) : null}

          {queue.held ? (
            <div className="notice warn">
              <strong className="small">Inside your quiet hours ({queue.quietHours})</strong>
              <span className="tiny">Nothing is sent automatically here — but these are drafted to go out first thing in the morning.</span>
            </div>
          ) : null}

          {queue.drafts.length ? (
            <>
              <div className="reminder-list">
                {queue.drafts.slice(0, draftsShown).map((draft) => {
                  const kind = reminderKind(draft.kind);
                  return (
                    <div key={draft.key} className="list-item reminder-row" style={{ cursor: 'default' }}>
                      <Avatar name={draft.patient_name} size="sm" />
                      <div className="li-main">
                        <span className="li-title">{draft.patient_name}</span>
                        <span className="li-sub">{draft.title}{draft.sub ? ` · ${draft.sub}` : ''}</span>
                      </div>
                      <Badge tone={kind.tone}>{kind.label}</Badge>
                      <div className="row-actions no-print">
                        <Button size="sm" variant="ghost" icon={Copy} onClick={() => copyDraft(draft)}>Copy</Button>
                        <Button size="sm" variant="subtle" icon={MessageSquare} onClick={() => openWhatsApp(draft)}>WhatsApp</Button>
                        <Button size="sm" variant="ghost" icon={Check} onClick={() => markSent(draft)}>Sent</Button>
                        <IconButton icon={X} label={`Skip ${draft.patient_name}`} className="plain sm" onClick={() => skipDraft(draft)} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {queue.total > draftsShown ? (
                <button className="btn ghost block list-more" onClick={() => setDraftsShown((n) => n + 6)}>
                  Show {Math.min(6, queue.total - draftsShown)} more
                </button>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={Check} title="Nothing to chase right now"
              description="Booked appointments inside the reminder lead time, recalls that are due, and bills older than a week all appear here."
            />
          )}

          {queue.noPhone.length ? (
            <p className="tiny muted" style={{ margin: 0 }}>
              {queue.noPhone.length} patient{queue.noPhone.length === 1 ? '' : 's'} with something to chase
              {' '}({queue.noPhone.slice(0, 3).map((d) => d.patient_name).join(', ')}{queue.noPhone.length > 3 ? '…' : ''})
              {' '}have no mobile number on file — add one in their chart and the message drafts itself.
            </p>
          ) : null}

          {loggedToday.length ? (
            <details className="reminder-log">
              <summary className="tiny muted">{loggedToday.length} logged today</summary>
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                {loggedToday.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="row small" style={{ gap: 8, justifyContent: 'space-between' }}>
                    <span className="truncate">{entry.patient_name} · {entry.kind_label}</span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="tiny faint">{entry.channel_label}</span>
                      <Badge tone={entry.status_tone}>{entry.status_label}</Badge>
                    </span>
                  </div>
                ))}
              </div>
              <p className="tiny faint" style={{ margin: '8px 0 0' }}>
                A record of what this device did — copied, opened, marked sent or skipped. Nothing is sent automatically.
              </p>
            </details>
          ) : null}
        </div>
      </Card>

      <div className="split">
        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Overdue" sub="Reach out first — these patients were expected back" icon={UserX} action={<Badge tone="danger">{overdue.length}</Badge>} />
            <div className="card-body" style={{ paddingTop: 8 }}>
              {overdue.length ? overdue.map((c) => <Row key={c.id} consultation={c} tone="danger" />) : <EmptyState icon={Check} title="Nothing overdue" description="Every recall in this window has been seen or closed." />}
            </div>
          </Card>
          <Card>
            <CardHead title="Due soon" sub={`Today and the next ${window_} days`} icon={BellRing} action={<Badge tone="warn">{todayDue.length + upcoming.length}</Badge>} />
            <div className="card-body" style={{ paddingTop: 8 }}>
              {todayDue.length + upcoming.length ? [...todayDue, ...upcoming].map((c) => <Row key={c.id} consultation={c} tone={c.follow_up_on === t ? 'warn' : 'info'} />) : <EmptyState icon={BellRing} title="No recalls in this window" description="Set a follow-up date during the next consultation and it will appear here." />}
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Gone quiet" sub="No visit in 60 days" icon={Repeat} />
            <div className="card-body" style={{ paddingTop: 8 }}>
              {lapsed.length ? lapsed.map((c) => {
                const patient = patientOf(c.patient_id);
                return (
                  <div key={c.id} className="list-item" style={{ cursor: 'default' }}>
                    <Avatar name={patient?.full_name ?? 'Patient'} size="sm" />
                    <button className="li-main" onClick={() => patient && navigate(`/app/patients/${patient.id}`)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                      <span className="li-title">{patient?.full_name ?? 'Patient'}</span>
                      <span className="li-sub">last seen {formatDate(c.visited_on, { withYear: false })} · {c.diagnoses?.[0] ?? 'visit'}</span>
                    </button>
                    <Button size="sm" variant="ghost" icon={CalendarPlus} onClick={() => setBookFor({ patient_id: c.patient_id })}>Book</Button>
                  </div>
                );
              }) : <p className="small muted">Every patient has visited in the last two months.</p>}
            </div>
          </Card>

          <Card className="pad" style={{ background: 'linear-gradient(160deg, var(--brand-50), var(--surface) 70%)' }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="kpi-icon"><MessageSquare size={15} /></span>
              <strong className="small">Reminder etiquette</strong>
            </div>
            <p className="tiny muted">
              Reminder text carries the doctor’s name, the clinic and the time — never the diagnosis. Copy a template
              or open WhatsApp, then log what you did; automatic sending is a Growth-plan add-on.
            </p>
          </Card>
        </div>
      </div>

      <AppointmentForm open={Boolean(bookFor)} onClose={() => setBookFor(null)} defaults={bookFor ?? {}} />

      <Modal
        open={Boolean(messageFor)} onClose={() => setMessageFor(null)}
        title="Reminder message" sub={messageFor ? `${messageFor.patient?.full_name} · ${messageFor.patient?.phone || 'no phone on file'}` : ''}
        footer={<>
          <Button variant="ghost" onClick={() => setMessageFor(null)}>Close</Button>
          <Button variant="primary" icon={MessageSquare} onClick={() => {
            navigator.clipboard?.writeText(messageText).then(() => toast.success('Reminder copied — paste it into WhatsApp or SMS.')).catch(() => toast.error('Clipboard blocked.'));
          }}>Copy message</Button>
        </>}
      >
        {messageFor ? (
          <div className="stack">
            <pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 14, borderRadius: 12, margin: 0, fontFamily: 'var(--font)' }}>
              {messageText}
            </pre>
            <p className="tiny faint">No diagnosis or medication is included. Personalise the time before sending.</p>
          </div>
        ) : null}
      </Modal>

      <p className="tiny faint" style={{ margin: 0 }}>
        {relativeDay(t) === 'Today' ? 'Today' : formatDate(t)} · {queue.total + queue.noPhone.length} reminders waiting
      </p>
    </div>
  );
}
