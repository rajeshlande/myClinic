/**
 * Workspace pointer, cache namespacing and logout cleanup — v2.0.0 Slice 2.
 *
 * Pure: storage objects are injected, so this is testable without a browser.
 * INERT until Slice 2b wires it. No PHI is ever written by this module, and the
 * pointer is a short-lived hint, never an authorisation decision.
 */
import {
  WORKSPACE_POINTER_KEY,
  clearTenantState,
  disposeTenantSession,
} from './tenant-client.mjs';

/** Deliberately short: a stale pointer must never outlive a token lease. */
export const WORKSPACE_POINTER_TTL_MS = 15 * 60 * 1000;
export const INDEXED_DB_PREFIX = 'myclinic-v2-';

function clock(now) {
  return typeof now === 'function' ? Number(now()) : Number(now ?? Date.now());
}

/** Persist a workspace pointer in sessionStorage with an expiry. */
export function writeWorkspacePointer(sessionStore, pointer, {
  now = Date.now,
  ttlMs = WORKSPACE_POINTER_TTL_MS,
} = {}) {
  if (!sessionStore || typeof sessionStore.setItem !== 'function') return false;
  const clinicId = String(pointer?.clinic_id ?? '').trim();
  if (!clinicId) return false;
  const record = {
    clinic_id: clinicId,
    tenant_slug: String(pointer?.tenant_slug ?? ''),
    workspace_id: String(pointer?.workspace_id ?? ''),
    expiresAt: clock(now) + Number(ttlMs),
  };
  sessionStore.setItem(WORKSPACE_POINTER_KEY, JSON.stringify(record));
  return true;
}

/** Read a live workspace pointer; expired or malformed records are removed. */
export function readWorkspacePointer(sessionStore, { now = Date.now } = {}) {
  if (!sessionStore || typeof sessionStore.getItem !== 'function') return null;
  const raw = sessionStore.getItem(WORKSPACE_POINTER_KEY);
  if (raw == null) return null;
  const drop = () => {
    if (typeof sessionStore.removeItem === 'function') {
      sessionStore.removeItem(WORKSPACE_POINTER_KEY);
    }
    return null;
  };
  let record;
  try {
    record = JSON.parse(String(raw));
  } catch {
    return drop();
  }
  if (!record || typeof record !== 'object' || !record.clinic_id
    || !Number.isFinite(Number(record.expiresAt))
    || Number(record.expiresAt) <= clock(now)) {
    return drop();
  }
  return Object.freeze({
    clinic_id: String(record.clinic_id),
    tenant_slug: String(record.tenant_slug ?? ''),
    workspace_id: String(record.workspace_id ?? ''),
  });
}

/** Per-clinic IndexedDB name for the Slice 2b storage migration. */
export function indexedDbName(clinicId) {
  const id = String(clinicId ?? '').trim();
  return id ? `${INDEXED_DB_PREFIX}${id}` : null;
}

/**
 * One clean logout: dispose the tenant session (RAM token + client), remove
 * tenant-namespaced keys and the workspace pointer, then let the app clear its
 * legacy cache. Order matters — the client goes first so no request can race a
 * half-cleared cache.
 */
export function logoutCleanup({
  storage = null,
  sessionStore = null,
  session = null,
  clearLegacyCache = null,
} = {}) {
  const disposed = disposeTenantSession(session);
  const removed = clearTenantState({ storage, sessionStorage: sessionStore });
  if (typeof clearLegacyCache === 'function') clearLegacyCache();
  if (sessionStore && typeof sessionStore.removeItem === 'function') {
    sessionStore.removeItem(WORKSPACE_POINTER_KEY);
  }
  return { disposed, removed };
}
