import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  CalendarPlus, Check, CircleDot, CreditCard, FileText, Printer, Stethoscope,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { can } from '../lib/permissions.js';
import { useToast, Badge, Button, Modal } from './ui.jsx';
import AppointmentForm from './AppointmentForm.jsx';
import CollectPayment from './CollectPayment.jsx';
import { formatDate, formatMoney, invoiceBalance, today } from '../lib/logic.mjs';
import { followUpDateFor, visitFlowState, visitNextActions } from '../lib/visit-flow.mjs';

/**
 * What to do next, the moment the note is saved.
 *
 * One sheet, used from every screen a consultation can be written from (dashboard,
 * token queue, appointments, the consultation list, the patient chart), because the
 * worst thing this app used to do was end the visit differently depending on where
 * the doctor happened to be standing:
 *
 *   dashboard  → "Billing is one tap away", with the invoice it had just raised
 *                hidden behind two menus
 *   queue      → closed, silence
 *   appointments → closed, silence
 *   list/chart → jumped to the invoice, skipping the prescription slip
 *
 * It shows where the visit got to (token → consult → slip → bill → follow-up) and
 * offers only the steps that are still missing. Nothing here creates work that was
 * already done: the bill it points at is the bill that was raised.
 */
export default function VisitNextSteps({ open, onClose, visit = null, invoice = null, tokenNo = null }) {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [payFor, setPayFor] = useState(null);
  const [bookOpen, setBookOpen] = useState(false);

  if (!open || !visit) return null;

  const role = store.role ?? 'owner';
  const canBill = can(role, 'invoice:create');
  const patient = store.patients.find((p) => p.id === visit.patient_id) ?? null;
  const doctor = store.doctors.find((d) => d.id === visit.doctor_id) ?? null;
  const balance = invoice ? invoiceBalance(invoice) : 0;
  const state = visitFlowState({ consultation: visit, invoice });
  const actions = visitNextActions({ consultation: visit, invoice, canBill, balancePaise: balance });
  const primary = actions[0]?.id ?? null;
  const has = (id) => actions.some((a) => a.id === id);
  const followUpOn = followUpDateFor(visit, { days: store.clinic?.follow_up_days ?? 15, today: today() });

  function printPrescription() {
    onClose();
    navigate(`/prescription/${visit.id}`);
  }

  return (
    <>
      <Modal
        open={open} onClose={onClose}
        title="Visit saved — what next?"
        sub={[patient?.full_name, tokenNo ? `token ${tokenNo}` : null, doctor?.full_name].filter(Boolean).join(' · ')}
        footer={<>
          <Button variant="ghost" onClick={onClose}>Done</Button>
          {has('book-followup') ? (
            <Button variant="subtle" icon={CalendarPlus} onClick={() => setBookOpen(true)}>
              {visit.follow_up_on ? `Follow-up ${formatDate(visit.follow_up_on)}` : 'Book follow-up'}
            </Button>
          ) : null}
          {has('print-rx') ? <Button variant="subtle" icon={Printer} onClick={printPrescription}>Print slip</Button> : null}
          {has('collect') ? (
            <Button variant="primary" icon={CreditCard} onClick={() => setPayFor(invoice)}>Collect {formatMoney(balance)}</Button>
          ) : null}
          {primary === 'invoice' ? (
            <Button variant="primary" icon={FileText} onClick={() => { onClose(); navigate(`/app/billing?new=1&patient=${visit.patient_id}`); }}>
              Raise the invoice
            </Button>
          ) : null}
          {primary === 'open-invoice' ? (
            <Button variant="primary" icon={FileText} onClick={() => { onClose(); navigate(`/invoice/${invoice.id}`); }}>Open invoice</Button>
          ) : null}
        </>}
      >
        <div className="stack" style={{ gap: 14 }}>
          {/* Where the visit got to. Chips, not a progress bar: five words a doctor
              can read at a glance and none of them invented. */}
          <div className="row wrap" style={{ gap: 6 }} role="list" aria-label="Visit progress">
            {state.steps.map((step) => (
              <span key={step.id} role="listitem" title={step.hint} style={{ display: 'inline-flex' }}>
                <Badge tone={step.done ? 'success' : step.current ? 'brand' : 'neutral'}>
                  {step.done ? <Check size={11} /> : step.current ? <CircleDot size={11} /> : null}
                  {' '}{step.label}
                </Badge>
              </span>
            ))}
          </div>

          <div className="stack" style={{ gap: 8, background: 'var(--surface-2)', borderRadius: 12, padding: 12 }}>
            <div className="row small" style={{ gap: 8 }}>
              <Stethoscope size={14} className="muted" />
              <span className="muted">Chart</span>
              <span className="spacer" />
              <span className="strong">{visit.complaint || 'Consultation'} · {formatDate(visit.visited_on)}</span>
            </div>
            <div className="row small" style={{ gap: 8 }}>
              <FileText size={14} className="muted" />
              <span className="muted">{invoice ? 'Invoice' : 'Invoice not raised'}</span>
              <span className="spacer" />
              {invoice ? (
                <span className="strong">
                  {invoice.number} · {formatMoney(invoice.total_paise)}
                  {balance > 0 ? <span className="faint"> · {formatMoney(balance)} due</span> : <span className="faint"> · paid</span>}
                </span>
              ) : (
                <span className="faint">{canBill ? 'one tap below' : 'the front desk raises it'}</span>
              )}
            </div>
            <div className="row small" style={{ gap: 8 }}>
              <CalendarPlus size={14} className="muted" />
              <span className="muted">Follow-up</span>
              <span className="spacer" />
              <span className={visit.follow_up_on ? 'strong' : 'faint'}>
                {visit.follow_up_on ? formatDate(visit.follow_up_on) : `not dated — ${formatDate(followUpOn)} suggested`}
              </span>
            </div>
          </div>

          {has('print-rx') ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              The slip prints in the patient’s language, with the dose pattern and the date the course ends. Hand it over before they leave the room.
            </p>
          ) : null}
        </div>
      </Modal>

      <CollectPayment
        invoice={payFor}
        open={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        onDone={() => { setPayFor(null); toast.success('Payment recorded.'); }}
      />

      <AppointmentForm
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        defaults={{
          patient_id: visit.patient_id,
          doctor_id: visit.doctor_id ?? undefined,
          scheduled_on: followUpOn,
          kind: 'Follow-up',
          source: 'walk-in',
          reason: visit.diagnoses?.[0] ?? visit.complaint ?? 'Follow-up',
        }}
        onCreated={() => { setBookOpen(false); onClose(); }}
      />
    </>
  );
}
