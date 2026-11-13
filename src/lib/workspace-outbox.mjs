/** Inert v2 outbox adapter: one adapter per flush/lease, never reuse across
 * workspace transitions. Caller must lease-guard queue/cache commits as well.
 */
import { TABLES } from './offline.js';
import { TenantAuthUnavailableError } from './tenant-client.mjs';

export function createWorkspaceOutboxDb(lease) {
  if (typeof lease?.run !== 'function' || !lease.clinicId) throw new TypeError('workspace operation lease required');
  const clinicId = lease.clinicId;
  function tableAllowed(table) {
    if (!TABLES.includes(table)) throw new TenantAuthUnavailableError('outbox table refused');
  }
  function payloadAllowed(row, required = false) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || (required && row.clinic_id !== clinicId)
      || (Object.hasOwn(row, 'clinic_id') && row.clinic_id !== clinicId)) {
      throw new TenantAuthUnavailableError('outbox clinic mismatch');
    }
  }
  async function request(table, build, one = true, allowMissing = false) {
    tableAllowed(table);
    return lease.run(async (client) => {
      const { data, error } = await build(client.from(table));
      if (error && !(allowMissing && error.code === 'PGRST116')) throw error;
      if (error) return null;
      if (one && !allowMissing && !data) throw new TenantAuthUnavailableError('outbox write returned no row');
      if (one && data && data.clinic_id !== clinicId) throw new TenantAuthUnavailableError('outbox result clinic mismatch');
      return data ?? null;
    });
  }
  return Object.freeze({
    selectOne(table, filter) {
      if (!filter?.id && !filter?.client_id) throw new TenantAuthUnavailableError('outbox row identity required');
      return request(table, (q) => {
        q = q.select('*').eq('clinic_id', clinicId);
        return (filter.id ? q.eq('id', filter.id) : q.eq('client_id', filter.client_id)).maybeSingle();
      }, true, true);
    },
    insert(table, row) {
      payloadAllowed(row, true);
      return request(table, (q) => q.insert(row).select().single());
    },
    update(table, id, patch) {
      if (!id) throw new TenantAuthUnavailableError('outbox row identity required');
      payloadAllowed(patch);
      return request(table, (q) => q.update(patch).eq('clinic_id', clinicId).eq('id', id).select().single());
    },
    remove(table, id) {
      if (!id) throw new TenantAuthUnavailableError('outbox row identity required');
      return request(table, (q) => q.delete().eq('clinic_id', clinicId).eq('id', id), false, true);
    },
  });
}
