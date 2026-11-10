import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { Button, Field, Modal, Select, useToast } from './ui.jsx';
import {
  assignmentLimit, branchesForStaff, canAssignMultipleBranches, validateAssignments,
} from '../lib/branch-config.mjs';

/**
 * One dialog shared by Doctors & staff and Settings → Branches. The rules are
 * pure (`branch-config.mjs`); this component only renders them. Owners get
 * checkboxes, doctors and front desk get one select — exactly the decision in
 * docs/PLAN-v1.33.md §9.
 */
export default function BranchAssignmentModal({
  open, onClose, member, branches = [], assignments = [], onSave,
}) {
  const toast = useToast();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(branchesForStaff(member?.id, assignments, branches).map((b) => b.id));
  }, [open, member?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeBranches = branches.filter((b) => b.active);
  const validIds = activeBranches.map((b) => b.id);
  const check = validateAssignments({ role: member?.role, branchIds: selected, validBranchIds: validIds });
  const multi = canAssignMultipleBranches(member?.role);
  const limit = assignmentLimit(member?.role);

  const save = async () => {
    if (!check.ok || !member) return;
    setBusy(true);
    try {
      await onSave(member.id, check.ids);
      toast.success(`Branches updated for ${member.full_name}.`);
      onClose();
    } catch (e) {
      toast.error(e.message ?? 'Could not save branches.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign branches"
      sub={member ? `${member.full_name} · ${member.role}` : ''}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={GitBranch} loading={busy} disabled={!check.ok} onClick={save}>
            Save branches
          </Button>
        </>
      )}
    >
      <div className="stack" style={{ gap: 12 }}>
        <p className="tiny muted">
          {multi
            ? 'Owners can be assigned several branches and see all of them.'
            : `Doctors and front-desk seats are assigned exactly one branch (limit ${limit}).`}
        </p>
        {multi ? (
          <div className="stack" style={{ gap: 8 }}>
            {activeBranches.map((branch) => (
              <label key={branch.id} className="row small" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(branch.id)}
                  onChange={(e) => setSelected((prev) => (
                    e.target.checked ? [...prev, branch.id] : prev.filter((id) => id !== branch.id)
                  ))}
                />
                <strong>{branch.name}</strong>
                <span className="tiny faint mono">{branch.code}</span>
              </label>
            ))}
          </div>
        ) : (
          <Field label="Branch" htmlFor="branch-assignment-select">
            <Select
              id="branch-assignment-select"
              value={selected[0] ?? ''}
              onChange={(e) => setSelected(e.target.value ? [e.target.value] : [])}
            >
              <option value="">Choose a branch</option>
              {activeBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </Select>
          </Field>
        )}
        {!check.ok ? <p className="tiny" style={{ color: 'var(--danger)' }}>{check.message}</p> : null}
      </div>
    </Modal>
  );
}
