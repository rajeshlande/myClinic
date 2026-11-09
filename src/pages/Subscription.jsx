import { useState } from 'react';
import {
  BadgeCheck, CalendarClock, Check, CreditCard, Download, IndianRupee, ReceiptText, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, WifiOff,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useAuth } from '../lib/auth-context.jsx';
import { Badge, Button, Card, CardHead, Modal, useToast } from '../components/ui.jsx';
import { PLANS, downloadFile, formatMoney, toCSV, today } from '../lib/logic.mjs';
import {
  GRACE_DAYS, billingPeriod, canWrite, formatExpiry, licenseHeadline, licenseTone,
  planPrice, upgradeCost,
} from '../lib/license.mjs';
import { APP_VERSION } from '../lib/version.js';
import { CENTRAL_GRACE_NOTE, centralMatchLabel, centralStatusLabel } from '../lib/central-sync.mjs';

const PLAN_BLURB = {
  solo: 'One doctor, one front desk. The whole clinic on a single screen.',
  growth: 'The usual pick for a busy multi-doctor OPD.',
  chain: 'Clinic groups and polyclinics with billing at branch level.',
};

function money(paise) { return formatMoney(paise ?? 0); }

export default function Subscription() {
  const store = useStore();
  const { user } = useAuth();
  const toast = useToast();
  const license = store.license;
  const [open, setOpen] = useState(null);          // plan id being purchased
  // Two different questions, kept apart: `period` is what the clinic actually
  // bought (it decides the renewal term and the price on the status card), while
  // `shopPeriod` is the toggle inside the plan dialog (it only previews prices).
  const period = license?.interval === 'yearly' ? 'yearly' : 'monthly';
  const term = billingPeriod({ interval: period });
  const [shopPeriod, setShopPeriod] = useState(period);
  const [billing, setBilling] = useState({ name: store.clinic?.name ?? '', email: store.clinic?.email ?? user?.email ?? '', phone: store.clinic?.phone ?? '', gstin: store.clinic?.gstin ?? '', collection_ref: '' });
  const [busy, setBusy] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [reference, setReference] = useState('');

  /**
   * Central Auto-Sync takes precedence over everything local: when it is
   * configured, the plan on this screen came from the central project, the local
   * plan picker has nothing to sell, and "renew" is a button that would be
   * refused by the store anyway (it throws `CENTRAL_MANAGED_MESSAGE`).
   */
  const central = store.centralSync ?? { enabled: false };
  const centrallyManaged = Boolean(central.enabled);
  const centralVerdict = central.verdict ?? null;
  const centralPlan = centralVerdict?.plan ?? license?.plan ?? 'solo';
  const centralStatusText = central.state === 'offline'
    ? 'Offline grace'
    : centralStatusLabel(centralVerdict?.status ?? (license?.status === 'expired' ? 'expired' : 'active'));
  const centralTone = central.state === 'syncing' || central.state === 'idle'
    ? 'neutral'
    : central.state === 'offline'
      ? 'warn'
      : centralVerdict?.allowed === false
        ? 'danger'
        : 'success';

  const isOwner = store.role === 'owner';
  const writable = canWrite(license);
  const plan = license?.plan ?? 'growth';
  const seats = store.licenseSeats ?? [];

  /**
   * The contract's own window. `license.startsAt` is the date the central
   * project issued with the plan; `license.endsAt` is its expiry. Both are
   * printed verbatim — a blank card is honest, a guessed date is not.
   */
  const startsAt = license?.startsAt ?? null;
  const endsAt = license?.endsAt ?? null;

  const buy = async () => {
    if (!isOwner) { toast.error('Only the clinic owner can change the subscription.'); return; }
    setBusy(true);
    try {
      await store.changePlan({ plan: open, interval: shopPeriod, billing });
      toast.success(`${PLANS.find((p) => p.id === open)?.name} plan activated.`);
      setOpen(null);
    } catch (e) {
      toast.error(e.message ?? 'Could not change the plan.');
    } finally { setBusy(false); }
  };

  const renew = async () => {
    if (!isOwner) { toast.error('Only the clinic owner can renew the subscription.'); return; }
    setBusy(true);
    try {
      // The term comes from the subscription, not from the dialog's price toggle:
      // a yearly clinic that had been browsing monthly prices still buys a year.
      await store.renewSubscription({ reference: reference.trim(), months: term.months });
      toast.success('Subscription renewed. The clinic is writable again.');
      setRenewOpen(false); setReference('');
    } catch (e) {
      toast.error(e.message ?? 'Could not renew the subscription.');
    } finally { setBusy(false); }
  };

  const syncCentrally = async () => {
    setBusy(true);
    try {
      const result = await store.syncCentralNow();
      if (!result) toast.error('Central Auto-Sync is not configured for this build.');
      else if (result.allowed) {
        toast.success(result.offline
          ? `Offline — the sealed licence is still in force until ${formatExpiry(result.expiresAt)}.`
          : `Licence confirmed: ${PLANS.find((p) => p.id === result.plan)?.name ?? result.plan} until ${formatExpiry(result.expiresAt)}.`);
      } else toast.error(result.reason || 'The central subscription service refused this clinic.');
    } catch (e) {
      toast.error(e.message ?? 'Central Auto-Sync failed.');
    } finally { setBusy(false); }
  };

  const exportBilling = () => {
    // A centrally issued plan has terms this build does not know: it knows the
    // plan and both dates, not the price or the billing interval. Those cells are
    // left empty rather than filled with the local catalogue's numbers.
    const row = [{
      clinic: store.clinic?.name ?? '',
      plan: centrallyManaged ? `Central · ${centralPlan}` : plan,
      status: license?.status ?? '',
      interval: centrallyManaged ? '' : period,
      starts: startsAt ? formatExpiry(startsAt) : '',
      ends: endsAt ? formatExpiry(endsAt) : '',
      price_paise: centrallyManaged ? '' : (planPrice(plan, { interval: period }) ?? 0) / 100,
      reference: license?.collectionRef ?? '',
      generated_on: today(),
    }];
    downloadFile(`myclinic-subscription-${today()}.csv`, toCSV(row, [
      { label: 'Clinic', key: 'clinic' }, { label: 'Plan', key: 'plan' }, { label: 'Status', key: 'status' },
      { label: 'Interval', key: 'interval' }, { label: 'Starts', key: 'starts' }, { label: 'Valid until', key: 'ends' },
      { label: 'Amount (INR)', key: 'price_paise' }, { label: 'Reference', key: 'reference' },
      { label: 'Generated', key: 'generated_on' },
    ]));
    toast.success('Subscription summary exported.');
  };

  return (
    <div className="page" style={{ padding: '4px 20px 96px', maxWidth: 1180, margin: '0 auto' }}>
      {/* ---------------------------------------------------------- the one card */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead
          title="Your subscription"
          sub={store.mode === 'demo' ? 'Demo workspace' : 'Live workspace'}
          icon={BadgeCheck}
          action={(
            <Badge tone={centrallyManaged ? centralTone : licenseTone(license)} dot>
              {centrallyManaged ? centralStatusText : licenseHeadline(license)}
            </Badge>
          )}
        />
        <div className="card-body stack" style={{ gap: 14 }}>
          {/* plan · start · end — the three facts a clinic asks for */}
          <div className="grid three" style={{ gap: 14, alignItems: 'start' }}>
            <div className="stack" style={{ gap: 5 }}>
              <span className="eyebrow">Plan</span>
              <strong style={{ fontSize: '1.35rem' }}>{PLANS.find((p) => p.id === centralPlan)?.name ?? centralPlan}</strong>
              {centrallyManaged ? (
                <span className="tiny muted">
                  {centralVerdict?.tier ? `Central tier: ${centralVerdict.tier}` : 'Not verified on this device yet'}
                </span>
              ) : (
                <>
                  <span className="tiny muted">{period === 'yearly' ? 'Yearly' : 'Monthly'} billing</span>
                  <div className="kpi-value mono" style={{ fontSize: '1.3rem' }}>
                    {money(planPrice(plan, { interval: period }))}
                    <span className="tiny faint"> /{term.short}</span>
                  </div>
                  {license?.collectionRef ? <span className="tiny faint">Collection ref: {license.collectionRef}</span> : null}
                </>
              )}
            </div>

            <div className="stack" style={{ gap: 5 }}>
              <span className="eyebrow">Start date</span>
              <strong className="mono" style={{ fontSize: '1.05rem' }}>{startsAt ? formatExpiry(startsAt) : '—'}</strong>
              <span className="tiny muted">
                {startsAt
                  ? (centrallyManaged ? 'Issued with the plan by Central' : 'Beginning of this billing period')
                  : (centrallyManaged ? 'Central did not send a start date' : 'No start date recorded')}
              </span>
            </div>

            <div className="stack" style={{ gap: 5 }}>
              <span className="eyebrow">End date</span>
              <strong className="mono" style={{ fontSize: '1.05rem' }}>{endsAt ? formatExpiry(endsAt) : '—'}</strong>
              <span className="tiny muted">
                {typeof license?.daysLeft === 'number'
                  ? (license.daysLeft > 0 ? `${license.daysLeft} days left` : 'This period has ended')
                  : 'No period end set'}
              </span>
              {centrallyManaged && centralVerdict?.graceUntil ? (
                <span className="tiny faint">Offline grace until {formatExpiry(centralVerdict.graceUntil)}</span>
              ) : null}
            </div>
          </div>

          {/* seats */}
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">Seats</span>
            {seats.map((row) => (
              <div key={row.id} className="stack" style={{ gap: 4 }}>
                <div className="row small" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">{row.label}</span>
                  <span className="mono strong">{row.used} / {row.unlimited ? '∞' : row.limit}</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ width: `${row.unlimited ? 6 : row.percent}%`, height: '100%', borderRadius: 99, background: row.over ? 'var(--danger)' : row.full ? 'var(--warn)' : 'var(--brand-500)' }} />
                </div>
              </div>
            ))}
            {seats.some((r) => r.full && r.id !== 'branches') ? (
              <span className="tiny" style={{ color: 'var(--warn)' }}>
                <TriangleAlert size={11} /> A seat limit is reached — upgrade to add more staff.
              </span>
            ) : null}
          </div>

          {/* where the plan comes from, and how fresh that answer is */}
          {centrallyManaged ? (
            <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div className="row wrap" style={{ gap: 10, justifyContent: 'space-between' }}>
                <span className="tiny muted">
                  {centralVerdict?.matchMode ? centralMatchLabel(centralVerdict.matchMode) : 'Match mode unknown until the first sync'}
                </span>
                <span className="tiny faint">
                  {central.syncedAt
                    ? `Last synced ${formatExpiry(central.syncedAt)} · ${new Date(central.syncedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Not synced on this device yet'}
                </span>
              </div>
              <span className="tiny faint">{CENTRAL_GRACE_NOTE}</span>

              {central.error ? (
                <div className="row" style={{ gap: 8, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '10px 12px', borderRadius: 11 }}>
                  <TriangleAlert size={14} />
                  <span className="tiny">{central.error}</span>
                </div>
              ) : null}

              {central.state === 'offline' ? (
                <div className="row" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '10px 12px', borderRadius: 11 }}>
                  <WifiOff size={14} />
                  <span className="tiny">
                    The central service could not be reached. This clinic keeps writing on its sealed cached licence until
                    {' '}{endsAt ? formatExpiry(endsAt) : 'it expires'} — after that it becomes read-only,
                    and every patient record stays readable and exportable throughout.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* actions */}
          <div className="row wrap" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10, alignItems: 'center' }}>
            {centrallyManaged ? (
              isOwner ? (
                <>
                  <Button variant="primary" icon={RefreshCw} loading={busy || central.state === 'syncing'} onClick={syncCentrally}>
                    Sync now
                  </Button>
                  <span className="tiny muted">
                    Plan, seat limits and both dates are issued by Central — they are changed in the Control Room, not here.
                  </span>
                </>
              ) : (
                <span className="tiny muted">Only the clinic owner can ask Central to re-check the subscription.</span>
              )
            ) : isOwner ? (
              <>
                <Button variant="primary" icon={Sparkles} onClick={() => setOpen(plan)}>Change plan</Button>
                <Button variant="subtle" icon={CalendarClock} onClick={() => setRenewOpen(true)}>Record a payment</Button>
              </>
            ) : (
              <span className="tiny muted">Only the clinic owner can change the subscription.</span>
            )}
            <Button variant="ghost" icon={Download} onClick={exportBilling}>Export summary</Button>
            {isOwner && !writable && !centrallyManaged ? (
              <Button variant="subtle" icon={BadgeCheck} onClick={() => store.startTrial().then(() => toast.success('Trial restarted.')).catch((e) => toast.error(e.message))}>
                Restart 14-day trial
              </Button>
            ) : null}
            <span className="tiny faint mono" style={{ marginLeft: 'auto' }}>build v{APP_VERSION}</span>
          </div>
        </div>
      </Card>
      {/* ---------------------------------------------------------- plan grid */}
      <div className="grid three" style={{ gap: 14 }}>
        {PLANS.map((p) => {
          const current = p.id === plan;
          const cost = upgradeCost(plan, p.id, { interval: shopPeriod });
          return (
            <Card key={p.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
              {p.popular && !current ? (
                <span className="badge brand" style={{ position: 'absolute', top: -11, left: 18 }}>Most chosen</span>
              ) : null}
              {current ? (
                <span className="badge success" style={{ position: 'absolute', top: -11, right: 18 }}>Current</span>
              ) : null}
              <div className="card-body stack" style={{ gap: 10, flex: 1 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{p.name}</h3>
                  <p className="tiny muted" style={{ margin: '3px 0 0' }}>{PLAN_BLURB[p.id]}</p>
                </div>
                <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                  <span className="kpi-value mono" style={{ fontSize: '1.4rem' }}>{money(planPrice(p.id, { interval: shopPeriod }))}</span>
                  <span className="tiny faint">/{shopPeriod === 'yearly' ? 'yr' : 'mo'}</span>
                </div>
                {shopPeriod === 'yearly' ? (
                  <span className="tiny" style={{ color: 'var(--success)' }}>Two months free versus monthly</span>
                ) : null}
                <Badge tone="neutral">{p.limits}</Badge>
                <ul className="tiny muted" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 5 }}>
                  {p.features.map((f) => (
                    <li key={f} className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                      <Check size={12} strokeWidth={3} style={{ marginTop: 3, color: 'var(--brand-500)' }} /> {f}
                    </li>
                  ))}
                </ul>
                <span className="spacer" style={{ flex: 1 }} />
                {current ? (
                  <Button variant="subtle" className="block" disabled>Current plan</Button>
                ) : (
                  <Button
                    variant={p.popular ? 'primary' : 'subtle'}
                    className="block"
                    disabled={!isOwner || centrallyManaged}
                    onClick={() => setOpen(p.id)}
                  >
                    {centrallyManaged
                      ? 'Managed centrally'
                      : cost?.direction === 'upgrade' ? `Upgrade · +${money(cost.delta)}` : cost?.direction === 'downgrade' ? 'Downgrade' : 'Switch'}
                  </Button>
                )}
                {cost && !current ? (
                  <span className="tiny faint" style={{ textAlign: 'center' }}>
                    {cost.direction === 'downgrade' ? `Save ${money(-cost.delta)} / ${shopPeriod === 'yearly' ? 'yr' : 'mo'}` : `${money(cost.to)} billed ${shopPeriod}`}
                  </span>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      {/* ---------------------------------------------------------- what a plan does not change */}
      <Card style={{ marginTop: 16 }}>
        <CardHead title="What never changes on any plan" sub="Licensing must not hold patient data hostage" icon={ShieldCheck} />
        <div className="card-body grid two" style={{ gap: 10 }}>
          {[
            ['Your data stays readable', 'Even expired, every chart, prescription and invoice opens — and CSV export always works.'],
            ['Nothing is deleted on expiry', 'Lapsing pauses writes. It never removes records, staff or history.'],
            ['Enforced in the database', `Seat limits and the read-only gate are Postgres triggers and RLS, not just UI. Grace period: ${GRACE_DAYS} days.`],
            ['No card data in myClinic', 'Collection references are recorded (UPI, bank transfer, reseller). Card details never touch this app.'],
          ].map(([title, body]) => (
            <div key={title} className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
              <BadgeCheck size={15} style={{ marginTop: 2, color: 'var(--success)' }} />
              <div>
                <strong className="small" style={{ display: 'block' }}>{title}</strong>
                <span className="tiny muted">{body}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ---------------------------------------------------------- export hook for the banner */}
      <button id="license-export" onClick={exportBilling} style={{ display: 'none' }} aria-hidden="true" />

      {/* ---------------------------------------------------------- change-plan modal */}
      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open && open === plan
          ? `Billing for the ${PLANS.find((p) => p.id === open)?.name ?? ''} plan`
          : `Switch to ${PLANS.find((p) => p.id === open)?.name ?? ''}`}
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="segmented">
            {['monthly', 'yearly'].map((i) => (
              <button key={i} className={shopPeriod === i ? 'active' : ''} onClick={() => setShopPeriod(i)}>
                {i === 'yearly' ? 'Yearly · save 20%' : 'Monthly'}
              </button>
            ))}
          </div>
          <div className="card pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
            <div className="row small" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{PLANS.find((p) => p.id === open)?.name} · {shopPeriod}</span>
              <strong className="mono">{money(planPrice(open, { interval: shopPeriod }))}</strong>
            </div>
            <span className="tiny faint">Inclusive of the 18% GST shown on your invoice. Cancel any time — the plan stays active until the period ends.</span>
          </div>

          <div className="grid two" style={{ gap: 10 }}>
            {[['name', 'Billing name'], ['email', 'Billing email'], ['phone', 'Billing phone'], ['gstin', 'GSTIN (optional)']].map(([key, label]) => (
              <label key={key} className="field" style={{ margin: 0 }}>
                <span className="tiny muted">{label}</span>
                <input className="input" value={billing[key] ?? ''} onChange={(e) => setBilling((b) => ({ ...b, [key]: e.target.value }))} />
              </label>
            ))}
          </div>

          <div className="row" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '10px 12px', borderRadius: 11 }}>
            <IndianRupee size={14} />
            <span className="tiny">This marks the plan active in your own project. Money collection stays outside myClinic — record the UPI/bank reference in Settings or the payment dialog.</span>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={buy} icon={CreditCard}>
              {open && open === plan ? 'Update plan' : `Activate ${PLANS.find((p) => p.id === open)?.name ?? ''}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- renewal modal */}
      <Modal open={renewOpen} onClose={() => setRenewOpen(false)} title="Record a payment">
        <div className="stack" style={{ gap: 12 }}>
          <p className="small muted" style={{ margin: 0 }}>
            Renews from {license?.endsAt && new Date(license.endsAt) > new Date() ? formatExpiry(license.endsAt) : 'today'} for{' '}
            <strong>{term.label}</strong> at{' '}
            <strong className="mono">{money(planPrice(plan, { interval: period }))}</strong> — the clinic is on{' '}
            <strong>{period}</strong> billing.
          </p>
          <label className="field" style={{ margin: 0 }}>
            <span className="tiny muted">Collection reference (UPI / bank / reseller)</span>
            <input className="input" placeholder="e.g. UPI 4213… / INV-8891" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={() => setRenewOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={renew} icon={ReceiptText}>Mark as paid &amp; renew</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
