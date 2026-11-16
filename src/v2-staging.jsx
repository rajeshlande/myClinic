import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import WorkspaceGate from './components/WorkspaceGate.jsx';
import { mountClinicalClient } from './lib/clinical-client.js';
import { createStagingRuntime, stagingConfig } from './lib/v2-staging-runtime.mjs';

// Deliberately not main.jsx: no legacy Auth/Store, PHI cache, PWA or SW registration.
// Controller construction is outside React effects, including StrictMode replay.
const config = stagingConfig(import.meta.env);
const runtime = config.ok ? createStagingRuntime({env:import.meta.env,createClient,mountClinicalClient}) : null;
function Staging() {
  const snapshot = useSyncExternalStore(runtime.controller.subscribe,runtime.controller.getSnapshot,runtime.controller.getSnapshot);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);setMessage('');
    const email = String(fields.get('email') ?? '');
    const password = String(fields.get('password') ?? '');
    form.reset();fields.delete('password');
    try { await runtime.signIn(email,password); }
    catch { setMessage('Sign-in refused or unavailable. No legacy fallback was attempted.'); }
    finally { setBusy(false); }
  }
  return <>
    {snapshot.state === 'SIGNED_OUT' ? <form onSubmit={login}>
      <h2>Sign in to Central — synthetic test account only</h2>
      <label>Email <input name="email" type="email" autoComplete="off" required disabled={busy}/></label><br/>
      <label>Password <input name="password" type="password" autoComplete="off" required disabled={busy}/></label><br/>
      <button disabled={busy}>{busy?'Checking…':'Sign in and discover workspaces'}</button>
    </form> : null}
    <p role="status">{message}</p>
    <p>Boundary state: <strong>{snapshot.state}</strong></p>
    {snapshot.errorCode ? <p role="alert">Blocked: {snapshot.errorCode}. Verify the reviewed Central/broker contract; do not enable flags to bypass this.</p> : null}
    <WorkspaceGate controller={runtime.controller}>
      <section><h2>Workspace token/client boundary ready</h2>
        <p>This means local boot and token/client checks passed. It does not prove gateway/RLS acceptance. No clinical query or write was sent by this page.</p>
        <p>Dashboard, patients, billing and Drive backups are intentionally unavailable in this staging slice.</p>
        <button onClick={()=>runtime.controller.boot()}>Return to workspace selection</button>
        <button onClick={()=>runtime.controller.logout()}>Sign out of staging</button>
      </section>
    </WorkspaceGate>
  </>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><main style={{maxWidth:850,margin:'32px auto',padding:24,fontFamily:'system-ui',lineHeight:1.7}}>
  <h1>v2 staging — trust boundary test</h1>
  <p><strong>Synthetic users only. Not a production clinic.</strong> This is a separate entry point, not the migrated clinical app.</p>
  <p>Use a private browser window. No stored legacy session or clinic cache is read, migrated or deleted. Reload discards the in-memory staging login. Existing same-origin service workers are not removed; a dedicated staging origin is still recommended.</p>
  {runtime ? <Staging/> : <p role="alert">Staging blocked: expected Central public configuration is missing or invalid. No authentication or clinical request was started. Configure only the reviewed VITE_CENTRAL_SUPABASE_URL and VITE_CENTRAL_SUPABASE_ANON_KEY build inputs.</p>}
</main></React.StrictMode>);
