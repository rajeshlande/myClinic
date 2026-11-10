/**
 * Logos & branding: the two uploads, the live preview and the note about where
the files are stored. Extracted verbatim from Settings.jsx in v1.30.0
 * (docs/ARCHITECTURE.md §3 step 4) — markup and copy unchanged.
 */

import {can} from '../../lib/permissions.js';
import {BrandMark, BrandingFields} from '../Branding.jsx';
import {Button, Card, CardHead} from '../ui.jsx';
import {ImagePlus, Save, ShieldCheck} from 'lucide-react';
import {useStore} from '../../lib/store.jsx';

export default function BrandingTab({ clinic, setClinic, saveClinic, saving, profile }) {
  const store = useStore();
  const role = store.role ?? 'owner';
  const canEdit = can(role, 'clinic:settings');
  return (
    <>
        <Card>
          <CardHead
            title="Logos & branding"
            sub="Used on prescriptions, invoices, and ready for WhatsApp and email"
            icon={ImagePlus}
            action={<Button size="sm" variant="primary" icon={Save} onClick={saveClinic} loading={saving}>Save</Button>}
          />
          <div className="card-body stack" style={{ gap: 14 }}>
            {!can(role, 'clinic:settings') ? (
              <div className="row small" style={{ gap: 8, background: 'var(--warn-bg)', color: 'var(--warn)', padding: '9px 12px', borderRadius: 11 }}>
                <ShieldCheck size={14} />
                <span>Only the clinic owner can change branding.</span>
              </div>
            ) : null}

            <div className="branding-preview">
              <div className="row" style={{ gap: 10 }}>
                <BrandMark clinic={clinic} size={44} />
                <div>
                  <div className="strong">{clinic.name || 'Your clinic'}</div>
                  <div className="tiny faint">How the clinic appears across myClinic</div>
                </div>
              </div>
              <div className="branding-preview-note tiny muted">
                Upload a square logo for avatars and profile photos, and a wide one for letterheads.
                Either can stand in for the other, so one upload is enough to get started.
              </div>
            </div>

            <BrandingFields
              clinic={clinic}
              disabled={!can(role, 'clinic:settings') || saving}
              onChange={(patch) => setClinic((c) => ({ ...c, ...patch }))}
            />

            <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
              <ShieldCheck size={14} className="muted" />
              <span className="muted">
                Logos are resized in your browser and stored with the clinic, so they print correctly
                offline and are covered by the same access rules as the rest of your clinic data.
              </span>
            </div>
          </div>
        </Card>
    </>
  );
}
