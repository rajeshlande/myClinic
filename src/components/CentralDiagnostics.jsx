import { useEffect, useState } from 'react';
import { Globe2, RefreshCw, ShieldQuestion, TriangleAlert, WifiOff } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { Badge, Button, Card, CardHead, useToast } from './ui.jsx';
import { formatExpiry } from '../lib/license.mjs';
import { centralCodeNote, centralMatchLabel, centralStatusLabel } from '../lib/central-sync.mjs';

/**
 * Central Auto-Sync, as the operator needs to see it.
 *
 * The central project records nothing when it refuses — it inserts a machine row
 * only on the allowed path — so "the client never called", "the client called and
 * was refused" and "this build has no central project configured" all look the
 * same on the dashboard: *Awaiting Connect*. This card makes the client's own
 * state readable, which is the difference between a support call that can be
 * answered and one that cannot.
 *
 * It never prints a key, the seal pepper or a seal: those are not the operator's
 * to compare, and they are not what goes wrong.
 */

const SOURCE_LABEL = {
  owner: 'the owner’s staff row',
  clinic: 'the clinic’s own email',
  billing: 'the subscription’s billing email',
  session: 'the signed-in user',
  none: 'nowhere — no address resolved',
};

function Fact({ label, children }) {
  return (
    <div className="stack" style={{ gap: 2, minWidth: 0 }}>
      <span className="eyebrow">{label}</span>
      <span className="small" style={{ overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

export default function CentralDiagnostics() {
  const store = useStore();
  const toast = useToast();
  const diagnostics = store.centralDiagnostics ?? {};
  const central = store.centralSync ?? { enabled: false };
  const verdict = central.verdict ?? null;
  const probe = diagnostics.probe ?? null;

  const [revealEmail, setRevealEmail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [syncNote, setSyncNote] = useState('');

  // The ten-second hold on the readiness probe lives here as a visible countdown,
  // and in the store as the real guard. One interval, cleared on unmount.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Owners only: the card names an email address and a device id.
  if (store.role !== 'owner') return null;

  const configured = Boolean(central.enabled);
  const emailKnown = Boolean(diagnostics.email);
  const tone = central.state === 'offline' ? 'warn' : verdict?.allowed === false ? 'danger' : configured ? 'success' : 'neutral';

  const runSync = async () => {
    setSyncing(true);
    setSyncNote('');
    try {
      const result = await store.syncCentralNow({ silent: false });
      if (!result) setSyncNote('Nothing was sent: this build is not in live mode, or Central is not configured.');
      else if (result.allowed) setSyncNote(result.offline ? 'Offline — the sealed lease answered instead of Central.' : 'Central allowed this clinic.');
      else setSyncNote(`${result.code || 'REFUSED'} — ${result.reason || 'Central refused this clinic.'}`);
    } catch (e) {
      setSyncNote(e.message ?? 'The sync failed before Central answered.');
      toast.error(e.message ?? 'Central Auto-Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const runProbe = async () => {
    setProbing(true);
    setCooldown(10);
    try {
      await store.probeCentral();
    } finally {
      setProbing(false);
    }
  };

  return (
    <Card style={{ marginBottom: 16 }} id="central-diagnostics">
      <CardHead
        title="Central Auto-Sync"
        sub="What this build sends to the central subscription service, and what came back. No key, no seal and no token is ever shown here."
        icon={Globe2}
        action={<Badge tone={tone} dot>{configured ? (verdict ? centralStatusLabel(verdict.status) : 'Configured') : 'Not configured'}</Badge>}
      />
      <div className="card-body stack" style={{ gap: 12 }}>
        <div className="grid two" style={{ gap: 12, alignItems: 'start' }}>
          {/* ---------------------------------------------------------- what we send */}
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <Fact label="Configured">
              {configured ? <span style={{ color: 'var(--success)' }}>Yes — this build can ask Central.</span> : <span style={{ color: 'var(--warn)' }}>No</span>}
            </Fact>
            {!configured ? (
              <div className="row" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '10px 12px', borderRadius: 11, alignItems: 'flex-start' }}>
                <TriangleAlert size={14} style={{ marginTop: 2, flex: 'none' }} />
                <span className="tiny">
                  {diagnostics.error
                    || 'Central Auto-Sync is not configured in this build — VITE_CENTRAL_SUPABASE_URL and VITE_CENTRAL_SUPABASE_ANON_KEY are empty. Add both as repository Variables and re-run the deploy.'}
                </span>
              </div>
            ) : null}

            <Fact label="Central project">{diagnostics.host ? <span className="mono">{diagnostics.host}</span> : '—'}</Fact>

            <Fact label="Mode">
              {diagnostics.mode !== 'live'
                ? 'Demo — this build has no Supabase session, so Central is never called. Sign in first.'
                : configured
                  ? 'Live — the licence comes from this clinic’s database, so Central is asked.'
                  : 'Live — but Central Auto-Sync is off in this build, so nothing is asked.'}
            </Fact>

            <Fact label={`Identity sent (${SOURCE_LABEL[diagnostics.emailSource] ?? 'unknown'})`}>
              {emailKnown ? (
                <span className="row wrap" style={{ gap: 8 }}>
                  <span className="mono">{revealEmail ? diagnostics.email : diagnostics.emailMasked}</span>
                  <button
                    type="button"
                    className="tiny"
                    onClick={() => setRevealEmail((value) => !value)}
                    style={{ background: 'none', border: 0, padding: 0, color: 'var(--brand-600)', cursor: 'pointer' }}
                  >
                    {revealEmail ? 'hide' : 'show'}
                  </button>
                </span>
              ) : (
                <span style={{ color: 'var(--warn)' }}>
                  No address resolved. Central’s row is pinned on the owner email, so a call with an empty one cannot match it — set the owner’s email on
                  {' '}<strong>Doctors &amp; staff</strong> (or the clinic email in <strong>Settings → Clinic</strong>) to the address pinned on Central.
                  {' '}The call is still attempted, because a URL-only licence on Central is matched without an email.
                </span>
              )}
            </Fact>

            <Fact label="Origin sent">
              <span className="mono">{diagnostics.origin || '—'}</span>
              <span className="tiny faint" style={{ display: 'block', marginTop: 2 }}>
                scheme + host only. Central compares this against the row’s pinned URL, so a path such as <span className="mono">/myClinic</span> must not be pinned.
              </span>
            </Fact>

            <Fact label="Device id">
              <span className="mono">{diagnostics.deviceId ? `${diagnostics.deviceId.slice(0, 8)}…` : 'not created yet'}</span>
              <span className="tiny faint" style={{ display: 'block', marginTop: 2 }}>
                Central binds a cloud origin to <span className="mono">web:&lt;origin&gt;</span> and counts that, not this id.
              </span>
            </Fact>
          </div>

          {/* -------------------------------------------------------- last answer */}
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <Fact label="Last attempt">
              {central.syncedAt ? (
                <span>
                  {formatExpiry(central.syncedAt)} · {new Date(central.syncedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  {verdict?.fromCache ? ' (cached lease)' : ''}
                </span>
              ) : 'No attempt on this device yet.'}
            </Fact>

            {verdict ? (
              <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <Badge tone={verdict.allowed ? 'success' : 'danger'} dot>{verdict.allowed ? 'Allowed' : 'Refused'}</Badge>
                  <Badge tone="neutral">{centralStatusLabel(verdict.status)}</Badge>
                  {verdict.code ? <Badge tone="neutral">{verdict.code}</Badge> : null}
                  {verdict.offline ? <Badge tone="warn">Offline</Badge> : null}
                </div>
                {verdict.matchMode ? (
                  <span className="tiny muted">{centralMatchLabel(verdict.matchMode)}</span>
                ) : null}
                {verdict.reason ? (
                  <span className="tiny" style={{ overflowWrap: 'anywhere' }}>{verdict.reason}</span>
                ) : null}
                {centralCodeNote(verdict.code) ? (
                  <span className="tiny faint" style={{ overflowWrap: 'anywhere' }}>{centralCodeNote(verdict.code)}</span>
                ) : null}
                {verdict.offline && verdict.expiresAt ? (
                  <span className="tiny faint">
                    Sealed lease in force until {formatExpiry(verdict.expiresAt)}
                    {verdict.graceUntil ? ` · grace until ${formatExpiry(verdict.graceUntil)}` : ''}
                  </span>
                ) : null}
                {central.error && !verdict.reason ? (
                  <span className="tiny" style={{ color: 'var(--danger)', overflowWrap: 'anywhere' }}>{central.error}</span>
                ) : null}
              </div>
            ) : (
              <span className="tiny muted">
                {configured
                  ? 'This device has not asked Central yet — the first sync happens after sign-in.'
                  : 'Nothing to ask: Central Auto-Sync is off in this build.'}
              </span>
            )}

            {central.state === 'offline' ? (
              <div className="row" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '10px 12px', borderRadius: 11, alignItems: 'flex-start' }}>
                <WifiOff size={14} style={{ marginTop: 2, flex: 'none' }} />
                <span className="tiny">
                  Central could not be reached, so the sealed lease is keeping this clinic writable. That is not a verdict — it is an outage.
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* ------------------------------------------------------------- actions */}
        <div className="row wrap" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10, alignItems: 'center' }}>
          <Button
            variant="primary"
            icon={RefreshCw}
            loading={syncing || central.state === 'syncing'}
            onClick={runSync}
            disabled={!configured}
          >
            Sync now
          </Button>
          <Button
            variant="subtle"
            icon={ShieldQuestion}
            loading={probing}
            onClick={runProbe}
            disabled={!configured || probing || cooldown > 0}
          >
            {cooldown > 0 ? `Test again in ${cooldown}s` : 'Test Central connection'}
          </Button>
          {syncNote ? <span className="tiny" style={{ overflowWrap: 'anywhere' }}>{syncNote}</span> : null}
        </div>

        {probe ? (() => {
          // A build that cannot open a socket is not an outage: it gets the danger
          // tone and its own words, so the two can never be confused again.
          const buildFault = probe.code === 'FETCH_UNAVAILABLE' || probe.code === 'CLIENT_ERROR';
          return (
            <div
              className="row"
              style={{
                gap: 8,
                padding: '10px 12px',
                borderRadius: 11,
                alignItems: 'flex-start',
                background: probe.ok ? 'var(--success-bg, var(--surface-2))' : buildFault ? 'var(--danger-bg)' : 'var(--warn-bg)',
                color: probe.ok ? 'var(--success)' : buildFault ? 'var(--danger)' : 'var(--warn)',
              }}
            >
              <ShieldQuestion size={14} style={{ marginTop: 2, flex: 'none' }} />
              <span className="tiny" style={{ overflowWrap: 'anywhere' }}>
                <strong>
                  Readiness probe{probe.code ? ` · ${probe.code}` : ''}
                  {probe.at ? ` · ${new Date(probe.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}:{' '}
                </strong>
                {probe.ok
                  ? `the central project answered, the RPC exists and reports schema v${probe.schemaVersion ?? '?'}. This proves reachability — not that this clinic is licensed.`
                  : (probe.error || 'the probe did not succeed.')}
                {centralCodeNote(probe.code) ? ` ${centralCodeNote(probe.code)}` : ''}
              </span>
            </div>
          );
        })() : null}

        {configured ? (
          <span className="tiny faint">
            The probe sends an empty email and origin with a health-check device id, so it cannot create a machine, move a heartbeat or spend a seat.
            A green probe next to a refused sync means the network is fine and the <strong>pair</strong> — owner email and origin — is what Central does not recognise.
          </span>
        ) : null}
      </div>
    </Card>
  );
}
