import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  CalendarDays, ClipboardList, CreditCard, LayoutDashboard, Menu, MoonStar,
  Plus, Search, Settings as SettingsIcon, Sparkles, Stethoscope, Sun, Users, UserRound,
  ArrowRightLeft, BarChart3, X, BellRing, LogOut, ShieldCheck, CircleUser, Ticket, Sunset,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useAuth } from '../lib/auth-context.jsx';
import { applyTheme, readTheme, saveTheme } from '../lib/theme.js';
import { appointmentMatchesQuery, formatMoney, patientSearch, relativeDay, today, tokenLabel } from '../lib/logic.mjs';
import { can } from '../lib/permissions.js';
import { SyncBadge, SyncCenter } from './SyncCenter.jsx';
import { LicenseBanner } from './LicenseBanner.jsx';
import { licenseHeadline, licenseTone } from '../lib/license.mjs';
import { Avatar, Button, IconButton, Modal, SearchInput } from './ui.jsx';
import { BrandMark } from './Branding.jsx';

const NAV = [
  { group: 'Clinic', items: [
    { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/queue', label: 'Token queue', icon: Ticket, badgeKey: 'waiting' },
    { to: '/app/appointments', label: 'Appointments', icon: CalendarDays, badgeKey: 'today' },
    { to: '/app/consultations', label: 'Consultations', icon: Stethoscope, capability: 'consultation:read' },
    { to: '/app/follow-ups', label: 'Follow-ups', icon: BellRing, badgeKey: 'followups', capability: 'consultation:read' },
  ] },
  { group: 'Records & money', items: [
    { to: '/app/patients', label: 'Patients', icon: Users },
    { to: '/app/billing', label: 'Billing', icon: CreditCard, capability: 'invoice:read' },
    { to: '/app/day-close', label: 'Day close', icon: Sunset, capability: 'day:close' },
    { to: '/app/reports', label: 'Reports', icon: BarChart3, capability: 'clinic:reports' },
  ] },
  { group: 'Clinic setup', items: [
    { to: '/app/team', label: 'Doctors & staff', icon: ClipboardList, capability: 'team:read' },
    { to: '/app/subscription', label: 'Subscription', icon: Ticket, capability: 'clinic:settings' },
    { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
  ] },
];

const TABS = [
  { to: '/app/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/app/queue', label: 'Queue', icon: Ticket, badgeKey: 'waiting' },
  { to: '/app/appointments', label: 'Calendar', icon: CalendarDays },
  { to: '/app/patients', label: 'Patients', icon: Users },
  { to: '/app/billing', label: 'Billing', icon: CreditCard, capability: 'invoice:read' },
];

function pageTitle(pathname) {
  const map = [
    ['/app/dashboard', 'Dashboard', 'How the clinic is running today'],
    ['/app/queue', 'Token queue', 'Issue tokens and call the next patient'],
    ['/app/appointments', 'Appointments', 'Book, check in and manage the OPD queue'],
    ['/app/patients', 'Patients', 'Registration and clinical records'],
    ['/app/consultations', 'Consultations', 'Notes, vitals and prescriptions'],
    ['/app/billing', 'Billing', 'Invoices, payments and outstanding dues'],
    ['/app/day-close', 'Day close', 'Count the drawer, catch missed charges, close the day'],
    ['/app/follow-ups', 'Follow-ups', 'Recalls and reminders due'],
    ['/app/reports', 'Reports', 'Revenue, footfall and doctor performance'],
    ['/app/team', 'Doctors & staff', 'Who can access this clinic'],
    ['/app/subscription', 'Subscription', 'Plan, seats, billing and renewal'],
    ['/app/settings', 'Settings', 'Clinic profile, billing and preferences'],
  ];
  const hit = map.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? [hit[1], hit[2]] : ['myClinic', 'OPD management'];
}

export default function AppLayout() {
  const store = useStore();
  const { user, signOut, configured } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState(readTheme());
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [title, sub] = pageTitle(location.pathname);

  const role = store.role ?? 'owner';
  const [syncOpen, setSyncOpen] = useState(false);

  const counts = useMemo(() => {
    const t = today();
    return {
      today: store.appointments.filter((a) => a.scheduled_on === t && !['cancelled', 'no-show', 'completed'].includes(a.status)).length,
      waiting: store.appointments.filter((a) => a.scheduled_on === t && a.token_no && ['booked', 'checked-in'].includes(a.status)).length,
      followups: store.consultations.filter((c) => c.follow_up_on && c.follow_up_on <= t && !c.follow_up_done).length,
    };
  }, [store.appointments, store.consultations]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    setTheme(next);
  };

  const brand = store.clinic?.name ?? 'myClinic';

  const nav = (
    <>
      <div className="brand">
        <BrandMark clinic={store.clinic} size={34} className="brand-mark-logo" />
        <div style={{ minWidth: 0 }}>
          <div className="brand-name">myClinic</div>
          <div className="brand-sub truncate" style={{ maxWidth: 150 }}>{brand}</div>
        </div>
      </div>

      {NAV.map((section) => ({ ...section, items: section.items.filter((i) => !i.capability || can(role, i.capability)) }))
        .filter((section) => section.items.length)
        .map((section) => (
        <div className="nav-group" key={section.group}>
          <span className="nav-label">{section.group}</span>
          {section.items.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setMenuOpen(false)}>
              <item.icon size={17} strokeWidth={2.1} />
              <span>{item.label}</span>
              {item.badgeKey && counts[item.badgeKey] ? <span className="nav-badge">{counts[item.badgeKey]}</span> : null}
            </NavLink>
          ))}
        </div>
      ))}

      <div className="sidebar-foot">
        {/* The plan panel belongs to whoever can act on it. A doctor or a front-desk
            seat sees no plan box, no subscription link and no upgrade nudge — the
            clinic's billing is not their screen. */}
        {can(role, 'clinic:settings') ? (
          <div className="plan-card">
            <div className="plan-name"><Sparkles size={13} style={{ color: 'var(--brand-500)' }} /> {(store.license?.plan ?? 'growth') === 'chain' ? 'Multi-clinic' : (store.license?.plan ?? 'growth') === 'solo' ? 'Solo plan' : 'Growth plan'}</div>
            <p className="tiny muted" style={{ margin: '4px 0 6px' }}>{store.mode === 'demo' ? 'Demo workspace · sample data' : 'Live workspace · Supabase synced'}</p>
            <span className={`badge ${licenseTone(store.license) === 'success' ? 'success' : licenseTone(store.license) === 'danger' ? 'danger' : 'warn'} tiny`} style={{ marginBottom: 8, display: 'inline-flex' }}>{licenseHeadline(store.license)}</span>
            <Button size="sm" variant="subtle" className="block" onClick={() => navigate('/app/subscription')}>Manage subscription</Button>
          </div>
        ) : null}
        <button className="user-chip" onClick={() => navigate('/app/settings')}>
          <Avatar name={store.profile?.full_name || user?.email || 'Clinic owner'} size="sm" />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="small strong truncate" style={{ display: 'block' }}>{store.profile?.full_name || 'Clinic owner'}</span>
            <span className="tiny faint truncate" style={{ display: 'block' }}>{store.currentStaff?.role === 'owner' ? 'Owner' : store.currentStaff?.role ?? 'Member'}</span>
          </span>
          <SettingsIcon size={14} className="faint" />
        </button>
      </div>
    </>
  );

  return (
    <div className="shell">
      <aside className="sidebar">{nav}</aside>

      <div className="main">
        {/* Mobile header */}
        <div className="mobilebar">
          <button className="icon-btn plain" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="brand-name" style={{ fontSize: '0.95rem' }}>{title}</div>
            <div className="tiny faint truncate">{store.clinic?.name}</div>
          </div>
          <IconButton icon={Ticket} label="Issue token" onClick={() => navigate('/app/queue')} className="plain" />
          <IconButton icon={Search} label="Search patients" onClick={() => setPaletteOpen(true)} className="plain" />
          <IconButton icon={theme === 'dark' ? Sun : MoonStar} label="Toggle theme" onClick={toggleTheme} className="plain" />
        </div>

        {/* Desktop header */}
        <header className="topbar" key={location.pathname}>
          <div className="topbar-title">
            <h1>{title}</h1>
            <span>{sub}</span>
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-actions">
            <button className="searchbox" style={{ width: 260, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: 0 }} onClick={() => setPaletteOpen(true)} aria-label="Search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ position: 'static', marginLeft: 11, color: 'var(--faint)' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
              <span className="small faint" style={{ textAlign: 'left', flex: 1, padding: '10px 8px' }}>Search patients, invoices…</span>
              <kbd style={{ marginRight: 9 }}>⌘K</kbd>
            </button>
            <IconButton icon={theme === 'dark' ? Sun : MoonStar} label="Toggle theme" onClick={toggleTheme} />
            <Button variant="primary" icon={Plus} onClick={() => navigate('/app/appointments?new=1')}>New appointment</Button>
          </div>
        </header>

        <div className="page-wrap" style={{ padding: '0 20px' }}>
          <LicenseBanner />
        </div>

        <Outlet />

        <nav className="tabbar" aria-label="Primary">
          {TABS.filter((tab) => !tab.capability || can(role, tab.capability)).map((tab) => (
            <NavLink key={tab.to} to={tab.to} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
              <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
                <tab.icon size={20} strokeWidth={2.1} />
                {tab.badgeKey && counts[tab.badgeKey] ? (
                  <span style={{ position: 'absolute', top: -4, right: -9, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 99, background: 'var(--brand-500)', color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'grid', placeItems: 'center' }}>{counts[tab.badgeKey]}</span>
                ) : null}
              </span>
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="overlay" style={{ placeItems: 'stretch start', padding: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setMenuOpen(false); }}>
          <div style={{ width: 280, maxWidth: '86vw', height: '100%', background: 'var(--surface)', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', animation: 'slideIn .24s var(--ease)' }}>
            <style>{'@keyframes slideIn{from{transform:translateX(-100%)}}'}</style>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="eyebrow">Menu</span>
              <IconButton icon={X} label="Close menu" onClick={() => setMenuOpen(false)} className="plain" />
            </div>
            {nav}
            <div className="stack" style={{ marginTop: 16, gap: 8 }}>
              <Button icon={Ticket} variant="primary" onClick={() => { setMenuOpen(false); navigate('/app/queue'); }}>Issue token</Button>
              <Button icon={CalendarDays} variant="subtle" onClick={() => { setMenuOpen(false); navigate('/app/appointments?new=1'); }}>New appointment</Button>
              <Button icon={UserRound} variant="ghost" onClick={() => { setMenuOpen(false); navigate('/app/patients?new=1'); }}>Register patient</Button>
              {configured ? <Button icon={LogOut} variant="ghost" onClick={async () => { await signOut(); navigate('/'); }}>Sign out</Button> : null}
            </div>
          </div>
        </div>
      ) : null}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SyncBadge onOpen={() => setSyncOpen(true)} />
      <SyncCenter open={syncOpen} onClose={() => setSyncOpen(false)} />
    </div>
  );
}

function CommandPalette({ open, onClose }) {
  const store = useStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  useEffect(() => { if (!open) setQ(''); }, [open]);

  const role = store.role ?? 'owner';
  const patients = useMemo(() => patientSearch(store.patients, q).slice(0, 5), [store.patients, q]);
  // A doctor cannot open an invoice, so the palette must not surface one either —
  // in the demo workspace (and before RLS answers) the rows are still in memory.
  const canReadInvoices = can(role, 'invoice:read');
  const invoices = useMemo(() => {
    if (!q.trim() || !canReadInvoices) return [];
    const t = q.toLowerCase();
    return store.invoices.filter((i) => i.number.toLowerCase().includes(t)).slice(0, 3);
  }, [store.invoices, q, canReadInvoices]);
  const appts = useMemo(() => store.appointments.filter((a) => appointmentMatchesQuery(a, store.patients, q)).slice(0, 3), [store.appointments, store.patients, q]);

  const go = (path) => { onClose(); navigate(path); };

  return (
    <Modal open={open} onClose={onClose} title="Jump to anything" sub="Patients, invoices, appointments or a page">
      <div className="stack">
        <SearchInput value={q} onChange={setQ} placeholder="Type a name, phone, invoice number…" shortcutHint={null} />
        {!q ? (
          <div className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">Quick actions</span>
            {[
              { label: 'Issue a token for a walk-in', icon: Ticket, path: '/app/queue' },
              { label: 'Book an appointment', icon: CalendarDays, path: '/app/appointments?new=1' },
              { label: 'Register a new patient', icon: Users, path: '/app/patients?new=1' },
              { label: 'Raise an invoice', icon: CreditCard, path: '/app/billing?new=1', capability: 'invoice:create' },
              { label: "Today's queue", icon: Stethoscope, path: '/app/appointments' },
              { label: 'Open reports', icon: BarChart3, path: '/app/reports', capability: 'clinic:reports' },
            ].filter((a) => !a.capability || can(role, a.capability)).map((a) => (
              <button key={a.label} className="list-item" onClick={() => go(a.path)}>
                <span className="kpi-icon" style={{ width: 30, height: 30 }}><a.icon size={14} /></span>
                <span className="li-main"><span className="li-title">{a.label}</span></span>
                <ArrowRightLeft size={13} className="faint" />
              </button>
            ))}
          </div>
        ) : (
          <div className="stack">
            {patients.length ? (
              <div className="stack" style={{ gap: 2 }}>
                <span className="eyebrow">Patients</span>
                {patients.map((p) => (
                  <button key={p.id} className="list-item" onClick={() => go(`/app/patients/${p.id}`)}>
                    <Avatar name={p.full_name} size="sm" />
                    <span className="li-main">
                      <span className="li-title">{p.full_name}</span>
                      <span className="li-sub">{p.code} · {p.phone || 'No phone'}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {appts.length ? (
              <div className="stack" style={{ gap: 2 }}>
                <span className="eyebrow">Appointments</span>
                {appts.map((a) => (
                  <button key={a.id} className="list-item" onClick={() => go('/app/appointments')}>
                    <span className="kpi-icon" style={{ width: 30, height: 30 }}><CalendarDays size={14} /></span>
                    <span className="li-main">
                      <span className="li-title">{store.patients.find((p) => p.id === a.patient_id)?.full_name ?? 'Patient'}</span>
                      <span className="li-sub">{relativeDay(a.scheduled_on)} · {a.scheduled_at}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {invoices.length ? (
              <div className="stack" style={{ gap: 2 }}>
                <span className="eyebrow">Invoices</span>
                {invoices.map((i) => (
                  <button key={i.id} className="list-item" onClick={() => go(`/invoice/${i.id}`)}>
                    <span className="kpi-icon" style={{ width: 30, height: 30 }}><CreditCard size={14} /></span>
                    <span className="li-main">
                      <span className="li-title mono">{i.number}</span>
                      <span className="li-sub">{formatMoney(i.total_paise)} · {i.status}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {!patients.length && !appts.length && !invoices.length ? (
              <p className="small muted center" style={{ padding: 20 }}>Nothing matched “{q}”.</p>
            ) : null}
          </div>
        )}
        <div className="row tiny faint" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <ShieldCheck size={12} /> Searches only run inside your clinic workspace.
          <span className="spacer" />
          <CircleUser size={12} /> {store.mode === 'demo' ? 'Demo data' : 'Live data'}
        </div>
      </div>
    </Modal>
  );
}
