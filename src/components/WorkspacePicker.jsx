import { workspaceChoices } from '../lib/workspace-controller.mjs';

/** Inert controlled view. No Auth/client creation, effects, storage or routing.
 * The future v2 gate supplies snapshots/callbacks; App.jsx does NOT import this.
 */
export default function WorkspacePicker({ snapshot = {}, onChoose, onReload, onLogout }) {
  const busy = ['LOADING', 'CONNECTING', 'SIGNING_OUT'].includes(snapshot.state);
  const rows = workspaceChoices(snapshot);
  const message = ({
    SIGNED_OUT: 'Sign in to Master to discover your workspaces.',
    LOADING: 'Checking your Master session and workspace access…',
    CHOOSE_WORKSPACE: 'Choose a workspace to open securely.',
    CONNECTING: 'Verifying workspace access…',
    NOT_READY: 'Workspace access is not enabled yet. Contact your administrator.',
    READY: 'Your selected workspace is connected.',
    SIGNING_OUT: 'Closing the clinic session and signing out…',
    ERROR: 'The workspace could not be opened safely. Retry or sign out.',
    DISPOSED: 'This workspace session is closed.',
  })[snapshot.state] ?? 'Load your workspaces to continue.';
  return (
    <section className="card workspace-picker" aria-label="Clinic workspaces" aria-busy={busy}>
      <h2>Choose a workspace</h2>
      <p role="status" aria-live="polite">{message}</p>
      {rows.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className="btn" style={{ width: '100%', whiteSpace: 'normal', textAlign: 'left' }}
                disabled={busy || !row.ready || snapshot.state === 'DISPOSED'}
                aria-pressed={row.selected} onClick={() => onChoose?.(row.id)}>
                <span>{row.label}</span>
                <span> · {row.role} · {row.ready ? 'Available' : 'Not ready'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : !busy ? <p>No accessible workspaces are loaded.</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="btn" disabled={busy || snapshot.state === 'DISPOSED'} onClick={() => onReload?.()}>Reload workspaces</button>
        <button type="button" className="btn" disabled={snapshot.state === 'SIGNING_OUT' || snapshot.state === 'DISPOSED'} onClick={() => onLogout?.()}>Sign out</button>
      </div>
    </section>
  );
}
