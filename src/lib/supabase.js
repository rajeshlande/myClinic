import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** True when real Supabase credentials are present at build time. */
export const supabaseConfigured = Boolean(url && key && /^https:\/\//.test(url) && !/service_role|sb_secret/i.test(key));

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  : null;

/** Friendly copy for common Supabase auth errors (never logs credentials). */
export function authErrorMessage(error) {
  const msg = String(error?.message ?? error ?? 'Something went wrong.');
  if (/invalid login credentials/i.test(msg)) return 'That email and password do not match an account.';
  if (/email not confirmed/i.test(msg)) return 'Confirm your email address from the link we sent, then sign in.';
  if (/user already registered/i.test(msg)) return 'An account already exists for this email. Try signing in instead.';
  if (/password should be at least/i.test(msg)) return 'Use a password with at least 8 characters.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|network/i.test(msg)) return 'Cannot reach the server. Check your connection and try again.';
  return msg;
}
