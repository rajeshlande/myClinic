import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './lib/auth-context.jsx';
import { StoreProvider, useStore } from './lib/store.jsx';
import { Spinner } from './components/ui.jsx';
import { RequireCapability } from './components/RequireCapability.jsx';

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Setup from './pages/Setup.jsx';
import AppLayout from './components/AppLayout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Queue from './pages/Queue.jsx';
import Appointments from './pages/Appointments.jsx';
import Patients from './pages/Patients.jsx';
import PatientDetail from './pages/PatientDetail.jsx';
import Consultations from './pages/Consultations.jsx';
import Billing from './pages/Billing.jsx';
import FollowUps from './pages/FollowUps.jsx';
import DayClose from './pages/DayClose.jsx';
import Team from './pages/Team.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Subscription from './pages/Subscription.jsx';

const InvoiceView = lazy(() => import('./pages/InvoiceView.jsx'));
const PrescriptionView = lazy(() => import('./pages/PrescriptionView.jsx'));
// The public booking pages are split out: they are the only screens an
// unauthenticated visitor can reach, and staff never need them in the app bundle.
const PublicBooking = lazy(() => import('./pages/PublicBooking.jsx'));
const BookingManage = lazy(() => import('./pages/BookingManage.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [pathname]);
  return null;
}

function Loading({ label = 'Opening your clinic…' }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', gap: 10, color: 'var(--muted)' }}>
      <div className="stack" style={{ alignItems: 'center', gap: 10 }}>
        <Spinner size={26} />
        <span className="small">{label}</span>
      </div>
    </div>
  );
}

/** Blocks the app shell until clinic data is loaded (or sends to onboarding). */
function DataGate({ children }) {
  const store = useStore();
  const { user } = useAuth();
  if (!store.ready) return <Loading />;
  if (store.mode === 'live' && !user) return <Navigate to="/login" replace />;
  if (store.needsOnboarding) return <Navigate to="/onboarding" replace />;
  return children;
}

/**
 * A patient's link (`/#/book/<clinic>`, `/#/booking/<ref>`) is not part of the
 * staff workspace, so it must not wait for one.
 *
 * These three routes used to sit inside <StoreProvider> alongside the app, which
 * meant a stranger who opened a booking link at 9pm watched "Opening your clinic…"
 * while the clinic's whole workspace — patients, invoices, the diary — loaded (or
 * failed to) on their phone. They now render on their own, from the booking RPCs,
 * and nothing about the practice is fetched to show them.
 */
function PublicScreen() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<Loading label="Opening the booking page…" />}>
        <Routes>
          <Route path="/book" element={<PublicBooking />} />
          <Route path="/book/:slug" element={<PublicBooking />} />
          <Route path="/booking/:ref" element={<BookingManage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

/** Every path a patient, not a member of staff, can open. */
const PUBLIC_SCREEN = /^\/(book(\/|$)|booking\/)/;

export default function App() {
  const { pathname } = useLocation();
  if (PUBLIC_SCREEN.test(pathname)) return <PublicScreen />;
  return <ClinicApp />;
}

function ClinicApp() {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;

  return (
    <StoreProvider session={session}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<Landing anchor="pricing" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/onboarding" element={<Onboarding />} />

        <Route path="/app" element={<DataGate><AppLayout /></DataGate>}>
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="queue" element={<Queue />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="patients" element={<Patients />} />
          <Route path="patients/:id" element={<PatientDetail />} />
          <Route path="consultations" element={<RequireCapability capability="consultation:read"><Consultations /></RequireCapability>} />
          <Route path="billing" element={<RequireCapability capability="invoice:read"><Billing /></RequireCapability>} />
          <Route path="day-close" element={<RequireCapability capability="invoice:collect"><DayClose /></RequireCapability>} />
          <Route path="follow-ups" element={<RequireCapability capability="consultation:read"><FollowUps /></RequireCapability>} />
          <Route path="team" element={<RequireCapability capability="team:read"><Team /></RequireCapability>} />
          <Route path="reports" element={<RequireCapability capability="clinic:reports"><Reports /></RequireCapability>} />
          <Route path="subscription" element={<RequireCapability capability="clinic:settings"><Subscription /></RequireCapability>} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* The booking screens live in <PublicScreen>, outside this shell. */}

        {/* The printable views are routes of their own, so they carry the same
            capability as the screens that link to them. */}
        <Route path="/invoice/:id" element={<RequireCapability capability="invoice:read"><Suspense fallback={<Loading />}><InvoiceView /></Suspense></RequireCapability>} />
        <Route path="/prescription/:id" element={<RequireCapability capability="consultation:read"><Suspense fallback={<Loading />}><PrescriptionView /></Suspense></RequireCapability>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StoreProvider>
  );
}
