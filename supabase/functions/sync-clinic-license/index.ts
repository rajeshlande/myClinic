// myClinic · sync-clinic-license
//
// Phones the licence authority, verifies the RS256 capability token it returns,
// and records the verdict in this clinic's own database — where the RLS policies
// and the write guards can act on it.
//
// Why this exists at all: myClinic is a static SPA. On GitHub Pages there is no
// server, so anything the browser decides can be overridden in DevTools. The
// browser layer is a convenience — it shows the real tier, expiry and seat caps.
// *This* function is the enforcement: it holds the licence key and the
// service_role key, and it is the only caller allowed to write
// `apply_authority_license()`. Editing JavaScript cannot reach it.
//
// Secrets (Supabase → Project Settings → Edge Functions → Secrets):
//   AUTHORITY_VERIFY_URL   https://<authority-ref>.supabase.co/functions/v1/verify-license
//   LICENSE_KEY            the 32-character key issued in the authority's Control Room
//   LICENSE_PUBLIC_KEY     SPKI public key (-----BEGIN PUBLIC KEY----- …), safe to hold here
//   MYCLINIC_ORIGINS       optional, comma-separated allowlist (e.g. https://clinic.github.io)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// Deploy:  npx supabase functions deploy sync-clinic-license --project-ref <clinic-ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';

const ISSUER = 'myclinic-license-authority';
const TOKEN_DRIFT_SECONDS = 120; // clock tolerance when reading iat/exp

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * A refusal the caller can act on, with a stable code the app can map.
 *
 * The platform's function log records the *status* and nothing else — a bare
 * `POST | 403` with an empty logs array, which is a shrug rather than a
 * diagnosis. So every refusal names itself here too, once, in a single line:
 * the code, the status, and the context that decides it (origin, allowlist,
 * missing secret names, clinic id). Never the licence key, the token or any
 * Supabase key.
 *
 * The same code also travels as a response header, so a browser's Network tab
 * shows why without opening the body.
 */
function refuse(
  code: string,
  error: string,
  status = 400,
  context: Record<string, unknown> = {},
): Response {
  const detail = Object.keys(context).length ? ` ${JSON.stringify(context)}` : '';
  console.warn(`refused ${status} ${code}${detail}`);
  return new Response(JSON.stringify({ ok: false, code, error }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'x-myclinic-code': code,
    },
  });
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(?:BEGIN|END) [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('LICENSE_PUBLIC_KEY is empty or malformed.');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  // Backed by a real ArrayBuffer, not the shared-or-resizable union: this value
  // is handed to crypto.subtle.verify() as a BufferSource, which will not accept
  // a Uint8Array over ArrayBufferLike. `deno check` fails on that, so it is typed
  // here rather than cast away at the call site.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(segment))) as T;
}

interface CapabilityClaims {
  iss?: string;
  sub?: string;
  license_key?: string;
  tier?: string;
  machine_fingerprint?: string;
  allowed_origin?: string;
  max_machines?: number;
  subscription_expires_at?: string;
  iat?: number;
  exp?: number;
}

/**
 * Verifies an RS256 capability token with the authority's public key and checks
 * every claim this deployment depends on. Nothing is trusted until this passes —
 * in particular the `tier`, which decides how many seats the clinic gets.
 */
async function verifyCapabilityToken(
  token: string,
  publicKeyPem: string,
  { expectedFingerprint, expectedLicenseKey }: {
    expectedFingerprint: string;
    expectedLicenseKey: string;
  },
): Promise<{ ok: true; claims: CapabilityClaims } | { ok: false; code: string; error: string }> {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { ok: false, code: 'token-malformed', error: 'Token is not a JWT.' };

  let header: { alg?: string; typ?: string };
  let claims: CapabilityClaims;
  try {
    header = decodeSegment<{ alg?: string; typ?: string }>(parts[0]);
    claims = decodeSegment<CapabilityClaims>(parts[1]);
  } catch {
    return { ok: false, code: 'token-malformed', error: 'Token segments are not valid JSON.' };
  }

  if (header.alg !== 'RS256') {
    // Refusing anything else is what stops the classic `alg: none` downgrade.
    return { ok: false, code: 'token-alg', error: `Unexpected token algorithm ${header.alg ?? 'none'}.` };
  }

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(publicKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch (error) {
    return {
      ok: false,
      code: 'token-key',
      error: `Could not verify the signature: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }

  if (!verified) {
    return { ok: false, code: 'token-signature', error: 'Signature does not match the authority public key.' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER) {
    return { ok: false, code: 'token-issuer', error: `Unexpected issuer ${claims.iss ?? '(none)'}.` };
  }
  if (typeof claims.exp !== 'number' || claims.exp + TOKEN_DRIFT_SECONDS < nowSeconds) {
    return { ok: false, code: 'token-expired', error: 'The capability token has expired.' };
  }
  if (typeof claims.iat === 'number' && claims.iat - TOKEN_DRIFT_SECONDS > nowSeconds) {
    return { ok: false, code: 'token-future', error: 'The capability token is issued in the future.' };
  }
  if (claims.machine_fingerprint !== expectedFingerprint) {
    return {
      ok: false,
      code: 'token-fingerprint',
      error: 'The token is bound to a different deployment origin.',
    };
  }
  if (expectedLicenseKey && claims.license_key && claims.license_key !== expectedLicenseKey) {
    return { ok: false, code: 'token-key-mismatch', error: 'The token belongs to a different licence key.' };
  }

  const contractEnd = claims.subscription_expires_at
    ? new Date(claims.subscription_expires_at)
    : null;
  if (!contractEnd || Number.isNaN(contractEnd.getTime())) {
    return { ok: false, code: 'token-expiry-missing', error: 'The token carries no subscription expiry.' };
  }

  return { ok: true, claims };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return refuse('method', 'Use POST.', 405);

  const verifyUrl = Deno.env.get('AUTHORITY_VERIFY_URL')?.trim();
  const licenseKey = Deno.env.get('LICENSE_KEY')?.trim().toUpperCase();
  const publicKeyPem = Deno.env.get('LICENSE_PUBLIC_KEY')?.trim();

  if (!verifyUrl || !licenseKey || !publicKeyPem) {
    const missing = [
      ['AUTHORITY_VERIFY_URL', verifyUrl],
      ['LICENSE_KEY', licenseKey],
      ['LICENSE_PUBLIC_KEY', publicKeyPem],
    ].filter(([, value]) => !value).map(([name]) => name);
    return refuse(
      'not-configured',
      'This clinic is not connected to a licence authority: set AUTHORITY_VERIFY_URL, LICENSE_KEY and LICENSE_PUBLIC_KEY as Edge Function secrets.',
      503,
      { missing },
    );
  }

  let body: { clinic_id?: unknown; origin?: unknown };
  try {
    body = await req.json();
  } catch {
    return refuse('bad-json', 'Invalid JSON body.');
  }

  const clinicId = typeof body.clinic_id === 'string' ? body.clinic_id.trim() : '';
  const origin = typeof body.origin === 'string'
    ? body.origin.trim().toLowerCase().replace(/\/+$/, '')
    : '';

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clinicId)) {
    return refuse('bad-clinic', 'A clinic id is required.');
  }
  if (!/^https?:\/\/[^\s]+$/.test(origin) || origin.length > 200) {
    return refuse('bad-origin', 'A deployment origin (https://…) is required.');
  }

  const allowList = (Deno.env.get('MYCLINIC_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);
  if (allowList.length > 0 && !allowList.includes(origin)) {
    // The commonest 403, and the one a log line cannot describe: the browser
    // sends `window.location.origin` — scheme, host and port only, never the
    // repository path a Pages site is served from.
    return refuse('origin-not-allowed', 'This origin is not on the clinic\'s allowlist.', 403, {
      origin, allow: allowList,
    });
  }

  // ------------------------------------------------------------ who is asking
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return refuse('not-signed-in', 'Sign in to myClinic first.', 401, { clinic: clinicId });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return refuse('config', 'The clinic project is missing its Supabase keys.', 500);
  }

  // Judged with the caller's own token: RLS decides what they can see, so this
  // cannot be talked into believing a stranger is a member.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    // An expired session arrives here: the browser sent *something*, but not a
    // user. The app should refresh and retry rather than show a dead end.
    return refuse('not-signed-in', 'Sign in to myClinic first.', 401, {
      clinic: clinicId, reason: userError?.message ?? 'no user for this token',
    });
  }

  const { data: seat, error: seatError } = await asCaller
    .from('staff')
    .select('role')
    .eq('clinic_id', clinicId)
    .eq('user_id', userData.user.id)
    .eq('active', true)
    .maybeSingle();

  if (seatError) {
    return refuse('lookup', 'Could not read your seat in this clinic.', 500, {
      clinic: clinicId, reason: seatError.message,
    });
  }
  if (!seat) {
    return refuse('not-member', 'You are not a member of this clinic.', 403, {
      clinic: clinicId, user: userData.user.id,
    });
  }
  if (seat.role !== 'owner') {
    return refuse('not-owner', 'Only the clinic owner can sync the licence.', 403, {
      clinic: clinicId, user: userData.user.id, role: seat.role,
    });
  }

  // ------------------------------------------------------------- phone home
  const fingerprint = `web:${origin}`;
  let authorityBody: Record<string, unknown> = {};
  let authorityStatus = 0;

  try {
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ license_key: licenseKey, machine_fingerprint: fingerprint }),
    });
    authorityStatus = response.status;
    authorityBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      // The authority's refusals are meaningful: revoked key, suspended
      // subscription, expired contract, seat limit. Pass the sentence through.
      return refuse(
        'authority-refused',
        typeof authorityBody.error === 'string' ? authorityBody.error : `Authority answered ${response.status}.`,
        402,
      );
    }
  } catch (error) {
    return refuse(
      'authority-unreachable',
      `Could not reach the licence authority: ${error instanceof Error ? error.message : 'network error'}.`,
      503,
    );
  }

  const token = typeof authorityBody.token === 'string' ? authorityBody.token.trim() : '';
  if (!token) return refuse('authority-token', 'The authority returned no capability token.', 502);

  const check = await verifyCapabilityToken(token, publicKeyPem, {
    expectedFingerprint: fingerprint,
    expectedLicenseKey: licenseKey,
  });
  if (!check.ok) {
    return refuse(check.code, `Refused: ${check.error}`, 403, {
      clinic: clinicId, origin, authority: authorityStatus,
    });
  }

  const claims = check.claims;

  // ------------------------------------------------------------ record the verdict
  const asOperator = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: applied, error: applyError } = await asOperator.rpc('apply_authority_license', {
    p_clinic: clinicId,
    p_subscription_id: String(claims.sub ?? ''),
    p_tier: String(claims.tier ?? ''),
    p_fingerprint: fingerprint,
    p_expires_at: claims.subscription_expires_at,
    p_token_exp: new Date(Number(claims.exp) * 1000).toISOString(),
    p_origin: origin,
  });

  if (applyError) {
    console.error('[sync-clinic-license] apply failed:', applyError.message);
    return refuse('apply', `The clinic database refused the verdict: ${applyError.message}`, 500);
  }

  // The token is returned so the browser can cache it and verify the signature
  // itself — the UI should never take a status on trust any more than the
  // database does.
  return json({
    ok: true,
    plan: applied?.plan ?? null,
    status: applied?.status ?? null,
    tier: applied?.tier ?? claims.tier ?? null,
    subscription_id: applied?.subscription_id ?? claims.sub ?? null,
    fingerprint,
    current_period_end: claims.subscription_expires_at ?? null,
    token_exp: applied?.token_exp ?? null,
    synced_at: applied?.synced_at ?? new Date().toISOString(),
    max_machines: claims.max_machines ?? null,
    token,
  });
});
