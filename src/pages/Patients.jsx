import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Archive, ArrowUpDown, CalendarPlus, Download, Phone, Plus, Users, UserRound,
  ChevronRight, ShieldAlert, Wallet, Filter, MoreHorizontal,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Avatar, Badge, Button, Card, CardHead, EmptyState, IconButton, SearchInput, Select, Tabs, Segmented } from '../components/ui.jsx';
import PatientForm from '../components/PatientForm.jsx';
import AppointmentForm from '../components/AppointmentForm.jsx';
import {
  ageLabel, appointmentVisitsSince, downloadFile, formatDate, formatMoney, lastAppointmentVisit,
  lastVisit, outstandingByPatient, patientSearch, patientVisits, toCSV, today, visitFrequency,
} from '../lib/logic.mjs';
import { can } from '../lib/permissions.js';

export default function Patients() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The register grows; a phone should not have to render all of it.
  const pageSize = () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches ? 12 : 200);
  const [shown, setShown] = useState(pageSize);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [filter, setFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState(null);
  const [apptFor, setApptFor] = useState(null);

  // React Router reuses the component between ?new=1 navigations, so key the
  // effect on the parameter rather than running once on mount.
  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  // The register is the front desk's screen, and the front desk may not read
  // consultation rows (schema 10) — so "last visit"/"visits" fall back to
  // completed appointments rather than silently reading "never seen".
  const canReadConsults = can(store.role ?? 'owner', 'consultation:read');
  const lastSeen = useCallback((patientId) => (canReadConsults
    ? lastVisit(store.consultations, patientId)
    : lastAppointmentVisit(store.appointments, patientId)), [canReadConsults, store.consultations, store.appointments]);
  const visitCount = useCallback((patientId) => (canReadConsults
    ? visitFrequency(store.consultations, patientId)
    : appointmentVisitsSince(store.appointments, patientId)), [canReadConsults, store.consultations, store.appointments]);

  const dues = useMemo(() => outstandingByPatient(store.invoices), [store.invoices]);
  const searchFn = useMemo(() => patientSearch(store.patients, query), [store.patients, query]);
  const rows = useMemo(() => {
    let list = searchFn;
    if (filter === 'dues') list = list.filter((p) => (dues.get(p.id) ?? 0) > 0);
    if (filter === 'chronic') list = list.filter((p) => (p.tags ?? []).length > 0);
    if (filter === 'new') list = list.filter((p) => String(p.created_at).slice(0, 10) >= today().slice(0, 8) + '01');
    if (filter === 'inactive') list = list.filter((p) => {
      const lv = lastSeen(p.id);
      return !lv || lv.visited_on < today().slice(0, 8) + '01';
    });
    const withVisit = list.map((p) => ({ ...p, _last: lastSeen(p.id), _visits: visitCount(p.id) }));
    return withVisit.sort((a, b) => {
      if (sort === 'name') return a.full_name.localeCompare(b.full_name);
      if (sort === 'newest') return String(b.created_at).localeCompare(String(a.created_at));
      if (sort === 'visits') return b._visits - a._visits;
      return String(b._last?.visited_on ?? '').localeCompare(String(a._last?.visited_on ?? ''));
    });
  }, [searchFn, filter, sort, dues, store.consultations, store.appointments, lastSeen, visitCount]);

  const exportCsv = () => {
    const csv = toCSV(rows, [
      { label: 'Patient ID', key: 'code' },
      { label: 'Name', key: 'full_name' },
      { label: 'Phone', key: 'phone' },
      { label: 'Gender', key: 'gender' },
      { label: 'Age', value: (p) => ageLabel(p) },
      { label: 'Blood group', key: 'blood_group' },
      { label: 'City', key: 'city' },
      { label: 'Tags', value: (p) => (p.tags ?? []).join('; ') },
      { label: 'Last visit', value: (p) => p._last?.visited_on ?? '' },
      { label: 'Visits (12 mo)', value: (p) => p._visits },
      { label: 'Outstanding', value: (p) => ((dues.get(p.id) ?? 0) / 100).toFixed(2) },
    ]);
    downloadFile(`myclinic-patients-${today()}.csv`, csv);
    toast.success(`${rows.length} patients exported.`);
  };

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2>Patient records</h2>
          <div className="sub">{store.patients.length} registered · searchable by name, phone or patient ID</div>
        </div>
        <Button variant="subtle" icon={Download} onClick={exportCsv}>Export</Button>
        <Button variant="primary" icon={Plus} onClick={() => { setEditing(null); setFormOpen(true); }}>Register patient</Button>
      </div>
      <div className="row wrap page-titlebar" style={{ gap: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}><SearchInput value={query} onChange={setQuery} placeholder="Search name, phone, patient ID or condition" /></div>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} style={{ maxWidth: 190 }} aria-label="Sort">
          <option value="recent">Recent visit first</option>
          <option value="name">Name A–Z</option>
          <option value="newest">Newest registrations</option>
          <option value="visits">Most visits</option>
        </Select>
      </div>

      <Tabs
        value={filter} onChange={setFilter}
        tabs={[
          { value: 'all', label: 'All', count: store.patients.length },
          { value: 'new', label: 'New this month' },
          { value: 'chronic', label: 'Chronic flags' },
          { value: 'dues', label: 'Has dues' },
          { value: 'inactive', label: 'Not seen recently' },
        ]}
      />

      <div className="grid two" style={{ gap: 16 }}>
        <Card style={{ gridColumn: '1 / -1' }}>
          <CardHead title={`${rows.length} patient${rows.length === 1 ? '' : 's'}`} sub={`${store.patients.length} registered in this clinic`} icon={Users}
            action={<Badge tone="neutral">{store.patients.filter((p) => (dues.get(p.id) ?? 0) > 0).length} with dues</Badge>} />
          <div className="card-body" style={{ paddingTop: 6 }}>
            {rows.length ? rows.slice(0, shown).map((patient) => {
              const due = dues.get(patient.id) ?? 0;
              return (
                <div key={patient.id} className="list-item patient-row" style={{ cursor: 'default' }}>
                  <button onClick={() => navigate(`/app/patients/${patient.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <Avatar name={patient.full_name} />
                    <span className="li-main">
                      <span className="li-title">
                        {patient.full_name}
                        {(patient.tags ?? []).slice(0, 2).map((tag) => <span key={tag} className="tag warn">{tag}</span>)}
                        {patient.allergies ? <span className="tag" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><ShieldAlert size={9} /> Allergy</span> : null}
                      </span>
                      <span className="li-sub">
                        <span className="mono">{patient.code}</span>
                        <span className="sep" aria-hidden="true">·</span>
                        <span>{ageLabel(patient)}</span>
                        <span className="sep" aria-hidden="true">·</span>
                        <span>{patient.phone || 'no phone'}</span>
                        {patient._last ? <><span className="sep" aria-hidden="true">·</span><span>last seen {formatDate(patient._last.visited_on, { withYear: false })}</span></> : <><span className="sep" aria-hidden="true">·</span><span className="faint">never visited</span></>}
                      </span>
                    </span>
                    <span className="stack" style={{ alignItems: 'flex-end', gap: 3, flex: 'none' }}>
                      {due ? <Badge tone="danger"><Wallet size={10} /> {formatMoney(due)}</Badge> : <span className="tiny faint">{patient._visits} visits</span>}
                    </span>
                  </button>
                  <div className="patient-actions no-print">
                    <Button size="sm" variant="ghost" icon={CalendarPlus} onClick={() => setApptFor({ patient_id: patient.id })}>Book</Button>
                    <button className="icon-btn plain sm" aria-label="Open chart" onClick={() => navigate(`/app/patients/${patient.id}`)}><ChevronRight size={15} /></button>
                    <IconButton icon={MoreHorizontal} label="More actions" size={16} className="plain sm" style={{ color: 'var(--muted)' }} />
                  </div>
                </div>
              );
            }) : (
              <EmptyState icon={UserRound} title="No patients match" description="Try a different search or filter — or register the patient now."
                action={<Button size="sm" variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>Register patient</Button>} />
            )}
            {rows.length > shown ? (
              <div className="list-more">
                <Button variant="subtle" onClick={() => setShown((n) => n + pageSize())}>Show {Math.min(pageSize(), rows.length - shown)} more</Button>
                <span className="tiny faint">{rows.length - shown} left of {rows.length}</span>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <PatientForm open={formOpen} onClose={() => setFormOpen(false)} patient={editing} onCreated={(p) => { if (!editing) navigate(`/app/patients/${p.id}`); }} />
      <AppointmentForm open={Boolean(apptFor)} onClose={() => setApptFor(null)} defaults={apptFor ?? {}} />
    </div>
  );
}
