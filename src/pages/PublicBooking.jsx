import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AlertCircle, ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Clock, Copy,
  MapPin, MessageSquare, Phone, Ticket,
} from 'lucide-react';
import { useToast, Badge, Button, Field, Input, Spinner, Textarea } from '../components/ui.jsx';
import { formatMoney } from '../lib/logic.mjs';
import {
  BOOKING_HORIZON_DAYS, BOOKING_SLUG_FALLBACK, availabilityByDay, bookingApi, bookingDays,
  cleanRef, dayLabel, groupedSlots, isBookingRef, slotLabel, slotsForDay, validateBooking,
  whatsappShare,
} from '../lib/public-booking.mjs';

/**
 * /book/:slug — the only screen in the product that works without an account.
 *
 * Deliberately store-free: it talks to the booking API (demo workspace or the
 * security-definer RPCs) and never loads the clinic's workspace, so nothing about
 * the practice leaks into a page a stranger can open.
 */
export default function PublicBooking() {
  const { slug = BOOKING_SLUG_FALLBACK } = useParams();
  const toast = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [profile, setProfile] = useState(null);
  const [doctorId, setDoctorId] = useState(null);
  const [busy, setBusy] = useState([]);
  const [busyLoading, setBusyLoading] = useState(false);
  const [dayIso, setDayIso] = useState(null);
  const [time, setTime] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const [refLookup, setRefLookup] = useState('');

  const doctors = profile?.doctors ?? [];
  const doctor = doctors.find((d) => d.id === doctorId) ?? doctors[0] ?? null;
  const horizon = profile?.clinic?.booking_horizon_days || BOOKING_HORIZON_DAYS;
  const days = useMemo(() => bookingDays({ count: horizon }), [horizon]);

  /* ------------------------------------------------------------------- load */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    bookingApi.profile(slug)
      .then((data) => {
        if (!alive) return;
        if (!data) { setLoadError('No clinic is published at this address.'); return; }
        setProfile(data);
        if (data.enabled === false) return;
        const first = data.doctors?.[0] ?? null;
        setDoctorId(first?.id ?? null);
      })
      .catch((e) => alive && setLoadError(e.message ?? 'Could not reach the clinic.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [slug]);

  /* --------------------------------------------------- busy feed per doctor */
  useEffect(() => {
    if (!doctorId) return undefined;
    let alive = true;
    setBusyLoading(true);
    bookingApi.busy(slug, doctorId)
      .then((list) => {
        if (!alive) return;
        setBusy(list ?? []);
        // Land on the first day that actually has something free.
        const available = availabilityByDay({ doctor, days, busy: list ?? [] });
        const firstOpen = days.find((d) => (available.get(d.iso) ?? 0) > 0);
        setDayIso((current) => (current && (available.get(current) ?? 0) > 0 ? current : (firstOpen?.iso ?? days[0]?.iso)));
        setTime(null);
      })
      .catch(() => alive && setBusy([]))
      .finally(() => alive && setBusyLoading(false));
    return () => { alive = false; };
  }, [doctorId, slug, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const availability = useMemo(
    () => (doctor ? availabilityByDay({ doctor, days, busy }) : new Map()),
    [doctor, days, busy],
  );
  const slots = useMemo(
    () => (doctor && dayIso ? slotsForDay({ doctor, iso: dayIso, busy }) : []),
    [doctor, dayIso, busy],
  );
  const groups = useMemo(() => groupedSlots(slots), [slots]);
  const hasAnySlot = [...availability.values()].some((n) => n > 0);

  /* ----------------------------------------------------------------- submit */
  async function book(event) {
    event?.preventDefault?.();
    const found = validateBooking({ name, phone, reason });
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!doctor || !dayIso || !time) {
      toast.error('Pick a doctor, a date and a time first.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await bookingApi.book({ slug, doctorId: doctor.id, iso: dayIso, time, name, phone, reason });
      setConfirmed({ ...result, doctorName: result.doctor ?? doctor.full_name, time });
      setTime(null);
      setBusy(await bookingApi.busy(slug, doctor.id));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      if (e.code === 'slot-taken') {
        toast.error('That slot was just taken — pick another.');
        setTime(null);
        setBusy(await bookingApi.busy(slug, doctor.id).catch(() => busy));
      } else {
        toast.error(e.message ?? 'Could not book that slot.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setConfirmed(null);
    setTime(null);
    setReason('');
    setName('');
    setPhone('');
    setErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function copyRef() {
    const text = confirmed?.ref ?? '';
    navigator.clipboard?.writeText(text)
      .then(() => toast.success('Reference copied.'))
      .catch(() => toast.error('Clipboard blocked — read it out instead.'));
  }

  /* ------------------------------------------------------------------- views */
  if (loading) {
    return (
      <Shell>
        <div className="pub-card pad center stack" style={{ gap: 10, alignItems: 'center' }}>
          <Spinner size={22} />
          <p className="small muted" style={{ margin: 0 }}>Opening the diary…</p>
        </div>
      </Shell>
    );
  }

  if (loadError || !profile) {
    return (
      <Shell>
        <div className="pub-card pad stack" style={{ gap: 10 }}>
          <span className="kpi-icon danger"><AlertCircle size={16} /></span>
          <h1 className="pub-h1">Booking is not available</h1>
          <p className="small muted" style={{ margin: 0 }}>{loadError || 'This link does not match a clinic.'}</p>
          <p className="tiny faint" style={{ margin: 0 }}>
            Ask the clinic for their booking link, or call them directly.
          </p>
          <Link className="btn ghost" to="/"><ArrowLeft size={15} /> Back to myClinic</Link>
        </div>
      </Shell>
    );
  }

  if (profile.enabled === false) {
    return (
      <Shell clinic={profile.clinic}>
        <div className="pub-card pad stack" style={{ gap: 10 }}>
          <span className="kpi-icon warn"><Clock size={16} /></span>
          <h1 className="pub-h1">Online booking is closed</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {profile.clinic?.name} is not taking appointments from this page right now.
          </p>
          {profile.clinic?.phone ? (
            <a className="btn primary" href={`tel:${String(profile.clinic.phone).replace(/\s/g, '')}`}>
              <Phone size={15} /> Call {profile.clinic.phone}
            </a>
          ) : null}
        </div>
      </Shell>
    );
  }

  if (confirmed) {
    return (
      <Shell clinic={profile.clinic}>
        <div className="pub-card pad stack" style={{ gap: 14 }}>
          <span className="pub-tick"><Check size={22} strokeWidth={3} /></span>
          <div>
            <h1 className="pub-h1">Appointment confirmed</h1>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {confirmed.iso ? dayLabel(confirmed.iso) : dayLabel(dayIso)} at {slotLabel(confirmed.at ?? confirmed.time)} ·{' '}
              {confirmed.doctorName}
            </p>
          </div>

          <div className="pub-ref">
            <div>
              <span className="eyebrow">Your reference</span>
              <strong className="pub-ref-code">{confirmed.ref}</strong>
            </div>
            <Button size="sm" variant="subtle" icon={Copy} onClick={copyRef}>Copy</Button>
          </div>

          <p className="small muted" style={{ margin: 0 }}>
            Show this reference at the desk, or use it to cancel. Keep it — anyone with the
            reference can change this appointment.
          </p>

          <div className="row wrap" style={{ gap: 8 }}>
            <a
              className="btn subtle" target="_blank" rel="noopener noreferrer"
              href={whatsappShare({ phone, clinic: profile.clinic, iso: confirmed.iso ?? dayIso, time: confirmed.at ?? confirmed.time, doctor: confirmed.doctorName, ref: confirmed.ref })}
            >
              <MessageSquare size={15} /> Send to my phone
            </a>
            <Button variant="subtle" icon={CalendarDays} onClick={() => navigate(`/booking/${confirmed.ref}`)}>
              Manage booking
            </Button>
            <Button variant="ghost" icon={ArrowRight} onClick={reset}>Book another</Button>
          </div>

          <div className="pub-foot">
            <span>{profile.clinic.name}</span>
            {profile.clinic.address ? <span className="tiny muted">{profile.clinic.address}</span> : null}
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell clinic={profile.clinic}>
      <div className="pub-card pad stack" style={{ gap: 18 }}>
        <div>
          <h1 className="pub-h1">Book an appointment</h1>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {profile.clinic.clinic_type} · {doctors.length} doctor{doctors.length === 1 ? '' : 's'} · no account needed.
          </p>
        </div>

        {/* 1 — doctor */}
        <section className="pub-step">
          <StepHead n="1" title="Choose a doctor" />
          <div className="pub-doctors">
            {doctors.map((d) => (
              <button
                key={d.id} type="button"
                className={`pub-doctor ${doctor?.id === d.id ? 'selected' : ''}`}
                onClick={() => setDoctorId(d.id)}
                aria-pressed={doctor?.id === d.id}
              >
                <span className="pub-doc-avatar" style={{ background: d.color || 'var(--brand-500)' }}>
                  {d.full_name.replace(/^Dr\.?\s*/i, '').split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </span>
                <span className="pub-doc-main">
                  <strong className="small">{d.full_name}</strong>
                  <span className="tiny muted">{d.specialty}{d.qualification ? ` · ${d.qualification}` : ''}</span>
                  <span className="tiny faint">
                    {slotLabel(d.day_start)} – {slotLabel(d.day_end)} · {formatMoney(d.fee_paise)}
                  </span>
                </span>
                {doctor?.id === d.id ? <span className="pub-doc-tick"><Check size={13} strokeWidth={3} /></span> : null}
              </button>
            ))}
          </div>
        </section>

        {/* 2 — day and time */}
        <section className="pub-step">
          <StepHead n="2" title="Pick a date and time" sub="Next 14 days" />
          {busyLoading ? (
            <div className="row" style={{ gap: 8, padding: '10px 0' }}><Spinner size={16} /><span className="small muted">Checking the diary…</span></div>
          ) : null}

          {!hasAnySlot && !busyLoading ? (
            <div className="pub-empty">
              <Clock size={16} />
              <div>
                <strong className="small">No free slots in the next {horizon} days</strong>
                <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                  {profile.clinic.phone
                    ? `The diary is full. Call ${profile.clinic.phone} and the desk will fit you in.`
                    : 'The diary is full — please call the clinic.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="pub-days" role="tablist" aria-label="Choose a date">
                {days.map((d) => {
                  const free = availability.get(d.iso) ?? 0;
                  return (
                    <button
                      key={d.iso} type="button" role="tab" aria-selected={dayIso === d.iso}
                      className={`pub-day ${dayIso === d.iso ? 'selected' : ''} ${free ? '' : 'full'}`}
                      onClick={() => { setDayIso(d.iso); setTime(null); }}
                      disabled={!free}
                    >
                      <span className="tiny">{d.isToday ? 'Today' : d.isTomorrow ? 'Tmrw' : d.weekday}</span>
                      <strong>{d.day}</strong>
                      <span className="tiny faint">{d.month}</span>
                    </button>
                  );
                })}
              </div>

              <div className="pub-slots">
                {groups.length ? groups.map((group) => (
                  <div key={group.id} className="pub-slot-group">
                    <span className="eyebrow">{group.label}</span>
                    <div className="pub-slot-grid">
                      {group.slots.map((slot) => (
                        <button
                          key={slot.time} type="button"
                          className={`pub-slot ${time === slot.time ? 'selected' : ''}`}
                          onClick={() => setTime(slot.time)}
                          aria-pressed={time === slot.time}
                        >
                          {slotLabel(slot.time)}
                        </button>
                      ))}
                    </div>
                  </div>
                )) : (
                  <p className="small muted" style={{ margin: 0 }}>
                    {dayIso ? 'Nothing free on this day — try another date above.' : 'Choose a date above.'}
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        {/* 3 — details */}
        <section className="pub-step">
          <StepHead n="3" title="Your details" sub="The desk uses this to find or create your card" />
          <form className="stack" style={{ gap: 12 }} onSubmit={book} noValidate>
            <div className="pub-form">
              <Field label="Patient name" error={errors.name}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
              </Field>
              <Field label="Mobile number" error={errors.phone} hint="We use this to find your existing card.">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98200 11223" inputMode="tel" autoComplete="tel" />
              </Field>
            </div>
            <Field label="Reason for the visit" error={errors.reason} hint="Optional — the doctor sees it before you arrive.">
              <Textarea rows={2} maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Fever since yesterday, or a follow-up" />
            </Field>

            <div className={`pub-summary ${time ? 'ready' : ''}`}>
              {time && dayIso && doctor ? (
                <>
                  <CheckCircle2 size={16} />
                  <span className="small">
                    <strong>{dayLabel(dayIso)}</strong> at {slotLabel(time)} · {doctor.full_name}
                  </span>
                </>
              ) : (
                <>
                  <CalendarDays size={16} />
                  <span className="small muted">Pick a time above to continue.</span>
                </>
              )}
            </div>

            <Button type="submit" variant="primary" size="lg" block loading={submitting} disabled={!time}>
              Confirm appointment
            </Button>
            <p className="tiny faint" style={{ margin: 0 }}>
              By confirming you agree to be contacted about this appointment. No payment is taken here —
              you settle at the clinic.
            </p>
          </form>
        </section>

        <div className="pub-foot">
          <span>{profile.clinic.name}</span>
          {profile.clinic.address ? <span className="tiny muted"><MapPin size={11} /> {profile.clinic.address}</span> : null}
          {profile.clinic.phone ? <span className="tiny muted"><Phone size={11} /> {profile.clinic.phone}</span> : null}
          {profile.clinic.booking_note ? <span className="tiny muted">{profile.clinic.booking_note}</span> : null}
        </div>
      </div>

      {/* manage an existing booking, without an account */}
      <div className="pub-card pad stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="kpi-icon"><Ticket size={15} /></span>
          <strong className="small">Already booked?</strong>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          Enter the reference from your confirmation to see or cancel it.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <Input
            value={refLookup}
            onChange={(e) => setRefLookup(e.target.value.toUpperCase())}
            placeholder="BK-4K7P2Q"
            aria-label="Booking reference"
          />
          <Button
            variant="subtle" icon={ArrowRight}
            onClick={() => {
              const value = cleanRef(refLookup);
              if (!isBookingRef(value)) { toast.error('That does not look like a reference (BK-XXXXXX).'); return; }
              navigate(`/booking/${value}`);
            }}
          >
            Open
          </Button>
        </div>
      </div>

      <p className="pub-legal tiny faint">
        Powered by myClinic · <Link to="/">clinic software for OPD practices</Link>
      </p>
    </Shell>
  );
}

function Shell({ clinic, children }) {
  return (
    <div className="pub">
      <header className="pub-head">
        {clinic ? (
          <>
            <span className="pub-mark" style={{ background: clinic.brand_color || 'var(--brand-500)' }}>
              {String(clinic.name || 'C').trim()[0]?.toUpperCase()}
            </span>
            <div className="pub-head-main">
              <strong>{clinic.name}</strong>
              <span className="tiny muted">
                {clinic.clinic_type}
                {clinic.phone ? ` · ${clinic.phone}` : ''}
              </span>
            </div>
            {clinic.phone ? (
              <a className="icon-btn plain" aria-label={`Call ${clinic.name}`} href={`tel:${String(clinic.phone).replace(/\s/g, '')}`}>
                <Phone size={16} />
              </a>
            ) : null}
          </>
        ) : (
          <span className="pub-head-main"><strong>myClinic</strong><span className="tiny muted">Appointments</span></span>
        )}
      </header>
      <main className="pub-body stack" style={{ gap: 12 }}>{children}</main>
    </div>
  );
}

function StepHead({ n, title, sub }) {
  return (
    <div className="pub-step-head">
      <span className="pub-step-n">{n}</span>
      <div>
        <strong className="small">{title}</strong>
        {sub ? <span className="tiny muted" style={{ display: 'block' }}>{sub}</span> : null}
      </div>
    </div>
  );
}
