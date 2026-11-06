import { useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, Upload, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button, Field, IconButton, Input } from './ui.jsx';
import { LOGO_ACCEPT, LOGO_KINDS, clinicInitials, logoFor, formatBytes } from '../lib/branding.mjs';
import { describeLogo, processLogoFile } from '../lib/logo.js';

/**
 * The clinic mark, wherever it appears: sidebar, documents, future message previews.
 *
 * Renders the square logo when there is one, the wide logo otherwise, and a
 * lettermark built from the clinic name when neither exists — so the shell never
 * shows a broken image and never has to invent a placeholder graphic.
 */
export function BrandMark({ clinic, size = 34, radius, className = '', style }) {
  const square = logoFor(clinic, 'square');
  const wide = logoFor(clinic, 'wide');
  const src = square ?? wide;
  const initials = clinicInitials(clinic?.name);
  const color = clinic?.brand_color || '#0f766e';
  const rounded = radius ?? Math.round(size * 0.28);

  if (src) {
    // A wide banner squeezed into a square box is cropped, not squashed.
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: size, height: size, borderRadius: rounded, overflow: 'hidden',
          background: '#fff', flex: '0 0 auto', ...style,
        }}
      >
        <img
          src={src}
          alt={clinic?.name ? `${clinic.name} logo` : 'Clinic logo'}
          style={{
            width: '100%', height: '100%',
            objectFit: square ? 'contain' : 'cover',
            display: 'block',
          }}
        />
      </span>
    );
  }

  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: rounded, flex: '0 0 auto',
        background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 62%, #000))`,
        color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.4),
        letterSpacing: '-0.02em', ...style,
      }}
    >
      {initials}
    </span>
  );
}

/**
 * Document header block: wide logo if present, square fallback, then the clinic
 * details. Used by prescriptions and invoices so the two documents can never
 * drift apart in how the clinic is presented.
 */
export function DocumentHeader({ clinic, logo = true, right = null, accent, showGstin = true }) {
  const wide = logoFor(clinic, 'wide');
  const square = logoFor(clinic, 'square');
  const mark = wide ?? square;
  const color = accent || clinic?.brand_color || '#0f766e';

  return (
    <div className="doc-head">
      {logo && mark ? (
        <img
          className="doc-logo"
          src={mark}
          alt={clinic?.name ? `${clinic.name} logo` : 'Clinic logo'}
          style={{ maxHeight: wide ? 58 : 52, maxWidth: wide ? 220 : 92 }}
        />
      ) : null}
      <div className="doc-head-text">
        <div className="doc-clinic" style={{ color: '#12312c' }}>{clinic?.name ?? 'Clinic'}</div>
        <div className="doc-meta">
          {clinic?.address ? <>{clinic.address}<br /></> : null}
          {[clinic?.phone, clinic?.email].filter(Boolean).join(' · ')}
          {/* A GSTIN belongs on a bill, not on a prescription: the format asks for
              the prescriber's registration number, and a tax id in that block reads
              as one more number to check. Invoices keep it. */}
          {showGstin && clinic?.gstin ? <><br />GSTIN {clinic.gstin}</> : null}
        </div>
        <div className="doc-rule" style={{ background: color }} />
      </div>
      {right ? <div className="doc-head-right">{right}</div> : null}
    </div>
  );
}

/**
 * Uploader for one logo kind. Everything the user needs to reason about the file
 * is on screen: the crop it will be used at, its real dimensions and weight after
 * processing, and how it will look on paper.
 */
export function LogoUploader({ kind, value, clinicName, color, onChange, disabled }) {
  const spec = LOGO_KINDS.find((k) => k.id === kind) ?? LOGO_KINDS[0];
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputId = useId();

  const stored = typeof value === 'string' && value.startsWith('data:image/') ? value : null;

  async function handleFile(file) {
    if (!file || disabled) return;
    setError(null);
    setBusy(true);
    try {
      const result = await processLogoFile(file, kind);
      setMeta(result);
      onChange(result.dataUrl);
    } catch (e) {
      setError(e?.message ?? 'Could not use that image.');
      setMeta(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const description = meta ? describeLogo(meta) : (stored ? 'Stored with your clinic' : null);

  return (
    <div className={`logo-field ${drag ? 'drag' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <div className="logo-field-head">
        <span className="logo-field-title">{spec.label}</span>
        <span className="tiny faint">{spec.ratio} · up to {formatBytes(2 * 1024 * 1024)}</span>
      </div>

      <div className="logo-field-body">
        {/* preview — exactly how it will sit on paper */}
        <div className={`logo-preview ${kind === 'wide' ? 'wide' : 'square'}`}>
          {stored ? (
            <img src={stored} alt={`${spec.label} preview`} />
          ) : (
            <span className="logo-empty">
              <ImagePlus size={kind === 'wide' ? 20 : 16} />
              {kind === 'square' ? <em>{clinicInitials(clinicName)}</em> : null}
            </span>
          )}
        </div>

        <div className="logo-field-side">
          <div className="row wrap" style={{ gap: 6 }}>
            <Button
              size="sm" variant={stored ? 'subtle' : 'primary'} icon={Upload}
              onClick={() => inputRef.current?.click()}
              disabled={busy || disabled}
              type="button"
            >
              {busy ? 'Preparing…' : stored ? 'Replace' : 'Upload'}
            </Button>
            {stored ? (
              <Button
                size="sm" variant="ghost" icon={Trash2} type="button"
                disabled={busy || disabled}
                onClick={() => { onChange(null); setMeta(null); setError(null); }}
              >
                Remove
              </Button>
            ) : null}
            {busy ? <span className="row tiny faint" style={{ gap: 5 }}><Loader2 size={12} className="spin" /> resizing</span> : null}
          </div>

          <p className="tiny faint" style={{ margin: 0 }}>{spec.hint}</p>
          {description ? <p className="tiny mono faint" style={{ margin: 0 }}>{description}</p> : null}
          {meta?.scaled ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              Scaled from {meta.sourceWidth}×{meta.sourceHeight} to {meta.width}×{meta.height}.
            </p>
          ) : null}

          <label
            htmlFor={inputId}
            className="logo-drop"
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              handleFile(e.dataTransfer?.files?.[0]);
            }}
          >
            Drop a file here, or use Upload
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept={LOGO_ACCEPT}
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {error ? (
        <p className="logo-error"><AlertTriangle size={13} /> {error}</p>
      ) : (
        <p className="logo-note"><ShieldCheck size={12} /> Re-encoded in your browser. Photos lose location data; SVGs with script are refused.</p>
      )}
    </div>
  );
}

/**
 * The whole branding section: both logos, the printing toggle and the clinic
 * name/accent that the documents use alongside them.
 */
export function BrandingFields({ clinic, onChange, disabled }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Field label="Clinic name on documents">
        <Input
          value={clinic.name ?? ''}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
          placeholder="Sunrise Multispecialty OPD"
        />
      </Field>

      <div className="logo-grid">
        {LOGO_KINDS.map((k) => (
          <LogoUploader
            key={k.id}
            kind={k.id}
            value={clinic[k.column]}
            clinicName={clinic.name}
            color={clinic.brand_color}
            disabled={disabled}
            onChange={(dataUrl) => onChange({ [k.column]: dataUrl })}
          />
        ))}
      </div>

      <label className="row" style={{ gap: 9, alignItems: 'flex-start', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <input
          type="checkbox"
          checked={clinic.logo_on_documents !== false}
          disabled={disabled}
          onChange={(e) => onChange({ logo_on_documents: e.target.checked })}
          style={{ marginTop: 2 }}
        />
        <span>
          <span className="small strong">Print logos on documents</span>
          <span className="tiny faint" style={{ display: 'block' }}>
            Prescriptions and invoices. Turn off for letterhead that already carries your logo.
          </span>
        </span>
      </label>
    </div>
  );
}
