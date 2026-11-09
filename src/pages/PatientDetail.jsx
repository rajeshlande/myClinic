import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeft, CalendarPlus, CreditCard, FileText, Pencil, Phone, Mail, MapPin, ShieldAlert, Stethoscope, Trash2, Activity, Pill, Printer, ChevronRight, HeartPulse, Wallet, Clock, HandCoins, Receipt,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { can } from '../lib/permissions.js';
import {
  useToast, Avatar, Badge, Button, Card, CardHead, EmptyState, Modal, Tabs, Progress,
} from '../components/ui.jsx';
import PatientForm from '../components/PatientForm.jsx';
import AppointmentForm from '../components/AppointmentForm.jsx';
import ConsultationForm from '../components/ConsultationForm.jsx';
import InvoiceForm from '../components/InvoiceForm.jsx';
import CollectPayment from '../components/CollectPayment.jsx';
import {
  ageLabel, formatDate, formatMoney, formatTime, invoiceBalance, invoiceStatus,
  patientVisits, relativeDay, today,
} from '../lib/logic.mjs';

export default function PatientDetail() {
  const { id } = useParams();
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [apptOpen, setApptOpen] = useState(false);
  const [consultOpen, setConsultOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // What this member may see of the chart. The clinical half and the money half
  // are separate roles in this product (schema 10 enforces the same split), so a
  // front-desk member gets registration, appointments and invoices — never a note.
  const role = store.role ?? 'owner';
  const canReadConsults = can(role, 'consultation:read');
  const canWriteConsults = can(role, 'consultation:write');
  const canReadInvoices = can(role, 'invoice:read');
  const canCreateInvoice = can(role, 'invoice:create');
  const canCollect = can(role, 'invoice:collect');

  const patient = store.patients.find((p) => p.id === id);
  const visits = useMemo(() => (patient ? patientVisits(store.consultations, patient.id) : []), [store.consultations, patient]);
  const appts = useMemo(() => store.appointments.filter((a) => a.patient_id === id).sort((a, b) => `${b.scheduled_on}${b.scheduled_at}`.localeCompare(`${a.scheduled_on}${a.scheduled_at}`)), [store.appointments, id]);
  const invoices = useMemo(() => store.invoices.filter((i) => i.patient_id === id).sort((a, b) => b.issued_on.localeCompare(a.issued_on)), [store.invoices, id]);
  const dues = invoices.filter((i) => i.status !== 'void').reduce((s, i) => s + invoiceBalance(i), 0);
  const lifetime = invoices.filter((i) => i.status !== 'void').reduce((s, i) => s + Number(i.total_paise || 0), 0);
  const upcoming = appts.filter((a) => a.scheduled_on >= today() && ['booked', 'checked-in'].includes(a.status)).sort((a, b) => a.scheduled_on.localeCompare(b.scheduled_on));
  // Money still owed, oldest first — the front desk collects the oldest first.
  const openInvoices = invoices.filter((i) => i.status !== 'void' && invoiceBalance(i) > 0)
    .sort((a, b) => a.issued_on.localeCompare(b.issued_on));
  // A consultation that never produced a bill is the commonest leak in a clinic.
  const invoiceForVisit = (visit) => invoices.find((i) => i.status !== 'void'
    && ((visit.appointment_id && i.appointment_id === visit.appointment_id) || i.issued_on === visit.visited_on));
  const unbilledVisits = visits.filter((v) => !invoiceForVisit(v));
  const availableTabs = ['overview', 'appointments']
    .concat(canReadConsults ? ['visits', 'prescriptions'] : [])
    .concat(canReadInvoices ? ['billing'] : []);
  const activeTab = availableTabs.includes(tab) ? tab : 'overview';

  if (!patient) {
    return (
      <div className="page">
        <Card><div className="card-body"><EmptyState icon={FileText} title="Patient not found" description="This record may have been removed, or the link is from another clinic." action={<Button variant="primary" onClick={() => navigate('/app/patients')}>All patients</Button>} /></div></Card>
      </div>
    );
  }

  const doctorOf = (docId) => store.doctors.find((d) => d.id === docId);

  async function archive() {
    try {
      await store.update('patients', patient.id, { archived: true });
      toast.success('Patient archived. Records are retained.');
      setDeleteOpen(false);
      navigate('/app/patients');
    } catch (e) { toast.error(e.message ?? 'Could not archive.'); }
  }

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => navigate('/app/patients')}>Patients</Button>
        <span className="spacer" />
        <Button size="sm" variant="ghost" icon={Printer} onClick={() => window.print()}>Print chart</Button>
        <Button size="sm" variant="subtle" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>
        {canWriteConsults ? (
          <Button size="sm" variant="primary" icon={Stethoscope} onClick={() => setConsultOpen(true)}>New consultation</Button>
        ) : null}
      </div>

      {/* Identity card */}
      <Card className="pad">
        <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
          <Avatar name={patient.full_name} size="xl" />
          <div className="stack" style={{ gap: 6, flex: 1, minWidth: 200 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <h2 style={{ fontSize: '1.35rem' }}>{patient.full_name}</h2>
              <Badge tone="brand" >{patient.code}</Badge>
              {patient.archived ? <Badge tone="neutral">Archived</Badge> : null}
            </div>
            <div className="row wrap small muted" style={{ gap: 14 }}>
              <span>{ageLabel(patient)}</span>
              {patient.blood_group ? <span className="row" style={{ gap: 4 }}><HeartPulse size={13} /> {patient.blood_group}</span> : null}
              {patient.phone ? <a className="row" href={`tel:${patient.phone.replace(/\s/g, '')}`} style={{ gap: 4, color: 'inherit' }}><Phone size={13} /> {patient.phone}</a> : null}
              {patient.email ? <a className="row" href={`mailto:${patient.email}`} style={{ gap: 4, color: 'inherit' }}><Mail size={13} /> {patient.email}</a> : null}
              {patient.city ? <span className="row" style={{ gap: 4 }}><MapPin size={13} /> {patient.city}</span> : null}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {(patient.tags ?? []).map((tag) => <span key={tag} className="tag warn">{tag}</span>)}
              {patient.allergies ? <span className="tag" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><ShieldAlert size={10} /> Allergy: {patient.allergies}</span> : null}
            </div>
            {patient.address ? <p className="tiny faint">{patient.address}</p> : null}
          </div>
          <div className="stack" style={{ gap: 8, minWidth: 190 }}>
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" variant="subtle" icon={CalendarPlus} className="block" onClick={() => setApptOpen(true)}>Book appointment</Button>
            </div>
            {canCreateInvoice ? (
              <Button size="sm" variant="subtle" icon={CreditCard} className="block" onClick={() => setInvoiceOpen(true)}>Raise invoice</Button>
            ) : null}
            {canReadInvoices
              ? (dues
                ? <Badge tone="danger"><Wallet size={11} /> {formatMoney(dues)} outstanding</Badge>
                : <Badge tone="success"><Wallet size={11} /> No dues</Badge>)
              : null}
          </div>
        </div>

        <div className="row wrap" style={{ gap: 22, marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          {[
            ...(canReadConsults ? [
              ['Total visits', visits.length],
              ['Last visit', visits[0] ? formatDate(visits[0].visited_on, { withYear: false }) : '—'],
            ] : []),
            ...(canReadInvoices ? [['Lifetime billed', formatMoney(lifetime, { compact: true })]] : []),
            ['Registered', formatDate(String(patient.created_at).slice(0, 10), { withYear: false })],
            ['Upcoming', upcoming[0] ? relativeDay(upcoming[0].scheduled_on) : 'None'],
          ].map(([label, value]) => (
            <div key={label}><span className="eyebrow">{label}</span><div className="strong mono small">{value}</div></div>
          ))}
        </div>
      </Card>

      {/* The one thing to do next with this patient: settle money, or bill a visit
          that was never invoiced. Everything else is a tab away. */}
      {canReadInvoices && (openInvoices.length || unbilledVisits.length) ? (
        <div className={`flow-strip ${openInvoices.length ? 'due' : 'unbilled'}`}>
          <span className="flow-strip-icon">{openInvoices.length ? <Wallet size={16} /> : <Receipt size={16} />}</span>
          <div className="flow-strip-text">
            {openInvoices.length ? (
              <>
                <strong>{formatMoney(dues)} outstanding</strong>
                <span className="tiny faint">
                  Oldest unpaid: {openInvoices[0].number} · {formatDate(openInvoices[0].issued_on)}
                  {openInvoices.length > 1 ? ` · ${openInvoices.length} invoices open` : ''}
                </span>
              </>
            ) : (
              <>
                <strong>{unbilledVisits.length} visit{unbilledVisits.length === 1 ? '' : 's'} not billed</strong>
                <span className="tiny faint">
                  Last consultation {formatDate(unbilledVisits[0].visited_on)} has no invoice yet
                </span>
              </>
            )}
          </div>
          <span className="spacer" />
          {openInvoices.length ? (
            <>
              <Button size="sm" variant="subtle" onClick={() => setTab('billing')}>Invoices</Button>
              {canCollect ? (
                <Button size="sm" variant="primary" icon={HandCoins} onClick={() => setPayFor(openInvoices[0])}>Collect {formatMoney(invoiceBalance(openInvoices[0]))}</Button>
              ) : null}
            </>
          ) : canCreateInvoice ? (
            <Button size="sm" variant="primary" icon={CreditCard} onClick={() => setInvoiceOpen(true)}>Raise invoice</Button>
          ) : null}
        </div>
      ) : null}

      {upcoming.length ? (
        <div className="row wrap small" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)', padding: '10px 14px', borderRadius: 12, gap: 8 }}>
          <Clock size={14} />
          Next appointment {relativeDay(upcoming[0].scheduled_on)} at {formatTime(upcoming[0].scheduled_at)} with {doctorOf(upcoming[0].doctor_id)?.full_name ?? 'the doctor'}
          <span className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => navigate('/app/appointments')}>View calendar</Button>
        </div>
      ) : null}

      <Tabs
        value={activeTab} onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          ...(canReadConsults ? [
            { value: 'visits', label: 'Visits', count: visits.length },
            { value: 'prescriptions', label: 'Prescriptions' },
          ] : []),
          ...(canReadInvoices ? [{ value: 'billing', label: 'Billing', count: invoices.length }] : []),
          { value: 'appointments', label: 'Appointments', count: appts.length },
        ]}
      />

      {activeTab === 'overview' ? (
        <div className="split">
          <Card>
            <CardHead title={canReadConsults ? 'Clinical timeline' : 'Appointments & records'} sub="Most recent first" icon={Activity} />
            <div className="card-body" style={{ paddingTop: 14 }}>
              {!canReadConsults ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Consultation notes belong to the doctors in this clinic. You can still book
                  appointments, register the patient and take payment.
                </p>
              ) : visits.length ? (
                <div className="timeline">
                  {visits.slice(0, 6).map((visit) => (
                    <div className="timeline-item" key={visit.id}>
                      <span className="timeline-dot" />
                      <div className="stack" style={{ gap: 4 }}>
                        <div className="row wrap small" style={{ gap: 8 }}>
                          <strong>{formatDate(visit.visited_on)}</strong>
                          <Badge tone="neutral">{doctorOf(visit.doctor_id)?.full_name ?? 'Doctor'}</Badge>
                          {(visit.diagnoses ?? []).map((d) => <Badge key={d} tone="info">{d}</Badge>)}
                        </div>
                        <p className="small muted">{visit.complaint}</p>
                        <div className="row wrap tiny faint" style={{ gap: 12 }}>
                          {visit.vitals?.bp_systolic ? <span>BP {visit.vitals.bp_systolic}/{visit.vitals.bp_diastolic}</span> : null}
                          {visit.vitals?.pulse_bpm ? <span>Pulse {visit.vitals.pulse_bpm}</span> : null}
                          {visit.vitals?.temperature_c ? <span>{visit.vitals.temperature_c}°F</span> : null}
                          {visit.vitals?.spo2 ? <span>SpO₂ {visit.vitals.spo2}%</span> : null}
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          <Button size="sm" variant="ghost" icon={FileText} onClick={() => navigate(`/prescription/${visit.id}`)}>Prescription</Button>
                          <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => setTab('visits')}>Details</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Stethoscope} title="No consultations yet" description="Start the first consultation — vitals, notes and prescription in one screen."
                  action={<Button size="sm" variant="primary" icon={Stethoscope} onClick={() => setConsultOpen(true)}>Start consultation</Button>} />
              )}
            </div>
          </Card>

          <div className="stack" style={{ gap: 16 }}>
            {canReadConsults ? (
            <Card>
              <CardHead title="Latest vitals" sub={visits[0] ? formatDate(visits[0].visited_on) : 'No data'} icon={HeartPulse} />
              <div className="card-body" style={{ paddingTop: 10 }}>
                {visits[0]?.vitals && Object.keys(visits[0].vitals).length ? (
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    {[
                      ['Temp', visits[0].vitals.temperature_c, '°F'],
                      ['Pulse', visits[0].vitals.pulse_bpm, 'bpm'],
                      ['BP', visits[0].vitals.bp_systolic ? `${visits[0].vitals.bp_systolic}/${visits[0].vitals.bp_diastolic}` : null, 'mmHg'],
                      ['SpO₂', visits[0].vitals.spo2, '%'],
                      ['Weight', visits[0].vitals.weight_kg, 'kg'],
                      ['Height', visits[0].vitals.height_cm, 'cm'],
                    ].filter(([, v]) => v).map(([label, value, unit]) => (
                      <div key={label} className="card pad" style={{ padding: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
                        <span className="tiny faint">{label}</span>
                        <div className="strong mono">{value}<span className="tiny faint"> {unit}</span></div>
                      </div>
                    ))}
                  </div>
                ) : <p className="small muted">Vitals are recorded during a consultation.</p>}
              </div>
            </Card>
            ) : null}

            {canReadInvoices ? (
            <Card>
              <CardHead title="Outstanding" sub="Billing summary" icon={Wallet} />
              <div className="card-body" style={{ paddingTop: 10 }}>
                <div className="row" style={{ gap: 10 }}>
                  <div>
                    <span className="eyebrow">Dues</span>
                    <div className="kpi-value mono" style={{ fontSize: '1.35rem', color: dues ? 'var(--danger)' : 'var(--success)' }}>{formatMoney(dues)}</div>
                  </div>
                  <span className="spacer" />
                  <div style={{ textAlign: 'right' }}>
                    <span className="eyebrow">Lifetime</span>
                    <div className="strong mono">{formatMoney(lifetime, { compact: true })}</div>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Progress value={lifetime ? (lifetime - dues) / lifetime : 1} />
                  <p className="tiny faint" style={{ marginTop: 6 }}>{lifetime ? Math.round(((lifetime - dues) / lifetime) * 100) : 100}% of lifetime billing collected</p>
                </div>
                {canCreateInvoice ? (
                  <Button size="sm" variant="subtle" className="block" icon={CreditCard} style={{ marginTop: 10 }} onClick={() => setInvoiceOpen(true)}>Raise an invoice</Button>
                ) : null}
              </div>
            </Card>
            ) : null}

            <Card className="pad">
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <span className="kpi-icon"><Trash2 size={14} /></span>
                <strong className="small">Record controls</strong>
              </div>
              <p className="tiny muted" style={{ marginBottom: 10 }}>Archiving hides the patient from lists but keeps every clinical and billing record.</p>
              {can(role, 'patient:archive') ? (
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDeleteOpen(true)}>Archive patient</Button>
              ) : (
                <p className="tiny faint" style={{ margin: 0 }}>Only a doctor or the owner can archive a patient.</p>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {activeTab === 'visits' ? (
        <div className="stack" style={{ gap: 12 }}>
          {visits.length ? visits.map((visit) => (
            <Card key={visit.id}>
              <CardHead title={formatDate(visit.visited_on, { weekday: true })} sub={`${doctorOf(visit.doctor_id)?.full_name ?? 'Doctor'} · ${(visit.diagnoses ?? []).join(', ') || 'no diagnosis'}`} icon={Stethoscope}
                action={(
                  <div className="row wrap no-print" style={{ gap: 6 }}>
                    <Button size="sm" variant="subtle" icon={Printer} onClick={() => navigate(`/prescription/${visit.id}`)}>Prescription</Button>
                    {invoiceForVisit(visit)
                      ? <Button size="sm" variant="ghost" icon={Receipt} onClick={() => navigate(`/invoice/${invoiceForVisit(visit).id}`)}>Invoice</Button>
                      : <Button size="sm" variant="ghost" icon={CreditCard} onClick={() => setInvoiceOpen(true)}>Bill this visit</Button>}
                  </div>
                )} />
              <div className="card-body stack" style={{ gap: 10, paddingTop: 12 }}>
                <div><span className="eyebrow">Complaint</span><p className="small">{visit.complaint}</p></div>
                {visit.examination ? <div><span className="eyebrow">Examination</span><p className="small">{visit.examination}</p></div> : null}
                {visit.advice ? <div><span className="eyebrow">Advice</span><p className="small">{visit.advice}</p></div> : null}
                {visit.prescription?.length ? (
                  <div>
                    <span className="eyebrow"><Pill size={10} /> Prescription</span>
                    <div className="stack" style={{ gap: 5, marginTop: 5 }}>
                      {visit.prescription.map((rx, i) => (
                        <div key={i} className="row small" style={{ gap: 8 }}>
                          <strong>{rx.drug}</strong>
                          <span className="muted">{rx.dose} · {rx.frequency} · {rx.duration}</span>
                          {rx.instructions ? <span className="tiny faint">({rx.instructions})</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {visit.follow_up_on ? (
                  <div className="row small" style={{ gap: 8 }}>
                    <Badge tone={visit.follow_up_done ? 'success' : 'warn'}>Follow-up {formatDate(visit.follow_up_on, { withYear: false })}</Badge>
                    {!visit.follow_up_done ? <Button size="sm" variant="ghost" onClick={async () => { await store.update('consultations', visit.id, { follow_up_done: true }); toast.success('Follow-up marked done.'); }}>Mark done</Button> : null}
                  </div>
                ) : null}
              </div>
            </Card>
          )) : <Card><div className="card-body"><EmptyState icon={Stethoscope} title="No visits recorded" /></div></Card>}
        </div>
      ) : null}

      {activeTab === 'prescriptions' ? (
        <Card>
          <CardHead title="Prescription history" sub="Every medication issued to this patient" icon={Pill} />
          <div className="card-body" style={{ paddingTop: 10 }}>
            {visits.filter((v) => v.prescription?.length).length ? visits.filter((v) => v.prescription?.length).map((visit) => (
              <div key={visit.id} className="list-item" style={{ cursor: 'default' }}>
                <span className="kpi-icon" style={{ width: 32, height: 32 }}><Pill size={14} /></span>
                <span className="li-main">
                  <span className="li-title">{visit.prescription.map((rx) => rx.drug).join(', ')}</span>
                  <span className="li-sub">{formatDate(visit.visited_on)} · {doctorOf(visit.doctor_id)?.full_name ?? 'Doctor'}</span>
                </span>
                <Button size="sm" variant="ghost" icon={Printer} onClick={() => navigate(`/prescription/${visit.id}`)}>Open</Button>
              </div>
            )) : <EmptyState icon={Pill} title="No prescriptions yet" />}
          </div>
        </Card>
      ) : null}

      {activeTab === 'billing' ? (
        <Card>
          <CardHead title="Invoices" sub={`${formatMoney(dues)} outstanding across ${invoices.filter((i) => invoiceBalance(i) > 0).length} invoice(s)`} icon={CreditCard}
            action={<Button size="sm" variant="primary" icon={CreditCard} onClick={() => setInvoiceOpen(true)}>New invoice</Button>} />
          <div className="card-body" style={{ paddingTop: 10 }}>
            {invoices.length ? invoices.map((inv) => {
              const meta = invoiceStatus(inv);
              return (
                <div key={inv.id} className="list-item" style={{ cursor: 'default' }}>
                  <button className="li-main" onClick={() => navigate(`/invoice/${inv.id}`)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <span className="li-title mono">{inv.number}</span>
                    <span className="li-sub">{formatDate(inv.issued_on)} · {(inv.lines ?? []).map((l) => l.name).join(', ') || 'charges'}</span>
                  </button>
                  <span className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
                    <span className="strong mono small">{formatMoney(inv.total_paise)}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </span>
                  <div className="row no-print" style={{ gap: 4, flex: 'none' }}>
                    {invoiceBalance(inv) > 0 && inv.status !== 'void'
                      ? <Button size="sm" variant="subtle" icon={HandCoins} onClick={() => setPayFor(inv)}>Collect</Button>
                      : null}
                    <ChevronRight size={14} className="faint" />
                  </div>
                </div>
              );
            }) : <EmptyState icon={CreditCard} title="No invoices yet" description="Raise the first invoice for this patient." action={<Button size="sm" variant="primary" onClick={() => setInvoiceOpen(true)}>Raise invoice</Button>} />}
          </div>
        </Card>
      ) : null}

      {activeTab === 'appointments' ? (
        <Card>
          <CardHead title="Appointment history" sub="Booked, completed and missed visits" icon={CalendarPlus}
            action={<Button size="sm" variant="primary" icon={CalendarPlus} onClick={() => setApptOpen(true)}>Book</Button>} />
          <div className="card-body" style={{ paddingTop: 10 }}>
            {appts.length ? appts.map((a) => (
              <div key={a.id} className="list-item" style={{ cursor: 'default' }}>
                <span className="kpi-icon" style={{ width: 32, height: 32 }}><CalendarPlus size={14} /></span>
                <span className="li-main">
                  <span className="li-title">{formatDate(a.scheduled_on, { weekday: true })} · {formatTime(a.scheduled_at)}</span>
                  <span className="li-sub">{a.kind} · {doctorOf(a.doctor_id)?.full_name ?? 'Doctor'} · {a.reason || 'no reason noted'}</span>
                </span>
                <Badge tone={a.status === 'completed' ? 'success' : a.status === 'cancelled' ? 'danger' : a.status === 'no-show' ? 'warn' : 'info'}>{a.status}</Badge>
              </div>
            )) : <EmptyState icon={CalendarPlus} title="No appointments" />}
          </div>
        </Card>
      ) : null}

      <PatientForm open={editOpen} onClose={() => setEditOpen(false)} patient={patient} />
      <AppointmentForm open={apptOpen} onClose={() => setApptOpen(false)} defaults={{ patient_id: patient.id }} />
      <ConsultationForm
        open={consultOpen}
        onClose={() => setConsultOpen(false)}
        patient={patient}
        appointment={upcoming[0] ?? null}
        onSaved={(_visit, raised) => {
          setConsultOpen(false);
          // Saving with “Save & bill” raises an invoice — walk the front desk
          // straight into it so the consultation ends with money collected.
          if (raised?.id) navigate(`/invoice/${raised.id}`);
        }}
      />
      <InvoiceForm open={invoiceOpen} onClose={() => setInvoiceOpen(false)} patient={patient} />
      <CollectPayment
        invoice={payFor}
        open={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        onDone={() => setPayFor(null)}
      />
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Archive this patient?"
        footer={<><Button variant="ghost" onClick={() => setDeleteOpen(false)}>Keep record</Button><Button variant="danger" onClick={archive}>Archive</Button></>}>
        <p className="small muted">
          {patient.full_name} will be hidden from patient lists. Their {visits.length} consultation records and {invoices.length} invoices stay intact for legal and clinical history.
        </p>
      </Modal>
    </div>
  );
}
