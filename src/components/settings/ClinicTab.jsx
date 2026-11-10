/**
 * Clinic profile, consulting hours, days off and the public booking switch — one
tab, one file. Extracted verbatim from Settings.jsx in v1.30.0
 * (docs/ARCHITECTURE.md §3 step 4) — markup and copy unchanged.
 */

import {FOLLOW_UP_MAX_DAYS, FOLLOW_UP_MIN_DAYS} from '../../lib/hours.mjs';
import {CLINIC_TYPES} from '../../lib/logic.mjs';
import {can} from '../../lib/permissions.js';
import {BOOKING_HORIZON_DAYS, bookingUrl, clinicSlug} from '../../lib/public-booking.mjs';
import {DayOffEditor, SessionEditor} from '../HoursEditor.jsx';
import {Badge, Button, Card, CardHead, Field, Input, Select} from '../ui.jsx';
import {Building2, CalendarDays, CalendarOff, Clock, Copy, ExternalLink, Save} from 'lucide-react';
import {useStore} from '../../lib/store.jsx';
import {useNavigate} from 'react-router';
import {useToast} from '../ui.jsx';

export default function ClinicTab({ clinic, setClinic, saveClinic, saving, followUpError, nextClosedLine, profile, savedSlug, publicLink, slugPending }) {
  const store = useStore();
  const role = store.role ?? 'owner';
  const canEdit = can(role, 'clinic:settings');
  const clinicState = store.clinic ?? {};
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <>
        <Card>
          <CardHead title="Clinic profile" sub="Appears on invoices, prescriptions and reminders" icon={Building2}
            action={<Button size="sm" variant="primary" icon={Save} onClick={saveClinic} loading={saving}>Save</Button>} />
          <div className="card-body">
            <div className="form-grid">
              <Field label="Clinic name" className="span-2"><Input value={clinic.name ?? ''} onChange={(e) => setClinic((c) => ({ ...c, name: e.target.value }))} /></Field>
              <Field label="Clinic type"><Select value={clinic.clinic_type ?? CLINIC_TYPES[0]} onChange={(e) => setClinic((c) => ({ ...c, clinic_type: e.target.value }))}>{CLINIC_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Phone"><Input value={clinic.phone ?? ''} onChange={(e) => setClinic((c) => ({ ...c, phone: e.target.value }))} /></Field>
              <Field label="Email"><Input value={clinic.email ?? ''} onChange={(e) => setClinic((c) => ({ ...c, email: e.target.value }))} /></Field>
              <Field label="GSTIN" hint="Leave blank if not registered"><Input value={clinic.gstin ?? ''} onChange={(e) => setClinic((c) => ({ ...c, gstin: e.target.value }))} /></Field>
              <Field label="Address" className="span-2"><Input value={clinic.address ?? ''} onChange={(e) => setClinic((c) => ({ ...c, address: e.target.value }))} /></Field>
              <Field label="Default slot length">
                <Select value={clinic.slot_minutes ?? 15} onChange={(e) => setClinic((c) => ({ ...c, slot_minutes: Number(e.target.value) }))}>
                  {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                </Select>
              </Field>
              <Field label="Follow-up validity (days)" hint={`${FOLLOW_UP_MIN_DAYS}–${FOLLOW_UP_MAX_DAYS} days`} error={followUpError}>
                <Input type="number" min={FOLLOW_UP_MIN_DAYS} max={FOLLOW_UP_MAX_DAYS} step={1}
                  value={clinic.follow_up_days ?? ''}
                  onChange={(e) => setClinic((c) => ({ ...c, follow_up_days: e.target.value === '' ? '' : Number(e.target.value) }))} />
              </Field>
              <Field label="Consultation fee ₹"><Input value={clinic.fee} onChange={(e) => setClinic((c) => ({ ...c, fee: e.target.value }))} inputMode="decimal" /></Field>
              <Field label="Follow-up fee ₹"><Input value={clinic.follow_up_fee} onChange={(e) => setClinic((c) => ({ ...c, follow_up_fee: e.target.value }))} inputMode="decimal" /></Field>
              <Field label="Brand colour">
                <div className="row" style={{ gap: 6 }}>
                  {['#0f766e', '#3d7fb8', '#7c5cd6', '#0f7d63', '#c0455a', '#c2872b'].map((c) => (
                    <button key={c} type="button" aria-label={`Brand colour ${c}`} onClick={() => setClinic((x) => ({ ...x, brand_color: c }))}
                      style={{ width: 26, height: 26, borderRadius: 8, background: c, border: clinic.brand_color === c ? '2px solid var(--text)' : '1px solid var(--border)', cursor: 'pointer' }} />
                  ))}
                </div>
              </Field>
            </div>

            <div className="stack" style={{ gap: 10, marginTop: 14 }}>
              <div className="row" style={{ gap: 8 }}>
                <Clock size={15} className="muted" />
                <strong className="small">Consulting hours</strong>
                <span className="small muted">Up to two sessions a day — the break between them is never offered as a slot.</span>
              </div>
              <SessionEditor
                label="Clinic hours"
                value={clinic.sessions}
                disabled={!canEdit}
                hint="A patient can only be booked inside one of these sessions. A doctor is then given one of them."
                onChange={(sessions) => setClinic((c) => ({ ...c, sessions }))}
              />
            </div>
          </div>
        </Card>
        <Card>
          <CardHead
            title="Days the clinic is closed" icon={CalendarOff}
            sub="Weekly days off and one-off holidays — no slots are offered on these days"
            action={<Badge tone={(clinic.closed_weekdays ?? []).length || (clinic.closed_dates ?? []).length ? 'warn' : 'neutral'}>
              {(clinic.closed_weekdays ?? []).length + (clinic.closed_dates ?? []).length} closed
            </Badge>}
          />
          <div className="card-body">
            <DayOffEditor
              weekdays={clinic.closed_weekdays}
              dates={clinic.closed_dates}
              disabled={!canEdit}
              onWeekdays={(closed_weekdays) => setClinic((c) => ({ ...c, closed_weekdays }))}
              onDates={(closed_dates) => setClinic((c) => ({ ...c, closed_dates }))}
            />
            <div className="small muted" style={{ marginTop: 10 }}>
              {nextClosedLine}
            </div>
          </div>
        </Card>
        <Card>
          <CardHead
            title="Public booking" icon={CalendarDays}
            sub="A page patients can open without an account — share the link anywhere"
            action={<Badge tone={clinicState.booking_enabled === false ? 'neutral' : 'success'}>{clinicState.booking_enabled === false ? 'Closed' : 'Open'}</Badge>}
          />
          <div className="card-body stack">
            <label className="check">
              <input
                type="checkbox" disabled={!canEdit}
                checked={clinicState.booking_enabled !== false}
                onChange={(e) => setClinic((c) => ({ ...c, booking_enabled: e.target.checked }))}
              />
              <span>
                <strong className="small">Accept appointments from the booking link</strong>
                <span className="tiny muted" style={{ display: 'block' }}>
                  Patients pick a free slot themselves; the appointment lands on your calendar with source
                  “Booked online”. Turn this off and the page shows your phone number instead.
                </span>
              </span>
            </label>

            <Field
              label="Booking link"
              hint={savedSlug
                ? 'Paste it on WhatsApp, your Google listing, or print the QR at the desk.'
                : 'This clinic has no link yet — press “Save booking settings” and one is created from the link name below.'}
            >
              <div className="row" style={{ gap: 8 }}>
                <Input
                  readOnly value={publicLink} onFocus={(e) => e.target.select()} aria-label="Public booking link"
                  placeholder="Not created yet"
                />
                <Button
                  size="sm" variant="subtle" icon={Copy} type="button" disabled={!savedSlug}
                  onClick={() => navigator.clipboard?.writeText(bookingUrl(savedSlug))
                    .then(() => toast.success('Booking link copied.'))
                    .catch(() => toast.error('Clipboard blocked.'))}
                >
                  Copy
                </Button>
                <Button
                  size="sm" variant="ghost" icon={ExternalLink} type="button" disabled={!savedSlug}
                  onClick={() => navigate(`/book/${savedSlug}`)}
                >
                  Open
                </Button>
              </div>
            </Field>

            <div className="form-grid">
              <Field
                label="Link name"
                hint={!slugPending
                  ? 'Lowercase, no spaces — this is the last part of the link.'
                  : savedSlug
                    ? `Not saved yet — patients stay on /book/${savedSlug} until you save.`
                    : 'Not saved yet — saving creates this link.'}
              >
                <Input
                  value={clinicState.slug ?? ''} disabled={!canEdit}
                  onChange={(e) => setClinic((c) => ({ ...c, slug: clinicSlug(e.target.value) }))}
                  onBlur={(e) => setClinic((c) => ({ ...c, slug: clinicSlug(e.target.value || clinicState.name) }))}
                  placeholder={clinicSlug(clinicState.name) || 'your-clinic'}
                  aria-label="Booking link name"
                />
              </Field>
              <Field label="Diary opens for" hint="How far ahead a stranger may book.">
                <Select
                  value={clinicState.booking_horizon_days ?? BOOKING_HORIZON_DAYS} disabled={!canEdit}
                  onChange={(e) => setClinic((c) => ({ ...c, booking_horizon_days: Number(e.target.value) }))}
                >
                  {[7, 14, 21, 30].map((d) => <option key={d} value={d}>Next {d} days</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Note shown to patients" hint="Optional — arrival time, parking, what to bring.">
              <Input
                value={clinicState.booking_note ?? ''} maxLength={120} disabled={!canEdit}
                onChange={(e) => setClinic((c) => ({ ...c, booking_note: e.target.value }))}
                placeholder="Reach 15 minutes before your slot."
              />
            </Field>

            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" icon={Save} onClick={saveClinic} loading={saving} disabled={!canEdit}>
                Save booking settings
              </Button>
              <Button variant="ghost" icon={ExternalLink} disabled={!savedSlug} onClick={() => navigate(`/book/${savedSlug}`)}>
                Preview what patients see
              </Button>
            </div>
            <p className="tiny faint" style={{ margin: 0 }}>
              No account, no payment and no clinical detail crosses this page. A patient can cancel with the
              reference they were given; you keep the record either way.
            </p>
          </div>
        </Card>
    </>
  );
}
