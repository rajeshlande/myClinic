/**
 * Where a workspace is written down between renders.
 *
 * Two mirrors, two rules: a demo workspace lives in one localStorage key and is
 * rewritten whole, while a live one is cached per user *and* clinic so a clinic
 * switch cannot show another clinic's patients. Both were inline in `store.jsx`,
 * next to the React state they feed; here they take the storage as an argument, so
 * a private-mode browser and a full quota are testable rather than assumed.
 */

import { writeCache } from './offline.js';

/** The demo workspace: one key, no TTL — it is fictional, and it is the user's. */
export const DEMO_KEY = 'myclinic.demo.v1';

/**
 * Read the demo snapshot back.
 *
 * Anything unreadable — no key, invalid JSON, a shape without a clinic — reads as
 * "there is none", which sends the caller to `makeDemoWorkspace()`. A half-written
 * snapshot must never be handed to the app: a clinic-less state renders an
 * onboarding screen to a user who already has a workspace.
 */
export function readDemoSnapshot(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(DEMO_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.clinic ? parsed : null;
  } catch { return null; }
}

/** Persist the demo snapshot. A quota or private-mode refusal is not an error. */
export function writeDemoSnapshot(state, storage = globalThis.localStorage) {
  try { storage.setItem(DEMO_KEY, JSON.stringify(state)); } catch { /* quota / private mode */ }
}

/** Forget the demo snapshot (used when the demo is rebuilt from scratch). */
export function clearDemoSnapshot(storage = globalThis.localStorage) {
  try { storage.removeItem(DEMO_KEY); } catch { /* private mode */ }
}

/**
 * Write the state wherever this workspace is mirrored.
 *
 * Demo: the one key. Live: the per-user, per-clinic cache — and only when there is
 * a clinic, because the cache key is made of it. Returns a word for the caller to
 * log or assert on, never a boolean to branch on.
 */
export function mirrorState({ mode, userId, state, storage = globalThis.localStorage }) {
  if (mode === 'demo') { writeDemoSnapshot(state, storage); return 'demo'; }
  if (userId && state?.clinic?.id) { writeCache(userId, state.clinic.id, state); return 'cache'; }
  return 'none';
}

/**
 * Fold a row the server just returned into a list the client already shows.
 *
 * Identity is `id`, or `client_id` while a locally-created row is still waiting
 * for its server id — the same rule `applyRemote` used inline. A row that is
 * already there is merged (so a server-side default wins over a local guess), a
 * row that is not is put at the front, because the lists are newest-first.
 */
export function mergeRemoteRow(list, row) {
  const rows = list ?? [];
  if (!row) return rows;
  const isSame = (r) => r.id === row.id || (row.client_id && r.client_id === row.client_id);
  return rows.some(isSame)
    ? rows.map((r) => (isSame(r) ? { ...r, ...row } : r))
    : [row, ...rows];
}
