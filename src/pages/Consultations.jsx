import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Activity, FileText, Plus, Printer, Stethoscope, ChevronRight, Search, CalendarPlus } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { Avatar, Badge, Button, Card, CardHead, EmptyState, SearchInput, Select, Segmented } from '../components/ui.jsx';
import ConsultationForm from '../components/ConsultationForm.jsx';
import {
  appointmentsForDate, currentMonth, formatDate, formatMoney, inMonth, monthLabel, today,
} from '../lib/logic.mjs';

export default function Consultations() {
  const store = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('month');
  const [doctorId, setDoctorId] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [presetPatient, setPresetPatient] = useState(null);

  const from = range === 'today' ? today() : range === 'week' ? new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10) : `${currentMonth()}-01`;

  const rows = useMemo(() => {
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

  const awaiting = appointmentsForDate(store.appointments, today()).filter((a) => ['checked-in', 'in-consult'].includes(a.status));
  const patientOf = (id) => store.patients.find((p) => p.id === id);
  const doctorOf = (id) => store.doctors.find((d) => d.id === id);

  return (
    <div className="page stack" style={{ gap: 16 }}>
      {awaiting.length ? (
        <Card>
          <CardHead title="Waiting for notes" sub="Checked in but consultation not saved" icon={Activity}
            action={<Badge tone="warn">{awaiting.length}</Badge>} />
          <div className="card-body" style={{ paddingTop: 10 }}>
            {awaiting.map((appt) => {
              const patient = patientOf(appt.patient_id);
              return (
                <div key={appt.id} className="appt live">
                  <div className="when">{appt.scheduled_at}</div>
                  <Avatar name={patient?.full_name} size="sm" />
                  <div className="who"><b>{patient?.full_name ?? 'Patient'}</b><span className="tiny muted">{appt.kind} · {appt.reason || 'no reason noted'}</span></div>
                  <Badge tone="info">{appt.status === 'in-consult' ? 'In consult' : 'Checked in'}</Badge>
                  <Button size="sm" variant="primary" icon={Stethoscope} onClick={() => { setPresetPatient({ patient, appt }); setFormOpen(true); }}>Write notes</Button>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="row wrap" style={{ gap: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}><SearchInput value={query} onChange={setQuery} placeholder="Search by patient, complaint or diagnosis" /></div>
        <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ maxWidth: 190 }} aria-label="Doctor">
          <option value="all">All doctors</option>
          {store.doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </Select>
        <Segmented value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: '7 days' }, { value: 'month', label: 'This month' }]} />
        <Button variant="primary" icon={Plus} onClick={() => { setPresetPatient(null); setFormOpen(true); }}>New consultation</Button>
      </div>

      <Card>
        <CardHead title={`${rows.length} consultation${rows.length === 1 ? '' : 's'}`} sub={range === 'month' ? monthLabel(currentMonth()) : `${formatDate(from, { withYear: false })} → today`} icon={Stethoscope}
          action={<Badge tone="brand">{rows.filter((r) => (r.prescription ?? []).length).length} with Rx</Badge>} />
        <div className="card-body" style={{ paddingTop: 8 }}>
          {rows.length ? rows.slice(0, 60).map((visit) => {
            const patient = patientOf(visit.patient_id);
            const doctor = doctorOf(visit.doctor_id);
            return (
              <div key={visit.id} className="list-item" style={{ cursor: 'default' }}>
                <button className="li-main row" onClick={() => patient && navigate(`/app/patients/${patient.id}`)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', gap: 12, alignItems: 'center' }}>
                  <Avatar name={patient?.full_name ?? 'Patient'} size="sm" tone={doctor?.color} />
                  <span className="li-main">
                    <span className="li-title">
                      {patient?.full_name ?? 'Patient'}
                      {(visit.diagnoses ?? []).slice(0, 2).map((d) => <span key={d} className="tag">{d}</span>)}
                    </span>
                    <span className="li-sub">{formatDate(visit.visited_on)} · {doctor?.full_name ?? 'Doctor'} · {visit.complaint}</span>
                  </span>
                </button>
                <span className="stack" style={{ alignItems: 'flex-end', gap: 3, flex: 'none' }}>
                  {visit.follow_up_on ? <Badge tone={visit.follow_up_done ? 'success' : 'warn'}>F/U {formatDate(visit.follow_up_on, { withYear: false })}</Badge> : null}
                  <span className="tiny faint">{(visit.prescription ?? []).length} drugs</span>
                </span>
                <Button size="sm" variant="ghost" icon={Printer} onClick={() => navigate(`/prescription/${visit.id}`)}>Rx</Button>
              </div>
            );
          }) : (
            <EmptyState icon={Stethoscope} title="No consultations in this range" description="Start a consultation from the queue or a patient chart."
              action={<Button size="sm" variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>New consultation</Button>} />
          )}
        </div>
      </Card>

      {formOpen ? (
        <ConsultationForm
          open onClose={() => setFormOpen(false)}
          patient={presetPatient?.patient ?? store.patients[0]}
          appointment={presetPatient?.appt ?? null}
          onSaved={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}
