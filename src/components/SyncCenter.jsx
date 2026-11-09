import { useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Check, CheckCheck, CloudOff, Cloud, RefreshCw, Scale, Trash2, ChevronRight, Database, WifiOff,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast, Badge, Button, Modal } from './ui.jsx';
import { describeOp } from '../lib/offline.js';
import { formatMoney } from '../lib/logic.mjs';

function whenLabel(iso) {
  if (!iso) return 'never';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Thin bar pinned to the bottom of the viewport: offline / pending / conflicts. */
export function SyncBadge({ onOpen }) {
  const store = useStore();
  const { online, pending, conflicts, syncState, flushNow } = store;
  const [busy, setBusy] = useState(false);

  if (online && !pending.length && !conflicts.length && syncState !== 'syncing') return null;

  const tone = conflicts.length ? 'conflict' : !online ? 'offline' : pending.length ? 'pending' : 'syncing';
  const copy = {
    conflict: `${conflicts.length} change${conflicts.length > 1 ? 's' : ''} need${conflicts.length > 1 ? '' : 's'} your decision`,
    offline: `${pending.length ? `${pending.length} change${pending.length > 1 ? 's' : ''} saved on this device · ` : ''}working offline`,
    pending: `${pending.length} change${pending.length > 1 ? 's' : ''} waiting to sync`,
    syncing: 'Syncing to your clinic…',
  }[tone];

  return (
    <button className={`syncbar ${tone}`} data-store="1" onClick={onOpen} type="button">
      <span className="syncbar-icon">
        {tone === 'conflict' ? <AlertTriangle size={14} />
          : tone === 'offline' ? <CloudOff size={14} />
            : tone === 'syncing' ? <RefreshCw size={14} className="spin" />
              : <ArrowUpFromLine size={14} />}
      </span>
      <span className="syncbar-text">{copy}</span>
      {online && pending.length ? (
        <span
          className="syncbar-action"
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); setBusy(true); Promise.resolve(flushNow()).finally(() => setBusy(false)); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); flushNow(); } }}
        >
          {busy ? 'Syncing…' : 'Sync now'}
        </span>
      ) : null}
      <ChevronRight size={14} className="syncbar-chevron" />
    </button>
  );
}

/** Full sync panel: status, queue, conflict resolution, cache controls. */
export function SyncCenter({ open, onClose }) {
  const store = useStore();
  const toast = useToast();
  const { online, pending, conflicts, syncState, lastSyncedAt, usingCache, flushNow } = store;
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(null);

  const syncNow = async () => {
    setBusy(true);
    try {
      await flushNow();
      toast.success('Everything on this device is in your clinic database.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <Modal
        open={open} onClose={onClose}
        title="Offline & sync"
        sub="Changes are saved on this device first, then sent to Supabase when you are online"
        footer={<>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={RefreshCw} onClick={syncNow} loading={busy} disabled={!online || (!pending.length && !conflicts.length)}>
            Sync now
          </Button>
        </>}
      >
        <div className="stack" style={{ gap: 14 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px,100%),1fr))', gap: 10 }}>
            <Stat icon={online ? Cloud : WifiOff} label="Connection" value={online ? 'Online' : 'Offline'} tone={online ? 'success' : 'warn'} />
            <Stat icon={ArrowUpFromLine} label="Waiting to sync" value={String(pending.length)} tone={pending.length ? 'warn' : 'success'} />
            <Stat icon={Scale} label="Needs a decision" value={String(conflicts.length)} tone={conflicts.length ? 'danger' : 'success'} />
            <Stat icon={CheckCheck} label="Last synced" value={whenLabel(lastSyncedAt)} tone="neutral" />
          </div>

          {usingCache ? (
            <div className="row small" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn-ink)', padding: '10px 12px', borderRadius: 11 }}>
              <Database size={14} />
              <span>You are reading this device’s cached copy of the clinic. It is used only while the server is unreachable and expires after 24 hours.</span>
            </div>
          ) : null}

          <section>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <strong className="small">Pending changes</strong>
              <Badge tone={pending.length ? 'warn' : 'neutral'}>{pending.length}</Badge>
            </div>
            {pending.length ? (
              <div className="stack" style={{ gap: 6 }}>
                {pending.map((op) => (
                  <div key={op.id} className="row" style={{ gap: 9, background: 'var(--surface-2)', padding: '9px 11px', borderRadius: 10 }}>
                    <span className={`sync-dot ${op.attempts ? 'warn' : ''}`} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="small strong truncate">{describeOp(op, store.patients)}</div>
                      <div className="tiny faint">
                        {op.type === 'create' ? 'New record · ' : op.type === 'delete' ? 'Deletion · ' : 'Edit · '}
                        queued {whenLabel(op.queued_at)}
                        {op.attempts ? ` · ${op.attempts} failed attempt${op.attempts > 1 ? 's' : ''}` : ''}
                      </div>
                      {op.last_error ? <div className="tiny" style={{ color: 'var(--danger)' }}>{String(op.last_error).slice(0, 140)}</div> : null}
                    </div>
                    <Badge tone={op.attempts ? 'danger' : 'warn'}>{op.attempts ? 'Retrying' : 'Queued'}</Badge>
                  </div>
                ))}
              </div>
            ) : <p className="small muted">Nothing waiting — every change on this device is in the database.</p>}
          </section>

          <section>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <strong className="small">Conflicts</strong>
              <Badge tone={conflicts.length ? 'danger' : 'neutral'}>{conflicts.length}</Badge>
            </div>
            {conflicts.length ? (
              <div className="stack" style={{ gap: 8 }}>
                {conflicts.map((c) => (
                  <div key={c.id} className="card pad" style={{ padding: 12, boxShadow: 'none' }}>
                    <div className="row" style={{ gap: 8 }}>
                      <AlertTriangle size={14} style={{ color: 'var(--warn)' }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="small strong">
                          {c.kind === 'field' ? `Both sides changed ${c.fields.map((f) => f.field.replace(/_/g, ' ')).join(', ')}`
                            : c.kind === 'deleted-remotely' && isOwnProfileRow(c) ? 'This account has no profile row in the database'
                              : c.kind === 'deleted-remotely' ? 'This record was deleted at the clinic'
                                : 'The clinic database rejected this change'}
                        </div>
                        <div className="tiny muted">
                          {c.kind === 'field' ? `${c.table} · choose which value to keep`
                            : c.kind === 'deleted-remotely' && isOwnProfileRow(c) ? 'Your name and preferences have nowhere to attach to yet. Recreate writes the row now.'
                              : c.kind === 'deleted-remotely' ? 'Your offline edit cannot be applied. Discard it, or recreate the record.'
                                : c.message}
                        </div>
                      </div>
                      <Button size="sm" variant="subtle" onClick={() => setResolving(c)}>Review</Button>
                    </div>
                    {c.kind === 'field' ? (
                      <div className="tiny faint" style={{ marginTop: 6 }}>
                        {c.fields.map((f) => (
                          <div key={f.field}>
                            <code>{f.field}</code>: yours <strong>{renderValue(c.table, f.field, f.local)}</strong> · clinic <strong>{renderValue(c.table, f.field, f.remote)}</strong>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <p className="small muted">No conflicts. Edits to the same record are merged field by field, newest change per field.</p>}
          </section>

          <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
            <ArrowDownToLine size={14} className="muted" />
            <span className="muted">
              Cached data is stored per user and per clinic on this device, expires after 24 hours, and is wiped when you sign out.
            </span>
          </div>
        </div>
      </Modal>

      <ResolveConflict
        conflict={resolving} onClose={() => setResolving(null)} store={store}
        onResolved={(msg) => { setResolving(null); toast.success(msg); }}
      />
    </>
  );
}

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <div className={`card pad sync-stat ${tone}`} style={{ padding: 11, boxShadow: 'none' }}>
      <span className="row tiny muted" style={{ gap: 6 }}><Icon size={12} /> {label}</span>
      <div className="small strong" style={{ marginTop: 3 }}>{value}</div>
    </div>
  );
}

/** A conflict on the signed-in user's own profile row — the one row we can rebuild. */
function isOwnProfileRow(conflict) {
  return conflict?.table === 'profiles';
}

function renderValue(table, field, value) {
  if (value == null) return '—';
  if (/_paise$/.test(field) && typeof value === 'number') return formatMoney(value);
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 40);
  return String(value).slice(0, 40);
}

function ResolveConflict({ conflict, onClose, store, onResolved }) {
  const [choices, setChoices] = useState({});
  if (!conflict) return null;

  const apply = async (winner) => {
    await store.resolveConflict(conflict, winner);
    onResolved('Conflict resolved.');
  };

  if (conflict.kind !== 'field') {
    const ownProfile = isOwnProfileRow(conflict);
    return (
      <Modal open onClose={onClose} title="Review change" sub={conflict.table}
        footer={<>
          <Button variant="ghost" icon={Trash2} onClick={() => { store.dismissConflict(conflict.id); onResolved('Change discarded.'); }}>Discard my change</Button>
          {conflict.kind === 'rejected' ? <Button variant="primary" onClick={() => apply('local')}>Try again</Button> : null}
          {conflict.kind === 'deleted-remotely' && ownProfile
            ? <Button variant="primary" icon={Check} onClick={() => apply('recreate')}>Recreate my profile</Button>
            : null}
        </>}>
        <div className="stack" style={{ gap: 10 }}>
          <p className="small muted">
            {conflict.kind === 'deleted-remotely' && ownProfile
              ? 'Your account profile row is not in the database — it was never written, usually because the account was created before the database had the trigger that writes it. Nobody deleted anything: the row is yours and its id is known, so Recreate writes it now, with these values. Saving in Settings will also do this from now on.'
              : conflict.kind === 'deleted-remotely'
                ? 'Someone at the clinic deleted this record while you were offline, so your edit has nothing to attach to. Discarding is the safe choice; if the record is still needed, re-create it.'
                : conflict.message}
          </p>
          <pre className="mono tiny" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10, overflowX: 'auto', margin: 0 }}>
            {JSON.stringify(conflict.local, null, 2).slice(0, 700)}
          </pre>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Resolve conflict"
      sub="These fields changed both here and at the clinic"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Later</Button>
        <Button variant="primary" icon={Check} onClick={() => apply(choices)}>Apply choices</Button>
      </>}>
      <div className="stack" style={{ gap: 10 }}>
        {conflict.fields.map((f) => (
          <div key={f.field} className="card pad" style={{ padding: 12, boxShadow: 'none' }}>
            <div className="small strong" style={{ marginBottom: 8 }}>{f.field.replace(/_/g, ' ')}</div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {['local', 'remote'].map((side) => {
                const selected = (choices[f.field] ?? 'remote') === side;
                return (
                  <button
                    key={side} type="button" onClick={() => setChoices((c) => ({ ...c, [f.field]: side }))}
                    className={`conflict-choice ${selected ? 'selected' : ''}`}
                  >
                    <span className="tiny faint">{side === 'local' ? 'This device' : 'Clinic database'}</span>
                    <span className="small strong">{renderValue(conflict.table, f.field, side === 'local' ? f.local : f.remote)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="tiny faint">Money and status fields are never merged automatically — they always wait for your decision.</p>
      </div>
    </Modal>
  );
}
