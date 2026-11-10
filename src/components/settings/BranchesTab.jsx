import { useState } from 'react';
import { GitBranch, MapPin, Plus, Users } from 'lucide-react';
import { Badge, Button, Card, CardHead, Field, Input, Modal, Select, useToast } from '../ui.jsx';
import { useStore } from '../../lib/store.jsx';
import { currentPlan } from '../../lib/current-plan.mjs';
import { planLabel, planLimits } from '../../lib/plans.mjs';
import {
  ROLE_OWNER, assignmentLimit, staffBranchBadge, visibleBranchIds,
} from '../../lib/branch-config.mjs';
import BranchAssignmentModal from '../BranchAssignmentModal.jsx';

/**
 * Settings → Branches (schema 20). One owner, one parent clinic, many child
 * branches. The plan cap, assignment cardinality and active-branch visibility
 * all come from pure modules; this panel only renders and calls the store.
 */
export default function BranchesTab({ } = {}) {
  const store = useStore();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState(null);

  const plan = currentPlan(store);
  const cap = planLimits(plan).branches;
  const branches = store.branches ?? [];
  const assignments = store.staffBranches ?? [];
  const active = branches.filter((b) => b.active);
  const staff = (store.staff ?? []).filter((s) => s.active);
  const owner = store.role === ROLE_OWNER;
  const canAdd = owner && (cap === null || active.length < cap);
  const visible = visibleBranchIds(store.role, store.currentStaff?.id, assignments, branches);
  const activeName = branches.find((b) => b.id === store.activeBranchId)?.name ?? 'None';

  const add = async () => {
    if (!name.trim()) { toast.error('Give the branch a name.'); return; }
    setBusy(true);
    try {
      await store.createBranch({ name });
      toast.success(`${name.trim()} was added.`);
      setName('');
      setAddOpen(false);
    } catch (e) {
      toast.error(e.message ?? 'Could not add the branch.');
    } finally {
      setBusy(false);
    }
  };

  const switchBranch = async (branchId) => {
    if (!branchId || branchId === store.activeBranchId) return;
    try {
      await store.setActiveBranch(branchId);
      toast.success('Active branch changed.');
    } catch (e) {
      toast.error(e.message ?? 'Could not change branch.');
    }
  };

  return (
    <>
      <div className="stack" style={{ gap: 16 }}>
        <Card>
          <CardHead
            title="Branches"
            sub={`One clinic · ${active.length} branch${active.length === 1 ? '' : 'es'} · ${planLabel(plan)} plan`}
            icon={GitBranch}
            action={canAdd ? <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>Add branch</Button> : null}
          />
          <div className="card-body stack" style={{ gap: 12 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <div className="stack" style={{ gap: 2, flex: 1, minWidth: 220 }}>
                <span className="eyebrow">Active branch</span>
                <Select
                  aria-label="Active branch"
                  value={store.activeBranchId ?? ''}
                  onChange={(e) => switchBranch(e.target.value)}
                  disabled={!owner || visible.length === 0}
                >
                  {visible.length ? visible.map((id) => {
                    const branch = branches.find((b) => b.id === id);
                    return branch ? <option key={id} value={id}>{branch.name}</option> : null;
                  }) : <option value="">No branches yet</option>}
                </Select>
              </div>
              <Badge tone={cap === null ? 'info' : 'neutral'}>
                {cap === null ? 'Unlimited branches' : `${active.length} / ${cap} branches`}
              </Badge>
            </div>
            {!canAdd && owner ? (
              <p className="tiny muted">
                The {planLabel(plan)} plan allows {cap} branch{cap === 1 ? '' : 'es'}. Upgrade to add another.
              </p>
            ) : null}
            {!owner ? (
              <p className="tiny muted">Only the clinic owner can create branches or change assignments.</p>
            ) : null}
            {!branches.length ? (
              <p className="tiny muted">
                This workspace has no branches yet. Paste <code>supabase/schema.sql</code> into the Supabase SQL editor
                to apply schema 20; existing clinics get a Main branch automatically.
              </p>
            ) : (
              <div className="grid two" style={{ gap: 10 }}>
                {branches.map((branch) => {
                  const assigned = assignments.filter((a) => a.branch_id === branch.id && a.active).length;
                  return (
                    <div key={branch.id} className="card pad" style={{ padding: 12, background: 'var(--surface-2)', boxShadow: 'none' }}>
                      <div className="row" style={{ gap: 8 }}>
                        <MapPin size={14} className="muted" />
                        <strong className="small">{branch.name}</strong>
                        <span className="spacer" />
                        {branch.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                      </div>
                      <span className="tiny faint mono">{branch.code}</span>
                      <div className="tiny muted" style={{ marginTop: 6 }}>{assigned} staff assigned</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Staff assignments" sub="Owners may hold several branches; doctors and front desk hold one" icon={Users} />
          <div className="card-body stack" style={{ gap: 8 }}>
            {staff.length ? staff.map((row) => (
              <div key={row.id} className="row wrap" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <div className="stack" style={{ gap: 2, flex: 1, minWidth: 200 }}>
                  <strong className="small">{row.full_name}</strong>
                  <span className="tiny muted">{row.role} · {staffBranchBadge(row.id, assignments, branches)}</span>
                </div>
                <Badge tone="neutral">{assignmentLimit(row.role) === null ? 'Multiple' : 'One branch'}</Badge>
                {owner ? (
                  <Button size="sm" variant="subtle" icon={GitBranch} onClick={() => setMember(row)}>Assign</Button>
                ) : null}
              </div>
            )) : <p className="tiny muted">No active staff yet.</p>}
          </div>
        </Card>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a branch"
        sub="Branches belong to this clinic and share its patients and subscription"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={Plus} loading={busy} onClick={add}>Add branch</Button>
          </>
        )}
      >
        <Field label="Branch name" htmlFor="branch-name">
          <Input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bandra West" />
        </Field>
        <p className="tiny muted">A code is generated from the name. {cap === null ? 'This plan has no branch limit.' : `This plan allows ${cap} branch${cap === 1 ? '' : 'es'}.`}</p>
      </Modal>

      <BranchAssignmentModal
        open={Boolean(member)}
        onClose={() => setMember(null)}
        member={member}
        branches={branches}
        assignments={assignments}
        onSave={store.assignStaffBranches}
      />
    </>
  );
}
