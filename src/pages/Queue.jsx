import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  CheckCircle2, Clock, CreditCard, HandCoins, MessageSquare, PlayCircle, Ticket, Timer, UserPlus, UserX, Users, Volume2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Avatar, Badge, Button, Card, CardHead, EmptyState, Kpi, Modal, Segmented } from '../components/ui.jsx';
import TokenForm from '../components/TokenForm.jsx';
import PatientForm from '../components/PatientForm.jsx';
import ConsultationForm from '../components/ConsultationForm.jsx';
import VisitNextSteps from '../components/VisitNextSteps.jsx';
import CollectPayment from '../components/CollectPayment.jsx';
import { invoiceForVisit } from '../lib/visit-flow.mjs';
import MessageSheet from '../components/MessageSheet.jsx';
import { tokenMessage } from '../lib/messages.mjs';
import {
  addDays, averageWait, canCallNext, formatDate, formatMoney, formatTime, humanWait, invoiceBalance, nextTokenNo, queueBoard, queueState, relativeDay, roomFullMessage, tokenLabel, today, waitedMinutes,
} from '../lib/logic.mjs';

export default function Queue() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [doctorId, setDoctorId] = useState('all');
  const [date, setDate] = useState(today());
  const [tokenOpen, setTokenOpen] = useState(false);
  const [patientOpen, setPatientOpen] = useState(false);
  const [consultFor, setConsultFor] = useState(null);
  const [savedVisit, setSavedVisit] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [msgFor, setMsgFor] = useState(null); // { patient, message }
  const [displayOpen, setDisplayOpen] = useState(false);
  const [feeFor, setFeeFor] = useState(null);

  const board = useMemo(
    () => queueBoard({ appointments: store.appointments, patients: store.patients, doctors: store.doctors, iso: date, doctorId }),
    [store.appointments, store.patients, store.doctors, date, doctorId],
  );
  const avg = useMemo(() => averageWait(store.consultations, store.appointments, date), [store.consultations, store.appointments, date]);
  const patientOf = (id) => store.patients.find((p) => p.id === id);
  const doctorOf = (id) => store.doctors.find((d) => d.id === id);

  /**
   * The bill this visit already has. The queue used to offer "Bill" unconditionally,
   * so a second tap after the doctor's "Save & bill" raised a duplicate invoice for
   * the same token. Now the button becomes "Collect" when there is something to
   * collect, and only says "Bill" when nothing has been raised yet.
   */
  const billFor = (appt) => invoiceForVisit(store.invoices, {
    appointmentId: appt.id, patientId: appt.patient_id, on: appt.scheduled_on ?? date,
  });

  async function setStatus(appt, status, message) {
    try {
      await store.update('appointments', appt.id, { status });
      toast.success(message);
    } catch (e) { toast.error(e.message ?? 'Could not update the queue.'); }
  }

  // A click can come from a tab whose board is a few seconds old, or from a second
  // receptionist. Re-read the room from the store at click time instead of trusting
  // the row that was rendered, and hold a token id while its write is in flight so a
  // double click cannot put two people through the same open seat.
  const storeRef = useRef(store);
  storeRef.current = store;
  const callingRef = useRef(new Set());

  const callIn = async (row, appt = row.next) => {
    if (!appt || callingRef.current.has(appt.id)) return;
    const fresh = queueBoard({
      appointments: storeRef.current.appointments,
      patients: storeRef.current.patients,
      doctors: storeRef.current.doctors,
      iso: date, doctorId: row.doctor.id,
    });
    const live = fresh.rows[0];
    if (!live || !canCallNext(live.inRoom)) {
      toast.error(roomFullMessage(live?.inRoom ?? []));
      return;
    }
    callingRef.current.add(appt.id);
    try {
      const name = storeRef.current.patients.find((p) => p.id === appt.patient_id)?.full_name ?? 'patient';
      await setStatus(appt, 'in-consult', `${tokenLabel(appt.token_no)} · ${name} — called in.`);
    } finally {
      callingRef.current.delete(appt.id);
    }
  };

  const markDone = (appt) => {
    if (!appt) return;
    setStatus(appt, 'completed', `${tokenLabel(appt.token_no)} completed.`);
  };

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="page-head no-print">
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2>Token queue</h2>
          <div className="sub">Front desk issues a number, the doctor calls it in — no appointment needed for walk-ins</div>
        </div>
        <div className="row wrap hero-actions" style={{ gap: 8 }}>
          <Button variant="subtle" icon={Volume2} onClick={() => setDisplayOpen(true)}>Display</Button>
          <Button variant="subtle" icon={UserPlus} onClick={() => setPatientOpen(true)}>Register</Button>
          <Button variant="primary" icon={Ticket} onClick={() => setTokenOpen(true)}>Issue token</Button>
        </div>
      </div>

      <div className="row wrap no-print" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 4 }}>
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" />
          <div style={{ textAlign: 'center', minWidth: 120 }}>
            <div className="small strong">{relativeDay(date)}</div>
            <div className="tiny faint">{formatDate(date)}</div>
          </div>
          <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => setDate(addDays(date, 1))} aria-label="Next day" />
          {date !== today() ? <Button size="sm" variant="subtle" onClick={() => setDate(today())}>Today</Button> : null}
        </div>
        <span className="spacer" />
        <Segmented
          value={doctorId} onChange={setDoctorId}
          options={[{ value: 'all', label: 'All doctors' }, ...store.doctors.filter((d) => d.role !== 'frontdesk').map((d) => ({ value: d.id, label: d.full_name.replace(/^Dr\.?\s*/i, 'Dr ') }))]}
        />
      </div>

      <div className="grid kpis kpi-compactable no-print">
        <Kpi label="Tokens issued" value={board.totals.issued} icon={Ticket} meta={`${board.totals.done} completed`} accent />
        <Kpi label="Waiting now" value={board.totals.waiting} icon={Users} meta={`${board.totals.serving} in the room`} />
        <Kpi label="Average wait" value={avg == null ? '—' : humanWait(avg)} icon={Timer} meta="issue → seen, today" />
        <Kpi label="Next to issue" value={tokenLabel(nextTokenNo(store.appointments, doctorId === 'all' ? store.doctors[0]?.id : doctorId, date))} icon={Clock} meta={doctorId === 'all' ? store.doctors.find((d) => d.role !== 'frontdesk')?.full_name ?? '' : doctorOf(doctorId)?.full_name ?? ''} />
      </div>

      {board.rows.length ? board.rows.map((row) => (
        <Card key={row.doctor.id} className="no-break">
          <CardHead
            title={row.doctor.full_name} icon={Ticket}
            sub={`${row.doctor.specialty} · next token ${tokenLabel(row.nextToken)} · ${row.issued} issued today`}
            action={<div className="row no-print" style={{ gap: 6 }}>
              <Badge tone={row.waiting.length ? 'warn' : 'success'}>{row.waiting.length} waiting</Badge>
              <Badge tone="neutral">{row.done} done</Badge>
            </div>}
          />
          <div className="card-body stack" style={{ gap: 12, paddingTop: 12 }}>
            {/* now serving + next up */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 10 }}>
              <div className="card pad" style={{ padding: 13, background: row.roomCount ? 'linear-gradient(140deg, var(--brand-50), var(--surface) 75%)' : 'var(--surface-2)', borderColor: row.roomCount ? 'var(--brand-300)' : 'var(--border)', boxShadow: 'none' }}>
                <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                  <span className="eyebrow">Now in the room</span>
                  <span className="spacer" />
                  <Badge tone={row.canCallNext ? 'neutral' : 'warn'} aria-label={`${row.roomCount} of ${row.roomLimit} seats in the room`}>{row.roomCount} / {row.roomLimit}</Badge>
                </div>
                {row.seats.length ? (
                  <div className="stack" style={{ gap: 10 }}>
                    {row.seats.map((seat) => (
                      /* One seat = one patient's information + that patient's own
                         Consult and Done. Nothing is shared between the seats. */
                      <div
                        key={seat.appt.id}
                        className="stack"
                        style={{ gap: 6, ...(seat.primary ? {} : { borderTop: '1px dashed var(--border)', paddingTop: 9 }) }}
                      >
                        <div className="row" style={{ gap: seat.primary ? 10 : 8 }}>
                          {seat.primary ? (
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 800, letterSpacing: '-0.03em' }}>{seat.token}</span>
                          ) : (
                            <span className="mono tiny strong">{seat.token}</span>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className={seat.primary ? 'small strong truncate' : 'tiny strong truncate'}>{patientOf(seat.appt.patient_id)?.full_name}</div>
                            <div className="tiny muted">
                              {seat.primary
                                ? `with ${row.doctor.full_name} · ${formatTime(seat.appt.scheduled_at)}`
                                : `${humanWait(waitedMinutes(seat.appt))} waiting · ${formatTime(seat.appt.scheduled_at)}`}
                            </div>
                          </div>
                          <Badge tone={seat.tone}>{seat.label}</Badge>
                        </div>
                        <div className="row no-print" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <Button
                            size="sm" variant={seat.primary ? 'primary' : 'subtle'} icon={PlayCircle}
                            aria-label={`Consult ${seat.token}`}
                            onClick={() => setConsultFor(seat.appt)}
                          >{seat.consultLabel}</Button>
                          <Button
                            size="sm" variant="subtle" icon={CheckCircle2}
                            aria-label={`Mark ${seat.token} done`}
                            onClick={() => markDone(seat.appt)}
                          >{seat.doneLabel}</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="small muted">{row.next ? 'Ready for the next patient.' : 'No one waiting.'}</p>
                )}
                {row.next && row.canCallNext ? (
                  <div className="row no-print" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <Button size="sm" variant={row.roomCount ? 'subtle' : 'primary'} icon={Volume2} onClick={() => callIn(row)}>
                      {row.roomCount ? `Call ${tokenLabel(row.next.token_no)} in` : `Call ${tokenLabel(row.next.token_no)}`}
                    </Button>
                  </div>
                ) : null}
                {row.next && !row.canCallNext ? <p className="tiny muted" role="status" style={{ marginTop: 8 }}>{row.roomFull}</p> : null}
              </div>

              <div className="card pad" style={{ padding: 13, background: 'var(--surface-2)', boxShadow: 'none' }}>
                <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                  <span className="eyebrow">Up next</span>
                  <span className="spacer" />
                  <Badge tone="info">{row.waiting.length} in queue</Badge>
                </div>
                {row.waiting.length ? (
                  <div className="stack" style={{ gap: 5 }}>
                    {row.waiting.slice(0, 3).map((appt) => {
                      const st = queueState(appt, row.doctor);
                      const wait = waitedMinutes(appt);
                      return (
                        <div key={appt.id} className="row" style={{ gap: 8 }}>
                          <span className="mono small strong" style={{ minWidth: 38 }}>{tokenLabel(appt.token_no)}</span>
                          <span className="small truncate" style={{ flex: 1 }}>{patientOf(appt.patient_id)?.full_name}</span>
                          <span className="tiny faint nowrap">{['checked-in', 'in-consult'].includes(appt.status) ? humanWait(wait) : '—'}</span>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </div>
                      );
                    })}
                    {row.waiting.length > 3 ? <span className="tiny faint">+ {row.waiting.length - 3} more in the queue</span> : null}
                  </div>
                ) : <p className="small muted">Queue is empty — issue a token when a patient arrives.</p>}
                <div className="row no-print" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {row.next ? (
                    <Button
                      size="sm" variant="subtle" icon={Volume2}
                      disabled={!row.canCallNext}
                      title={row.canCallNext ? '' : row.roomFull}
                      aria-label={row.canCallNext ? 'Call next' : `Cannot call next: ${row.roomFull}`}
                      onClick={() => callIn(row)}
                    >Call next</Button>
                  ) : null}
                  <Button size="sm" variant="ghost" icon={Ticket} onClick={() => setTokenOpen(true)}>New token</Button>
                </div>
                {row.next && !row.canCallNext ? <p className="tiny muted" role="status" style={{ marginTop: 6 }}>{row.roomFull}</p> : null}
              </div>
            </div>

            {/* full token table */}
            {row.waiting.length || row.done ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Patient</th>
                      <th>Visit</th>
                      <th>At desk</th>
                      <th>Waiting</th>
                      <th>Status</th>
                      <th className="num no-print">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...row.waiting, ...row.completed].map((appt) => {
                      const patient = patientOf(appt.patient_id);
                      const st = queueState(appt, row.doctor);
                      return (
                        <tr key={appt.id}>
                          <td className="strong mono">{tokenLabel(appt.token_no)}</td>
                          <td>
                            <button onClick={() => patient && navigate(`/app/patients/${patient.id}`)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                              <div className="small strong">{patient?.full_name ?? 'Patient'}</div>
                              <div className="tiny faint">{patient?.code}{patient?.phone ? ` · ${patient.phone}` : ''}</div>
                            </button>
                          </td>
                          <td className="small">{appt.kind}{appt.reason ? <span className="tiny faint" style={{ display: 'block' }}>{appt.reason}</span> : null}</td>
                          <td className="small mono">{formatTime(appt.scheduled_at)}</td>
                          <td className="small">{['checked-in', 'in-consult'].includes(appt.status) ? humanWait(waitedMinutes(appt)) : '—'}</td>
                          <td><Badge tone={st.tone}>{st.label}</Badge></td>
                          <td className="num no-print">
                            <div className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              {appt.status === 'booked' ? <Button size="sm" variant="subtle" onClick={() => setStatus(appt, 'checked-in', 'Patient is at the desk.')}>Arrived</Button> : null}
                              {appt.status === 'checked-in' ? <Button size="sm" variant="primary" onClick={() => callIn(row, appt)}>Call in</Button> : null}
                              {appt.status === 'in-consult' ? <Button size="sm" variant="primary" icon={PlayCircle} onClick={() => setConsultFor(appt)}>Consult</Button> : null}
                              {appt.status === 'completed' ? (billFor(appt)
                                ? <Button size="sm" variant="ghost" icon={HandCoins} onClick={() => setPayFor(billFor(appt))}>Collect {formatMoney(invoiceBalance(billFor(appt)))}</Button>
                                : <Button size="sm" variant="ghost" icon={CreditCard} onClick={() => setFeeFor(appt)}>Bill</Button>) : null}
                              {appt.token_no ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon={MessageSquare}
                                  aria-label="Send the token on WhatsApp"
                                  onClick={() => {
                                    const waiting = row.waiting ?? [];
                                    const idx = waiting.findIndex((a) => a.id === appt.id);
                                    const ahead = idx >= 0 ? idx : 0;
                                    const slot = Number(row.doctor?.slot_minutes ?? store.clinic?.slot_minutes ?? 15);
                                    setMsgFor({
                                      patient,
                                      message: tokenMessage({
                                        clinic: store.clinic,
                                        doctor: row.doctor,
                                        patient,
                                        appointment: appt,
                                        ahead,
                                        etaMinutes: ahead * slot,
                                        at: appt.scheduled_at ? String(appt.scheduled_at).slice(0, 5) : '',
                                      }),
                                    });
                                  }}
                                >Token</Button>
                              ) : null}
                              {['booked', 'checked-in'].includes(appt.status)
                                ? <Button size="sm" variant="ghost" icon={UserX} onClick={() => setStatus(appt, 'no-show', 'Marked as no show.')}>No show</Button>
                                : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={Ticket} title="No tokens for this doctor yet"
                description="Issue the first token when a patient walks in — booked patients can also be given a number at the desk."
                action={<Button size="sm" variant="primary" icon={Ticket} onClick={() => setTokenOpen(true)}>Issue token</Button>}
              />
            )}
          </div>
        </Card>
      )) : (
        <Card><div className="card-body"><EmptyState icon={Users} title="No doctors configured" description="Add a doctor under Doctors & staff to start issuing tokens." /></div></Card>
      )}

      {/* completed tokens, so the desk can still bill them */}
      <Card className="no-print">
        <CardHead title="Completed today" sub="Bill or reprint any patient served today" icon={CheckCircle2}
          action={<Badge tone="success">{board.totals.done}</Badge>} />
        <div className="card-body" style={{ paddingTop: 8 }}>
          {store.appointments.filter((a) => a.scheduled_on === date && a.status === 'completed' && a.token_no && (doctorId === 'all' || a.doctor_id === doctorId)).length ? (
            store.appointments.filter((a) => a.scheduled_on === date && a.status === 'completed' && a.token_no && (doctorId === 'all' || a.doctor_id === doctorId))
              .sort((a, b) => (a.token_no ?? 0) - (b.token_no ?? 0))
              .map((appt) => (
                <div key={appt.id} className="list-item" style={{ cursor: 'default' }}>
                  <span className="mono small strong" style={{ minWidth: 42 }}>{tokenLabel(appt.token_no)}</span>
                  <Avatar name={patientOf(appt.patient_id)?.full_name} size="sm" />
                  <span className="li-main">
                    <span className="li-title">{patientOf(appt.patient_id)?.full_name}</span>
                    <span className="li-sub">{doctorOf(appt.doctor_id)?.full_name} · {formatTime(appt.scheduled_at)} · {appt.kind}</span>
                  </span>
                  {billFor(appt)
                    ? <Button size="sm" variant="subtle" icon={HandCoins} onClick={() => setPayFor(billFor(appt))}>Collect {formatMoney(invoiceBalance(billFor(appt)))}</Button>
                    : <Button size="sm" variant="subtle" icon={CreditCard} onClick={() => setFeeFor(appt)}>Bill</Button>}
                </div>
              ))
          ) : <p className="small muted">No completed tokens for this day yet.</p>}
        </div>
      </Card>

      <TokenForm open={tokenOpen} onClose={() => setTokenOpen(false)} defaults={{ doctor_id: doctorId !== 'all' ? doctorId : undefined }} />
      <PatientForm open={patientOpen} onClose={() => setPatientOpen(false)} onCreated={() => { setPatientOpen(false); setTokenOpen(true); }} />
      {consultFor ? (
        <ConsultationForm
          open onClose={() => setConsultFor(null)}
          appointment={consultFor} patient={patientOf(consultFor.patient_id)}
          onSaved={(saved, raised) => {
            setSavedVisit({ visit: saved, invoice: raised ?? null, tokenNo: consultFor?.token_no ?? null });
            setConsultFor(null);
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

      <Modal open={Boolean(feeFor)} onClose={() => setFeeFor(null)} title="Raise the fee" sub={feeFor ? `${tokenLabel(feeFor.token_no)} · ${patientOf(feeFor.patient_id)?.full_name}` : ''}
        footer={<>
          <Button variant="ghost" onClick={() => setFeeFor(null)}>Later</Button>
          <Button variant="primary" icon={CreditCard} onClick={() => { const id = feeFor.patient_id; setFeeFor(null); navigate(`/app/billing?new=1&patient=${id}`); }}>Create invoice</Button>
        </>}>
        <p className="small muted">
          Opens the invoice with this patient pre-filled and the doctor’s consultation fee as the first line. Take cash, UPI, card or insurance on the same screen.
        </p>
      </Modal>

      <CollectPayment
        invoice={payFor}
        open={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        onDone={() => setPayFor(null)}
      />

      <Modal open={displayOpen} onClose={() => setDisplayOpen(false)} title="Waiting-room display" sub="Show this on the lounge TV or a tablet at reception">
        <WaitingDisplay board={board} patientOf={patientOf} />
      </Modal>

      <MessageSheet
        open={Boolean(msgFor)}
        onClose={() => setMsgFor(null)}
        patient={msgFor?.patient}
        message={msgFor?.message}
      />
    </div>
  );
}

export function WaitingDisplay({ board, patientOf }) {
  const rows = board.rows.filter((r) => r.seats.length || r.next);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.length ? rows.map((row) => (
        <div key={row.doctor.id} className="card pad" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <strong className="small">{row.doctor.full_name}</strong>
            <Badge tone="neutral">{row.doctor.specialty}</Badge>
            <span className="spacer" />
            <span className="tiny faint">next {tokenLabel(row.nextToken)}</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="center card pad" style={{ padding: 10, background: 'var(--brand-50)', boxShadow: 'none', borderColor: 'var(--brand-300)' }}>
              <span className="eyebrow">In the room · {row.roomCount} / {row.roomLimit}</span>
              {row.seats.length ? (
                <div className="stack" style={{ gap: 2 }}>
                  {row.seats.map((seat) => seat.primary ? (
                    <div key={seat.appt.id}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, lineHeight: 1.1 }}>{tokenLabel(seat.appt.token_no)}</div>
                      <div className="tiny truncate">{patientOf(seat.appt.patient_id)?.full_name}</div>
                    </div>
                  ) : (
                    <div key={seat.appt.id} className="row center" style={{ gap: 6, justifyContent: 'center', borderTop: '1px dashed var(--border)', marginTop: 5, paddingTop: 5 }}>
                      <span className="mono small strong">{tokenLabel(seat.appt.token_no)}</span>
                      <span className="tiny faint truncate">{patientOf(seat.appt.patient_id)?.full_name} · waiting in room</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, lineHeight: 1.1 }}>—</div>
                  <div className="tiny truncate">Ready</div>
                </>
              )}
            </div>
            <div className="center card pad" style={{ padding: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
              <span className="eyebrow">{row.canCallNext ? 'Please proceed' : 'Please wait'}</span>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, lineHeight: 1.1 }}>{row.next ? tokenLabel(row.next.token_no) : '—'}</div>
              <div className="tiny truncate">{row.next ? patientOf(row.next.patient_id)?.full_name : 'No one waiting'}</div>
            </div>
          </div>
        </div>
      )) : <p className="small muted">No active tokens right now.</p>}
      <p className="tiny faint center">Numbers refresh as the desk updates the queue. Keep patient names on screen only where the lounge can see it.</p>
    </div>
  );
}
