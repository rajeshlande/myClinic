import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Printer, Stethoscope, ShieldAlert, Languages, Pill, CalendarClock, MessageSquare, FileText } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Badge, Button, Card, EmptyState, Segmented } from '../components/ui.jsx';
import { ageLabel, formatDate } from '../lib/logic.mjs';
import { RX_LANGUAGES, dosePattern, patientInstruction, quantityToDispense, rxSheet, fontStackFor } from '../lib/rx-language.js';
import { DocumentHeader } from '../components/Branding.jsx';
import { logoOnDocuments } from '../lib/branding.mjs';
import { prescriptionMessage } from '../lib/messages.mjs';
import { paginateRows, pageOffsets } from '../lib/paginate.mjs';
import MessageSheet from '../components/MessageSheet.jsx';

export default function PrescriptionView() {
  const { id } = useParams();
  const store = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const visit = store.consultations.find((c) => c.id === id);
  const [lang, setLang] = useState(visit?.rx_language ?? 'en');
  const [msgOpen, setMsgOpen] = useState(false);

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

  // The document is paginated here, not by the browser: every page carries the
  // clinic's identity at the bottom, and a page cannot overflow without us knowing.
  const pages = useMemo(() => paginateRows(visit?.prescription ?? []), [visit?.prescription]);
  const offsets = useMemo(() => pageOffsets(pages), [pages]);
  const clinicLine = [clinic?.phone, clinic?.email].filter(Boolean).join(' · ');

  if (!visit) {
    return <div className="page"><Card><div className="card-body"><EmptyState icon={Stethoscope} title="Prescription not found" action={<Button variant="primary" onClick={() => navigate('/app/consultations')}>Back</Button>} /></div></Card></div>;
  }

  const v = visit.vitals ?? {};
  const d = sheet.headings;
  const localised = lang !== 'en';
  // "None reported" is a finding, not an allergy — don't print a red alert for it.
  const hasAllergy = Boolean(patient?.allergies && !/^none\b|^nil\b|^no known/i.test(String(patient.allergies).trim()));

  // The slip goes to the patient: medicines and directions in the language the
  // doctor chose, never the diagnosis. Built by messages.mjs, logged on send.
  const message = prescriptionMessage({
    clinic,
    doctor,
    patient,
    visit,
    languageLabel: sheet.languageLabel,
    instructionFor: (rx) => patientInstruction(rx, lang),
  });

  return (
    <div className="doc-page">
      <div className="no-print" style={{ maxWidth: '210mm', margin: '0 auto 14px' }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => navigate(`/app/patients/${visit.patient_id}`)}>Patient chart</Button>
          <span className="spacer" />
          <Button size="sm" variant="subtle" icon={MessageSquare} onClick={() => setMsgOpen(true)}>WhatsApp</Button>
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

      {/* One block per sheet of paper. The pages are decided in paginate.mjs, so the
          footer can sit at the bottom of every page and say which page it is. */}
      {pages.map((rows, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLast = pageIndex === pages.length - 1;
        const offset = offsets[pageIndex];
        return (
          <section
            key={pageIndex}
            className="print-page rx-sheet"
            style={{ fontFamily: localised ? fontStackFor(lang) : 'var(--font)' }}
            aria-label={`Prescription page ${pageIndex + 1} of ${pages.length}`}
          >
            {isFirstPage ? (
              <DocumentHeader
                clinic={clinic}
                showGstin={false}
                logo={logoOnDocuments(clinic)}
                accent={clinic.brand_color}
                right={(
                  <div className="doc-title-block">
                    <div className="doc-kind">Prescription</div>
                    {visit.rx_number ? <div className="doc-number mono">{visit.rx_number}</div> : null}
                    <div className="doc-number">{doctor?.full_name ?? 'Consulting doctor'}</div>
                    <div className="doc-date">
                      {[doctor?.qualification, doctor?.specialty].filter(Boolean).join(' · ')}
                      {doctor?.registration_no ? <><br />Reg. {doctor.registration_no}</> : null}
                    </div>
                  </div>
                )}
              />
            ) : (
              /* Continuation sheet: who the patient is, whose prescription this is,
                 and which page — the three things a loose sheet needs to be filed. */
              <div className="page-cont">
                <span className="strong">{clinic?.name ?? 'Clinic'}</span>
                <span>{patient?.full_name} · {visit.rx_number ?? formatDate(visit.visited_on)}</span>
                <span className="page-cont-no">Page {pageIndex + 1} of {pages.length}</span>
              </div>
            )}

            {isFirstPage ? (
              <>
                <div className="rx-patient">
                  <div className="rx-patient-name"><b>{d.patient}</b>{patient?.full_name}</div>
                  <div><b>Patient ID</b><span className="mono">{patient?.code ?? '—'}</span></div>
                  <div><b>Age / Sex</b>{ageLabel(patient)}</div>
                  <div><b>Date</b>{formatDate(visit.visited_on)}</div>
                  <div><b>Visit</b>{appointment?.kind ?? 'Consultation'}{appointment?.token_no ? ` · T-${String(appointment.token_no).padStart(2, '0')}` : ''}</div>
                  {[patient?.address, patient?.city].filter(Boolean).length ? (
                    <div className="rx-patient-wide"><b>Address</b>{[patient?.address, patient?.city].filter(Boolean).join(', ')}</div>
                  ) : null}
                </div>

                {hasAllergy ? (
                  <div className="rx-allergy">
                    <ShieldAlert size={12} /> {d.allergy}: {patient.allergies}
                  </div>
                ) : null}

                {[v.temperature_c, v.pulse_bpm, v.bp_systolic, v.spo2, v.weight_kg, v.height_cm].some(Boolean) ? (
                  <div className="rx-vitals">
                    {[['Temp', v.temperature_c ? `${v.temperature_c} °F` : null], ['Pulse', v.pulse_bpm ? `${v.pulse_bpm} bpm` : null], ['BP', v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic} mmHg` : null], ['SpO₂', v.spo2 ? `${v.spo2}%` : null], ['Weight', v.weight_kg ? `${v.weight_kg} kg` : null], ['Height', v.height_cm ? `${v.height_cm} cm` : null]].filter(([, val]) => val).map(([label, val]) => (
                      <span key={label}><strong>{label}:</strong> {val}</span>
                    ))}
                  </div>
                ) : null}

                <div className="rx-clinical">
                  {visit.complaint ? (
                    <div>
                      <div className="rx-eyebrow">{d.complaint}</div>
                      <p className="rx-complaint">{visit.complaint}</p>
                    </div>
                  ) : null}
                  {(visit.diagnoses ?? []).length ? (
                    <div>
                      <div className="rx-eyebrow">{d.diagnosis}</div>
                      <div className="rx-dx">
                        {visit.diagnoses.map((dx) => <span key={dx} className="rx-dx-chip">{dx}</span>)}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="rx-block">
              <div className="rx-head-row">
                <span className="rx-symbol">℞</span>
                <strong>{d.medicines}{!isFirstPage ? ' (continued)' : ''}</strong>
                <span className="spacer" />
                <span className="rx-lang">{sheet.languageLabel}</span>
              </div>

              {rows.length ? (
                <table className="rx-table">
                  <thead>
                    <tr>
                      <th style={{ width: 20 }}>#</th>
                      <th style={{ width: '30%' }}>Medicine</th>
                      <th style={{ width: 80 }}>{sheet.columns.dose}</th>
                      <th>{lang === 'en' ? 'How to take' : 'Directions'}</th>
                      <th style={{ width: 74 }}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((rx, i) => (
                      <tr key={`${pageIndex}-${i}`}>
                        <td>{offset + i + 1}</td>
                        <td>
                          <div className="rx-drug">{rx.drug}</div>
                          {rx.salt ? (
                            <div className="rx-salt rx-generic">
                              {rx.salt}
                              {rx.form ? ` · ${rx.form}` : ''}
                              {rx.schedule === 'H1' ? ' · Schedule H1' : rx.schedule === 'X' ? ' · Schedule X' : ''}
                            </div>
                          ) : null}
                          {rx.notes ? <div className="rx-lang">{rx.notes}</div> : null}
                        </td>
                        <td>
                          <div>{rx.dose}</div>
                          {dosePattern(rx) ? <div className="rx-pattern-cell">{dosePattern(rx)}</div> : null}
                        </td>
                        <td>
                          <div className="rx-directions">{patientInstruction(rx, lang)}</div>
                          {localised ? <div className="rx-lang">{patientInstruction(rx, 'en')}</div> : null}
                        </td>
                        <td className="rx-qty">{quantityToDispense(rx)?.label ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : isFirstPage ? (
                <p className="rx-empty">{d.no_medicine}</p>
              ) : null}
            </div>

            {isLast ? (
              <>
                {(visit.investigations ?? []).length ? (
                  <div className="rx-block">
                    <div className="rx-eyebrow">Investigations advised</div>
                    <div className="rx-tests">
                      {(visit.investigations ?? []).map((test) => <span key={test}>{test}</span>)}
                    </div>
                  </div>
                ) : null}

                {visit.advice ? (
                  <div className="rx-block">
                    <div className="rx-eyebrow">{d.advice}</div>
                    <p className="rx-note">{visit.advice}</p>
                  </div>
                ) : null}

                <div className="rx-sign">
                  <div>
                    <div className="rx-eyebrow">Follow-up</div>
                    <div className="rx-followup">
                      <CalendarClock size={13} /> {visit.follow_up_on ? formatDate(visit.follow_up_on) : 'As needed'}
                    </div>
                    {visit.follow_up_on && localised ? <div className="rx-lang">{d.followup_in} {formatDate(visit.follow_up_on)}</div> : null}
                  </div>
                  <div className="rx-sign-block">
                    <div className="rx-sign-space" />
                    <div className="rx-sign-line">{doctor?.full_name}</div>
                    <div className="rx-lang">
                      {[doctor?.qualification, doctor?.registration_no ? `Reg. ${doctor.registration_no}` : null].filter(Boolean).join(' · ')}
                    </div>
                    <div className="rx-lang">{sheet.signature} &amp; clinic seal</div>
                  </div>
                </div>
              </>
            ) : null}

            {/* The footer is the bottom of the page, whatever is above it: the page
                is a flex column and this block is pushed down by `margin-top: auto`.
                Two blocks of the same width — the clinic on the left, the document
                on the right — so the line reads the same on every page. */}
            <footer className="page-foot">
              <div>
                <strong>{clinic?.name ?? 'Clinic'}</strong>
                {clinic?.address ? <span>{clinic.address}</span> : null}
                {clinicLine ? <span>{clinicLine}</span> : null}
                <span className="page-foot-fine">{sheet.footer}</span>
              </div>
              <div>
                <span>Prescription · {patient?.full_name ?? 'Patient'} · {formatDate(visit.visited_on)}</span>
                <span className="page-foot-fine">Computer-generated e-prescription · valid only with the prescriber’s signature and clinic seal</span>
                <span className="page-foot-fine">Bring this sheet to your next visit</span>
                <span className="page-foot-fine">Page {pageIndex + 1} of {pages.length} · myClinic</span>
              </div>
            </footer>
          </section>
        );
      })}

      <div className="no-print" style={{ maxWidth: '210mm', margin: '14px auto 0' }}>
        <div className="row wrap small muted" style={{ gap: 8 }}>
          <Badge tone="neutral"><Pill size={11} /> {visit.prescription?.length ?? 0} medicines</Badge>
          <Badge tone="neutral"><FileText size={11} /> {sheet.languageLabel}</Badge>
          {visit.follow_up_on ? <Badge tone="info">Follow-up {formatDate(visit.follow_up_on)}</Badge> : null}
          <span className="spacer" />
          <span className="tiny faint">Print sheet is A4-friendly · browser print dialog → Save as PDF</span>
        </div>
      </div>

      <MessageSheet
        open={msgOpen}
        onClose={() => setMsgOpen(false)}
        patient={patient}
        message={message}
      />
    </div>
  );
}
