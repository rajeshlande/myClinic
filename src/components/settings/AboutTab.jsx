/**
 * About & version: build, schema, changelog and the recent-errors list a clinic
can paste to support. Extracted verbatim from Settings.jsx in v1.30.0
 * (docs/ARCHITECTURE.md §3 step 4) — markup and copy unchanged.
 */

import {ROLE_BLURB, ROLE_LABEL, can} from '../../lib/permissions.js';
import {APP_VERSION, BUILD_LABEL, CHANGELOG, SCHEMA_VERSION} from '../../lib/version.js';
import {Badge, Button, Card, CardHead} from '../ui.jsx';
import MiniStat from './MiniStat.jsx';
import {AlertCircle, Check, Copy, GitBranch, History, RefreshCw, ShieldCheck, Sparkles} from 'lucide-react';
import {useStore} from '../../lib/store.jsx';

export default function AboutTab({ problems, copyDiagnostics, clinic }) {
  const store = useStore();
  const role = store.role ?? 'owner';
  const canEdit = can(role, 'clinic:settings');
  return (
    <>
        <div className="stack">
          <Card>
            <CardHead title="Version" sub="What this device is running" icon={GitBranch} />
            <div className="card-body stack" style={{ gap: 10 }}>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px,100%),1fr))', gap: 10 }}>
                <MiniStat label="App version" value={`v${APP_VERSION}`} tone="brand" />
                <MiniStat label="Schema" value={`v${SCHEMA_VERSION}`} tone="neutral" />
                <MiniStat label="Build" value={BUILD_LABEL} tone="neutral" />
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="subtle" icon={History} onClick={() => { window.location.hash = '#/app/settings'; }}>You are up to date</Button>
                <Button variant="ghost" icon={RefreshCw} onClick={() => window.location.reload()}>Reload this build</Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Recent problems" icon={AlertCircle}
              sub="What failed on this device, in the words the database used"
              action={<Button size="sm" variant="ghost" icon={Copy} onClick={() => copyDiagnostics()}>Copy</Button>}
            />
            <div className="card-body stack" style={{ gap: 8 }}>
              {problems.length ? problems.map((p) => (
                <div key={`${p.at}-${p.code}`} className="stack" style={{ gap: 2 }}>
                  <span className="small"><strong>{p.context || 'app'}</strong> · {p.message}</span>
                  <span className="tiny faint mono">{p.at} · {p.code || 'no code'}{p.detail && p.detail !== p.message ? ` · ${p.detail.slice(0, 160)}` : ''}</span>
                </div>
              )) : (
                <span className="small muted">Nothing has failed on this device. If something does, the exact reason lands here — copy it into a message and support can read it.</span>
              )}
              <span className="small muted">
                Schema {SCHEMA_VERSION} is what this build expects. If a problem mentions a missing column,
                re-run <code>supabase/schema.sql</code> in the Supabase SQL editor.
              </span>
            </div>
          </Card>

          <Card>
            <CardHead title="What's new" sub="Release notes for this workspace" icon={Sparkles} />
            <div className="card-body stack" style={{ gap: 14 }}>
              {CHANGELOG.map((rel) => (
                <div key={rel.version}>
                  <div className="row" style={{ gap: 8, marginBottom: 5 }}>
                    <strong className="small">v{rel.version}</strong>
                    <Badge tone={rel.version === APP_VERSION ? 'brand' : 'neutral'}>{rel.version === APP_VERSION ? 'Current' : rel.date}</Badge>
                    {rel.schema !== SCHEMA_VERSION ? <span className="tiny faint">schema v{rel.schema}</span> : null}
                  </div>
                  <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 3 }}>
                    {rel.highlights.map((h) => <li key={h}>{h}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="Your access" sub={`Role: ${ROLE_LABEL[role]}`} icon={ShieldCheck} />
            <div className="card-body stack" style={{ gap: 6 }}>
              <p className="small muted" style={{ marginBottom: 4 }}>{ROLE_BLURB[role]}</p>
              {[
                ['Register patients and book appointments', can(role, 'patient:write')],
                ['Issue tokens at the front desk', can(role, 'appointment:token')],
                ['Write consultations and prescriptions', can(role, 'consultation:write')],
                ['Collect payments', can(role, 'invoice:collect')],
                ['Close the day and freeze the snapshot', can(role, 'day:close')],
                ['Void a paid invoice', can(role, 'invoice:void')],
                ['See money reports', can(role, 'clinic:reports:money')],
                ['See the staff roster', can(role, 'team:read')],
                ['Manage team and roles', can(role, 'team:write')],
                ['Change clinic settings', can(role, 'clinic:settings')],
              ].map(([label, allowed]) => (
                <div key={label} className="row small" style={{ gap: 8 }}>
                  <span style={{ color: allowed ? 'var(--success)' : 'var(--muted)', marginTop: 1 }}>
                    {allowed ? <Check size={14} strokeWidth={3} /> : <span style={{ display: 'inline-block', width: 14, textAlign: 'center' }}>—</span>}
                  </span>
                  <span className={allowed ? '' : 'muted'}>{label}</span>
                  {!allowed ? <Badge tone="neutral">Not for {ROLE_LABEL[role].toLowerCase()}</Badge> : null}
                </div>
              ))}
              <p className="tiny faint" style={{ marginTop: 6 }}>Enforced by row-level security in Postgres, not just by this screen.</p>
            </div>
          </Card>
        </div>
    </>
  );
}
