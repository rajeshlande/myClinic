import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured, authErrorMessage } from './supabase.js';
import { clearAllCache } from './offline.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const run = useCallback(async (fn) => {
    setError('');
    try { return await fn(); } catch (e) { setError(authErrorMessage(e)); throw e; }
  }, []);

  const value = useMemo(() => ({
    configured: supabaseConfigured,
    session,
    user: session?.user ?? null,
    loading,
    error,
    clearError: () => setError(''),
    signIn: (email, password) => run(async () => {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password });
      if (e) throw e;
    }),
    signUp: (email, password, fullName) => run(async () => {
      const { data, error: e } = await supabase.auth.signUp({
        email, password,
        // Land in the app after confirming: the router sends a brand-new owner to
        // onboarding, while an invited user has their seat claimed on first load.
        options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}${window.location.pathname}#/app/dashboard` },
      });
      if (e) throw e;
      return data;
    }),
    signOut: () => run(async () => {
      await supabase.auth.signOut();
      // The cached clinic snapshot and the outbox hold patients, notes and
      // invoices. Signing out has to take them off the device, not just off the
      // screen — this is a shared reception machine more often than not.
      clearAllCache();
    }),
    resetPassword: (email) => run(async () => {
      const { error: e } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${window.location.pathname}#/reset-password`,
      });
      if (e) throw e;
    }),
    updatePassword: (password) => run(async () => {
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) throw e;
    }),
  }), [session, loading, error, run]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
