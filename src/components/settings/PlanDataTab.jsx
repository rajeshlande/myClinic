/**
 * Plan & data: the current plan, the seat meters, and the export/import and demo reset
 * actions, with the plan picker and reset confirmation they open. Extracted verbatim
 * from Settings.jsx in v1.30.0 (docs/ARCHITECTURE.md §3 step 4) — markup and copy
 * unchanged. v1.35.5 removes only the bottom "myClinic v1.0 · connected · …"
 * census card; the plan, seats, exports and reset actions are unchanged.
 */

import { PLANS, downloadFile, formatMoney, toCSV, today } from '../../lib/logic.mjs';
import { planLimits, planRow } from '../../lib/plans.mjs';
import { currentInterval, currentPlan, isCentralManaged } from '../../lib/current-plan.mjs';
import { Badge, Button, Card, CardHead, Modal } from '../ui.jsx';
import { Download, RefreshCw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useStore } from '../../lib/store.jsx';
import { clearDemoSnapshot } from '../../lib/offline-cache.js';
import { useToast } from '../ui.jsx';

/** A null cap is unlimited — printed as ∞, the way the seat meters show it. */
const cap = (n) => (n === null ? '∞' : n);

export default function PlanDataTab({ planOpen, setPlanOpen, resetOpen, setResetOpen, exportAll, clinic }) {
  const store = useStore();
  const toast = useToast();
  // v1.35.6: the licence / Central verdict is the plan; `clinics.plan` is only
  // a legacy fallback. See docs/PLAN-v1.33.md §15.
  const activePlan = currentPlan(store);
  const centralManaged = isCentralManaged(store);
  const canChangePlan = !centralManaged;
  return (
    <>
        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Your plan" sub={store.mode === 'demo' ? 'Demo workspace' : 'Live workspace'} icon={Sparkles}
              action={<Badge tone="brand">{planRow(activePlan).name}</Badge>} />
            <div className="card-body">
              <div className="row wrap" style={{ gap: 14 }}>
                <div>
                  <span className="eyebrow">Current</span>
                  {centralManaged ? (
                    <div className="kpi-value mono" style={{ fontSize: '1.5rem' }}>Issued by Central</div>
                  ) : (
                    <div className="kpi-value mono" style={{ fontSize: '1.5rem' }}>{formatMoney(planRow(activePlan).price_paise ?? 0)}<span className="tiny faint"> /mo</span></div>
                  )}
                </div>
                <span className="spacer" />
                {centralManaged ? (
                  <span className="tiny muted">Plan is managed by Central Auto-Sync.</span>
                ) : (
                  <Button variant="primary" icon={Sparkles} onClick={() => setPlanOpen(true)}>Change plan</Button>
                )}
              </div>
              <div className="grid three" style={{ gap: 8, marginTop: 14 }}>
                {[
                  ['Doctors', `${store.doctors.length} / ${cap(planLimits(activePlan).doctors)}`],
                  ['Front desk', `${store.frontDesk.length} / ${cap(planLimits(activePlan).frontdesk)}`],
                  ['Patients', String(store.patients.length)],
                ].map(([label, value]) => (
                  <div key={label} className="card pad" style={{ padding: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
                    <span className="tiny faint">{label}</span><div className="strong mono small">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Your data" sub="Export or reset the workspace" icon={Download} />
            <div className="card-body stack">
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="subtle" icon={Download} onClick={exportAll}>Export patients (CSV)</Button>
                <Button variant="subtle" icon={Download} onClick={() => { downloadFile(`myclinic-invoices-${today()}.csv`, toCSV(store.invoices, [{ label: 'Invoice', key: 'number' }, { label: 'Date', key: 'issued_on' }, { label: 'Total', value: (i) => (i.total_paise / 100).toFixed(2) }, { label: 'Paid', value: (i) => (i.paid_paise / 100).toFixed(2) }, { label: 'Method', key: 'method' }, { label: 'Status', key: 'status' }])); toast.success('Invoice export downloaded.'); }}>Export invoices (CSV)</Button>
              </div>
              <p className="tiny muted">Exports include only this clinic’s records. No patient data leaves your account unless you download it.</p>
              {store.mode === 'demo' ? (
                <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, gap: 8, flexWrap: 'wrap' }}>
                  <Button variant="subtle" icon={RefreshCw} onClick={() => { store.resetDemo(); toast.success('Demo workspace reset.'); }}>Reset demo data</Button>
                  <Button variant="danger" icon={Trash2} onClick={() => setResetOpen(true)}>Clear this browser’s demo</Button>
                </div>
              ) : (
                <div className="row small" style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11, gap: 8 }}>
                  <ShieldCheck size={14} className="muted" />
                  <span className="muted">Live workspace — records live in your Supabase project and are never deleted by this app.</span>
                </div>
              )}
            </div>
          </Card>

        </div>

      <Modal open={planOpen && canChangePlan} onClose={() => setPlanOpen(false)} title="Change plan" sub="Switch any time — data stays put">
        <div className="stack">
          {PLANS.map((plan) => (
            <div key={plan.id} className="row" style={{ gap: 12, border: `1px solid ${activePlan === plan.id ? 'var(--brand-500)' : 'var(--border)'}`, borderRadius: 12, padding: 12 }}>
              <div className="stack" style={{ gap: 2, flex: 1 }}>
                <div className="row" style={{ gap: 6 }}>
                  <strong className="small">{plan.name}</strong>
                  {plan.popular ? <Badge tone="brand">Popular</Badge> : null}
                  {activePlan === plan.id ? <Badge tone="success">Current</Badge> : null}
                </div>
                <span className="tiny muted">{plan.limits}</span>
              </div>
              <span className="strong mono small">{formatMoney(plan.price_paise, { compact: true })}/mo</span>
              <Button size="sm" variant={activePlan === plan.id ? 'subtle' : 'primary'} disabled={activePlan === plan.id || centralManaged}
                onClick={async () => {
                  try {
                    await store.changePlan({ plan: plan.id, interval: currentInterval(store), billing: {} });
                    toast.success(`Switched to ${plan.name}.`);
                    setPlanOpen(false);
                  } catch (e) { toast.error(e.message ?? 'Could not change plan.'); }
                }}>
                {activePlan === plan.id ? 'Active' : 'Switch'}
              </Button>
            </div>
          ))}
          {centralManaged ? (
            <p className="tiny faint">Central Auto-Sync issues this plan. Change it in the Control Room, not here.</p>
          ) : null}
          <p className="tiny faint">Billing is simulated in this build. Wire a payment provider before charging real clinics.</p>
        </div>
      </Modal>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Clear demo data?"
        footer={<><Button variant="ghost" onClick={() => setResetOpen(false)}>Keep it</Button><Button variant="danger" onClick={() => { clearDemoSnapshot(); store.resetDemo(); toast.success('Demo cleared and rebuilt.'); setResetOpen(false); }}>Clear and rebuild</Button></>}>
        <p className="small muted">This only clears the fictional demo workspace stored in this browser. Nothing is sent or deleted anywhere else.</p>
      </Modal>
    </>
  );
}
