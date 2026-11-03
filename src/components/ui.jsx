import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Info, X } from 'lucide-react';
import { initials } from '../lib/logic.mjs';

/* --------------------------------------------------------------- buttons */
export function Button({ variant = 'default', size, icon: Icon, children, className = '', loading = false, block = false, ...rest }) {
  const cls = ['btn', variant !== 'default' ? variant : '', size ?? '', block ? 'btn-block' : '', className].filter(Boolean).join(' ');
  return (
    <button className={cls} {...rest} disabled={rest.disabled || loading}>
      {loading ? <Spinner size={15} /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className = '', size = 17, ...rest }) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon size={size} strokeWidth={2.1} />
    </button>
  );
}

export function Spinner({ size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <circle cx="12" cy="12" r="9" stroke={color} strokeOpacity="0.22" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------------------------------------- surfaces */
export function Card({ children, className = '', ...rest }) {
  return <section className={`card ${className}`} {...rest}>{children}</section>;
}
export function CardHead({ title, sub, action, icon: Icon }) {
  return (
    <header className="card-head">
      {Icon ? <span className="kpi-icon" style={{ width: 30, height: 30 }}><Icon size={15} /></span> : null}
      <div style={{ minWidth: 0 }} className="spacer">
        <h3 className="truncate">{title}</h3>
        {sub ? <div className="sub truncate">{sub}</div> : null}
      </div>
      {action}
    </header>
  );
}

export function Badge({ tone = 'neutral', children, dot = false }) {
  return <span className={`badge ${tone}`}>{dot ? <i className="dot" /> : null}{children}</span>;
}

export function Avatar({ name, size = '', tone }) {
  const style = tone ? { background: `${tone}1a`, color: tone, borderColor: `${tone}33` } : undefined;
  return <span className={`avatar ${size}`} style={style} aria-hidden="true">{initials(name)}</span>;
}

export function Field({ label, htmlFor, error, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ error, className = '', ...rest }) {
  return <input className={`input ${error ? 'invalid' : ''} ${className}`} {...rest} />;
}
export function Select({ error, children, className = '', ...rest }) {
  return <select className={`select ${error ? 'invalid' : ''} ${className}`} {...rest}>{children}</select>;
}
export function Textarea({ error, className = '', ...rest }) {
  return <textarea className={`textarea ${error ? 'invalid' : ''} ${className}`} {...rest} />;
}

export function Segmented({ value, onChange, options, ariaLabel = 'Options' }) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button key={opt.value} role="tab" aria-selected={value === opt.value} className={value === opt.value ? 'active' : ''} onClick={() => onChange(opt.value)} type="button">
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ value, onChange, tabs }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} role="tab" type="button" aria-selected={value === tab.value} className={value === tab.value ? 'active' : ''} onClick={() => onChange(tab.value)}>
          {tab.label}{tab.count != null ? ` (${tab.count})` : ''}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, description, action }) {
  return (
    <div className="empty">
      <span className="e-icon"><Icon size={22} /></span>
      <h4>{title}</h4>
      {description ? <p className="small" style={{ maxWidth: 380 }}>{description}</p> : null}
      {action}
    </div>
  );
}

export function Kpi({ label, value, icon: Icon, trend, meta, accent = false }) {
  return (
    <div className={`kpi ${accent ? 'accent' : ''}`}>
      <div className="kpi-top">
        {Icon ? <span className="kpi-icon"><Icon size={16} /></span> : null}
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value mono">{value}</div>
      <div className="kpi-meta">
        {trend ? <span className={`trend ${trend.dir}`}>{trend.label}</span> : null}
        {meta ? <span>{meta}</span> : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- modal */
export function Modal({ open, onClose, title, sub, children, footer, wide = false, labelledBy }) {
  const ref = useRef(null);
  const titleId = useId();
  // Kept in a ref so the setup effect below depends on `open` alone: callers pass
  // an inline onClose, and an effect that re-ran on every render would re-arm the
  // autofocus timer on every keystroke and pull the caret out of the field being
  // typed in.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.modal = 'true';
    // Focus the first field once, when the dialog opens. Never again: if the
    // user has already moved the caret somewhere, that is where they are writing.
    const t = setTimeout(() => {
      const modal = ref.current;
      if (!modal || modal.contains(document.activeElement)) return;
      const el = modal.querySelector('input:not([type=hidden]):not([readonly]), select, textarea')
        ?? modal.querySelector('button');
      el?.focus({ preventScroll: true });
    }, 60);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      delete document.body.dataset.modal;
      clearTimeout(t);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId} ref={ref}>
        <div className="modal-head">
          <div className="spacer">
            <h2 id={titleId}>{title}</h2>
            {sub ? <div className="sub">{sub}</div> : null}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} className="plain" />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger = false }) {
  return (
    <Modal
      open={open} onClose={onClose} title={title}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
    >
      <p className="small muted">{body}</p>
    </Modal>
  );
}

/* --------------------------------------------------------------- toasts */
const ToastContext = createContext(null);
let seq = 0;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = 'info', ttl = 4200) => {
    const id = ++seq;
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), ttl);
  }, []);
  const api = useMemo(() => ({
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error', 6000),
    info: (m) => push(m, 'info'),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="t-icon">{t.tone === 'success' ? <Check size={14} /> : t.tone === 'error' ? <AlertCircle size={14} /> : <Info size={14} />}</span>
            <span className="spacer">{t.message}</span>
            <button className="icon-btn plain sm" aria-label="Dismiss" onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}><X size={13} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() { return useContext(ToastContext) ?? { success() {}, error() {}, info() {} }; }

/* --------------------------------------------------------------- misc */
export function Progress({ value = 0 }) {
  return <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', shortcutHint = '/' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === shortcutHint && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); ref.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcutHint]);
  return (
    <div className="searchbox">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
      <input ref={ref} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} type="search" />
      {shortcutHint ? <kbd>{shortcutHint}</kbd> : null}
    </div>
  );
}

export function StatRow({ items }) {
  return (
    <div className="row wrap" style={{ gap: 18 }}>
      {items.map((item) => (
        <div key={item.label}>
          <div className="eyebrow">{item.label}</div>
          <div className="strong mono">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
