import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase.js';
import { makeDemoWorkspace } from './demo-data.js';
import { nextId } from './logic.mjs';
import { licenseState, canWrite, seatUsage } from './license.mjs';
import { TRIAL_DAYS } from './license.mjs';
import {
  TABLES, readCache, writeCache, clearAllCache, readOutbox, writeOutbox, enqueue,
  newClientId, replayOutbox, readSyncMeta, writeSyncMeta,
} from './offline.js';

const DEMO_KEY = 'myclinic.demo.v1';
const StoreContext = createContext(null);

const emptyState = {
  clinic: null, profile: null, staff: [], patients: [], appointments: [], consultations: [],
  invoices: [], day_closes: [], reminders: [], subscription: null,
};
const STATE_TABLES = ['staff', 'patients', 'appointments', 'consultations', 'invoices', 'day_closes', 'reminders'];

function readDemo() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.clinic ? parsed : null;
  } catch { return null; }
}
function writeDemo(state) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); } catch { /* quota / private mode */ }
}

export function StoreProvider({ children, session }) {
  const [mode, setMode] = useState(supabaseConfigured && session ? 'live' : 'demo');
  const [state, setState] = useState(emptyState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // ---- offline / sync surface -------------------------------------------------
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [pending, setPending] = useState([]);          // outbox, mirrored for the UI
  const [conflicts, setConflicts] = useState([]);      // needs a human
  const [syncState, setSyncState] = useState('idle');  // idle | syncing | offline | error
  const [lastSyncedAt, setLastSyncedAt] = useState(() => readSyncMeta().lastSyncedAt ?? null);
  const [usingCache, setUsingCache] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const writableRef = useRef(true);
  const flushing = useRef(false);
  const userId = session?.user?.id ?? null;

  /* ------------------------------------------------------------------ demo mode */
  const bootDemo = useCallback(() => {
    const cached = readDemo();
    const next = cached ?? makeDemoWorkspace();
    if (!next.subscription) {
      const startedAt = new Date();
      next.subscription = {
        clinic_id: next.clinic?.id ?? 'demo-clinic',
        plan: next.clinic?.plan ?? 'growth',
        status: 'trial',
        interval: 'monthly',
        trial_ends_at: new Date(startedAt.getTime() + TRIAL_DAYS * 86400000).toISOString(),
        current_period_end: null,
        billing_email: '',
        collection_ref: 'DEMO-TRIAL',
      };
    }
    writeDemo(next);          // persist immediately: offline demos survive a reload
    setState({ ...next });
    setMode('demo');
    setReady(true);
    return next;
  }, []);

  /* ------------------------------------------------------------------ live load */
  const loadLive = useCallback(async ({ quiet = false } = {}) => {
    if (!session) return;
    if (!quiet) { setError(''); setReady(false); }
    try {
      const { data: profile, error: pErr } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (pErr) throw pErr;

      const { data: memberships, error: mErr } = await supabase.from('staff').select('*').eq('user_id', session.user.id);
      if (mErr) throw mErr;

      const mine = memberships?.[0];
      if (!mine) {
        setState({ ...emptyState, profile: profile ?? null });
        setNeedsOnboarding(true);
        setUsingCache(false);
        setMode('live');
        return;
      }

      const { data: clinic, error: cErr } = await supabase.from('clinics').select('*').eq('id', mine.clinic_id).single();
      if (cErr) throw cErr;

      // Tables added by a later schema are read tolerantly: a database that has
      // not been migrated yet must not blank the clinic, it just has no rows.
      const optional = async (query) => {
        const result = await query;
        const missing = result.error && (result.error.code === '42P01'
          || /relation .* does not exist/i.test(result.error.message ?? ''));
        return missing ? { data: [], error: null, missing: true } : result;
      };

      const results = await Promise.all([
        supabase.from('staff').select('*').eq('clinic_id', clinic.id).order('created_at'),
        supabase.from('patients').select('*').eq('clinic_id', clinic.id).order('created_at', { ascending: false }),
        supabase.from('appointments').select('*').eq('clinic_id', clinic.id).order('scheduled_on'),
        supabase.from('consultations').select('*').eq('clinic_id', clinic.id).order('visited_on', { ascending: false }),
        supabase.from('invoices').select('*').eq('clinic_id', clinic.id).order('issued_on', { ascending: false }),
        optional(supabase.from('day_closes').select('*').eq('clinic_id', clinic.id).order('closed_on', { ascending: false })),
        optional(supabase.from('reminders').select('*').eq('clinic_id', clinic.id).order('logged_on', { ascending: false })),
      ]);
      const failure = results.find((r) => r.error);
      if (failure) throw failure.error;

      // Licence: the server is authoritative. A failure here must not blank the
      // clinic, so it degrades to "read-only, unknown plan" for the banner only.
      const { data: licenseRow } = await supabase.rpc('license_state', { p_clinic: clinic.id });

      const next = {
        clinic,
        profile: profile ?? { id: session.user.id, full_name: session.user.email, theme: 'system' },
        staff: results[0].data ?? [],
        patients: results[1].data ?? [],
        appointments: results[2].data ?? [],
        consultations: results[3].data ?? [],
        invoices: results[4].data ?? [],
        day_closes: results[5].data ?? [],
        reminders: results[6].data ?? [],
        // schema 7 is what day close and the reminder log need; without it the
        // pages explain themselves instead of failing a write.
        schemaReady: !(results[5].missing || results[6].missing),
        subscription: licenseRow ?? null,
      };
      setState(next);
      writeCache(session.user.id, clinic.id, next);      // scoped + TTL'd
      setNeedsOnboarding(false);
      setMode('live');
      setUsingCache(false);
      setLastSyncedAt(new Date().toISOString());
      writeSyncMeta({ lastSyncedAt: new Date().toISOString(), clinicId: clinic.id });
      setSyncState(navigator.onLine ? 'idle' : 'offline');
    } catch (e) {
      // Offline boot: fall back to this user's cached clinic rather than a blank screen.
      const cached = mine ? readCache(session.user.id, mine.clinic_id) : null;
      const anyCache = cached ?? Object.keys(localStorage)
        .filter((k) => k.startsWith(`myclinic.cache.v2.${session.user.id}.`))
        .map((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } })
        .filter(Boolean)[0];

      if (anyCache?.state) {
        setState({ ...anyCache.state });
        setMode('live');
        setUsingCache(true);
        setSyncState('offline');
        setSavedAt(new Date(anyCache.savedAt));
      } else {
        setError(e.message ?? 'Could not load your clinic data.');
        setSyncState('error');
      }
    } finally {
      setReady(true);
    }
  }, [session]);

  useEffect(() => {
    if (supabaseConfigured && session) loadLive();
    else bootDemo();
  }, [session, loadLive, bootDemo]);

  // Pending work is mirrored into React state so the UI can show it.
  useEffect(() => {
    setPending(readOutbox(userId));
  }, [userId, mode]);

  /* --------------------------------------------------------------- connectivity */
  useEffect(() => {
    const goOnline = () => { setOnline(true); setSyncState('idle'); };
    const goOffline = () => { setOnline(false); setSyncState('offline'); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  /* -------------------------------------------------------------- local mutation */
  const persistLocal = useCallback((updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      if (mode === 'demo') writeDemo(next);
      else if (userId && next.clinic?.id) writeCache(userId, next.clinic.id, next);
      return next;
    });
    setSavedAt(new Date());
  }, [mode, userId]);

  /* ------------------------------------------------------------------- flushing */
  const applyRemote = useCallback((table, row) => {
    setState((prev) => {
      const list = prev[table] ?? [];
      const exists = list.some((r) => r.id === row.id || (row.client_id && r.client_id === row.client_id));
      const nextList = exists
        ? list.map((r) => (r.id === row.id || (row.client_id && r.client_id === row.client_id) ? { ...r, ...row } : r))
        : [row, ...list];
      const next = { ...prev, [table]: nextList };
      if (userId && next.clinic?.id) writeCache(userId, next.clinic.id, next);
      return next;
    });
  }, [userId]);

  const flush = useCallback(async () => {
    if (mode !== 'live' || !userId || flushing.current) return;
    if (!navigator.onLine) { setSyncState('offline'); return; }
    const ops = readOutbox(userId);
    if (!ops.length) { setSyncState('idle'); return; }

    flushing.current = true;
    setSyncState('syncing');

    // The replay/marge machinery is a pure module so it is unit-tested; here we
    // only supply the real database adapter.
    const db = {
      async selectOne(table, filter) {
        let q = supabase.from(table).select('*');
        q = filter.id ? q.eq('id', filter.id) : q.eq('client_id', filter.client_id);
        const { data, error: e } = await q.maybeSingle();
        if (e && e.code !== 'PGRST116') throw e;
        return data ?? null;
      },
      async insert(table, row) {
        const { data, error: e } = await supabase.from(table).insert(row).select().single();
        if (e) throw e;
        return data;
      },
      async update(table, id, patch) {
        const { data, error: e } = await supabase.from(table).update(patch).eq('id', id).select().single();
        if (e) throw e;
        return data;
      },
      async remove(table, id) {
        const { error: e } = await supabase.from(table).delete().eq('id', id);
        if (e && e.code !== 'PGRST116') throw e;
      },
    };

    try {
      const { remaining, conflicts: found, applied, stopped } = await replayOutbox({ ops, db });
      for (const { row, op } of applied) if (row && op.type !== 'delete') applyRemote(op.table, row);
      if (found.length) setConflicts((c) => [...c, ...found.filter((f) => !c.some((x) => x.id === f.id))]);
      writeOutbox(userId, remaining);
      setPending(remaining);

      if (stopped) {
        setSyncState(stopped.verdict === 'retry' ? 'offline' : 'error');
      } else {
        setSyncState('idle');
        setLastSyncedAt(new Date().toISOString());
        writeSyncMeta({ lastSyncedAt: new Date().toISOString() });
        if (applied.length) loadLive({ quiet: true }).catch(() => {});
      }
    } catch (e) {
      setSyncState('error');
    } finally {
      flushing.current = false;
    }
  }, [mode, userId, applyRemote, loadLive]);

  // Retry whenever we come back online, on a timer, and after each local write.
  useEffect(() => {
    if (mode !== 'live') return;
    if (online) flush();
    const t = setInterval(() => { if (navigator.onLine) flush(); }, 20000);
    return () => clearInterval(t);
  }, [online, mode, flush]);

  /* --------------------------------------------------------------------- writes */
  const create = useCallback(async (table, row) => {
    if (!TABLES.includes(table)) throw new Error(`Unknown table ${table}`);
    if (table !== 'profile') assertWritable();
    const clinicId = stateRef.current.clinic?.id;
    const clientId = row.client_id ?? newClientId();
    const record = {
      id: row.id ?? clientId,
      client_id: clientId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...row,
      clinic_id: clinicId,
    };

    // Optimistic: the UI updates immediately, the network catches up.
    persistLocal((prev) => ({ ...prev, [table]: [record, ...(prev[table] ?? [])] }));

    if (mode === 'demo') return record;

    enqueue(userId, {
      op_id: newClientId(), type: 'create', table, row: record, client_id: clientId,
      queued_at: new Date().toISOString(),
    });
    setPending(readOutbox(userId));

    if (navigator.onLine) flush();
    return record;
  }, [mode, persistLocal, userId, flush]);

  const update = useCallback(async (table, id, patch) => {
    const target = table === 'clinic' ? 'clinics' : table === 'profile' ? 'profiles' : table;
    // The clinic row stays editable so a lapsed clinic can still fix its details.
    if (!['profile', 'clinic'].includes(table)) assertWritable();
    const baseRow = table === 'clinic' ? stateRef.current.clinic
      : table === 'profile' ? stateRef.current.profile
        : (stateRef.current[table] ?? []).find((r) => r.id === id);

    persistLocal((prev) => {
      if (table === 'clinic') return { ...prev, clinic: { ...prev.clinic, ...patch } };
      if (table === 'profile') return { ...prev, profile: { ...prev.profile, ...patch } };
      return { ...prev, [table]: (prev[table] ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)) };
    });

    if (mode === 'demo') return;

    enqueue(userId, {
      op_id: newClientId(), type: 'update', table: target, id,
      patch, base: baseRow ?? null,          // three-way merge needs the version we saw
      queued_at: new Date().toISOString(),
    });
    setPending(readOutbox(userId));
    if (navigator.onLine) flush();
  }, [mode, persistLocal, userId, flush]);

  const remove = useCallback(async (table, id) => {
    assertWritable();
    persistLocal((prev) => ({ ...prev, [table]: (prev[table] ?? []).filter((r) => r.id !== id) }));
    if (mode === 'demo') return;
    enqueue(userId, { op_id: newClientId(), type: 'delete', table, id, queued_at: new Date().toISOString() });
    setPending(readOutbox(userId));
    if (navigator.onLine) flush();
  }, [mode, persistLocal, userId, flush]);

  const createClinic = useCallback(async ({ clinic, owner }) => {
    if (mode === 'demo') {
      const clinicId = nextId('clinic');
      persistLocal((prev) => ({
        ...prev,
        clinic: { ...prev.clinic, ...clinic, id: clinicId },
        staff: [{ ...owner, id: nextId('staff'), clinic_id: clinicId, role: 'owner', user_id: 'demo-user' }, ...prev.staff],
      }));
      setNeedsOnboarding(false);
      return clinicId;
    }
    const { data, error: e } = await supabase.rpc('create_clinic', { p_clinic: clinic, p_owner: owner });
    if (e) throw e;
    await loadLive();
    return data;
  }, [mode, persistLocal, loadLive]);

  /** Owner-side: create an invite (server enforces the owner check). */
  const inviteStaff = useCallback(async ({ email, role = 'frontdesk', name = '' }) => {
    if (mode === 'demo') return null;
    const { data, error: e } = await supabase.rpc('invite_staff', {
      p_clinic: stateRef.current.clinic.id, p_email: email, p_role: role, p_name: name,
    });
    if (e) throw e;
    return data;
  }, [mode]);

  /** Invitee-side: claim a pending invite addressed to this user's email. */
  const acceptInvite = useCallback(async (token = null) => {
    if (mode === 'demo') return null;
    const { data, error: e } = await supabase.rpc('accept_invite', { p_token: token });
    if (e) throw e;
    await loadLive();
    return data;
  }, [mode, loadLive]);

  const resetDemo = useCallback(() => {
    const fresh = makeDemoWorkspace();
    setState(fresh);
    writeDemo(fresh);
    setMode('demo');
    setReady(true);
  }, []);

  /* ------------------------------------------------------------- conflict tools */
  const resolveConflict = useCallback(async (conflict, winner /* 'local' | 'remote' | {field: 'local'|'remote'} */) => {
    if (!conflict) return;
    try {
      if (conflict.kind === 'field') {
        const patch = {};
        for (const f of conflict.fields) {
          const choice = typeof winner === 'object' ? winner[f.field] : winner;
          if (choice === 'local') patch[f.field] = f.local;
        }
        if (Object.keys(patch).length) {
          if (mode === 'demo') await update(conflict.table, conflict.remote.id, patch);
          else {
            const { data, error: e } = await supabase.from(conflict.table).update(patch).eq('id', conflict.remote.id).select().single();
            if (e) throw e;
            applyRemote(conflict.table, data);
          }
        }
      } else if (conflict.kind === 'rejected' && winner === 'local') {
        // Re-queue the rejected change so the operator can retry after fixing access.
        enqueue(userId, {
          op_id: newClientId(), type: 'update', table: conflict.table, id: conflict.opId,
          patch: conflict.local, base: null, queued_at: new Date().toISOString(),
        });
        setPending(readOutbox(userId));
      }
      setConflicts((c) => c.filter((x) => x.id !== conflict.id));
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message ?? 'Could not apply the resolution.');
    }
  }, [mode, update, applyRemote, userId]);

  const dismissConflict = useCallback((id) => setConflicts((c) => c.filter((x) => x.id !== id)), []);

  const signOutCleanup = useCallback(() => {
    clearAllCache();
    setPending([]);
    setConflicts([]);
    setUsingCache(false);
  }, []);

  const refresh = useCallback(() => loadLive(), [loadLive]);

  /* ------------------------------------------------------------------ licensing */
  // Defence in depth: every write path funnels through create/update/remove, so a
  // lapsed subscription is blocked here as well as in Postgres. Pages already
  // wrap these calls in try/catch and surface the message in a toast.
  const license = useMemo(() => licenseState(state.subscription), [state.subscription]);

  const licenseUsage = useMemo(() => ({
    doctors: (state.staff ?? []).filter((s) => s.active !== false && s.role !== 'frontdesk').length,
    frontdesk: (state.staff ?? []).filter((s) => s.active !== false && s.role === 'frontdesk').length,
    branches: 1,
  }), [state.staff]);

  const licenseSeats = useMemo(() => seatUsage(license, licenseUsage), [license, licenseUsage]);
  const writable = useMemo(() => (mode === 'demo' ? true : canWrite(license)), [mode, license]);
  writableRef.current = mode === 'demo' ? canWrite(license) : writable;

  const assertWritable = useCallback(() => {
    if (writableRef.current) return;
    throw new Error('The subscription is read-only, so this change was not saved. Everything stays readable and exportable — renew the plan to resume writing.');
  }, []);

  /** Mirror the server's answer into local state (both modes). */
  const applyLicense = useCallback((row) => {
    if (!row) return null;
    setState((prev) => {
      const next = { ...prev, subscription: row };
      const clinicId = prev.clinic?.id;
      if (mode === 'demo') writeDemo(next);
      else if (userId && clinicId) writeCache(userId, clinicId, next);
      return next;
    });
    return row;
  }, [mode, userId]);

  const licenceRpc = useCallback(async (fn, args) => {
    if (mode === 'demo') return null;            // demo keeps its local trial
    const { data, error: e } = await supabase.rpc(fn, args);
    if (e) throw e;
    applyLicense(data);
    return data;
  }, [mode, applyLicense]);

  const changePlan = useCallback(async ({ plan, interval = 'monthly', billing = {} }) => {
    if (mode === 'demo') {
      const days = interval === 'yearly' ? 365 : 30;
      return applyLicense({
        ...(stateRef.current.subscription ?? {}),
        plan, status: 'active', interval,
        current_period_end: new Date(Date.now() + days * 86400000).toISOString(),
        ...billing,
      });
    }
    return licenceRpc('change_plan', {
      p_clinic: stateRef.current.clinic?.id, p_plan: plan, p_interval: interval, p_billing: billing,
    });
  }, [mode, applyLicense, licenceRpc]);

  const renewSubscription = useCallback(async ({ reference = '', months = null } = {}) => {
    if (mode === 'demo') {
      const from = new Date(stateRef.current.subscription?.current_period_end ?? Date.now()).getTime();
      return applyLicense({
        ...(stateRef.current.subscription ?? {}),
        status: 'active',
        current_period_end: new Date(Math.max(from, Date.now()) + 30 * 86400000).toISOString(),
        collection_ref: reference,
      });
    }
    return licenceRpc('renew_subscription', {
      p_clinic: stateRef.current.clinic?.id, p_reference: reference, p_months: months,
    });
  }, [mode, applyLicense, licenceRpc]);

  const setLicenseStatus = useCallback(async (status) => {
    if (mode === 'demo') return applyLicense({ ...(stateRef.current.subscription ?? {}), status });
    return licenceRpc('set_license_status', { p_clinic: stateRef.current.clinic?.id, p_status: status });
  }, [mode, applyLicense, licenceRpc]);

  const startTrial = useCallback(async () => {
    if (mode === 'demo') {
      return applyLicense({
        ...(stateRef.current.subscription ?? {}),
        plan: 'growth', status: 'trial',
        trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
      });
    }
    return licenceRpc('start_trial', { p_clinic: stateRef.current.clinic?.id });
  }, [mode, applyLicense, licenceRpc]);

  const value = useMemo(() => ({
    ready, error, savedAt, mode, needsOnboarding,
    ...state,
    doctors: (state.staff ?? []).filter((s) => s.role !== 'frontdesk'),
    frontDesk: (state.staff ?? []).filter((s) => s.role === 'frontdesk'),
    currentStaff: (state.staff ?? []).find((s) => s.user_id && s.user_id === session?.user?.id) ?? (state.staff ?? [])[0] ?? null,
    role: (state.staff ?? []).find((s) => s.user_id && s.user_id === session?.user?.id)?.role ?? (state.staff ?? [])[0]?.role ?? 'owner',
    // sync surface
    online, pending, conflicts, syncState, lastSyncedAt, usingCache,
    flushNow: flush, resolveConflict, dismissConflict, signOutCleanup,
    create, update, remove, createClinic, inviteStaff, acceptInvite,
    refresh, resetDemo, enterDemo: bootDemo,
    // licensing
    license, licenseSeats, licenseUsage, writable,
    changePlan, renewSubscription, setLicenseStatus, startTrial,
  }), [ready, error, savedAt, mode, needsOnboarding, state, session, online, pending, conflicts,
    syncState, lastSyncedAt, usingCache, flush, resolveConflict, dismissConflict, signOutCleanup,
    create, update, remove, createClinic, inviteStaff, acceptInvite, resetDemo, bootDemo, refresh,
    license, licenseSeats, licenseUsage, writable,
    changePlan, renewSubscription, setLicenseStatus, startTrial]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
