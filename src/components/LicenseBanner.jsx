import { AlertTriangle, Check, Download, Sparkles, Ticket } from 'lucide-react';
import { Link } from 'react-router';
import { licenseHeadline, licenseTone } from '../lib/license.mjs';
import { useStore } from '../lib/store.jsx';
import { Badge, Button } from './ui.jsx';

/**
 * The licensing banner that sits under the top bar.
 *
 * Silent while the subscription is healthy; a single quiet line inside the last
 * seven days of a trial; loud when writes are about to stop or already have.
 * Reads the licence from the store, so demo and live modes behave identically.
 */
export function LicenseBanner() {
  const store = useStore();
  const license = store.license;
  if (!license) return null;

  const { status, daysLeft } = license;
  const tone = licenseTone(license);
  const toneVar = tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'warn';
  const bg = tone === 'success' ? 'var(--success-bg)' : tone === 'danger' ? 'var(--danger-bg)' : 'var(--warn-bg)';
  const fg = `var(--${toneVar})`;

  // Healthy and far from expiry: stay out of the way.
  if (status === 'active' && (daysLeft === null || daysLeft > 7)) return null;
  if (status === 'trial' && (daysLeft ?? 0) > 7) return null;

  const copy = {
    trial: {
      title: `Trial ends in ${daysLeft ?? 0} day${daysLeft === 1 ? '' : 's'}`,
      body: 'Pick a plan to keep appointments, prescriptions and billing running without interruption.',
      cta: 'Choose a plan',
    },
    grace: {
      title: 'Payment overdue — clinic still works',
      body: `Renew within ${Math.abs(daysLeft ?? 0)} day${Math.abs(daysLeft ?? 0) === 1 ? '' : 's'} to avoid read-only mode. Nothing has been deleted.`,
      cta: 'Renew now',
    },
    active: {
      title: 'Subscription renews soon',
      body: 'Your plan renews after the current period. You can change it any time from Subscription.',
      cta: 'Manage subscription',
    },
    read_only: {
      title: 'Read-only mode',
      body: 'The subscription has lapsed, so new records and edits are paused. Everything is still readable and exportable.',
      cta: 'Renew to keep writing',
    },
    expired: {
      title: 'Subscription expired',
      body: 'Read-only: you can still open every chart, print prescriptions and export your data. Renew to resume writing.',
      cta: 'Renew subscription',
    },
  }[status] ?? null;

  if (!copy) return null;

  return (
    <div
      className="licence-banner"
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: bg, color: fg, borderRadius: 12, padding: '10px 14px',
        margin: '0 0 14px', border: `1px solid color-mix(in srgb, ${fg} 26%, transparent)`,
      }}
    >
      {tone === 'success' ? <Sparkles size={16} /> : <AlertTriangle size={16} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ display: 'block', fontSize: '0.86rem' }}>{copy.title}</strong>
        <span className="tiny" style={{ opacity: 0.9 }}>{copy.body}</span>
      </div>
      {status === 'read_only' || status === 'expired' ? (
        <Button size="sm" variant="subtle" icon={Download} onClick={() => document.getElementById('license-export')?.click()}>
          Export data
        </Button>
      ) : null}
      {store.role === 'owner' ? (
        <Link to="/app/subscription" className="btn primary sm" style={{ textDecoration: 'none' }}>
          <Ticket size={14} strokeWidth={2.2} /> {copy.cta}
        </Link>
      ) : (
        <Badge tone={tone === 'danger' ? 'danger' : 'warn'}>{licenseHeadline(license)}</Badge>
      )}
    </div>
  );
}

/**
 * Wraps a write action so a read-only clinic gets a clear message instead of a
 * server error. Returns true when the caller may continue.
 */
export function guardWrite(store, toast, what = 'change') {
  if (store.writable) return true;
  const status = store.license?.status;
  toast.error(
    status === 'expired'
      ? `The subscription has expired, so you cannot ${what}. Your data is still readable and exportable — renew to resume.`
      : `The clinic is in read-only mode until the subscription is renewed, so you cannot ${what}.`,
  );
  return false;
}

export { Check };
