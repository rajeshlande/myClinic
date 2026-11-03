import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pill, Search, History, CornerDownLeft } from 'lucide-react';
import { FORMS, SCHEDULES, medicineName, searchMedicines } from '../lib/medicines.mjs';

/**
 * Drug name field with a typeahead onto the clinic medicine master.
 *
 * Two things matter more than the dropdown looking nice:
 *
 * 1. **Typing never stops working.** The field is a plain text input; if the
 *    catalogue has never heard of a drug the doctor simply carries on and the line
 *    is saved as written. A typeahead that blocks free text is a typeahead a busy
 *    doctor turns off.
 * 2. **Selection is one keystroke.** Arrow keys + Enter, or a click. Picking a
 *    medicine fills the dose, frequency, duration and food relation from its
 *    default template, which is where the retyping actually disappears.
 */
export default function MedicinePicker({
  value = '',
  onChange,
  onSelect,
  clinicHistory = [],
  placeholder = 'Start typing — brand, salt or symptom',
  autoFocus = false,
  ariaLabel = 'Medicine name',
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();

  const results = useMemo(
    () => (open ? searchMedicines(value, { clinicHistory, limit: 8 }) : []),
    [value, open, clinicHistory],
  );

  useEffect(() => { setActive(0); }, [value]);

  // Clicking anywhere else closes the list; the input keeps its value.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(med) {
    onSelect?.(med);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && results[active]) { e.preventDefault(); choose(results[active]); }
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const showEmpty = open && value.trim().length >= 2 && results.length === 0;

  return (
    <div className="med-picker" ref={wrapRef}>
      <div className="med-picker-field">
        <Search size={14} className="med-picker-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="input med-picker-input"
          value={value}
          onChange={(e) => { onChange?.(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        />
      </div>

      {open && results.length ? (
        <ul className="med-picker-list" id={listId} role="listbox" aria-label="Medicine suggestions">
          {results.map((med, i) => {
            const schedule = med.schedule ? SCHEDULES[med.schedule] : null;
            return (
              <li
                key={`${med.id}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`med-option ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(med); }}
              >
                <span className="med-option-main">
                  <span className="med-option-brand">
                    {med.source === 'history' ? <History size={12} className="med-option-src" /> : <Pill size={12} className="med-option-src" />}
                    {med.source === 'history' ? med.brand : medicineName(med)}
                  </span>
                  <span className="med-option-salt">
                    {med.salt || 'composition not recorded'}
                    {med.form ? ` · ${FORMS[med.form] ?? med.form}` : ''}
                  </span>
                </span>
                <span className="med-option-side">
                  {schedule ? <span className={`med-schedule ${med.schedule.toLowerCase()}`}>{schedule.label}</span> : null}
                  {i === active ? <CornerDownLeft size={12} className="med-option-enter" /> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {showEmpty ? (
        <p className="med-picker-empty">
          Not in the clinic list — keep typing and it is saved exactly as written.
        </p>
      ) : null}
    </div>
  );
}
