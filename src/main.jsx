import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import '@fontsource-variable/inter';
import '@fontsource-variable/manrope';
import './styles.css';
import App from './App.jsx';
import { AuthProvider } from './lib/auth-context.jsx';
import { applyTheme, readTheme, readAccent, watchSystemTheme } from './lib/theme.js';
import { ToastProvider } from './components/ui.jsx';
import { PWAProvider, usePWA } from './lib/pwa.jsx';
import { PWAWidgets } from './components/PWAWidgets.jsx';

applyTheme(readTheme(), readAccent());
watchSystemTheme(() => { if (readTheme() === 'system') applyTheme('system', readAccent()); });
// Restore a cached accent immediately so the first paint matches the clinic's colour.
document.documentElement.dataset.accent ??= readAccent();

function Boot() {
  const [online, setOnline] = useState(navigator.onLine);
  // The AppLayout badge is the richer one; this is only a fallback for screens
  // that render outside the store (login, landing, setup).
  const [hasStoreBadge, setHasStoreBadge] = useState(false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const check = () => setHasStoreBadge(Boolean(document.querySelector('.syncbar[data-store="1"]')));
    const timer = setInterval(check, 600);
    check();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(timer);
    };
  }, []);
  if (hasStoreBadge) return null;
  // Deliberately store-free: this renders outside <StoreProvider>, so it can only
  // use the browser's own connectivity. The richer sync badge lives in AppLayout.
  return online ? null : (
    <div className="syncbar offline" style={{ cursor: 'default', position: 'fixed' }}>
      <span className="syncbar-icon"><WifiOff size={14} /></span>
      <span className="syncbar-text">Working offline — changes are saved on this device</span>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <PWAProvider>
          <ToastProvider>
            <App />
            <PWAWidgets />
            <Boot />
          </ToastProvider>
        </PWAProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);

