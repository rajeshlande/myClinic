import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Activity, Plus, Stethoscope, MoreHorizontal, Printer, FileText, Clock as ClockIcon, Clock, History, X } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { can } from '../lib/permissions.js';
import { Avatar, Badge, Button, Card, CardHead, EmptyState, SearchInput, Select, Segmented, Kpi } from '../components/ui.jsx';
import ConsultationForm from '../components/ConsultationForm.jsx';
import VisitNextSteps from '../components/VisitNextSteps.jsx';
import {
  appointmentsForDate, currentMonth, formatDate, monthLabel, today, patientVisits, followUpDue,
} from '../lib/logic.mjs';

const PAGE_SIZE = 20;

const VISIT_COUNT_LABEL = (n) => n === 1 ? '1 visit' : `${n} visits`;

export default function Consultations() {
  const store = useStore();
  // Billing belongs to the front desk and the owner; a doctor's chart has no Bill
  // button because the database would refuse the invoice behind it.
  const canBill = can(store.role ?? 'owner', 'invoice:create');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('month');
  const [doctorId, setDoctorId] = useState('all');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [presetPatient, setPresetPatient] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [savedVisit, setSavedVisit] = useState(null);

  const from = range === 'today' ? today() : range === 'week' ? new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10) : `${currentMonth()}-01`;

  const allRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.consultations
      .filter((c) => c.visited_on >= from)
      .filter((c) => doctorId === 'all' || c.doctor_id === doctorId)
      .filter((c) => {
        if (!q) return true;
        const patient = store.patients.find((p) => p.id === c.patient_id);
        return [patient?.full_name, patient?.code, c.complaint, ...(c.diagnoses ?? [])].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => `${b.visited_on}${b.created_at ?? ''}`.localeCompare(`${a.visited_on}${a.created_at ?? ''}`));
  }, [store.consultations, store.patients, from, doctorId, query]);

  const total = allRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const rows = allRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const patientOf = (id) => store.patients.find((p) => p.id === id);
  const doctorOf = (id) => store.doctors.find((d) => d.id === id);

  const awaiting = appointmentsForDate(store.appointments, today()).filter((a) => ['checked-in', 'in-consult'].includes(a.status));
  const followUps = followUpDue(store.consultations, { withinDays: 7 });
  const withRx = allRows.filter((r) => (r.prescription ?? []).length).length;

  // Never silently fall back to store.patients[0] — require an explicit patient.
  function openForm(patient, appointment) {
    setPresetPatient({ patient, appointment });
    setFormOpen(true);
  }

  function handlePrint(visit) {
    navigate(`/prescription/${visit.id}`);
  }

  async function handleInvoice(visit) {
    const patient = patientOf(visit.patient_id);
    const doctor = doctorOf(visit.doctor_id);
    if (!patient) return;
    const fee = visit.follow_up_on ? (doctor?.follow_up_fee_paise ?? 25000) : (doctor?.fee_paise ?? 50000);
    const count = store.invoices.length + 1;
    try {
      const raised = await store.create('invoices', {
        number: `INV/2526/${String(count).padStart(4, '0')}`,
        patient_id: patient.id,
        doctor_id: doctor?.id ?? null,
        appointment_id: visit.appointment_id ?? null,
        issued_on: today(),
        lines: [{ service_id: 'svc-consult', name: 'Consultation', category: 'Consultation', qty: 1, rate_paise: fee, discount: 0, tax_rate: 0, total: fee }],
        subtotal_paise: fee, discount_paise: 0, tax_paise: 0, total_paise: fee, paid_paise: 0,
        method: 'cash', status: 'unpaid', notes: `Raised from consultation ${formatDate(visit.visited_on)}`,
      });
      // Open the invoice that was just raised so the front desk can collect on it.
      if (raised?.id) navigate(`/invoice/${raised.id}`);
      else toast.error('Invoice saved, but it could not be opened.');
    } catch (e) {
      openForm(patient, null);
    }
  }

  function handleFollowUpDone(visit) {
    store.update('consultations', visit.id, { follow_up_done: true });
  }

  const rangeLabel = (r) => r === 'month' ? monthLabel(currentMonth()) : r === 'today' ? 'Today' : 'Last 7 days';

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="row wrap page-titlebar" style={{ gap: 10, alignItems: 'center' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <CardHead title="Consultations" sub="Notes, vitals and prescriptions" icon={Stethoscope}
            action={<Badge tone="brand">{total}</Badge>} />
        </div>
        <Button variant="primary" icon={Plus} onClick={() => openForm(null, null)}>New consultation</Button>
      </div>

      {awaiting.length ? (
        <Card>
          <CardHead title="Waiting for notes" sub="Checked in but consultation not saved" icon={Activity}
            action={<Badge tone="warn">{awaiting.length}</Badge>} />
          <div className="card-body waiting-queue" style={{ paddingTop: 10 }}>
            {awaiting.map((appt) => {
              const patient = patientOf(appt.patient_id);
              const visits = patient ? patientVisits(store.consultations, patient.id).length : 0;
              const ongoing = appt.status === 'in-consult';
              return (
                <div key={appt.id} className="appt live row wrap" style={{ gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="when">{appt.scheduled_at}</div>
                  <Avatar name={patient?.full_name} size="sm" />
                  <div className="who" style={{ minWidth: 0, flex: 1 }}>
                    <b>{patient?.full_name ?? 'Patient'}</b>
                    <span className="tiny muted">{appt.kind} · {appt.reason || 'no reason noted'} · {VISIT_COUNT_LABEL(visits)}</span>
                  </div>
                  <Badge tone={ongoing ? 'brand' : 'info'}>
                    {ongoing ? 'Resume consult' : appt.status === 'in-consult' ? 'In consult' : 'Checked in'}
                  </Badge>
                  <Button size="sm" variant={ongoing ? 'primary' : 'primary'} icon={Stethoscope} onClick={() => openForm(patient, appt)} type="button">
                    {ongoing ? 'Resume' : 'Write notes'}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="row wrap cons-filters" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}><SearchInput value={query} onChange={setQuery} placeholder="Search by patient, complaint or diagnosis" /></div>
        <Select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setPage(1); }} style={{ maxWidth: 190 }} aria-label="Doctor">
          <option value="all">All doctors</option>
          {store.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </Select>
        <Segmented value={range} onChange={(v) => { setRange(v); setPage(1); }} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: '7 days' }, { value: 'month', label: 'This month' }]} />
        {followUps.length ? (
          <Button size="sm" variant="subtle" icon={Clock} onClick={() => { setRange('month'); setDoctorId('all'); setQuery(''); setPage(1); }} type="button">{followUps.length} follow-ups due</Button>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div className="cons-kpis">
          <Kpi label="Consultations" value={String(total)} icon={Stethoscope} />
          <Kpi label="With prescription" value={String(withRx)} icon={FileText} accent />
          <Kpi label="Follow-ups due (7d)" value={String(followUps.length)} icon={ClockIcon} tone="warn" />
        </div>
        <div className="row wrap" style={{ gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
          <span>Page {safePage} of {totalPages}</span>
          <Button size="sm" variant="ghost" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} type="button">‹</Button>
          <Button size="sm" variant="ghost" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} type="button">›</Button>
        </div>
      </div>

      <Card>
        <CardHead title={`${total} consultation${total === 1 ? '' : 's'}`} sub={rangeLabel(range)} icon={Stethoscope} />
        <div className="card-body" style={{ paddingTop: 8 }}>
          {rows.length ? (
            <div className="consult-list" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
              {rows.map((visit) => {
                const patient = patientOf(visit.patient_id);
                const doctor = doctorOf(visit.doctor_id);
                const visits = patient ? patientVisits(store.consultations, patient.id).length : 0;
                return (
                  <div key={visit.id} className="list-item row wrap" style={{ gap: 10, alignItems: 'center', padding: '10px', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer' }}
                    onClick={() => patient && navigate(`/app/patients/${patient.id}`)}>
                    <Avatar name={patient?.full_name ?? 'Patient'} size="sm" tone={doctor?.color} />
                    <div className="who" style={{ minWidth: 0, flex: 1 }}>
                      <div className="li-title row wrap" style={{ gap: 6, alignItems: 'baseline' }}>
                        <span className="li-title-text">{patient?.full_name ?? 'Patient'}</span>
                        {(visit.diagnoses ?? []).slice(0, 2).map((d) => <span key={d} className="tag">{d}</span>)}
                        <Badge tone="neutral" size="sm">{VISIT_COUNT_LABEL(visits)}</Badge>
                      </div>
                      <span className="li-sub">{formatDate(visit.visited_on)} · {doctor?.full_name ?? 'Doctor'} · {visit.complaint}</span>
                    </div>
                    <div className="actions">
                      <Button size="sm" variant="ghost" icon={Printer} onClick={(e) => { e.stopPropagation(); handlePrint(visit); }} type="button" title="Print prescription">Rx</Button>
                      {canBill ? (
                        <Button size="sm" variant="subtle" onClick={(e) => { e.stopPropagation(); handleInvoice(visit); }} type="button">Bill</Button>
                      ) : null}
                      {visit.follow_up_on && !visit.follow_up_done ? (
                        <Button size="sm" variant="subtle" onClick={(e) => { e.stopPropagation(); handleFollowUpDone(visit); }} type="button">F/U done</Button>
                      ) : null}
                      <MoreHorizontal size={16} style={{ color: 'var(--muted)', cursor: 'default' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={Stethoscope} title="No consultations in this range" description="Start a consultation from the queue or a patient chart."
              action={<Button size="sm" variant="primary" icon={Plus} onClick={() => openForm(null, null)}>New consultation</Button>} />
          )}
        </div>
      </Card>

      {formOpen ? (
        <ConsultationForm
          open onClose={() => setFormOpen(false)}
          patient={presetPatient?.patient ?? null}
          appointment={presetPatient?.appt ?? null}
          onSaved={(saved, raised) => {
            setFormOpen(false);
            // One ending everywhere: the sheet offers the slip, the money and the
            // return date, instead of jumping to the invoice and hiding the slip.
            setSavedVisit({ visit: saved, invoice: raised ?? null, tokenNo: presetPatient?.appt?.token_no ?? null });
          }}
        />
      ) : null}

      <VisitNextSteps
        open={Boolean(savedVisit)}
        onClose={() => setSavedVisit(null)}
        visit={savedVisit?.visit ?? null}
        invoice={savedVisit?.invoice ?? null}
        tokenNo={savedVisit?.tokenNo ?? null}
      />

      {/* Patient-history preview drawer */}
      {historyFor ? (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setHistoryFor(null); }}>
          <div className="modal wide" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div className="spacer">
                <h2>Patient history</h2>
                <div className="sub">{historyFor.full_name} · {historyFor.code}</div>
              </div>
              <IconButtonClose onClick={() => setHistoryFor(null)} />
            </div>
            <div className="modal-body" style={{ padding: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                {patientVisits(store.consultations, historyFor.id).map((v) => {
                  const doctor = doctorOf(v.doctor_id);
                  return (
                    <div key={v.id} className="row wrap" style={{ gap: 10, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ minWidth: 70 }}><span className="tiny faint">{formatDate(v.visited_on)}</span></div>
                      <div className="who" style={{ minWidth: 0, flex: 1 }}>
                        <span className="li-title">{v.complaint}</span>
                        <span className="li-sub">{doctor?.full_name ?? 'Doctor'} · {(v.diagnoses ?? []).join(', ') || 'no diagnosis recorded'}</span>
                      </div>
                      <div className="stack" style={{ alignItems: 'flex-end', gap: 3, flex: 'none' }}>
                        <Badge tone={v.follow_up_done ? 'success' : v.follow_up_on ? 'warn' : 'neutral'} size="sm">{v.follow_up_done ? 'F/U done' : v.follow_up_on ? `F/U ${formatDate(v.follow_up_on, { withYear: false })}` : '—'}</Badge>
                        <span className="tiny faint">{(v.prescription ?? []).length} drugs</span>
                      </div>
                    </div>
                  );
                })}
                {patientVisits(store.consultations, historyFor.id).length === 0 && (
                  <div style={{ padding: '26px', textAlign: 'center', color: 'var(--muted)' }}>
                    <History size={20} style={{ marginBottom: 8, opacity: 0.5 }} />
                    <div>No consultation history yet.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconButtonClose({ onClick }) {
  return (
    <button className="icon-btn plain sm" aria-label="Close" onClick={onClick}>
      <X size={16} />
    </button>
  );
}
