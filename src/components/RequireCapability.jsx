import { Navigate, useLocation } from 'react-router';
import { Lock } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { can, landingRouteFor, ROLE_LABEL } from '../lib/permissions.js';
import { Badge, Button, Card } from './ui.jsx';

/**
 * Route guard. Mirrors the database policies: a member without the capability is
 * sent to the screen they can actually use, with an explanation — never a blank
 * page, and never a request the server would reject.
 */
export function RequireCapability({ capability, children }) {
  const store = useStore();
  const location = useLocation();
  const role = store.role ?? 'owner';

  if (!store.ready) return null;
  if (can(role, capability)) return children;

  const fallback = landingRouteFor(role);
  if (location.pathname !== fallback) return <Navigate to={fallback} replace />;

  return (
    <div className="page narrow">
      <Card>
        <div className="card-body stack center" style={{ padding: 32, gap: 10 }}>
          <span className="kpi-icon" style={{ margin: '0 auto' }}><Lock size={18} /></span>
          <strong>This screen is not part of your role</strong>
          <p className="small muted" style={{ maxWidth: 380 }}>
            You are signed in as <Badge tone="neutral">{ROLE_LABEL[role]}</Badge>. Ask a clinic owner if you need access —
            the database enforces the same rule.
          </p>
          <Button variant="primary" onClick={() => { window.location.hash = `#${fallback}`; }}>Go to my workspace</Button>
        </div>
      </Card>
    </div>
  );
}
