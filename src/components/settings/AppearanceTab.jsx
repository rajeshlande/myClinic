/**
 * Appearance & colours: theme, accent and density, applied on this device only.
 * Extracted verbatim from Settings.jsx in v1.30.0 (docs/ARCHITECTURE.md §3 step 4) —
 * markup and copy unchanged.
 */

import { ACCENTS } from '../../lib/theme.js';
import { PWAStatus } from '../PWAWidgets.jsx';
import { Button, Card, CardHead, Field, Input, Segmented, Select } from '../ui.jsx';
import { BellRing, Check, Palette, Save, Smartphone, Sun, WifiOff } from 'lucide-react';

export default function AppearanceTab({ theme, setTheme, changeTheme, accent, setAccent, changeAccent, prefs, setPrefs, saveProfile, saving }) {
  return (
    <>
        <div className="stack" style={{ gap: 16 }}>
          <Card>
            <CardHead title="Appearance" sub="Applies to this device" icon={Sun} />
            <div className="card-body stack">
              <Field label="Theme">
                <Segmented
                  value={theme} onChange={changeTheme}
                  options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]}
                />
              </Field>
              <Field label="Density" hint="Compact fits more rows on a tablet at the desk">
                <Segmented value={prefs.density} onChange={(v) => setPrefs((p) => ({ ...p, density: v }))} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHead title="Reminders" sub="Follow-up recalls and review requests" icon={BellRing} />
            <div className="card-body stack">
              <label className="check">
                <input type="checkbox" checked={prefs.reminders_enabled} onChange={(e) => setPrefs((p) => ({ ...p, reminders_enabled: e.target.checked }))} />
                <span><strong className="small">Show recall reminders</strong><span className="tiny muted" style={{ display: 'block' }}>Surfaces due and overdue follow-ups on the dashboard.</span></span>
              </label>
              <div className="form-grid">
                <Field label="Remind how early">
                  <Select value={prefs.reminder_lead_hours} onChange={(e) => setPrefs((p) => ({ ...p, reminder_lead_hours: Number(e.target.value) }))}>
                    {[1, 2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h} hours before</option>)}
                  </Select>
                </Field>
                <Field label="Quiet hours" hint="No reminders are drafted in this window">
                  <Input value={prefs.quiet_hours} onChange={(e) => setPrefs((p) => ({ ...p, quiet_hours: e.target.value }))} placeholder="21:00-08:00" />
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={prefs.send_review_request} onChange={(e) => setPrefs((p) => ({ ...p, send_review_request: e.target.checked }))} />
                <span><strong className="small">Ask for a review after a completed visit</strong><span className="tiny muted" style={{ display: 'block' }}>Adds a review link to the invoice footer template.</span></span>
              </label>
              <Button variant="subtle" icon={Save} onClick={saveProfile} loading={saving}>Save preferences</Button>
            </div>
          </Card>

          <Card>
            <CardHead title="Accent colour" sub="Seven palettes — each has its own light and dark values" icon={Palette} />
            <div className="card-body stack" style={{ gap: 10 }}>
              <div className="accent-grid">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id} type="button"
                    className={`accent-swatch ${accent === a.id ? 'selected' : ''}`}
                    onClick={() => changeAccent(a.id)}
                    aria-pressed={accent === a.id}
                  >
                    <span className="accent-dot" style={{ background: `linear-gradient(135deg, ${a.light[500]}, ${a.dark[500]})` }} />
                    <span>{a.label}</span>
                    <span className="accent-preview">
                      <i style={{ background: a.light[100] }} />
                      <i style={{ background: a.light[500] }} />
                      <i style={{ background: a.dark[500] }} />
                      <i style={{ background: a.dark[100] }} />
                    </span>
                  </button>
                ))}
              </div>
              <p className="tiny faint">
                The palette follows the theme: {theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark values are active right now' : 'light values are active right now'}.
                Colour never carries meaning on its own — status is always labelled too.
              </p>
            </div>
          </Card>

          <Card>
            <CardHead title="Install myClinic" sub="Runs full-screen like a native app" icon={Smartphone} />
            <div className="card-body stack" style={{ gap: 8 }}>
              {[
                ['Android / Chrome', 'Open the browser menu and choose “Install app” or “Add to Home screen”.'],
                ['iPhone / Safari', 'Tap the Share icon, then “Add to Home Screen”.'],
                ['Desktop', 'Click the install icon in the address bar — the app opens in its own window.'],
              ].map(([label, body]) => (
                <div key={label} className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--success)', marginTop: 2 }}><Check size={14} strokeWidth={3} /></span>
                  <div><strong className="small">{label}</strong><p className="tiny muted">{body}</p></div>
                </div>
              ))}
              <div className="row small" style={{ gap: 8, background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 11 }}>
                <WifiOff size={14} className="muted" />
                <span className="muted">The app shell is cached, so a dropped connection never leaves reception with a blank screen.</span>
              </div>
              <PWAStatus />
            </div>
          </Card>
        </div>
    </>
  );
}
