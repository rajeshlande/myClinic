import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PWAContext = createContext(null);

/** True when the app is already running as an installed app. */
function standalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

function iosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function PWAProvider({ children, register = true }) {
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(standalone);
  const [isIOS] = useState(iosDevice);
  const [updateReady, setUpdateReady] = useState(null);
  const [offlineReady, setOfflineReady] = useState(false);

  // Capture the browser's install prompt so we can offer it inside the UI.
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvent(e); };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onChange = () => setInstalled(standalone());
    mq?.addEventListener?.('change', onChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onChange);
    };
  }, []);

  // Register the service worker and surface "update available".
  useEffect(() => {
    if (!register || !('serviceWorker' in navigator) || !import.meta.env.PROD) return;
    let cancelled = false;
    const base = import.meta.env.BASE_URL || '/';

    // Everything registered below is unregistered in the cleanup. The front desk
    // leaves this app open all day and React re-runs an effect on a remount, so a
    // listener without a counterpart would stack a second update check on top of
    // the first and fire twice.
    const teardown = [];
    const onController = () => setOfflineReady(true);

    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then((reg) => {
      if (cancelled) return;
      if (navigator.serviceWorker.controller) setOfflineReady(true);
      const offer = (worker) => setUpdateReady(worker);
      if (reg.waiting) offer(reg.waiting);

      const onUpdateFound = () => {
        const worker = reg.installing;
        const onStateChange = () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        };
        worker?.addEventListener('statechange', onStateChange);
        teardown.push(() => worker?.removeEventListener('statechange', onStateChange));
      };
      reg.addEventListener('updatefound', onUpdateFound);
      teardown.push(() => reg.removeEventListener('updatefound', onUpdateFound));

      // Check for a new build when the app regains focus.
      const check = () => reg.update().catch(() => {});
      const onVisible = () => { if (document.visibilityState === 'visible') check(); };
      document.addEventListener('visibilitychange', onVisible);
      teardown.push(() => document.removeEventListener('visibilitychange', onVisible));
      window.addEventListener('online', check);
      teardown.push(() => window.removeEventListener('online', check));
    }).catch(() => { /* offline or unsupported — the app still works */ });

    navigator.serviceWorker.addEventListener('controllerchange', onController);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
      for (const off of teardown) {
        try { off(); } catch { /* the registration went away with the page */ }
      }
    };
  }, [register]);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return 'unavailable';
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome === 'accepted') setInstalled(true);
    return outcome;
  }, [installEvent]);

  const applyUpdate = useCallback(() => {
    if (!updateReady) return;
    updateReady.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => window.location.reload(), 240);
  }, [updateReady]);

  const value = useMemo(() => ({
    canInstall: Boolean(installEvent) && !installed,
    installed,
    isIOS,
    promptInstall,
    updateReady: Boolean(updateReady),
    applyUpdate,
    offlineReady,
  }), [installEvent, installed, isIOS, promptInstall, updateReady, applyUpdate, offlineReady]);

  return <PWAContext.Provider value={value}>{children}</PWAContext.Provider>;
}

export function usePWA() {
  return useContext(PWAContext) ?? {
    canInstall: false, installed: false, isIOS: false,
    promptInstall: async () => 'unavailable', updateReady: false, applyUpdate: () => {}, offlineReady: false,
  };
}
