import { useEffect, useState } from 'react';
import { Download, RefreshCw, X, WifiOff, Check } from 'lucide-react';
import { usePWA } from '../lib/pwa.jsx';
import { Button } from './ui.jsx';

/**
 * Floating, non-blocking PWA affordances:
 *  - "A new version is ready" bar with a one-tap reload
 *  - install nudge (Android/desktop prompt, or iOS instructions)
 */
export function PWAWidgets() {
  const { updateReady, applyUpdate, canInstall, isIOS, installed, promptInstall } = usePWA();
  const [dismissedUpdate, setDismissedUpdate] = useState(false);
  const [dismissedInstall, setDismissedInstall] = useState(() => localStorage.getItem('myclinic.install.dismissed') === '1');
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const online = () => navigator.serviceWorker.controller && null;
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);

  const showUpdate = updateReady && !dismissedUpdate;
  const offerInstall = !installed && !dismissedInstall && (canInstall || isIOS);

  if (!showUpdate && !offerInstall) return null;

  return (
    <div className="pwa-widgets no-print">
      {showUpdate ? (
        <div className="pwa-bar">
          <span className="pwa-icon"><RefreshCw size={14} /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>A new version of myClinic is ready</strong>
            <span className="tiny muted" style={{ display: 'block' }}>Reload to pick up the latest build — nothing you saved is lost.</span>
          </div>
          <Button size="sm" variant="primary" onClick={applyUpdate}>Reload</Button>
          <button className="icon-btn plain sm" aria-label="Dismiss" onClick={() => setDismissedUpdate(true)}><X size={13} /></button>
        </div>
      ) : null}

      {offerInstall && !showUpdate ? (
        <div className="pwa-bar">
          <span className="pwa-icon"><Download size={14} /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>Install myClinic</strong>
            <span className="tiny muted" style={{ display: 'block' }}>
              {iosHint ? 'Tap Share, then “Add to Home Screen”.' : 'Full-screen app with an offline-ready shell.'}
            </span>
          </div>
          <Button
            size="sm" variant="primary"
            onClick={async () => {
              if (isIOS && !canInstall) { setIosHint(true); return; }
              const outcome = await promptInstall();
              if (outcome === 'dismissed') {
                localStorage.setItem('myclinic.install.dismissed', '1');
                setDismissedInstall(true);
              }
            }}
          >
            Install
          </Button>
          <button
            className="icon-btn plain sm" aria-label="Dismiss"
            onClick={() => { localStorage.setItem('myclinic.install.dismissed', '1'); setDismissedInstall(true); }}
          ><X size={13} /></button>
        </div>
      ) : null}
    </div>
  );
}

/** Inline "installed / offline ready" chips for the settings screen. */
export function PWAStatus() {
  const { installed, offlineReady, canInstall, promptInstall, isIOS } = usePWA();
  return (
    <div className="row wrap small" style={{ gap: 8 }}>
      <span className={`badge ${installed ? 'success' : 'neutral'}`}>
        {installed ? <Check size={11} /> : <Download size={11} />} {installed ? 'Installed app' : 'Browser tab'}
      </span>
      <span className={`badge ${offlineReady ? 'success' : 'neutral'}`}>
        <WifiOff size={11} /> {offlineReady ? 'Offline shell cached' : 'Shell caches on first load'}
      </span>
      {canInstall ? <Button size="sm" variant="subtle" icon={Download} onClick={() => promptInstall()}>Install now</Button> : null}
      {isIOS && !installed ? <span className="tiny faint">iOS: Share → Add to Home Screen</span> : null}
    </div>
  );
}
