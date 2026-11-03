import { useMemo } from 'react';
import {
  CalendarPlus, CheckCircle2, Clock, LogIn, Pencil, PlayCircle, UserX, X,
} from 'lucide-react';
import { Avatar, Badge, Button, Card, CardHead, EmptyState, IconButton } from './ui.jsx';
import {
  DEAD_STATUSES, LIVE_STATUSES, buildDayBoard, intervalOf, nowMinutes, time,
} from '../lib/schedule.mjs';
import { formatSlotRange, statusMeta } from '../lib/logic.mjs';

const STATE_STYLE = {
  free: { background: 'var(--surface)', border: '1px dashed var(--border)', cursor: 'pointer' },
  past: { background: 'var(--surface-2)', border: '1px solid var(--border)', opacity: 0.55, cursor: 'pointer' },
  booked: { background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'default' },
  live: { background: 'var(--brand-50)', border: '1px solid var(--brand-500)', cursor: 'default' },
  done: { background: 'var(--surface-2)', border: '1px solid var(--border)', cursor: 'default' },
};

/**
 * The day board. One column per doctor, one row per slot, blocks sized by the
 * appointment's real duration so a 30-minute visit covers two 15-minute rows.
 */
export function DayBoard({
  doctors, appointments, iso, duration = 15, now = new Date(),
  onNew, onEdit, onStatus, onConsult, onCancel, onPatient,
}) {
  const board = useMemo(
    () => buildDayBoard({ doctors, appointments, iso, now, duration }),
    [doctors, appointments, iso, duration, now],
  );
  const nowM = nowMinutes(iso, now);

  if (!board.columns.length) {
    return (
      <Card>
        <div className="card-body">
          <EmptyState title="No doctors configured" description="Add a doctor under Doctors & staff to start booking slots." />
        </div>
      </Card>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {board.columns.map((column) => (
        <Card key={column.doctor.id}>
          <CardHead
            title={column.doctor.full_name}
            icon={Clock}
            sub={`${column.doctor.specialty} · ${time(column.open)}–${time(column.close)} · ${column.doctor.slot_minutes || 15} min slots`}
            action={(
              <div className="row wrap" style={{ gap: 8 }}>
                <Badge tone={column.stats.free ? 'success' : 'warn'}>{column.stats.free} free</Badge>
                <Badge tone="neutral">{column.stats.total} booked</Badge>
                <Badge tone="brand">{column.stats.utilisation}% full</Badge>
                <Button
                  size="sm" variant="subtle" icon={CalendarPlus}
                  onClick={() => {
                    const free = column.slots.find((s) => s.state === 'free') ?? column.slots[0];
                    onNew(free?.time ?? time(column.open), column.doctor.id);
                  }}
                >
                  Add
                </Button>
              </div>
            )}
          />
          <div className="card-body" style={{ paddingTop: 10 }}>
            {/* utilisation bar */}
            <div style={{ height: 5, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ width: `${column.stats.utilisation}%`, height: '100%', background: 'var(--brand-500)', borderRadius: 99, transition: 'width .3s var(--ease)' }} />
            </div>

            <div className="day-grid" role="list" aria-label={`${column.doctor.full_name} schedule`}>
              {column.slots.map((slot) => (
                <SlotCell
                  key={slot.time}
                  slot={slot}
                  iso={iso}
                  nowM={nowM}
                  doctor={column.doctor}
                  onNew={onNew}
                  onEdit={onEdit}
                  onStatus={onStatus}
                  onConsult={onConsult}
                  onCancel={onCancel}
                  onPatient={onPatient}
                />
              ))}
            </div>

            {column.offGrid.length ? (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                <span className="tiny faint">Off-grid bookings</span>
                {column.offGrid.map((appt) => (
                  <OffGridRow
                    key={appt.id} appt={appt} doctor={column.doctor}
                    onEdit={onEdit} onStatus={onStatus} onConsult={onConsult} onCancel={onCancel} onPatient={onPatient}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      ))}

      {/* next-free shortcut */}
      {board.summary.nextFree ? (
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <span className="tiny muted">Next free across the clinic:</span>
          <Button
            size="sm" variant="subtle" icon={CalendarPlus}
            onClick={() => onNew(board.summary.nextFree.time, board.summary.nextFree.doctor_id)}
          >
            {board.summary.nextFree.time} today
          </Button>
          <span className="tiny faint">· {board.summary.utilization}% of clinic time is booked</span>
        </div>
      ) : null}
    </div>
  );
}

function SlotCell({ slot, iso, nowM, doctor, onNew, onEdit, onStatus, onConsult, onCancel, onPatient }) {
  const style = STATE_STYLE[slot.state] ?? STATE_STYLE.free;
  const span = Math.max(1, Math.round(intervalOf(slot.appointment ?? { duration_minutes: 15 }).duration / 15));

  if (!slot.appointment) {
    return (
      <button
        type="button"
        role="listitem"
        className={`slot ${slot.state}`}
        onClick={() => onNew(slot.time, doctor.id)}
        style={{ ...style, minHeight: 58 }}
        aria-label={`Book ${slot.time} with ${doctor.full_name}`}
      >
        <span className="slot-time">{slot.time}</span>
        <span className="slot-hint">{slot.state === 'past' ? 'Past — book anyway' : 'Available'}</span>
        <CalendarPlus size={13} className="slot-icon" />
      </button>
    );
  }

  const appt = slot.appointment;
  const meta = statusMeta(appt.status);
  const patient = appt.patient ?? null;
  const isNow = iso && nowM >= slot.start && nowM < slot.start + intervalOf(appt).duration;

  return (
    <div
      role="listitem"
      className={`slot booked ${slot.state} ${isNow ? 'now' : ''}`}
      style={{ ...style, gridRow: `span ${span}`, minHeight: 58 * span }}
    >
      <div className="slot-top">
        <span className="slot-time">{slot.time}</span>
        <span className={`slot-status tone-${meta.tone}`}>{meta.label}</span>
        {isNow ? <span className="slot-now">now</span> : null}
      </div>
      <button className="slot-who" type="button" onClick={() => onPatient(appt.patient_id)}>
        <b className="truncate">{patient?.full_name ?? 'Patient'}</b>
        <span className="tiny muted truncate">{appt.kind}</span>
      </button>
      <div className="slot-actions no-print">
        {appt.status === 'booked' ? (
          <>
            <Button size="sm" variant="subtle" icon={LogIn} onClick={() => onStatus(appt, 'checked-in', 'Patient checked in.')}>In</Button>
            <IconButton icon={UserX} label="Mark no-show" size={13} className="plain sm" onClick={() => onStatus(appt, 'no-show', 'Marked as a no-show.')} />
          </>
        ) : null}
        {appt.status === 'checked-in' ? <Button size="sm" variant="primary" icon={PlayCircle} onClick={() => onConsult(appt)}>Start</Button> : null}
        {appt.status === 'in-consult' ? <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => onConsult(appt)}>Resume</Button> : null}
        {appt.status === 'completed' ? (
          <Button size="sm" variant="subtle" onClick={() => onConsult(appt)}>Open note</Button>
        ) : null}
        <span className="spacer" />
        <IconButton icon={Pencil} label="Reschedule" size={12} className="plain sm" onClick={() => onEdit(appt)} />
        {!DEAD_STATUSES.includes(appt.status) && appt.status !== 'completed'
          ? <IconButton icon={X} label="Cancel" size={12} className="plain sm" onClick={() => onCancel(appt)} />
          : null}
      </div>
    </div>
  );
}

function OffGridRow({ appt, doctor, onEdit, onStatus, onConsult, onCancel, onPatient }) {
  const meta = statusMeta(appt.status);
  const iv = intervalOf(appt);
  return (
    <div className="row" style={{ gap: 8, padding: '6px 8px', borderRadius: 9, background: 'var(--surface-2)' }}>
      <span className="tiny mono faint">{formatSlotRange(time(iv.start), iv.duration)}</span>
      <button className="slot-who" type="button" onClick={() => onPatient(appt.patient_id)} style={{ flex: 1 }}>
        <b className="truncate small">{appt.patient?.full_name ?? 'Patient'}</b>
      </button>
      <Badge tone={meta.tone}>{meta.label}</Badge>
      {LIVE_STATUSES.includes(appt.status) ? <Button size="sm" variant="primary" onClick={() => onConsult(appt)}>Consult</Button> : null}
      <IconButton icon={Pencil} label="Reschedule" size={12} className="plain sm" onClick={() => onEdit(appt)} />
      <IconButton icon={X} label="Cancel" size={12} className="plain sm" onClick={() => onCancel(appt)} />
    </div>
  );
}

/**
 * Week view: doctors down the side, days across the top, one load bar per cell.
 * Clicking a cell jumps to that doctor on that day.
 */
export function WeekGrid({ rows, days, onPick, selectedDoctorId }) {
  return (
    <Card>
      <CardHead
        title="Week at a glance"
        sub="Load per doctor per day — click a cell to open that day"
        icon={Clock}
      />
      <div className="card-body" style={{ paddingTop: 8, overflowX: 'auto' }}>
        <table className="week-grid">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Doctor</th>
              {days.map((d) => (
                <th key={d.iso} className={d.isToday ? 'today' : ''}>
                  <span className="wk-day">{d.weekday}</span>
                  <span className="wk-num">{d.day}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ doctor, cells }) => (
              <tr key={doctor.id} className={selectedDoctorId === doctor.id ? 'selected' : ''}>
                <td>
                  <div className="row" style={{ gap: 7 }}>
                    <Avatar name={doctor.full_name} size="sm" tone={doctor.color} />
                    <div style={{ minWidth: 0 }}>
                      <div className="small strong truncate">{doctor.full_name}</div>
                      <div className="tiny faint truncate">{doctor.specialty}</div>
                    </div>
                  </div>
                </td>
                {cells.map((cell) => (
                  <td key={cell.iso}>
                    <button
                      type="button"
                      className={`week-cell ${cell.total ? 'has' : ''}`}
                      onClick={() => onPick(cell.iso, doctor.id)}
                      title={`${cell.total} booked · ${cell.free} free slots`}
                    >
                      <span className="week-count">{cell.total || '—'}</span>
                      <span className="week-bar">
                        <span style={{ width: `${Math.min(100, cell.utilization)}%` }} />
                      </span>
                      <span className="tiny faint">{cell.free ? `${cell.free} free` : 'full'}</span>
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

