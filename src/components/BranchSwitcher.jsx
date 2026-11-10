import { GitBranch } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { useToast } from './ui.jsx';
import { ALL_BRANCH_SCOPE } from '../lib/branch-scope.mjs';

/**
 * One control decides which branch the lists, reports and badges are looking at.
 * An owner gets a selector with `All branches` plus every visible branch; a
 * doctor or front desk gets a plain label, because their seat has exactly one
 * assignment and no switcher. The real branch for new rows is never `all`.
 */
export default function BranchSwitcher({ compact = false } = {}) {
  const store = useStore();
  const toast = useToast();
  const options = store.branchOptions ?? [];
  const label = store.branchScopeLabel ?? 'Main branch';
  const canSwitch = Boolean(store.canSwitchBranches && options.length);
  const value = store.branchScope ?? options[0]?.id ?? '';
  const note = store.branchScope === ALL_BRANCH_SCOPE
    ? `Viewing ${label}. New entries go to ${store.activeBranchLabel ?? 'the active branch'}.`
    : `Branch: ${label}`;

  async function change(event) {
    try {
      await store.setBranchScope(event.target.value);
    } catch (e) {
      toast.error(e.message ?? 'Could not change the branch view.');
    }
  }

  if (!store.ready) return null;
  return (
    <div className={`branch-switcher${compact ? ' compact' : ''}`} title={note}>
      <GitBranch size={14} strokeWidth={2.2} aria-hidden="true" />
      {canSwitch ? (
        <select aria-label="Branch view" value={value} onChange={change}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      ) : (
        <span className="branch-static truncate" aria-label="Your branch">{label}</span>
      )}
    </div>
  );
}
