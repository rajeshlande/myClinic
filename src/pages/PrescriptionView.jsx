import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Printer, Stethoscope, ShieldAlert, Languages, Pill, CalendarClock, Copy, Check, FileText } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Badge, Button, Card, EmptyState, Segmented } from '../components/ui.jsx';
import { ageLabel, formatDate } from '../lib/logic.mjs';
import { RX_LANGUAGES, patientInstruction, rxSheet, fontStackFor, durationParts } from '../lib/rx-language.js';
import { DocumentHeader } from '../components/Branding.jsx';
import { logoOnDocuments } from '../lib/branding.mjs';

export default function PrescriptionView() {
  const { id } = useParams();
  const store = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const visit = store.consultations.find((c) => c.id === id);
  const [lang, setLang] = useState(visit?.rx_language ?? 'en');
  const [copied, setCopied] = useState(false);

  // A print sheet is the whole screen: hide the install prompt and sync bar so
  // they never sit on top of a patient's prescription.
  useEffect(() => {
    document.body.dataset.printview = 'true';
    return () => { delete document.body.dataset.printview; };
  }, []);

  const patient = store.patients.find((p) => p.id === visit?.patient_id);
  const doctor = store.doctors.find((d) => d.id === visit?.doctor_id) ?? store.currentStaff;
  const clinic = store.clinic ?? {};
  const appointment = store.appointments.find((a) => a.id === visit?.appointment_id);

  const sheet = useMemo(
    () => rxSheet(visit ?? { prescription: [] }, { lang, patient, doctor, clinic }),
    [visit, lang, patient, doctor, clinic],
  );

  if (!visit) {
    return <div className="page"><Card><div className="card-body"><EmptyState icon={Stethoscope} title="Prescription not found" action={<Button variant="primary" onClick={() => navigate('/app/consultations')}>Back</Button>} /></div></Card></div>;
  }

  const v = visit.vitals ?? {};
  const d = sheet.headings;
  const localised = lang !== 'en';

  /** Plain-text version for WhatsApp / SMS to the patient. */
  const shareText = () => {
    const lines = [
      `${clinic.name ?? 'Clinic'} — ${sheet.languageLabel}`,
      `${d.patient}: ${patient?.full_name ?? ''} (${patient?.code ?? ''})`,
      `${formatDate(visit.visited_on)} · ${doctor?.full_name ?? ''}`,
      '',
      `${d.medicines}:`,
      ...(visit.prescription ?? []).map((rx, i) => `${i + 1}. ${rx.drug} — ${patientInstruction(rx, lang)}`),
      '',
      visit.advice ? `${d.advice}: ${visit.advice}` : '',
      visit.follow_up_on ? `${d.followup}: ${formatDate(visit.follow_up_on)}` : '',
      '',
      sheet.footer,
    ].filter(Boolean);
    const text = lines.join('\n');
    navigator.clipboard?.writeText(text)
      .then(() => { setCopied(true); toast.success('Prescription copied — paste it into WhatsApp.'); setTimeout(() => setCopied(false), 2500); })
      .catch(() => toast.error('Could not copy on this device.'));
  };

  return (
    <div style={{ minHeight: '100dvh', padding: 'clamp(12px, 3vw, 32px)' }}>
      <div className="no-print" style={{ maxWidth: 900, margin: '0 auto 14px' }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => navigate(`/app/patients/${visit.patient_id}`)}>Patient chart</Button>
          <span className="spacer" />
          <Button size="sm" variant="subtle" icon={copied ? Check : Copy} onClick={shareText}>{copied ? 'Copied' : 'Copy for WhatsApp'}</Button>
          <Button size="sm" variant="primary" icon={Printer} onClick={() => window.print()}>Print / PDF</Button>
        </div>

        {/* language picker — the doctor picks the patient's language at the counter */}
        <Card className="pad" style={{ marginTop: 10, padding: 12 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <span className="row small strong" style={{ gap: 7 }}><Languages size={15} /> Instruction language</span>
            <span className="spacer" />
            <span className="tiny faint">Medicine names always stay in English</span>
          </div>
          <div className="lang-chips">
            {RX_LANGUAGES.map((l) => (
              <button
                key={l.code} type="button"
                className={`lang-chip ${lang === l.code ? 'selected' : ''}`}
                onClick={() => setLang(l.code)}
                lang={l.code}
              >
                <span className="lang-native">{l.native}</span>
                <span className="lang-label">{l.label}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="print-sheet card rx-sheet" style={{ maxWidth: 900, margin: '0 auto', fontFamily: localised ? fontStackFor(lang) : 'var(--font)' }}>
        {/* ---------------------------------------------------------------- header */}
        <DocumentHeader
          clinic={clinic}
          logo={logoOnDocuments(clinic)}
          accent={clinic.brand_color}
          right={(
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, fontSize: '1rem' }}>{doctor?.full_name ?? 'Consulting doctor'}</div>
              <div className="rx-meta">
                {[doctor?.qualification, doctor?.specialty].filter(Boolean).join(' · ')}
                {doctor?.registration_no ? <><br />Reg. {doctor.registration_no}</> : null}
              </div>
            </div>
          )}
        />

        {/* --------------------------------------------------------------- patient */}
        <div className="rx-patient">
          <div><b>{d.patient}</b>{patient?.full_name}</div>
          <div><b>ID</b>{patient?.code}</div>
          <div><b>Age / Sex</b>{ageLabel(patient)}</div>
          <div><b>Date</b>{formatDate(visit.visited_on)}</div>
          <div><b>Visit</b>{appointment?.kind ?? 'Consultation'}{appointment?.token_no ? ` · T-${String(appointment.token_no).padStart(2, '0')}` : ''}</div>
        </div>

        {patient?.allergies ? (
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', background: '#fbe8ec', color: '#b23b4e', padding: '4px 10px', borderRadius: 7, fontSize: '0.74rem', fontWeight: 800, letterSpacing: '.02em' }}>
            <ShieldAlert size={12} /> {d.allergy}: {patient.allergies}
          </div>
        ) : null}

        {/* ---------------------------------------------------------------- vitals */}
        {[v.temperature_c, v.pulse_bpm, v.bp_systolic, v.spo2, v.weight_kg].some(Boolean) ? (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', background: '#f6faf8', borderRadius: 8, padding: '8px 12px', margin: '12px 0', fontSize: '0.76rem', color: '#374a45' }}>
            {[['Temp', v.temperature_c ? `${v.temperature_c} °F` : null], ['Pulse', v.pulse_bpm ? `${v.pulse_bpm} bpm` : null], ['BP', v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic} mmHg` : null], ['SpO₂', v.spo2 ? `${v.spo2}%` : null], ['Weight', v.weight_kg ? `${v.weight_kg} kg` : null]].filter(([, val]) => val).map(([label, val]) => (
              <span key={label}><strong>{label}:</strong> {val}</span>
            ))}
          </div>
        ) : null}

        {/* ------------------------------------------------------- clinical summary */}
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          {visit.complaint ? (
            <div>
              <div className="rx-eyebrow">{d.complaint}</div>
              <p style={{ fontSize: '0.85rem', marginTop: 2 }}>{visit.complaint}</p>
            </div>
          ) : null}
          {(visit.diagnoses ?? []).length ? (
            <div>
              <div className="rx-eyebrow">{d.diagnosis}</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                {visit.diagnoses.map((dx) => <span key={dx} style={{ background: '#e6f4f1', color: '#0c655e', padding: '2px 8px', borderRadius: 5, fontSize: '0.75rem', fontWeight: 700 }}>{dx}</span>)}
              </div>
            </div>
          ) : null}
        </div>

        {/* ----------------------------------------------------------- prescription */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '2px solid #0f766e', paddingBottom: 5 }}>
            <span className="rx-symbol">℞</span>
            <strong style={{ fontSize: '0.84rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#374a45', fontFamily: 'var(--font)' }}>{d.medicines}</strong>
            <span className="spacer" />
            <span className="rx-lang" style={{ fontFamily: 'var(--font)' }}>{sheet.languageLabel}</span>
          </div>

          {(visit.prescription ?? []).length ? (
            <table className="rx-table" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={{ width: 22 }}>#</th>
                  <th style={{ width: '32%' }}>Medicine</th>
                  <th style={{ width: 72 }}>{sheet.columns.dose}</th>
                  <th>{lang === 'en' ? 'How to take' : 'Directions'}</th>
                </tr>
              </thead>
              <tbody>
                {visit.prescription.map((rx, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font)' }}>{rx.drug}</div>
                      {rx.notes ? <div className="rx-lang" style={{ fontFamily: 'var(--font)' }}>{rx.notes}</div> : null}
                    </td>
                    <td style={{ fontFamily: 'var(--font)' }}>{rx.dose}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{patientInstruction(rx, lang)}</div>
                      {localised ? (
                        <div className="rx-lang" style={{ fontFamily: 'var(--font)' }}>{patientInstruction(rx, 'en')}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ fontSize: '0.84rem', color: '#7b8b86', marginTop: 6 }}>{d.no_medicine}</p>}
        </div>

        {/* ------------------------------------------------------------------ advice */}
        {visit.advice ? (
          <div style={{ marginTop: 14 }}>
            <div className="rx-eyebrow">{d.advice}</div>
            <p className="rx-note" style={{ marginTop: 4 }}>{visit.advice}</p>
          </div>
        ) : null}

        {/* --------------------------------------------------------------- follow-up */}
        <div className="rx-sign">
          <div>
            <div className="rx-eyebrow" style={{ fontFamily: 'var(--font)' }}>Follow-up</div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
              <CalendarClock size={13} /> {visit.follow_up_on ? formatDate(visit.follow_up_on) : 'As needed'}
            </div>
            {visit.follow_up_on ? <div className="rx-lang" style={{ marginTop: 2 }}>{d.followup_in} {formatDate(visit.follow_up_on)}</div> : null}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ height: 38 }} />
            <div className="rx-sign-line">{doctor?.full_name}</div>
            <div className="rx-lang" style={{ fontFamily: 'var(--font)' }}>{sheet.signature}</div>
          </div>
        </div>

        <p style={{ marginTop: 14, fontSize: '0.68rem', color: '#8b9c97', borderTop: '1px solid #eef3f1', paddingTop: 8 }}>
          {sheet.footer} · myClinic
        </p>
      </div>

      <div className="no-print" style={{ maxWidth: 900, margin: '14px auto 0' }}>
        <div className="row wrap small muted" style={{ gap: 8 }}>
          <Badge tone="neutral"><Pill size={11} /> {visit.prescription?.length ?? 0} medicines</Badge>
          <Badge tone="neutral"><FileText size={11} /> {sheet.languageLabel}</Badge>
          {visit.follow_up_on ? <Badge tone="info">Follow-up {formatDate(visit.follow_up_on)}</Badge> : null}
          <span className="spacer" />
          <span className="tiny faint">Print sheet is A4-friendly · browser print dialog → Save as PDF</span>
        </div>
      </div>
    </div>
  );
}
