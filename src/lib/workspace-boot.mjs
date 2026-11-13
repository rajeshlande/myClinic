/**
 * Boot-response parsing for the extended `sync_clinic_subscription` RPC.
 *
 * Pure and inert in Slice 2: the Central RPC has not been extended yet (R4 §4,
 * Q5). Nothing in `src/` imports this module until the one-RPC boot is wired.
 * Nothing here performs a network call, reads env, or writes to storage.
 */
import { validateClinicalDescriptor } from './tenant-client.mjs';

export const BOOKING_POINTER_PREFIX = 'booking:';
export const WORKSPACE_STATUS_ACTIVE = 'active';

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
// `public-booking.mjs` already uses `booking:already` / `booking:slot_taken`
// as ERROR tokens. A boot pointer must never be mistaken for one of those.
const RESERVED = new Set(['already', 'failed', 'closed', 'invalid', 'slot_taken']);

/**
 * Parse a `booking:<slug>` pointer from a boot response. Deliberately strict:
 * reserved error tokens and anything containing a colon are rejected.
 */
export function parseBookingPointer(value) {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith(BOOKING_POINTER_PREFIX)) {
    return { ok: false, slug: '', reason: 'NOT_BOOKING_POINTER' };
  }
  const slug = raw.slice(BOOKING_POINTER_PREFIX.length);
  if (!SLUG.test(slug) || RESERVED.has(slug)) {
    return { ok: false, slug: '', reason: 'BAD_SLUG' };
  }
  return { ok: true, slug, reason: '' };
}

/** Normalise one workspace row. Returns null when the identity is incomplete. */
export function normaliseWorkspace(row = {}) {
  const r = row ?? {};
  const clinicId = String(r.clinic_id ?? r.clinicId ?? '').trim();
  const workspaceId = String(r.workspace_id ?? r.workspaceId ?? '').trim();
  const tenantSlug = String(r.tenant_slug ?? r.tenantSlug ?? '').trim();
  if (!clinicId || !workspaceId) return null;
  return Object.freeze({
    clinic_id: clinicId,
    workspace_id: workspaceId,
    tenant_slug: tenantSlug,
    name: String(r.name ?? r.clinic_name ?? ''),
    status: String(r.status ?? WORKSPACE_STATUS_ACTIVE),
    member_role: String(r.member_role ?? r.role ?? ''),
    ready: r.ready === true,
    licence: r.licence && typeof r.licence === 'object' && !Array.isArray(r.licence)
      ? Object.freeze({ ...r.licence }) : null,
  });
}

/**
 * Parse one boot response into workspaces, the licence verdict, the public
 * booking slug and the shared clinical API descriptor. Duplicate workspace ids
 * are dropped. The result is frozen so a caller cannot widen its own access.
 */
export function parseBootResponse(payload = {}) {
  const p = payload ?? {};
  const rows = Array.isArray(p.workspaces) ? p.workspaces : [];
  const seen = new Set();
  const workspaces = [];
  for (const row of rows) {
    const w = normaliseWorkspace(row);
    if (!w || seen.has(w.workspace_id)) continue;
    seen.add(w.workspace_id);
    workspaces.push(w);
  }

  const booking = parseBookingPointer(p.booking ?? p.booking_pointer ?? '');
  const descriptorSource = p.clinical ?? {
    clinical_url: p.clinical_url,
    clinical_publishable_key: p.clinical_publishable_key,
  };
  const clinical = validateClinicalDescriptor(descriptorSource);
  const licence = p.licence ?? p.verdict ?? null;

  let reason = '';
  if (!workspaces.length) reason = 'NO_WORKSPACES';
  else if (!clinical.ok) reason = clinical.reason;

  return Object.freeze({
    ok: Boolean(workspaces.length && clinical.ok),
    workspaces: Object.freeze(workspaces),
    licence,
    selectedWorkspaceId: seen.has(String(p.selected_workspace_id ?? ''))
      ? String(p.selected_workspace_id) : (workspaces[0]?.workspace_id ?? ''),
    bookingSlug: booking.ok ? booking.slug : '',
    booking,
    clinical,
    reason,
  });
}

/** Find a workspace by workspace id or clinic id. */
export function findWorkspace(boot, id) {
  const wanted = String(id ?? '').trim();
  if (!wanted) return null;
  const list = Array.isArray(boot) ? boot : (boot?.workspaces ?? []);
  return list.find((w) => w.workspace_id === wanted || w.clinic_id === wanted) ?? null;
}

/**
 * Fail-closed licence check. Only an explicit positive signal permits clinical
 * writes — an inactive, expired, suspended, missing or unrecognised verdict
 * does not. `mint-tenant-token` must apply the same rule server-side.
 */
export function licenceAllowsClinicalWrites(licence = null) {
  if (!licence || typeof licence !== 'object') return false;
  if (licence.allowed === false || licence.can_write === false || licence.writable === false) return false;
  const status = String(licence.status ?? licence.subscription_status ?? '').toLowerCase();
  if (['inactive', 'expired', 'suspended', 'read_only', 'unavailable', 'not_ready', 'revoked'].includes(status)) return false;
  if (licence.can_write === true || licence.writable === true) return true;
  return status === WORKSPACE_STATUS_ACTIVE;
}
