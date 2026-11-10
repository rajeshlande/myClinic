/**
 * Offline & sync: what is queued, what conflicts, and the way into the sync
centre. Extracted verbatim from Settings.jsx in v1.30.0
 * (docs/ARCHITECTURE.md §3 step 4) — markup and copy unchanged.
 */

import {can} from '../../lib/permissions.js';
import {SyncCenter} from '../SyncCenter.jsx';
import {Button, Card, CardHead} from '../ui.jsx';
import MiniStat from './MiniStat.jsx';
import {Check, CloudOff, RefreshCcw, RefreshCw, Scale, WifiOff} from 'lucide-react';
import {useStore} from '../../lib/store.jsx';
import {useAuth} from '../../lib/auth-context.jsx';

export default function SyncTab({ syncOpen, setSyncOpen, clinic }) {
  const store = useStore();
  const { user, configured, updatePassword, signOut } = useAuth();
  return (
    <>
        <div className="stack">
          <Card>
            <CardHead title="Offline & sync" sub="Work through a power cut or a dead hotspot" icon={CloudOff} />
            <div className="card-body stack" style={{ gap: 12 }}>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px,100%),1fr))', gap: 10 }}>
                <MiniStat label="Connection" value={store.online ? 'Online' : 'Offline'} tone={store.online ? 'success' : 'warn'} />
                <MiniStat label="Waiting to sync" value={String(store.pending.length)} tone={store.pending.length ? 'warn' : 'success'} />
                <MiniStat label="Conflicts" value={String(store.conflicts.length)} tone={store.conflicts.length ? 'danger' : 'success'} />
                <MiniStat label="Source" value={store.usingCache ? 'Device cache' : store.mode === 'demo' ? 'Demo workspace' : 'Live database'} tone="neutral" />
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="primary" icon={RefreshCcw} onClick={() => setSyncOpen(true)}>Open sync centre</Button>
                <Button variant="subtle" icon={RefreshCw} onClick={() => store.flushNow()} disabled={!store.online || !store.pending.length}>Sync now</Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="How merging works" sub="Documented policy — never silent" icon={Scale} />
            <div className="card-body stack" style={{ gap: 8 }}>
              {[
                ['Money & status', 'A change to a total, paid amount, invoice status, appointment status or token always waits for a human decision.'],
                ['Everything else', 'Merged field by field: if you edited the notes and reception edited the phone number, both survive.'],
                ['New records', 'Created on this device with an id, so replaying the queue can never duplicate a patient.'],
                ['Deleted elsewhere', 'Your offline edit cannot attach to a deleted row; it is queued for review so nothing is lost silently.'],
              ].map(([title, body]) => (
                <div key={title} className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--success)', marginTop: 2 }}><Check size={14} strokeWidth={3} /></span>
                  <div><strong className="small">{title}</strong><p className="tiny muted">{body}</p></div>
                </div>
              ))}
              <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
                <WifiOff size={14} className="muted" />
                <span className="muted">Cached data is stored per user and clinic, expires after 24 hours, and is wiped on sign out.</span>
              </div>
            </div>
          </Card>
        </div>

      <SyncCenter open={syncOpen} onClose={() => setSyncOpen(false)} />
    </>
  );
}
