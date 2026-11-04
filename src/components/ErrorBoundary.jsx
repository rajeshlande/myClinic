/**
 * The last line of defence.
 *
 * A thrown render used to leave a blank white page: no message, no version, no
 * way to tell the clinic what happened. This catches it, says what broke in
 * plain words, and offers two things a person can actually do — copy the
 * diagnostics for support, or reload and carry on. The change that was being
 * typed is *not* pretended to be saved.
 */
import React from 'react';
import { RefreshCw, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { diagnosticsText, rememberError } from '../lib/errors.mjs';
import { APP_VERSION, BUILD_LABEL, SCHEMA_VERSION } from '../lib/version.js';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    rememberError(error, 'Screen crashed');
    // Keep the component stack in the console: it is the only place a developer
    // can see which component threw, and it costs the user nothing.
    console.error('myClinic crashed', error, info?.componentStack);
  }

  copy() {
    const text = `${diagnosticsText({ app: APP_VERSION, schema: SCHEMA_VERSION, build: BUILD_LABEL })}\n\n${this.state.error?.stack ?? ''}`;
    const done = () => this.setState({ copied: true });
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this.fallbackCopy(text, done));
    } else {
      this.fallbackCopy(text, done);
    }
  }

  fallbackCopy(text, done) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      done();
    } catch { /* the text is still in the panel below */ }
  }

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)' }}>
        <div className="card" style={{ maxWidth: 620, width: '100%' }}>
          <div className="card-body stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 8 }}>
              <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
              <strong>This screen stopped working</strong>
            </div>
            <p className="small" style={{ margin: 0 }}>
              Nothing you had already saved was lost — everything is stored per clinic and per
              device. Reload to carry on; if it happens again, copy the details and send them to
              support, and say what you were doing at the time.
            </p>
            <pre className="small mono" style={{
              margin: 0, padding: 10, borderRadius: 10, background: 'var(--surface-2)',
              maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap',
            }}>
              {String(error?.message ?? error)}
              {'\n\n'}
              {`myClinic ${APP_VERSION} · schema ${SCHEMA_VERSION} · ${BUILD_LABEL}`}
            </pre>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" type="button" onClick={() => window.location.reload()}>
                <RefreshCw size={14} /> Reload the app
              </button>
              <button className="btn" type="button" onClick={() => this.copy()}>
                <ClipboardCheck size={14} /> {copied ? 'Copied' : 'Copy diagnostics'}
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              A database that is older than this build is the usual reason a screen breaks after an
              update. Re-running <code>supabase/schema.sql</code> in the Supabase SQL editor is safe:
              it is additive and never drops clinical or billing data.
            </p>
          </div>
        </div>
      </div>
    );
  }
}
