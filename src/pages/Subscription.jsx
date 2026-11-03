import { useState } from 'react';
import {
  BadgeCheck, CalendarClock, Check, CreditCard, Download, IndianRupee, ReceiptText,
  ShieldCheck, Sparkles, TriangleAlert, Users,
} from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useAuth } from '../lib/auth-context.jsx';
import { Badge, Button, Card, CardHead, Modal, useToast } from '../components/ui.jsx';
import { PLANS, downloadFile, formatMoney, toCSV, today } from '../lib/logic.mjs';
import {
  GRACE_DAYS, TRIAL_DAYS, canWrite, formatExpiry, licenseHeadline, licenseTone,
  planPrice, upgradeCost,
} from '../lib/license.mjs';

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
  const [interval, setInterval] = useState(license?.interval === 'yearly' ? 'yearly' : 'monthly');
  const [billing, setBilling] = useState({ name: store.clinic?.name ?? '', email: store.clinic?.email ?? user?.email ?? '', phone: store.clinic?.phone ?? '', gstin: store.clinic?.gstin ?? '', collection_ref: '' });
  const [busy, setBusy] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [reference, setReference] = useState('');

  const isOwner = store.role === 'owner';
  const writable = canWrite(license);
  const plan = license?.plan ?? 'growth';
  const seats = store.licenseSeats ?? [];

  const buy = async () => {
    if (!isOwner) { toast.error('Only the clinic owner can change the subscription.'); return; }
    setBusy(true);
    try {
      await store.changePlan({ plan: open, interval, billing });
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
      await store.renewSubscription({ reference: reference.trim(), months: interval === 'yearly' ? 12 : 1 });
      toast.success('Subscription renewed. The clinic is writable again.');
      setRenewOpen(false); setReference('');
    } catch (e) {
      toast.error(e.message ?? 'Could not renew the subscription.');
    } finally { setBusy(false); }
  };

  const exportBilling = () => {
    const row = [{
      clinic: store.clinic?.name ?? '',
      plan,
      status: license?.status ?? '',
      interval: license?.interval ?? 'monthly',
      ends: license?.endsAt ? formatExpiry(license.endsAt) : '',
      price_paise: (planPrice(plan, { interval: license?.interval ?? 'monthly' }) ?? 0) / 100,
      reference: license?.collection_ref ?? '',
      generated_on: today(),
    }];
    downloadFile(`myclinic-subscription-${today()}.csv`, toCSV(row, [
      { label: 'Clinic', key: 'clinic' }, { label: 'Plan', key: 'plan' }, { label: 'Status', key: 'status' },
      { label: 'Interval', key: 'interval' }, { label: 'Valid until', key: 'ends' },
      { label: 'Amount (INR)', key: 'price_paise' }, { label: 'Reference', key: 'reference' },
      { label: 'Generated', key: 'generated_on' },
    ]));
    toast.success('Subscription summary exported.');
  };

  return (
    <div className="page" style={{ padding: '4px 20px 96px', maxWidth: 1180, margin: '0 auto' }}>
      {/* ---------------------------------------------------------- status card */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead
          title="Your subscription"
          sub={`${store.mode === 'demo' ? 'Demo workspace' : 'Live workspace'} · schema v3 licensing`}
          icon={BadgeCheck}
          action={<Badge tone={licenseTone(license)} dot>{licenseHeadline(license)}</Badge>}
        />
        <div className="card-body">
          <div className="grid two" style={{ gap: 14, alignItems: 'start' }}>
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">Plan</span>
              <div className="row" style={{ gap: 8 }}>
                <strong style={{ fontSize: '1.35rem' }}>{PLANS.find((p) => p.id === plan)?.name ?? plan}</strong>
                <Badge tone="neutral">{license?.interval === 'yearly' ? 'Yearly' : 'Monthly'}</Badge>
              </div>
              <div className="kpi-value mono" style={{ fontSize: '1.5rem' }}>
                {money(planPrice(plan, { interval: license?.interval ?? 'monthly' }))}
                <span className="tiny faint"> /{license?.interval === 'yearly' ? 'yr' : 'mo'}</span>
              </div>
              <span className="tiny muted">
                {license?.status === 'trial'
                  ? `Trial started ${formatExpiry(license.endsAt ? new Date(new Date(license.endsAt).getTime() - TRIAL_DAYS * 86400000) : null)} · ends ${formatExpiry(license?.endsAt)}`
                  : license?.endsAt
                    ? `${license?.status === 'active' ? 'Renews' : 'Valid until'} ${formatExpiry(license?.endsAt)}`
                    : 'No period end set'}
              </span>
              {license?.collection_ref ? <span className="tiny faint">Collection ref: {license.collection_ref}</span> : null}
            </div>

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
          </div>

          <div className="row wrap" style={{ gap: 8, marginTop: 16 }}>
            {isOwner ? (
              <>
                <Button variant="primary" icon={Sparkles} onClick={() => setOpen(plan === 'chain' ? 'chain' : plan)}>Change plan</Button>
                <Button variant="subtle" icon={CalendarClock} onClick={() => setRenewOpen(true)}>Record a payment</Button>
              </>
            ) : (
              <span className="tiny muted">Only the clinic owner can change the subscription.</span>
            )}
            <Button variant="ghost" icon={Download} onClick={exportBilling}>Export summary</Button>
            {store.mode === 'demo' && license?.status !== 'trial' ? null : null}
            {isOwner && !writable ? (
              <Button variant="subtle" icon={BadgeCheck} onClick={() => store.startTrial().then(() => toast.success('Trial restarted.')).catch((e) => toast.error(e.message))}>
                Restart 14-day trial
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------- plan grid */}
      <div className="grid three" style={{ gap: 14 }}>
        {PLANS.map((p) => {
          const current = p.id === plan;
          const cost = upgradeCost(plan, p.id, { interval });
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
                  <span className="kpi-value mono" style={{ fontSize: '1.4rem' }}>{money(planPrice(p.id, { interval }))}</span>
                  <span className="tiny faint">/{interval === 'yearly' ? 'yr' : 'mo'}</span>
                </div>
                {interval === 'yearly' ? (
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
                    disabled={!isOwner}
                    onClick={() => { setOpen(p.id); setInterval(prev => prev); }}
                  >
                    {cost?.direction === 'upgrade' ? `Upgrade · +${money(cost.delta)}` : cost?.direction === 'downgrade' ? 'Downgrade' : 'Switch'}
                  </Button>
                )}
                {cost && !current ? (
                  <span className="tiny faint" style={{ textAlign: 'center' }}>
                    {cost.direction === 'downgrade' ? `Save ${money(-cost.delta)} / ${interval === 'yearly' ? 'yr' : 'mo'}` : `${money(cost.to)} billed ${interval}`}
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
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={`Switch to ${PLANS.find((p) => p.id === open)?.name ?? ''}`}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="segmented">
            {['monthly', 'yearly'].map((i) => (
              <button key={i} className={interval === i ? 'active' : ''} onClick={() => setInterval(i)}>
                {i === 'yearly' ? 'Yearly · save 20%' : 'Monthly'}
              </button>
            ))}
          </div>
          <div className="card pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
            <div className="row small" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{PLANS.find((p) => p.id === open)?.name} · {interval}</span>
              <strong className="mono">{money(planPrice(open, { interval }))}</strong>
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
            <Button variant="primary" loading={busy} onClick={buy} icon={CreditCard}>Activate {PLANS.find((p) => p.id === open)?.name}</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- renewal modal */}
      <Modal open={renewOpen} onClose={() => setRenewOpen(false)} title="Record a payment">
        <div className="stack" style={{ gap: 12 }}>
          <p className="small muted" style={{ margin: 0 }}>
            Renews from {license?.endsAt && new Date(license.endsAt) > new Date() ? formatExpiry(license.endsAt) : 'today'} for{' '}
            <strong>{interval === 'yearly' ? '12 months' : '1 month'}</strong> at{' '}
            <strong className="mono">{money(planPrice(plan, { interval }))}</strong>.
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
