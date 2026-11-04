import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, Clock, MapPin, Phone, Stethoscope, XCircle,
} from 'lucide-react';
import { useToast, Badge, Button, ConfirmDialog, Spinner } from '../components/ui.jsx';
import { bookingApi, cleanRef, dayLabel, publicStatus, slotLabel } from '../lib/public-booking.mjs';

/**
 * /booking/:ref — the patient's own view of one appointment.
 *
 * The reference is the credential: it is the only thing this page accepts, it is
 * not guessable, and the RPC behind it returns exactly one booking — never a
 * patient list. Cancelling is allowed until the day of the visit.
 */
export default function BookingManage() {
  const { ref: rawRef } = useParams();
  const ref = cleanRef(rawRef);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    bookingApi.lookup(ref)
      .then((data) => { if (alive) setBooking(data); })
      .catch((e) => alive && setError(e.message ?? 'Could not open that booking.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [ref]);

  async function cancel() {
    setWorking(true);
    try {
      const result = await bookingApi.cancel(ref);
      if (result?.cancelled) {
        setBooking((b) => ({ ...b, status: 'cancelled' }));
        toast.success('Appointment cancelled.');
      } else if (result?.status === 'past') {
        toast.error('That appointment has already passed — call the clinic.');
      } else {
        toast.error('This booking cannot be cancelled here.');
      }
      setConfirmOpen(false);
    } catch (e) {
      toast.error(e.message ?? 'Could not cancel.');
    } finally {
      setWorking(false);
    }
  }

  const status = publicStatus(booking?.status);
  const canCancel = booking && booking.status === 'booked';

  return (
    <div className="pub">
      <header className="pub-head">
        <span className="pub-mark" style={{ background: 'var(--brand-500)' }}>M</span>
        <div className="pub-head-main">
          <strong>{booking?.clinic ?? 'Your appointment'}</strong>
          <span className="tiny muted">Reference {ref}</span>
        </div>
        {booking?.phone ? (
          <a className="icon-btn plain" aria-label="Call the clinic" href={`tel:${String(booking.phone).replace(/\s/g, '')}`}>
            <Phone size={16} />
          </a>
        ) : null}
      </header>

      <main className="pub-body stack" style={{ gap: 12 }}>
        {loading ? (
          <div className="pub-card pad center stack" style={{ gap: 10, alignItems: 'center' }}>
            <Spinner size={22} />
            <p className="small muted" style={{ margin: 0 }}>Looking up your appointment…</p>
          </div>
        ) : error || !booking ? (
          <div className="pub-card pad stack" style={{ gap: 10 }}>
            <span className="kpi-icon danger"><AlertCircle size={16} /></span>
            <h1 className="pub-h1">No appointment found</h1>
            <p className="small muted" style={{ margin: 0 }}>
              {error || `Nothing matches the reference ${ref}. Check the letters and digits and try again.`}
            </p>
            <Link className="btn ghost" to="/book"><ArrowLeft size={15} /> Book an appointment</Link>
          </div>
        ) : (
          <div className="pub-card pad stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
              <h1 className="pub-h1">Hello {booking.patient_first}</h1>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>

            <div className="pub-detail">
              <div>
                <span className="pub-detail-icon"><CalendarDays size={15} /></span>
                <div>
                  <strong className="small">{dayLabel(booking.iso)}</strong>
                  <span className="tiny muted" style={{ display: 'block' }}>
                    <Clock size={11} /> {slotLabel(booking.at)} · {booking.doctor}
                  </span>
                </div>
              </div>
              {booking.address ? (
                <div>
                  <span className="pub-detail-icon"><MapPin size={15} /></span>
                  <div><span className="small muted">{booking.address}</span></div>
                </div>
              ) : null}
              <div>
                <span className="pub-detail-icon"><Stethoscope size={15} /></span>
                <div><span className="small muted">Bring any previous prescriptions or reports.</span></div>
              </div>
            </div>

            {canCancel ? (
              <>
                <Button variant="danger" block icon={XCircle} loading={working} onClick={() => setConfirmOpen(true)}>
                  Cancel this appointment
                </Button>
                <p className="tiny faint" style={{ margin: 0 }}>
                  Cancelling frees the slot for someone else. To move to another time, cancel and book again.
                </p>
              </>
            ) : booking.status === 'cancelled' ? (
              <div className="pub-empty">
                <CheckCircle2 size={16} />
                <div>
                  <strong className="small">This appointment is cancelled</strong>
                  <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                    Nothing is owed and the slot has been released.
                  </p>
                </div>
              </div>
            ) : (
              <div className="pub-empty">
                <Clock size={16} />
                <div>
                  <strong className="small">This appointment can no longer be changed here</strong>
                  <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                    {booking.phone ? `Call ${booking.phone} and the desk will help.` : 'Please call the clinic.'}
                  </p>
                </div>
              </div>
            )}

            <div className="row wrap" style={{ gap: 8 }}>
              <Link className="btn subtle" to="/book"><CalendarDays size={15} /> Book another time</Link>
              {booking.phone ? (
                <a className="btn ghost" href={`tel:${String(booking.phone).replace(/\s/g, '')}`}><Phone size={15} /> Call the clinic</a>
              ) : null}
            </div>
          </div>
        )}

        <p className="pub-legal tiny faint">
          Powered by myClinic · <Link to="/">clinic software for OPD practices</Link>
        </p>
      </main>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={cancel}
        title="Cancel this appointment?"
        body={`${dayLabel(booking?.iso)} at ${slotLabel(booking?.at)} with ${booking?.doctor}. The slot goes back into the diary immediately.`}
        confirmLabel="Yes, cancel it"
        danger
      />
    </div>
  );
}
