import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight, BadgeCheck, BarChart3, BellRing, CalendarCheck, Check, ChevronRight,
  CreditCard, FileText, LayoutDashboard, Lock, MessageSquare, MoonStar,
  ShieldCheck, Smartphone, Sparkles, Stethoscope, Sun, Users, WifiOff, Zap, Ticket,
  CloudOff, Languages, Paintbrush, KeyRound, Send, Sunset, Menu, X, Plus, Minus,
} from 'lucide-react';
import { PLANS, formatMoney } from '../lib/logic.mjs';
import { useAuth } from '../lib/auth-context.jsx';
import { applyTheme, readTheme } from '../lib/theme.js';
import { Button, Badge } from '../components/ui.jsx';
import { APP_VERSION } from '../lib/version.js';
import { FOOTER_GROUPS, isCompact } from '../lib/responsive.mjs';
import { useLayout } from '../lib/use-layout.js';

const FEATURES = [
  { icon: Ticket, title: 'Token queue for walk-ins', body: 'The front desk taps once to issue the next token — no appointment, no patient record needed first. Doctors call numbers in order, and the lounge screen shows who is next.' },
  { icon: CloudOff, title: 'Works without internet', body: 'Reception keeps registering patients through a power cut or a dead hotspot. Changes queue on the device and sync the moment the connection returns — with a real conflict policy, not silent overwrites.' },
  { icon: KeyRound, title: 'Roles that hold', body: 'Owner, doctor and front desk each see only what they run — enforced by row-level security in Postgres, not just hidden buttons. Front desk collects money; only owners void a paid bill.' },
  { icon: Languages, title: 'Prescriptions in 10 languages', body: 'Print directions in Hindi, Marathi, Tamil, Bengali and more, with medicine names left in English so the chemist reads exactly what you wrote.' },
  { icon: CalendarCheck, title: 'Appointments & booking', body: 'Slot-based booking per doctor. Booked patients and walk-ins share one queue, so the doctor sees a single ordered list instead of two registers.' },
  { icon: Users, title: 'Patient records', body: 'One chart per patient: demographics, allergies, chronic tags, prescriptions and every visit — searchable by name, phone or patient ID.' },
  { icon: Stethoscope, title: 'Consultations & prescriptions', body: 'Structured vitals, examination notes, diagnoses and a printable prescription in seconds. Last visit always visible for context.' },
  { icon: CreditCard, title: 'Billing & payments', body: 'Consultation, procedures and diagnostics on one GST-ready invoice. Part payments, UPI/card/insurance, and outstanding dues tracked per patient.' },
  { icon: Sunset, title: 'Close the day, not a notebook', body: 'Count the drawer against what the day actually collected, split by cash, UPI and card. Close the day and the figures freeze as a snapshot, so the sheet you printed at 9pm still agrees with the app tomorrow.' },
  { icon: BellRing, title: 'Follow-ups & recalls', body: 'Every consultation sets a follow-up date. myClinic surfaces who is due today and who has gone quiet, so patients come back.' },
  { icon: Send, title: 'Reminders with a paper trail', body: 'One privacy-safe message per patient — tomorrow\'s appointment, a recall, or a bill owed for a week — with WhatsApp and copy actions. The send log records what was actually sent, so nobody is chased twice.' },
  { icon: BarChart3, title: 'Reports that matter', body: 'Daily collection, monthly revenue vs footfall, payer mix, average ticket and doctor-wise performance — no spreadsheet exports needed.' },
];

const WORKFLOW = [
  { step: '01', title: 'Front desk books the slot', body: 'Search an existing patient or register a new one in 20 seconds. The doctor’s free slots are the only ones offered, so double bookings stop.' },
  { step: '02', title: 'Doctor sees the chart', body: 'Check in, then open the consultation with vitals, last visit, allergies and diagnoses already in view.' },
  { step: '03', title: 'Reception collects payment', body: 'The fee is pre-filled from the visit type and doctor. Raise the invoice, take a part payment, print or WhatsApp it.' },
  { step: '04', title: 'Follow-up comes back', body: 'A follow-up date is set during the consult and appears on the recall list exactly when it is due.' },
];

export default function Landing({ anchor }) {
  const navigate = useNavigate();
  const { configured } = useAuth();
  const [theme, setTheme] = useState(readTheme());
  const [menuOpen, setMenuOpen] = useState(false);
  const [planTab, setPlanTab] = useState(0);
  const layout = useLayout();
  const compact = isCompact(layout);

  // A phone menu that stays open across a scroll or an Escape press is a trap.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!compact) setMenuOpen(false);
  }, [compact]);

  useEffect(() => {
    if (anchor === 'pricing') {
      const el = document.getElementById('pricing');
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }, [anchor]);

  // The marketing page has exactly one way into the demo workspace: the footer's
  // "Open Demo" button. Everything else on this page is the product — plans, sign
  // up, the deployment guide — so a visitor never lands in sample data by accident.
  //
  // It always goes to the workspace, whether or not this deployment is configured.
  // On a live build a signed-out visitor has no session, so the store runs in demo
  // mode against localStorage and the shell labels the screen "Demo data" — sending
  // them to /login instead means the published site has a demo door that opens onto
  // a sign-in form. "Sign in" is the button for signing in.
  const enterDemo = () => navigate('/app/dashboard');
  const startFree = () => navigate(configured ? '/signup' : '/pricing');

  return (
    <div className="marketing">
      <nav className="mk-nav">
        <Link to="/" className="brand" style={{ padding: 0, textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark"><Stethoscope size={19} strokeWidth={2.3} /></span>
          <div>
            <div className="brand-name">myClinic</div>
            <div className="brand-sub">OPD management</div>
          </div>
        </Link>
        <div className="mk-links">
          <a href="#features">Features</a>
          <a href="#workflow">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#security">Security</a>
        </div>
        <div className="spacer" />
        <button className="icon-btn plain" aria-label="Toggle theme" onClick={() => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(next); setTheme(next); }}>
          {theme === 'dark' || document.documentElement.dataset.theme === 'dark' ? <Sun size={17} /> : <MoonStar size={17} />}
        </button>
        <Button variant="ghost" className="mk-signin" onClick={() => navigate('/login')}>Sign in</Button>
        <Button variant="primary" onClick={() => navigate('/signup')}>Start free</Button>
        <button
          type="button"
          className="mk-menu-btn"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mk-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        {menuOpen ? (
          <div className="mk-menu" id="mk-menu">
            {[
              ['#features', 'Features'],
              ['#workflow', 'How it works'],
              ['#pricing', 'Pricing'],
              ['#security', 'Security'],
            ].map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}
            <Link to="/setup" onClick={() => setMenuOpen(false)}>Deployment guide</Link>
            <Link to="/book/sunrise-multispecialty" onClick={() => setMenuOpen(false)}>Patient booking page</Link>
          </div>
        ) : null}
      </nav>

      <header className="mk-hero">
        <div className="stack" style={{ gap: 20 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <Badge tone="brand" dot>Built for single & multi-doctor OPDs</Badge>
            <Badge tone="neutral"><Sparkles size={11} /> v{APP_VERSION}</Badge>
          </div>
          <h1 className="mk-h1">
            Everything you need for{' '}<br className="mk-br" />
            <span style={{ color: 'var(--brand-500)' }}>smarter OPD</span> clinic management
          </h1>
          <p className="mk-sub">
            myClinic is OPD management software that helps clinics deliver faster care — appointments,
            token queues for walk-ins, patient records, consultations, billing and follow-ups in one calm
            platform. No paper registers, no lost case sheets, and no guessing what today collected — the
            day ends with the drawer counted and a snapshot you can hand to your accountant.
          </p>
          <div className="mk-cta">
            <Button variant="primary" size="lg" icon={ArrowRight} onClick={startFree}>
              {configured ? 'Start free' : 'See plans & pricing'}
            </Button>
          </div>
          <div className="row wrap tiny muted" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 5 }}><Check size={13} style={{ color: 'var(--success)' }} /> No card required</span>
            <span className="row" style={{ gap: 5 }}><Check size={13} style={{ color: 'var(--success)' }} /> Installs as an app</span>
            <span className="row" style={{ gap: 5 }}><Check size={13} style={{ color: 'var(--success)' }} /> Works on clinic wifi or offline</span>
            <span className="row" style={{ gap: 5 }}><Check size={13} style={{ color: 'var(--success)' }} /> Patients book their own slot</span>
          </div>
          <div className="mk-proof">
            <div><b>4.2 min</b><span>median consult-to-bill time</span></div>
            <div><b>₹0</b><span>for the first 30 patients / mo</span></div>
            <div><b>1 screen</b><span>front desk to doctor to cash</span></div>
          </div>
        </div>

        <ProductPreview />
      </header>

      <div className="mk-strip">
        {['Token queue', 'Appointments', 'Online booking', 'Patient records', 'Consultations', 'GST invoices', 'Day close', 'Follow-up recalls', 'Offline PWA', 'Installable app'].map((chip) => (
          <span key={chip} className="badge neutral" style={{ padding: '6px 12px', fontSize: '0.78rem' }}><BadgeCheck size={12} style={{ color: 'var(--brand-500)' }} /> {chip}</span>
        ))}
      </div>

      <section className="mk-section" id="features">
        <div className="stack" style={{ gap: 8, marginBottom: 24, maxWidth: 640 }}>
          <span className="eyebrow">The platform</span>
          <h2 style={{ fontSize: 'clamp(1.5rem, 1.1rem + 1.4vw, 2.1rem)' }}>One clinic, from the first token to the closed day</h2>
          <p className="muted">Every module talks to the others. A booking becomes a consultation, a consultation becomes an invoice, an invoice becomes a follow-up — and the day closes with the drawer counted.</p>
        </div>
        <div className={`mk-cards${compact ? ' compact' : ''}`}>
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} feature={f} compact={compact} />
          ))}
        </div>
      </section>

      <section className="mk-section" id="workflow" style={{ paddingTop: 0 }}>
        <div className="grid two" style={{ gap: 28, alignItems: 'start' }}>
          <div className="stack" style={{ gap: 18 }}>
            <span className="eyebrow">One afternoon, one clinic</span>
            <h2 style={{ fontSize: 'clamp(1.4rem, 1.1rem + 1vw, 1.9rem)' }}>From the door to the follow-up in four steps</h2>
            <div className="timeline" style={{ marginTop: 6 }}>
              {WORKFLOW.map((w) => (
                <div className="timeline-item" key={w.step}>
                  <span className="timeline-dot" />
                  <div>
                    <div className="row" style={{ gap: 8, marginBottom: 3 }}>
                      <span className="badge brand">{w.step}</span>
                      <strong style={{ fontSize: '0.94rem' }}>{w.title}</strong>
                    </div>
                    <p className="small muted">{w.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card pad" style={{ background: 'linear-gradient(160deg, var(--brand-50), var(--surface) 62%)' }}>
            <div className="stack" style={{ gap: 14 }}>
              <div className="row"><span className="kpi-icon" style={{ background: 'var(--brand-500)', color: '#fff' }}><Zap size={16} /></span><strong>What changes on day one</strong></div>
              {[
                ['Walk-ins get a number in one tap', 'Tokens restart daily, per doctor, in order.'],
                ['Front desk stops double-booking', 'Slots are enforced per doctor, per day.'],
                ['Doctors stop asking “what did we give last time?”', 'The full chart loads with the appointment.'],
                ['Collections reconcile themselves', 'Every invoice records who paid, how and when.'],
                ['Recalls happen on time', 'A follow-up date is set inside the consultation.'],
                ['You see the month as it happens', 'Revenue, footfall and dues update live.'],
              ].map(([title, body]) => (
                <div className="row" key={title} style={{ alignItems: 'flex-start', gap: 9 }}>
                  <span style={{ marginTop: 2, color: 'var(--success)' }}><Check size={15} strokeWidth={3} /></span>
                  <div>
                    <div className="small strong">{title}</div>
                    <div className="tiny muted">{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section" id="pricing" style={{ paddingTop: 0 }}>
        <div className="stack" style={{ gap: 8, marginBottom: 22, maxWidth: 620 }}>
          <span className="eyebrow">Pricing</span>
          <h2 style={{ fontSize: 'clamp(1.5rem, 1.1rem + 1.4vw, 2.1rem)' }}>Priced per clinic, not per patient</h2>
          <p className="muted">Start on Solo. Move up when you add a second doctor or a second branch. Annual billing saves two months.</p>
        </div>
        {compact ? (
          <div className="mk-plan-tabs" role="tablist" aria-label="Plans">
            {PLANS.map((plan, i) => (
              <button
                key={plan.id}
                type="button"
                role="tab"
                aria-selected={i === Math.min(planTab, PLANS.length - 1)}
                className={i === Math.min(planTab, PLANS.length - 1) ? 'on' : ''}
                onClick={() => setPlanTab(i)}
              >
                {plan.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mk-cards" style={{ gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(262px, 1fr))' }}>
          {(compact ? PLANS.filter((_, i) => i === Math.min(planTab, PLANS.length - 1)) : PLANS).map((plan) => (
            <article key={plan.id} className={`price-card ${plan.popular ? 'popular' : ''}`}>
              {plan.popular ? <span className="badge brand" style={{ position: 'absolute', top: -11, left: 20 }}>Most chosen</span> : null}
              <div>
                <h3>{plan.name}</h3>
                <p className="tiny muted">{plan.tagline}</p>
              </div>
              <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
                <span className="price-amount">{formatMoney(plan.price_paise)}</span>
                <span className="tiny muted">/ month</span>
              </div>
              <Badge tone="neutral">{plan.limits}</Badge>
              <ul>
                {plan.features.map((f) => <li key={f}><Check size={13} strokeWidth={3} /> {f}</li>)}
              </ul>
              <Button variant={plan.popular ? 'primary' : 'subtle'} className="block" onClick={() => navigate(configured ? '/signup' : '/setup')}>
                {configured ? (plan.id === 'chain' ? 'Talk to us' : 'Start 14-day trial') : 'Connect a project'}
              </Button>
            </article>
          ))}
        </div>
        <p className="tiny faint" style={{ marginTop: 14 }}>Prices exclude GST. Clinic data stays yours — export everything as CSV at any time, on any plan.</p>
      </section>

      <section className="mk-section" id="security" style={{ paddingTop: 0 }}>
        <div className="grid three">
          {[
            { icon: ShieldCheck, title: 'Your clinic is isolated', body: 'Every row belongs to a clinic and is protected by row-level security. A second clinic can never query your patients, even with a crafted request.' },
            { icon: Lock, title: 'No PHI in the URL', body: 'Patients, notes and invoices live behind authenticated sessions. Sample data is fictional and clearly labelled.' },
            { icon: WifiOff, title: 'Offline-friendly shell', body: 'The app shell is cached by a service worker, so a dropped connection never blanks the front desk screen.' },
            { icon: Smartphone, title: 'Installable everywhere', body: 'Add myClinic to the home screen on Android, iOS, or a clinic tablet. Works in portrait at the reception desk.' },
            { icon: MessageSquare, title: 'Reminders that respect privacy', body: 'Reminder templates carry the time and doctor only — never the diagnosis.' },
            { icon: FileText, title: 'Audit-friendly records', body: 'Immutable invoice numbers, GST lines and created/updated timestamps on every clinical record.' },
          ].map((item) => (
            <div className="mk-card" key={item.title}>
              <span className="ic"><item.icon size={18} /></span>
              <h3>{item.title}</h3>
              <p className="small muted">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mk-section" style={{ paddingTop: 0 }}>
        <div className="mk-final card pad">
          <div className="stack" style={{ gap: 8 }}>
            <h2 style={{ color: '#eafaf6', fontSize: 'clamp(1.3rem, 1rem + 1vw, 1.8rem)' }}>Tomorrow morning starts here</h2>
            <p style={{ color: 'rgba(234,250,246,0.78)', maxWidth: '56ch' }} className="small">
              Register a walk-in, issue a token, write the note, raise the bill and close the day — the whole path on one screen. The demo in the footer is loaded with six months of fictional patients if you would rather look first.
            </p>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button size="lg" onClick={() => navigate(configured ? '/signup' : '/pricing')} icon={ArrowRight} style={{ background: '#eafaf6', color: '#08403c', borderColor: 'transparent' }}>
              {configured ? 'Start free' : 'See plans'}
            </Button>
            <Button size="lg" variant="ghost" style={{ color: '#eafaf6' }} onClick={() => navigate('/setup')} icon={ChevronRight}>Connect Supabase</Button>
          </div>
        </div>
      </section>

      <footer className="mk-footer">
        <div className="mk-footer-inner">
          <div className="mk-footer-brand">
            <div className="row" style={{ gap: 9 }}>
              <span className="brand-mark" style={{ width: 32, height: 32, borderRadius: 10 }}><Stethoscope size={16} /></span>
              <div>
                <div className="brand-name">myClinic</div>
                <div className="tiny faint">OPD management software</div>
              </div>
            </div>
            <p className="small muted mk-footer-pitch">
              Appointments, token queues, patient records, billing and follow-ups — for a single-doctor
              OPD or a multi-branch group. Built for a clinic desk, not a boardroom.
            </p>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button size="sm" variant="primary" icon={LayoutDashboard} onClick={enterDemo}>Open Demo</Button>
            </div>
          </div>

          <nav className="mk-footer-links" aria-label="Footer">
            {FOOTER_GROUPS.map((group) => (
              <div className="mk-footer-col" key={group.title}>
                <h3>{group.title}</h3>
                {group.links.map((link) => (link.href
                  ? <a key={link.label} href={link.href}>{link.label}</a>
                  : <Link key={link.label} to={link.to}>{link.label}</Link>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <div className="mk-footer-bar">
          <span>© {new Date().getFullYear()} myClinic · OPD management software</span>
          <span className="mk-footer-ver">v{APP_VERSION}</span>
          <span className="spacer" />
          <span className="tiny faint">Made for Indian OPDs · GST-ready · Works offline</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * A feature is a card on a desk and a collapsed row on a phone: twelve bodies
 * of copy is a lot of scrolling when the screen is 390px wide.
 */
function FeatureCard({ feature, compact }) {
  const [open, setOpen] = useState(false);
  const Icon = feature.icon;

  if (!compact) {
    return (
      <article className="mk-card">
        <span className="ic"><Icon size={18} /></span>
        <h3>{feature.title}</h3>
        <p className="small muted">{feature.body}</p>
      </article>
    );
  }

  return (
    <article className={`mk-card mk-card-fold${open ? ' open' : ''}`}>
      <button type="button" className="mk-card-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="ic"><Icon size={17} /></span>
        <span className="mk-card-title">{feature.title}</span>
        <span className="mk-card-chev" aria-hidden="true">{open ? <Minus size={16} /> : <Plus size={16} />}</span>
      </button>
      {open ? <p className="small muted mk-card-body">{feature.body}</p> : null}
    </article>
  );
}

function ProductPreview() {
  return (
    <div className="preview-frame" aria-hidden="true">
      <div className="preview-bar">
        <span className="preview-dot" /><span className="preview-dot" /><span className="preview-dot" />
        <span className="tiny faint" style={{ marginLeft: 8 }}>myclinic.app/app/dashboard</span>
      </div>
      <div className="preview-body">
        <div className="preview-nav">
          <span className="on" /><span /><span /><span /><span style={{ marginTop: 'auto' }} />
        </div>
        <div className="preview-content">
          <div className="row" style={{ gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(145deg, var(--brand-500), var(--brand-700))' }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 8, width: '46%', borderRadius: 4, background: 'var(--surface-3)' }} />
              <div style={{ height: 6, width: '30%', borderRadius: 4, background: 'var(--surface-2)', marginTop: 4 }} />
            </div>
          </div>
          <div className="preview-kpis">
            {[['Today', '42'], ['Collected', '₹18.4k'], ['Due', '₹6.1k']].map(([label, value]) => (
              <div className="preview-kpi" key={label}><span>{label}</span><b>{value}</b></div>
            ))}
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'grid', gap: 7 }}>
            {[['09:00', 'Ananya Sharma', '#e3f4ee'], ['09:15', 'Rohit Patel', '#e6f4f1'], ['09:30', 'Meera Iyer', '#fbf1db'], ['09:45', 'Kabir Khan', '#eef3f1']].map(([time, name, tint]) => (
              <div key={time} className="row" style={{ gap: 8 }}>
                <span className="tiny mono faint" style={{ width: 34 }}>{time}</span>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: tint }} />
                <span style={{ height: 7, width: `${40 + (name.length % 5) * 8}%`, borderRadius: 4, background: 'var(--surface-3)' }} />
                <span style={{ marginLeft: 'auto', height: 14, width: 38, borderRadius: 6, background: tint }} />
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <div style={{ flex: 1, height: 46, borderRadius: 9, background: 'linear-gradient(180deg, color-mix(in srgb, var(--brand-500) 30%, transparent), transparent)' }} />
            <div style={{ flex: 1, height: 46, borderRadius: 9, background: 'linear-gradient(180deg, color-mix(in srgb, var(--violet) 22%, transparent), transparent)' }} />
            <div style={{ flex: 1, height: 46, borderRadius: 9, background: 'linear-gradient(180deg, color-mix(in srgb, var(--amber) 22%, transparent), transparent)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
