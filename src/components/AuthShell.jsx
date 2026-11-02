import { Link } from 'react-router';
import { CalendarCheck, Check, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { Badge } from './ui.jsx';

export default function AuthShell({ title, sub, children, footer, aside }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <Link to="/" className="brand" style={{ padding: 0, color: 'inherit', textDecoration: 'none' }}>
          <span className="brand-mark" style={{ background: 'rgba(255,255,255,0.14)', boxShadow: 'none' }}><Stethoscope size={19} /></span>
          <div>
            <div className="brand-name">myClinic</div>
            <div className="brand-sub" style={{ color: 'rgba(234,250,246,0.6)' }}>OPD management</div>
          </div>
        </Link>

        <div className="stack" style={{ gap: 14, marginTop: 'auto' }}>
          <h2 style={{ fontSize: '1.5rem', color: '#eafaf6', maxWidth: '22ch' }}>{aside?.heading ?? 'Your OPD, finally on one screen.'}</h2>
          <p style={{ color: 'rgba(234,250,246,0.72)', fontSize: '0.9rem', maxWidth: '38ch' }}>
            {aside?.body ?? 'Appointments, patient charts, prescriptions, invoices and follow-ups — for every doctor in the clinic.'}
          </p>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {(aside?.bullets ?? [
            [CalendarCheck, 'Slot-accurate booking per doctor'],
            [Users, 'Full patient chart with visit history'],
            [ShieldCheck, 'Clinic-isolated records with row-level security'],
          ]).map(([Icon, text]) => (
            <div className="row" key={text} style={{ gap: 9, color: 'rgba(234,250,246,0.86)', fontSize: '0.86rem' }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,0.12)' }}><Icon size={14} /></span>
              {text}
            </div>
          ))}
        </div>

        <div className="glass-card">
          <div className="row small" style={{ gap: 8, marginBottom: 6 }}>
            <Badge tone="neutral" style={{ background: 'rgba(255,255,255,0.16)', color: '#eafaf6' }}><Check size={11} /> Demo ready</Badge>
          </div>
          <p className="tiny" style={{ color: 'rgba(234,250,246,0.78)' }}>
            No Supabase project yet? Open the demo clinic from the sign-in screen — six months of fictional data, no account needed.
          </p>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-form">
          <div className="stack" style={{ gap: 5 }}>
            <Link to="/" className="row tiny muted" style={{ gap: 4, textDecoration: 'none' }}>← Back to site</Link>
            <h1 style={{ fontSize: '1.62rem' }}>{title}</h1>
            {sub ? <p className="small muted">{sub}</p> : null}
          </div>
          {children}
          {footer}
        </div>
      </main>
    </div>
  );
}
