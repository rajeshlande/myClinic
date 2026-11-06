import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase.js';
import { makeDemoWorkspace } from './demo-data.js';
import {
  inviteDefaults, recallInviteError, recallInviteToken, rememberInviteError, rememberInviteToken,
} from './invites.mjs';
import { nextId } from './logic.mjs';
import { rememberError } from './errors.mjs';
import { clinicSlug } from './public-booking.mjs';
import { licenseState, canWrite, seatUsage, billingPeriod, extendPeriod } from './license.mjs';
import { medicineFromDirectoryRow } from './medicines.mjs';
import { MIN_QUERY_LENGTH } from './drug-search.mjs';
import { TRIAL_DAYS } from './license.mjs';
import {
  TABLES, mergeFields, readCache, writeCache, clearAllCache, purgeExpiredCache, readOutbox, writeOutbox, enqueue,
  newClientId, replayOutbox, readSyncMeta, writeSyncMeta, unknownColumn,
} from './offline.js';

const DEMO_KEY = 'myclinic.demo.v1';

/** A project that has not run schema 9 yet answers with this instead of a slug. */
const missingFunction = (error) => error?.code === 'PGRST202' || error?.code === '42883'
  || /could not find the function|function .* does not exist/i.test(error?.message ?? '');
/**
 * Write the signed-in user's own profile row if it is missing.
 *
 * `profiles.id` is the auth user id and the row is otherwise the user's own, which
 * is exactly what the `profiles_self` policy allows them to insert. Returns null
 * (rather than throwing) when the database refuses: the app still works without
 * a profile row, it just cannot remember preferences.
 */
async function createOwnProfile(user) {
  if (!user?.id) return null;
  const seed = {
    id: user.id,
    full_name: String(user.user_metadata?.full_name ?? '').slice(0, 80),
  };
  const { data, error } = await supabase.from('profiles').upsert(seed, { onConflict: 'id' }).select().single();
  if (error) {
    rememberError(error, 'Create the account profile row');
    return null;
  }
  return data ?? null;
}

const StoreContext = createContext(null);

const emptyState = {
  clinic: null, profile: null, staff: [], patients: [], appointments: [], consultations: [],
  invoices: [], day_closes: [], reminders: [], invites: [], subscription: null,
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
  // Clinical data left behind by a previous session is removed before anything
  // reads the cache: the TTL is a storage rule, not only a read rule.
  useEffect(() => { purgeExpiredCache(); }, []);

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
  /**
   * Claim a seat that an owner has already offered.
   *
   * `accept_invite()` matches the invitation to the email in the caller's JWT, so
   * the token is only a disambiguator; it is passed when the invitee arrived from
   * the link (kept in sessionStorage across the sign-up and email-confirmation
   * round trip). "No pending invitation" is the normal case for a brand-new clinic
   * owner and must not surface as an error.
   */
  const claimPendingInvite = useCallback(async () => {
    try {
      const token = recallInviteToken();
      const { data, error } = await supabase.rpc('accept_invite', token ? { p_token: token } : {});
      if (error) {
        // 'no pending invitation for this email' is the ordinary answer for anyone
        // who is not invited — anything else is a refusal the person must read.
        const message = String(error.message ?? '');
        rememberInviteError(/no pending invitation/i.test(message) ? '' : message);
        return null;
      }
      if (!data) return null;
      rememberInviteToken('');    // a token is good once
      rememberInviteError('');
      return data;
    } catch { return null; }
  }, []);

  const loadLiveRef = useRef(null);

  const loadLive = useCallback(async ({ quiet = false, attempt = 0 } = {}) => {
    if (!session) return;
    if (!quiet) { setError(''); setReady(false); }
    try {
      const { data: found, error: pErr } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (pErr) throw pErr;
      // An account created before the sign-up trigger existed has no profile row.
      // Its own saves then arrive as "this record was deleted at the clinic" — for
      // a row that was never written. The row is ours and its id is known, so it is
      // created here, once per sign-in, instead of being reported as a deletion.
      const profile = found ?? await createOwnProfile(session.user);

      const { data: memberships, error: mErr } = await supabase.from('staff').select('*').eq('user_id', session.user.id);
      if (mErr) throw mErr;

      let mine = memberships?.[0];
      if (!mine && attempt === 0) {
        // No membership yet: this account may have been invited by a clinic owner.
        // accept_invite() is the only thing that can grant a seat, and it matches on
        // the verified email in the JWT — so a person who signed up from an invite
        // link lands in that clinic instead of being pushed to create their own.
        const claimed = await claimPendingInvite();
        if (claimed) {
          loadLiveRef.current?.({ quiet: true, attempt: 1 });
          return;
        }
      }
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
        // Owners see every invitation; staff see none (the policy filters, it does
        // not error), so Team can show the pending list without a second query.
        optional(supabase.from('invites').select('*').eq('clinic_id', clinic.id).order('created_at', { ascending: false })),
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
        invites: results[7].data ?? [],
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
  }, [session, claimPendingInvite]);

  loadLiveRef.current = loadLive;

  useEffect(() => {
    if (supabaseConfigured && session) loadLive();
    else bootDemo();
  }, [session, loadLive, bootDemo]);

  // The demo workspace lives in localStorage and the public booking page writes to
  // the same key — sometimes from this very document, when a reviewer opens
  // /#/book and comes back. Re-read on that signal so the appointment the patient
  // just booked is on the calendar without a reload.
  useEffect(() => {
    if (mode !== 'demo' || typeof window === 'undefined') return undefined;
    const reread = () => bootDemo();
    window.addEventListener('myclinic:demowrite', reread);
    return () => window.removeEventListener('myclinic:demowrite', reread);
  }, [mode, bootDemo]);

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
    const stamp = { created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    // `profiles` is keyed by the auth user and carries neither client_id nor
    // clinic_id, so it is written on its own shape — sending the clinic columns
    // there is a 400, not a shrug.
    const record = table === 'profile'
      ? { id: row.id ?? clientId, ...stamp, ...row }
      : { id: row.id ?? clientId, client_id: clientId, ...stamp, ...row, clinic_id: clinicId };

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

  /**
   * Save through to the database, and answer with what the server said.
   *
   * `update()` is deliberately optimistic and queued: a clinic that loses Wi-Fi
   * mid-morning must not lose the billing it is doing. But a settings screen is
   * the other kind of write — the person is standing still, watching a Save
   * button, and needs to know *now* whether it landed. Waiting on the outbox's
   * background flush meant the screen said "saved" before the server had even
   * answered, so a refused write looked like a success until the sync badge
   * turned red minutes later.
   *
   * This writes straight to PostgREST when the device is online, keeps the
   * three-way merge so a second device is not silently overwritten, repairs a
   * single unknown column against an older database, and throws the real error
   * otherwise. Offline (or in the demo) it falls back to the queued write.
   */
  const updateNow = useCallback(async (table, id, patch) => {
    const target = table === 'clinic' ? 'clinics' : table === 'profile' ? 'profiles' : table;
    const baseRow = table === 'clinic' ? stateRef.current.clinic
      : table === 'profile' ? stateRef.current.profile
        : (stateRef.current[table] ?? []).find((r) => r.id === id);

    if (mode !== 'live' || !navigator.onLine || !supabase) {
      await update(table, id, patch);
      return { queued: true };
    }

    const { data: current, error: readError } = await supabase.from(target).select('*').eq('id', id).maybeSingle();
    if (readError) throw readError;

    if (!current && table === 'profile') {
      // First write for this account's profile: create the row with the edit in it.
      const { data: created, error: createError } = await supabase.from('profiles')
        .upsert({ id, ...patch }, { onConflict: 'id' }).select().single();
      if (createError) throw createError;
      persistLocal((prev) => ({ ...prev, profile: { ...(prev.profile ?? {}), ...created } }));
      return { row: created, queued: false, created: true };
    }
    if (!current) throw new Error(`That record is no longer in the database — it may have been deleted on another device.`);

    const merged = mergeFields({ table: target, base: baseRow ?? null, local: patch, remote: current });
    const payload = { ...merged.patch, updated_at: new Date().toISOString() };
    if (!Object.keys(merged.patch).length) { persistLocal({}); return { row: current, unchanged: true }; }

    let result = await supabase.from(target).update(payload).eq('id', id).select().single();
    const missing = result.error ? unknownColumn(result.error) : null;
    if (missing && Object.prototype.hasOwnProperty.call(payload, missing)) {
      // A database still on the previous schema: keep every column it does have.
      const trimmed = { ...payload };
      delete trimmed[missing];
      result = await supabase.from(target).update(trimmed).eq('id', id).select().single();
    }
    if (result.error) throw result.error;

    const row = result.data;
    persistLocal((prev) => {
      if (table === 'clinic') return { ...prev, clinic: { ...prev.clinic, ...row } };
      if (table === 'profile') return { ...prev, profile: { ...(prev.profile ?? {}), ...row } };
      return { ...prev, [table]: (prev[table] ?? []).map((r) => (r.id === id ? { ...r, ...row } : r)) };
    });
    return { row, queued: false };
  }, [mode, update, persistLocal]);

  /**
   * Claim the clinic's public booking address.
   *
   * `slug` is not just another column: it is the last part of a link the owner is
   * about to print, so it has to end up as *the* address the public page answers
   * on. `set_clinic_slug()` (schema 9) normalises what was typed, steps aside if
   * another clinic holds it, fills it from the clinic's name when the field is
   * empty, and returns the address that is now live — so the caller can show the
   * saved link instead of guessing at it.
   *
   * Two fallbacks keep older deployments and a flat network working: a database
   * still on schema 8 has no such function, and a queue that is offline cannot
   * call one, so both write the row the ordinary way (the offline queue replays it).
   */
  const saveBookingSlug = useCallback(async (desired) => {
    const clinic = stateRef.current.clinic;
    if (!clinic?.id) throw new Error('Open a clinic before setting a booking link.');
    const wanted = clinicSlug(desired || clinic.slug || clinic.name || '');
    if (!wanted) throw new Error('Give the clinic a name, or type a link name.');

    const mirror = (slug) => persistLocal((prev) => (
      prev.clinic ? { ...prev, clinic: { ...prev.clinic, slug } } : prev
    ));

    // Demo, or a queue with no network: the row write is the only honest answer.
    if (mode === 'demo' || !navigator.onLine) {
      mirror(wanted);
      if (mode === 'demo') return wanted;
      await update('clinic', clinic.id, { slug: wanted });
      return wanted;
    }

    const { data, error: e } = await supabase.rpc('set_clinic_slug', { p_clinic: clinic.id, p_slug: wanted });
    if (!e && typeof data === 'string' && data) {
      mirror(data);
      return data;
    }
    // PGRST202/42883 = this project has not run schema 9 yet. Anything else is a
    // real refusal (not the owner, clinic gone) and belongs to the caller.
    if (e && !missingFunction(e)) throw e;
    mirror(wanted);
    await update('clinic', clinic.id, { slug: wanted });
    return wanted;
  }, [mode, persistLocal, update]);

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

  /**
   * Owner-side: create an invitation.
   *
   * Written as a row rather than through invite_staff(): the RPC only carries
   * email/role/name, while a doctor's invitation also has to carry a specialty and
   * a qualification for `accept_invite()` to copy onto the seat. The owner-only
   * insert policy (`is_clinic_owner(clinic_id) and invited_by = auth.uid()`) is the
   * gate — the same gate the RPC uses — so nothing is weakened by it.
   */
  const inviteStaff = useCallback(async ({ email, role = 'frontdesk', name = '', specialty = '', qualification = '' }) => {
    if (mode === 'demo') return null;
    const clinic = stateRef.current.clinic;
    if (!clinic?.id) throw new Error('Open a clinic before inviting anyone.');
    if (!userId) throw new Error('Sign in again to invite someone.');
    const seat = inviteDefaults({ role, email, name, clinic, staff: stateRef.current.staff ?? [] });

    const { data, error: e } = await supabase.from('invites').insert({
      clinic_id: clinic.id,
      email: seat.email,
      role: role === 'owner' ? 'doctor' : role,
      full_name: seat.full_name,
      specialty: specialty || '',
      qualification: qualification || '',
      invited_by: userId,
    }).select().maybeSingle();

    if (e) {
      // 23505 = this email already has a pending invitation for this clinic. Hand
      // back the one that exists instead of a red toast: the owner's goal — one
      // open invitation — is already true.
      if (e.code === '23505') {
        const { data: existing } = await supabase.from('invites').select('*')
          .eq('clinic_id', clinic.id).eq('email', seat.email).is('accepted_at', null)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (existing) return { ...existing, alreadyPending: true };
      }
      throw e;
    }

    await loadLive({ quiet: true });
    return data;
  }, [mode, userId, loadLive]);

  /** Owner-side: withdraw an invitation. RLS allows an owner to delete them. */
  const revokeInvite = useCallback(async (id) => {
    if (mode === 'demo' || !id) return;
    const { error: e } = await supabase.from('invites').delete().eq('id', id);
    if (e) throw e;
    await loadLive({ quiet: true });
  }, [mode, loadLive]);

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
      } else if (conflict.kind === 'deleted-remotely' && winner === 'recreate') {
        // "Recreate" writes the local values back as a new row. It is only offered
        // for rows the client owns the key of — `profiles`, whose primary key is the
        // signed-in user's id — because for anything else there is no whole record
        // to rebuild from an edit.
        const row = { ...(conflict.local ?? {}), id: conflict.recordId ?? session?.user?.id };
        if (!row.id) throw new Error('This device does not know the record’s id — discard the change instead.');
        if (mode === 'demo') {
          await create('profile', row);
        } else {
          const { data, error: e } = await supabase.from(conflict.table).upsert(row, { onConflict: 'id' }).select().single();
          if (e) throw e;
          persistLocal((prev) => (conflict.table === 'profiles'
            ? { ...prev, profile: { ...(prev.profile ?? {}), ...data } }
            : { ...prev, [conflict.table]: [data, ...(prev[conflict.table] ?? []).filter((r) => r.id !== data.id)] }));
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
  }, [mode, update, create, applyRemote, persistLocal, userId, session]);

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
      const period = billingPeriod({ interval });
      return applyLicense({
        ...(stateRef.current.subscription ?? {}),
        plan, status: 'active', interval: period.interval,
        current_period_start: new Date().toISOString(),
        current_period_end: extendPeriod(new Date(), period.months),
        ...billing,
      });
    }
    return licenceRpc('change_plan', {
      p_clinic: stateRef.current.clinic?.id, p_plan: plan, p_interval: interval, p_billing: billing,
    });
  }, [mode, applyLicense, licenceRpc]);

  const renewSubscription = useCallback(async ({ reference = '', months = null } = {}) => {
    if (mode === 'demo') {
      // A payment buys the subscription's own period (12 months on a yearly plan)
      // unless the caller states a term — the demo used to hard-code 30 days, so a
      // yearly clinic renewed for a month and looked broken.
      const sub = stateRef.current.subscription ?? {};
      const wanted = Number.isFinite(Number(months)) && Number(months) > 0 ? Number(months) : billingPeriod(sub).months;
      return applyLicense({
        ...sub,
        status: 'active',
        current_period_start: sub.current_period_start ?? new Date().toISOString(),
        current_period_end: extendPeriod(sub.current_period_end, wanted),
        collection_ref: reference || sub.collection_ref || '',
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

  /**
   * The drug directory (schema 14), searched on the server, or nothing at all.
   *
   * Three rules, because this runs while a doctor is typing:
   *
   *   • it never throws — a missing table, a missing function or an offline
   *     laptop each return `[]`, and the field keeps working from the catalogue
   *     that ships with the app;
   *   • it never blocks — the caller gets a promise it can ignore, and the local
   *     results are already on screen before this resolves;
   *   • it caches by term, so backspacing through "augmentin" does not send six
   *     queries to fetch four answers it already has.
   */
  const directoryCache = useRef(new Map());
  const searchDrugDirectory = useCallback(async (term) => {
    const query = String(term ?? '').trim();
    if (mode !== 'live' || !supabaseConfigured) return [];
    if (query.replace(/[^a-zA-Z0-9]/g, '').length < MIN_QUERY_LENGTH) return [];

    const key = query.toLowerCase();
    const cache = directoryCache.current;
    if (cache.has(key)) return cache.get(key);

    try {
      const { data, error } = await supabase.rpc('search_medicine_brands', { p_term: query, p_limit: 8 });
      // An older database, a project that never ran schema 14, or no network:
      // the directory is an enhancement, so its absence is not an error state.
      if (error) return [];
      const rows = (Array.isArray(data) ? data : []).map(medicineFromDirectoryRow).filter(Boolean);
      if (cache.size >= 60) cache.delete(cache.keys().next().value);
      cache.set(key, rows);
      return rows;
    } catch {
      return [];
    }
  }, [mode]);

  const value = useMemo(() => ({
    ready, error, savedAt, mode, needsOnboarding,
    ...state,
    doctors: (state.staff ?? []).filter((s) => s.role !== 'frontdesk'),
    frontDesk: (state.staff ?? []).filter((s) => s.role === 'frontdesk'),
    currentStaff: (state.staff ?? []).find((s) => s.user_id && s.user_id === session?.user?.id)
      ?? (state.staff ?? []).find((s) => s.role === 'owner') ?? (state.staff ?? [])[0] ?? null,
    // The signed-in member's own role; in the demo workspace nobody is signed in, so
    // fall back to the owner row — never to staff[0], which is whichever person was
    // added most recently (inviting a doctor used to demote the demo user).
    role: (state.staff ?? []).find((s) => s.user_id && s.user_id === session?.user?.id)?.role
      ?? (state.staff ?? []).find((s) => s.role === 'owner')?.role
      ?? (state.staff ?? [])[0]?.role ?? 'owner',
    // sync surface
    online, pending, conflicts, syncState, lastSyncedAt, usingCache,
    flushNow: flush, resolveConflict, dismissConflict, signOutCleanup,
    create, update, updateNow, remove, createClinic, saveBookingSlug, inviteStaff, revokeInvite, acceptInvite,
    refresh, resetDemo, enterDemo: bootDemo,
    // drug directory (schema 14) — searched on the server, always optional
    searchDrugDirectory,
    // licensing
    license, licenseSeats, licenseUsage, writable,
    changePlan, renewSubscription, setLicenseStatus, startTrial,
  }), [ready, error, savedAt, mode, needsOnboarding, state, session, online, pending, conflicts,
    syncState, lastSyncedAt, usingCache, flush, resolveConflict, dismissConflict, signOutCleanup,
    create, update, updateNow, remove, createClinic, saveBookingSlug, inviteStaff, revokeInvite, acceptInvite,
    resetDemo, bootDemo, refresh, searchDrugDirectory,
    license, licenseSeats, licenseUsage, writable,
    changePlan, renewSubscription, setLicenseStatus, startTrial]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
