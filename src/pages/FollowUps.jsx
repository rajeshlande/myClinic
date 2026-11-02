import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BellRing, CalendarPlus, Check, Clock, MessageSquare, Phone, Repeat, UserX } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Avatar, Badge, Button, Card, CardHead, EmptyState, Kpi, Modal, Segmented } from '../components/ui.jsx';
import AppointmentForm from '../components/AppointmentForm.jsx';
import {
  addDays, daysBetween, followUpDue, formatDate, formatMoney, relativeDay, today,
} from '../lib/logic.mjs';

export default function FollowUps() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [window_, setWindow] = useState('7');
  const [bookFor, setBookFor] = useState(null);
  const [messageFor, setMessageFor] = useState(null);

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

  async function markDone(consultation) {
    try {
      await store.update('consultations', consultation.id, { follow_up_done: true });
      toast.success('Follow-up closed.');
    } catch (e) { toast.error(e.message ?? 'Could not update.'); }
  }

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

      <div className="row wrap" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 1, flex: 1, minWidth: 220 }}>
          <h2 style={{ fontSize: '1.05rem' }}>Recall list</h2>
          <span className="tiny muted">Follow-up dates set inside consultations. Closing one keeps the clinical record.</span>
        </div>
        <Segmented
          value={window_} onChange={setWindow}
          options={[{ value: '0', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]}
        />
      </div>

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
              Reminder text carries the doctor’s name, the clinic and the time — never the diagnosis. Copy a template and send it on your own
              WhatsApp Business number; automatic sending is a Growth-plan add-on.
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
            const text = reminderText(messageFor, store.clinic);
            navigator.clipboard?.writeText(text).then(() => toast.success('Reminder copied — paste into WhatsApp or SMS.')).catch(() => toast.error('Clipboard blocked.'));
          }}>Copy message</Button>
        </>}
      >
        {messageFor ? (
          <div className="stack">
            <pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 14, borderRadius: 12, margin: 0, fontFamily: 'var(--font)' }}>
              {reminderText(messageFor, store.clinic)}
            </pre>
            <p className="tiny faint">No diagnosis or medication is included. Personalise the time before sending.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function reminderText({ consultation, patient }, clinic) {
  const doctor = consultation?.doctor_id ? '' : '';
  return `Hello ${patient?.full_name ?? 'there'},\n\nThis is ${clinic?.name ?? 'the clinic'}. Your follow-up visit was advised on ${formatDate(consultation?.follow_up_on, { weekday: true })}.${doctor}\n\nPlease reply to this message or call ${clinic?.phone ?? 'the clinic'} to confirm a convenient time.\n\nThank you.`;
}
