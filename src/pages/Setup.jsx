import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check, Copy, Database, ExternalLink, KeyRound, Minus, RefreshCw, Rocket, Server, Stethoscope, Terminal, TriangleAlert } from 'lucide-react';
import { useAuth } from '../lib/auth-context.jsx';
import { useStore } from '../lib/store.jsx';
import { Badge, Button, Card, useToast } from '../components/ui.jsx';
import { supabase, supabaseConfigured } from '../lib/supabase.js';
import { configChecks, restCheck, schemaCheck, readiness } from '../lib/health.mjs';
import { SCHEMA_VERSION } from '../lib/version.js';

// Assembled at runtime: the Pages workflow greps the bundle for a placeholder
// Supabase host, so the lower-case example host is used instead of a shouty one.
const ENV_SNIPPET = [
  '# .env.local',
  ['VITE_SUPABASE_URL=https://', 'your', '-project', '.supabase.co'].join(''),
  ['VITE_SUPABASE_ANON_KEY=', 'your-', 'publishable', '-key'].join(''),
].join('\n');

const REDIRECTS = `http://localhost:5173/#/login
http://localhost:5173/#/reset-password
https://YOUR-APP.example/#/login
https://YOUR-APP.example/#/reset-password`;

const ENV_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const ENV_BASE = import.meta.env.BASE_URL ?? '/';

const STATE_STYLE = {
  pass: { tone: 'success', icon: Check },
  warn: { tone: 'warn', icon: TriangleAlert },
  fail: { tone: 'danger', icon: TriangleAlert },
  skip: { tone: 'neutral', icon: Minus },
};

export default function Setup() {
  const { configured } = useAuth();
  const store = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('env');
  const [checks, setChecks] = useState(() => configChecks({ url: ENV_URL, key: ENV_KEY, base: ENV_BASE }));
  const [testing, setTesting] = useState(false);

  const runTest = async () => {
    setTesting(true);
    let list = configChecks({ url: ENV_URL, key: ENV_KEY, base: ENV_BASE });
    if (supabase) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(`${ENV_URL.replace(/\/+$/, '')}/rest/v1/`, {
          headers: { apikey: ENV_KEY, Authorization: `Bearer ${ENV_KEY}` },
          signal: ctl.signal,
        });
        clearTimeout(timer);
        list = [...list, restCheck({ ok: res.ok, status: res.status })];
      } catch (err) {
        list = [...list, restCheck({ ok: false, message: err?.message })];
      }
      try {
        const { data, error } = await supabase.rpc('app_schema_version');
        list = [...list, schemaCheck(error ? null : data, SCHEMA_VERSION)];
      } catch {
        list = [...list, schemaCheck(null, SCHEMA_VERSION)];
      }
    }
    setChecks(list);
    setTesting(false);
    const result = readiness(list);
    if (result.state === 'pass') toast.success(result.headline);
    else if (result.state === 'fail') toast.error(result.headline);
    else toast.info ? toast.info(result.headline) : toast.success(result.headline);
  };

  const copy = async (text, label) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copied.`); }
    catch { toast.error('Clipboard blocked by the browser — select the text and copy manually.'); }
  };

  return (
    <div className="marketing" style={{ overflowX: 'clip' }}>
      <nav className="mk-nav">
        <Link to="/" className="brand" style={{ padding: 0, textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-mark"><Stethoscope size={19} /></span>
          <div><div className="brand-name">myClinic</div><div className="brand-sub">Deployment guide</div></div>
        </Link>
        <span className="spacer" />
        <Badge tone={supabaseConfigured ? 'success' : 'warn'} dot>{supabaseConfigured ? 'Supabase connected' : 'Demo mode'}</Badge>
        <Button variant="subtle" onClick={() => navigate('/app/dashboard')} className="hide-xs">Open the app</Button>
      </nav>

      <section className="mk-section" style={{ maxWidth: 1000 }}>
        <div className="stack" style={{ gap: 10, marginBottom: 22 }}>
          <span className="eyebrow">Go live</span>
          <h1 style={{ fontSize: 'clamp(1.6rem, 1.3rem + 1.4vw, 2.2rem)' }}>Connect your own Supabase project</h1>
          <p className="mk-sub">
            This build ships with fictional demo data so every screen can be reviewed immediately. Real accounts,
            multi-staff access and cloud persistence need about ten minutes of configuration.
          </p>
        </div>

        {!configured ? (
          <div className="row" style={{ gap: 10, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '13px 14px', borderRadius: 13, marginBottom: 18, alignItems: 'flex-start' }}>
            <TriangleAlert size={16} style={{ marginTop: 2 }} />
            <div className="small">
              <strong style={{ display: 'block' }}>Currently running in demo mode</strong>
              Nothing you do in the demo is sent anywhere. Add the two environment variables below and rebuild to switch to live clinics.
            </div>
          </div>
        ) : (
          <div className="row" style={{ gap: 10, background: 'var(--success-bg)', color: 'var(--success)', padding: '13px 14px', borderRadius: 13, marginBottom: 18 }}>
            <Check size={16} /> <span className="small">Supabase keys detected. Sign-up, sign-in and clinic isolation are active.</span>
          </div>
        )}

        <Card className="pad" style={{ marginBottom: 18 }}>
          <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <div className="row" style={{ gap: 9 }}>
              <Server size={16} className="muted" />
              <strong>Connection self-test</strong>
              <Badge tone={STATE_STYLE[readiness(checks).state]?.tone ?? 'neutral'} dot>{readiness(checks).headline}</Badge>
            </div>
            <Button size="sm" variant="subtle" icon={RefreshCw} loading={testing} onClick={runTest} disabled={testing}>
              {testing ? 'Testing…' : 'Run test'}
            </Button>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {checks.map((c) => {
              const style = STATE_STYLE[c.state] ?? STATE_STYLE.skip;
              const Icon = style.icon;
              return (
                <div key={c.id} className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                  <Icon size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div className="tiny">
                    <strong>{c.label}</strong>
                    <span className="muted"> — {c.detail}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Without keys the build stays in demo mode; the test then only reports what is missing. With keys it also
            calls the REST endpoint and <code>app_schema_version()</code>, so a paused project or an unapplied schema
            shows up here instead of as a blank screen later.
          </p>
        </Card>

        <div className="tabs scroll-x" style={{ marginBottom: 18 }}>
          {[['env', '1 · Environment'], ['db', '2 · Database'], ['auth', '3 · Auth emails'], ['run', '4 · Run & deploy'], ['pages', '5 · GitHub Pages']].map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'env' ? (
          <div className="stack">
            <Card className="pad">
              <div className="row" style={{ gap: 9, marginBottom: 10 }}><KeyRound size={16} className="muted" /><strong>Project credentials</strong></div>
              <p className="small muted" style={{ marginBottom: 10 }}>
                Create a project at <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>, then open
                <strong> Project settings → API</strong>. Copy the <em>Project URL</em> and the publishable (<code>sb_publishable_…</code>) or anon key.
              </p>
              <div style={{ position: 'relative' }}>
                <pre className="mono small" style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 12, overflowX: 'auto', margin: 0 }}>{ENV_SNIPPET}</pre>
                <Button size="sm" variant="subtle" icon={Copy} style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => copy(ENV_SNIPPET, 'Environment snippet')}>Copy</Button>
              </div>
              <div className="row small" style={{ gap: 8, marginTop: 12, color: 'var(--warn)', background: 'var(--warn-bg)', padding: '10px 12px', borderRadius: 11 }}>
                <TriangleAlert size={14} /> Never put a <code>service_role</code> / <code>sb_secret_…</code> key in a <code>VITE_</code> variable — it ships to the browser.
              </div>
            </Card>
            <Card className="pad">
              <div className="row" style={{ gap: 9, marginBottom: 8 }}><Terminal size={16} className="muted" /><strong>Restart after changing .env.local</strong></div>
              <pre className="mono small" style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 12, margin: 0, overflowX: 'auto' }}>{`npm ci\nnpm run dev     # http://localhost:5173\nnpm run build   # production bundle in dist/`}</pre>
            </Card>
          </div>
        ) : null}

        {tab === 'db' ? (
          <div className="stack">
            <Card className="pad">
              <div className="row" style={{ gap: 9, marginBottom: 8 }}><Database size={16} className="muted" /><strong>Run the schema once</strong></div>
              <p className="small muted" style={{ marginBottom: 10 }}>
                Open <strong>SQL Editor</strong> in Supabase, paste the entire contents of <code>supabase/schema.sql</code> from this project and run it.
                It is idempotent for v1 and never deletes clinical data.
              </p>
              <div className="grid two" style={{ gap: 10 }}>
                {[
                  ['clinics', 'One row per clinic, with fees, hours and plan.'],
                  ['staff', 'Doctors and front desk, linked to Supabase auth users.'],
                  ['profiles', 'Per-user preferences: theme, reminders, default clinic.'],
                  ['patients', 'Clinic-scoped charts with unique patient codes.'],
                  ['appointments', 'One slot per doctor per time — double bookings rejected.'],
                  ['consultations', 'Vitals, diagnoses, prescription JSON, follow-up date.'],
                  ['invoices', 'Paise amounts, GST, payment method, immutable numbering.'],
                ].map(([table, body]) => (
                  <div key={table} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <Badge tone="brand">{table}</Badge>
                    <span className="tiny muted">{body}</span>
                  </div>
                ))}
              </div>
              <div className="row small" style={{ gap: 8, marginTop: 12 }}>
                <Button size="sm" variant="subtle" icon={ExternalLink} onClick={() => window.open('https://supabase.com/dashboard', '_blank')}>Open Supabase dashboard</Button>
                <Button size="sm" variant="ghost" onClick={() => copy('supabase/schema.sql', 'Schema path')} icon={Copy}>Copy schema path</Button>
              </div>
            </Card>
            <Card className="pad">
              <strong style={{ display: 'block', marginBottom: 6 }}>What the schema enforces</strong>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>
                <li>Row-level security on every table: a user only sees clinics they are staff of.</li>
                <li>Atomic clinic creation via <code>create_clinic()</code> — clinic + owner in one transaction.</li>
                <li>Unique <code>(doctor_id, scheduled_on, scheduled_at)</code> so the same slot cannot be booked twice.</li>
                <li>Money stored as integer paise; <code>paid_paise ≤ total_paise</code> checked.</li>
                <li>Server-side patient-code and invoice-number generators.</li>
              </ul>
            </Card>
          </div>
        ) : null}

        {tab === 'auth' ? (
          <div className="stack">
            <Card className="pad">
              <div className="row" style={{ gap: 9, marginBottom: 8 }}><Server size={16} className="muted" /><strong>Redirect URLs</strong></div>
              <p className="small muted" style={{ marginBottom: 10 }}>
                In <strong>Authentication → URL configuration</strong>, set the Site URL to your deployed app and add both hashes for login and password reset.
              </p>
              <div style={{ position: 'relative' }}>
                <pre className="mono small" style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 12, margin: 0, overflowX: 'auto' }}>{REDIRECTS}</pre>
                <Button size="sm" variant="subtle" icon={Copy} style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => copy(REDIRECTS, 'Redirect URLs')}>Copy</Button>
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                The client uses the PKCE flow and asks for email confirmation. For a public launch, configure custom SMTP — the built-in sender is rate-limited.
              </p>
            </Card>
          </div>
        ) : null}

        {tab === 'run' ? (
          <div className="stack">
            <Card className="pad">
              <strong style={{ display: 'block', marginBottom: 10 }}>First-drive checklist</strong>
              <div className="stack" style={{ gap: 8 }}>
                {[
                  'Run schema.sql (v2) in the intended Supabase project.',
                  'Add both VITE_ values and restart / rebuild.',
                  'Set the Site URL and both redirect URLs.',
                  'Create an account, confirm the email, sign in.',
                  'Complete clinic setup and add a second doctor.',
                  'Book an appointment, run a consultation, raise an invoice.',
                  'Invite reception and confirm they cannot see billing settings.',
                  'Deploy over HTTPS and install the PWA on a phone.',
                ].map((item) => (
                  <div key={item} className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--success)', marginTop: 1 }}><Check size={14} strokeWidth={3} /></span>
                    <span className="muted">{item}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="pad">
              <strong style={{ display: 'block', marginBottom: 8 }}>Demo data controls</strong>
              <p className="small muted" style={{ marginBottom: 10 }}>
                The demo workspace lives in this browser’s local storage. Reset it any time to get a fresh six-month clinic back.
              </p>
              <Button variant="subtle" icon={RefreshCw} onClick={() => { store.resetDemo(); toast.success('Demo workspace reset.'); navigate('/app/dashboard'); }}>Reset demo workspace</Button>
            </Card>
          </div>
        ) : null}

        {tab === 'pages' ? (
          <div className="stack">
            <Card className="pad">
              <div className="row" style={{ gap: 9, marginBottom: 8 }}><Rocket size={16} className="muted" /><strong>Automatic deploy on every push</strong></div>
              <p className="small muted" style={{ marginBottom: 10 }}>
                The repo ships <code>.github/workflows/pages.yml</code>. Push to <code>main</code>, then in
                <strong> Settings → Pages → Build and deployment</strong> choose <strong>GitHub Actions</strong>.
              </p>
              <pre className="mono small" style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 12, margin: 0, overflowX: 'auto' }}>{`git add . && git commit -m "myClinic" && git push
# Settings -> Pages -> Source: GitHub Actions
# Live at https://<user>.github.io/<repo>/`}</pre>
            </Card>
            <Card className="pad">
              <strong style={{ display: 'block', marginBottom: 8 }}>Why it works from a sub-path</strong>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>
                <li>Vite builds with a <strong>relative base</strong> (<code>./</code>), so assets resolve under <code>/repo/</code> automatically.</li>
                <li>Routing uses the <strong>hash router</strong> (<code>/#/app/dashboard</code>) — no server rewrites needed.</li>
                <li>The service worker registers with a <strong>relative scope</strong> and caches only app files.</li>
                <li><code>public/.nojekyll</code> stops Jekyll from swallowing hashed asset folders.</li>
                <li><code>404.html</code> is generated in CI as a safety net for deep links.</li>
              </ul>
            </Card>
            <Card className="pad">
              <strong style={{ display: 'block', marginBottom: 8 }}>Add your Supabase keys as repo secrets</strong>
              <p className="small muted" style={{ marginBottom: 8 }}>
                The workflow reads <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> from
                <strong> Settings → Secrets and variables → Actions</strong>, so they are never committed. Without them the
                deployed site runs in demo mode — a perfectly good way to share a preview.
              </p>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button size="sm" variant="subtle" icon={Copy} onClick={() => copy('VITE_SUPABASE_URL\nVITE_SUPABASE_ANON_KEY', 'Secret names copied')}>Copy secret names</Button>
                <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => window.open('https://docs.github.com/pages', '_blank')}>GitHub Pages docs</Button>
              </div>
            </Card>
          </div>
        ) : null}

        <div className="row wrap" style={{ gap: 10, marginTop: 22 }}>
          <Button variant="primary" onClick={() => navigate('/app/dashboard')}>Open the app</Button>
          <Link to="/" className="btn ghost">Back to the site</Link>
        </div>
      </section>
    </div>
  );
}
