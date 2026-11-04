/**
 * Hours, day offs — the two editors Settings and Team share.
 *
 * A clinic day can have two sessions with a closed shutter between them
 * (9 AM–1 PM, 6 PM–10 PM). A doctor sits inside one of them. Both screens edit
 * the same shape, so both use these components and get the same validation.
 */
import { useMemo, useState } from 'react';
import { Button, Field, IconButton, Input } from './ui.jsx';
import { Plus, Trash2, CalendarOff, Clock } from 'lucide-react';
import {
  MAX_SESSIONS, WEEKDAYS, clockOf, minutesOf,
  sessionMinutes, sessionsSummary, validateDoctorSessions, validateSessions,
} from '../lib/hours.mjs';

/* ------------------------------------------------------------------ sessions */

export function SessionEditor({
  value = [], onChange, label = 'Working hours', max = MAX_SESSIONS,
  clinicHours = null, disabled = false, hint = '',
}) {
  const rows = Array.isArray(value) ? value : [];
  const check = useMemo(
    () => (clinicHours ? validateDoctorSessions(rows, clinicHours, { label }) : validateSessions(rows, { label, max })),
    [rows, clinicHours, label, max],
  );

  const setRow = (index, patch) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange(next);
  };
  const addRow = () => {
    const last = rows[rows.length - 1];
    const start = last ? clockOf(Math.min(23 * 60 + 30, minutesOf(last.end) + 60)) : '09:00';
    onChange([...rows, { start, end: clockOf(Math.min(23 * 60 + 45, minutesOf(start) + 180)) }]);
  };
  const removeRow = (index) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.length === 0 ? (
        <div className="small muted">No hours set — patients see no slots until you add one.</div>
      ) : null}

      {rows.map((row, i) => {
        const length = sessionMinutes(row);
        return (
          <div key={`session-${i}`} className="session-row">
            <div style={{ flex: 1 }}>
              <Field label={i === 0 ? 'Session 1 starts' : `Session ${i + 1} starts`}>
                <Input type="time" disabled={disabled} value={String(row.start ?? '').slice(0, 5)}
                  onChange={(e) => setRow(i, { start: e.target.value })} />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Ends">
                <Input type="time" disabled={disabled} value={String(row.end ?? '').slice(0, 5)}
                  onChange={(e) => setRow(i, { end: e.target.value })} />
              </Field>
            </div>
            <span className="small muted session-length" style={{ paddingBottom: 11, minWidth: 46, textAlign: 'right' }}>
              {length ? `${Math.floor(length / 60)}h ${length % 60 ? `${length % 60}m` : ''}`.trim() : '—'}
            </span>
            <IconButton icon={Trash2} label={`Remove session ${i + 1}`} size={15} disabled={disabled}
              onClick={() => removeRow(i)} style={{ marginBottom: 4 }} />
          </div>
        );
      })}

      <div className="row" style={{ gap: 8 }}>
        {rows.length < max ? (
          <Button type="button" size="sm" variant="ghost" icon={Plus} disabled={disabled} onClick={addRow}>
            Add a second session
          </Button>
        ) : (
          <span className="small muted">Two sessions is the maximum — a patient cannot be given a slot in the break.</span>
        )}
        {rows.length ? (
          <span className="small muted"><Clock size={12} style={{ verticalAlign: -2 }} /> {sessionsSummary(rows)}</span>
        ) : null}
      </div>

      {check.error ? <div className="small" style={{ color: 'var(--danger)' }}>{check.error}</div> : null}
      {hint && !check.error ? <div className="small muted">{hint}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- day off */

export function DayOffEditor({
  weekdays = [], dates = [], onWeekdays, onDates, disabled = false,
  inheritNote = '', label = 'Closed days',
}) {
  const [draft, setDraft] = useState('');
  const days = Array.isArray(weekdays) ? weekdays.map(Number) : [];
  const holidays = Array.isArray(dates) ? dates : [];
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(draft) && !holidays.includes(draft);

  const toggle = (id) => {
    const next = days.includes(id) ? days.filter((d) => d !== id) : [...days, id];
    onWeekdays?.(next.sort((a, b) => a - b));
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="small muted">{label} — the diary closes on these weekdays every week.</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {WEEKDAYS.map((d) => {
          const on = days.includes(d.id);
          return (
            <button
              key={d.id} type="button" disabled={disabled} aria-pressed={on}
              title={on ? `${d.label} is a day off` : `Mark ${d.label} as a day off`}
              onClick={() => toggle(d.id)}
              style={{
                minWidth: 52, padding: '7px 10px', borderRadius: 999, cursor: disabled ? 'not-allowed' : 'pointer',
                border: `1px solid ${on ? 'var(--danger)' : 'var(--border)'}`,
                background: on ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : 'var(--surface)',
                color: on ? 'var(--danger)' : 'var(--text)', fontWeight: on ? 600 : 400, fontSize: 12,
              }}
            >
              {d.short}
            </button>
          );
        })}
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Field label="One-off holiday or leave">
            <Input type="date" disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
        </div>
        <Button type="button" size="sm" icon={CalendarOff} disabled={disabled || !validDate}
          onClick={() => { onDates?.([...holidays, draft].sort()); setDraft(''); }}>
          Add day
        </Button>
      </div>

      {holidays.length ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {holidays.map((d) => (
            <span key={d} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              <button type="button" className="icon-btn plain sm" aria-label={`Remove ${d}`} disabled={disabled}
                onClick={() => onDates?.(holidays.filter((x) => x !== d))}><Trash2 size={12} /></button>
            </span>
          ))}
        </div>
      ) : (
        <div className="small muted">No one-off days yet. A holiday added here closes the diary for that date only.</div>
      )}

      {inheritNote ? <div className="small muted">{inheritNote}</div> : null}
    </div>
  );
}

export default SessionEditor;
