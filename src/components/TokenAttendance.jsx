import { AlertTriangle, BadgeCheck, LogIn, RotateCcw, Ticket, UserX } from 'lucide-react';
import { Badge, Button } from './ui.jsx';
import { tokenLabel } from '../lib/logic.mjs';
import { attendanceOf, lateStamp } from '../lib/token-policy.mjs';

/**
 * Presentational pieces for token attendance. Everything that decides *what a
 * token is* lives in `token-policy.mjs`; this file only renders it. Keeping the
 * refusal and the no-show strip here also means a smoke can server-render the
 * real screens without a store or a click.
 */

export function AttendanceBadge({ appt }) {
  const a = attendanceOf(appt);
  return <Badge tone={a.tone}>{a.label}</Badge>;
}

/** Which attendance actions make sense for this token — a rule, but a presentational one. */
export function attendanceActionsFor(appt) {
  const id = attendanceOf(appt).id;
  return {
    canArrive: id === 'not-arrived',
    canReinstate: id === 'no-show',
    canMiss: ['not-arrived', 'waiting', 'arrived-late', 'in-room'].includes(id),
  };
}

export function AttendanceActions({ appt, onArrived, onArrivedLate, onNoShow }) {
  const { canArrive, canReinstate, canMiss } = attendanceActionsFor(appt);
  return (
    <>
      {canArrive ? <Button size="sm" variant="subtle" icon={LogIn} onClick={() => onArrived?.(appt)}>Arrived</Button> : null}
      {canReinstate ? <Button size="sm" variant="subtle" icon={RotateCcw} onClick={() => onArrivedLate?.(appt)}>Arrived late</Button> : null}
      {canMiss ? <Button size="sm" variant="ghost" icon={UserX} onClick={() => onNoShow?.(appt)}>No show</Button> : null}
    </>
  );
}

/** A small, always-visible tally so the three problem states are not invisible. */
export function AttendanceSummary({ counts = {} }) {
  return (
    <div className="row wrap no-print" style={{ gap: 6 }} aria-live="polite" aria-label="Token attendance">
      <Badge tone="info">{counts['not-arrived'] ?? 0} not arrived</Badge>
      <Badge tone="danger">{counts['no-show'] ?? 0} no show</Badge>
      <Badge tone="warn">{counts['arrived-late'] ?? 0} arrived late</Badge>
    </div>
  );
}

/**
 * No-show tokens used to disappear from the queue. They are listed here, out of
 * the waiting list, with the one action that puts the *same* number back in it.
 */
export function MissedTokens({ tokens = [], patientOf = () => null, onArrivedLate }) {
  if (!tokens.length) return null;
  return (
    <div className="card pad no-print" style={{ padding: 12, background: 'var(--surface-2)', borderColor: 'var(--border)', boxShadow: 'none' }}>
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <AlertTriangle size={14} className="muted" />
        <span className="eyebrow">No show / arrived later</span>
        <span className="spacer" />
        <Badge tone="danger">{tokens.length}</Badge>
      </div>
      <p className="tiny muted" style={{ margin: '0 0 8px' }}>
        When one of these patients comes back, tap <b>Arrived late</b>. Their original number
        returns to the queue — do not issue a second token.
      </p>
      <div className="stack" style={{ gap: 5 }} aria-live="polite">
        {tokens.map((appt) => (
          <div key={appt.id} className="row wrap" style={{ gap: 8 }}>
            <span className="mono small strong" style={{ minWidth: 42 }}>{tokenLabel(appt.token_no)}</span>
            <span className="small truncate" style={{ flex: 1, minWidth: 110 }}>{patientOf(appt.patient_id)?.full_name ?? 'Patient'}</span>
            <AttendanceBadge appt={appt} />
            <Button size="sm" variant="subtle" icon={RotateCcw} aria-label={`Mark ${tokenLabel(appt.token_no)} arrived late`}
              onClick={() => onArrivedLate?.(appt)}>Arrived late</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Shown instead of a second token. The reason is spoken (`role="alert"`), the
 * existing number is named, and every button re-uses that one appointment.
 */
export function ExistingTokenPanel({ check, onUse, onArrived, onArrivedLate }) {
  const existing = check?.existing;
  if (!existing) return null;
  const a = attendanceOf(existing);
  const { canArrive, canReinstate } = attendanceActionsFor(existing);
  return (
    <div className="card pad stack" style={{ gap: 10, background: 'var(--warn-bg)', borderColor: 'var(--warn)' }} role="alert">
      <div className="row" style={{ gap: 8 }}>
        <AlertTriangle size={16} />
        <span className="small strong">One token per patient per day</span>
        <span className="spacer" />
        <Badge tone="warn">{tokenLabel(existing.token_no)}</Badge>
      </div>
      <p className="small" style={{ margin: 0 }}>{check.reason}</p>
      <div className="row wrap" style={{ gap: 8 }}>
        <AttendanceBadge appt={existing} />
        <span className="tiny faint">{a.label}{lateStamp(existing) ? ` at ${lateStamp(existing)}` : ''} · {check.count} token{check.count === 1 ? '' : 's'} today</span>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button size="sm" variant="primary" icon={Ticket} onClick={() => onUse?.(existing)}>
          Use {tokenLabel(existing.token_no)}
        </Button>
        {canArrive ? <Button size="sm" variant="subtle" icon={LogIn} onClick={() => onArrived?.(existing)}>Mark arrived</Button> : null}
        {canArrive || canReinstate
          ? <Button size="sm" variant="subtle" icon={RotateCcw} onClick={() => onArrivedLate?.(existing)}>Arrived late</Button>
          : null}
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>
        <BadgeCheck size={12} /> Printing, WhatsApp and billing all use the existing number. Nothing is written when a token is refused.
      </p>
    </div>
  );
}
