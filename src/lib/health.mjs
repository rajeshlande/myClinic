/**
 * Supabase readiness probe (pure logic, no React, no network).
 *
 * `checkSupabase()` in src/pages/Setup.jsx feeds real results in here so the UI
 * can state, per check, whether the deployment is actually connected — instead
 * of only knowing that two environment variables were non-empty at build time.
 */

/**
 * @typedef {{ id: string, label: string, state: 'pass'|'warn'|'fail'|'skip', detail: string }} Check
 */

const isHttpUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

const looksSecret = (key) => /service_role|sb_secret|sbp_/i.test(key);

/**
 * Evaluate the static configuration, before any network call.
 * @param {{url?: string, key?: string, base?: string}} env
 * @returns {Check[]}
 */
export function configChecks({ url = '', key = '', base = '/' } = {}) {
  const u = String(url).trim();
  const k = String(key).trim();
  const checks = [];

  checks.push({
    id: 'env-url',
    label: 'Project URL configured',
    state: u ? 'pass' : 'fail',
    detail: u ? u.replace(/^(https:\/\/[^/]+).*/, '$1') : 'VITE_SUPABASE_URL is missing — the build runs in demo mode.',
  });

  checks.push({
    id: 'env-key',
    label: 'Publishable key configured',
    state: k ? 'pass' : 'fail',
    detail: k
      ? looksSecret(k)
        ? 'This key looks like a service-role/secret key. It must never ship in a browser bundle.'
        : `Looks like a publishable key (${k.length} chars).`
      : 'VITE_SUPABASE_ANON_KEY is missing — the build runs in demo mode.',
  });

  if (k && looksSecret(k)) checks[checks.length - 1].state = 'fail';

  checks.push({
    id: 'env-https',
    label: 'HTTPS origin',
    state: !u ? 'skip' : isHttpUrl(u) && u.startsWith('https://') ? 'pass' : 'fail',
    detail: !u ? 'Skipped until the URL is set.' : u.startsWith('https://') ? 'PKCE auth cookies need a secure origin.' : 'Use the https:// project URL, not http://.',
  });

  checks.push({
    id: 'base-path',
    label: 'Base path matches the deployment',
    state: !base || base === '/' || base === './' ? 'pass' : 'warn',
    detail:
      !base || base === '/' || base === './'
        ? 'Relative base — works at /, /<repo>/ and on a custom domain.'
        : `Building for ${base}; the app must be served from that exact path on Pages.`,
  });

  return checks;
}

/**
 * Normalise a Supabase REST key probe into a check.
 * @param {{ok: boolean, status?: number, message?: string}} result
 */
export function restCheck({ ok, status, message } = {}) {
  if (ok) {
    return {
      id: 'rest',
      label: 'REST API reachable with this key',
      state: 'pass',
      detail: 'The publishable key authenticated against the project REST endpoint.',
    };
  }
  const detail =
    status === 401 || status === 403
      ? 'Project reachable but the key was rejected. Copy the anon / publishable key again from Project Settings → API.'
      : /fetch|network|ENOTFOUND|Failed/i.test(String(message))
        ? 'Project host unreachable. Check the URL and that the project is not paused.'
        : `REST probe failed${status ? ` (HTTP ${status})` : ''}.`;
  return { id: 'rest', label: 'REST API reachable with this key', state: 'fail', detail };
}

/**
 * Compare the schema version reported by the database with the one this build needs.
 * @param {number|null|undefined} serverVersion
 * @param {number} clientVersion
 */
export function schemaCheck(serverVersion, clientVersion) {
  if (serverVersion == null) {
    return {
      id: 'schema',
      label: 'Database schema version',
      state: 'warn',
      detail: `Checked after sign-in. This build expects schema v${clientVersion}.`,
    };
  }
  if (Number(serverVersion) === Number(clientVersion)) {
    return {
      id: 'schema',
      label: 'Database schema version',
      state: 'pass',
      detail: `Server and app both report schema v${clientVersion}.`,
    };
  }
  return {
    id: 'schema',
    label: 'Database schema version',
    state: 'fail',
    detail:
      Number(serverVersion) < Number(clientVersion)
        ? `Server is schema v${serverVersion}; re-run supabase/schema.sql to reach v${clientVersion}.`
        : `Server is schema v${serverVersion}, this build expects v${clientVersion}. Pull the latest deployment.`,
  };
}

/**
 * Turn a list of checks into one headline.
 * @param {Check[]} checks
 */
export function readiness(checks) {
  const list = (checks || []).filter((c) => c && c.state !== 'skip');
  const failed = list.filter((c) => c.state === 'fail').length;
  const warned = list.filter((c) => c.state === 'warn').length;
  const passed = list.filter((c) => c.state === 'pass').length;
  const state = failed ? 'fail' : warned ? 'warn' : list.length ? 'pass' : 'unknown';
  const headline =
    state === 'fail'
      ? `${failed} check${failed === 1 ? ' needs' : 's need'} attention`
      : state === 'warn'
        ? `Connected, ${warned} check${warned === 1 ? '' : 's'} to confirm`
        : state === 'pass'
          ? 'Supabase connection ready'
          : 'Nothing checked yet';
  return { state, passed, warned, failed, total: list.length, headline };
}

/** The full checklist a clinic operator must tick before going live. */
export const GO_LIVE_CHECKLIST = [
  { id: 'env', label: 'Environment variables set in the Pages build', docs: '#2-connect-supabase' },
  { id: 'schema', label: 'schema.sql applied, app_schema_version() answers', docs: '#3-create-the-database' },
  { id: 'redirects', label: 'Site URL + redirect allow-list point at the Pages URL', docs: '#4-authentication-setup' },
  { id: 'rls', label: 'rls-tests.sql suite passes', docs: '#security' },
  { id: 'pwa', label: 'Installed from the HTTPS Pages URL, service worker active', docs: '#installable-app-pwa' },
];
