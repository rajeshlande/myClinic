import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pill, Search, History, CornerDownLeft, Database, Loader2 } from 'lucide-react';
import { FORMS, SCHEDULES, medicineName, searchMedicines } from '../lib/medicines.mjs';
import {
  MAX_RESULTS, MIN_QUERY_LENGTH, TIERS, mergeSearchResults, scoreMedicine,
} from '../lib/drug-search.mjs';

/** Type-to-search delay for the server directory. 250 ms is one pause in typing. */
export const DIRECTORY_DEBOUNCE_MS = 250;

const SOURCE_LABEL = {
  history: 'Used here',
  directory: 'Directory',
};

/** Wrap the matched letters in <mark>, leaving the rest of the brand alone. */
function BrandText({ text, ranges }) {
  if (!ranges?.length) return text;
  const parts = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={`m${i}`} className="med-mark">{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/**
 * Drug name field with a typeahead onto the clinic medicine master *and* the
 * drug directory (schema 14).
 *
 * Four things matter more than the dropdown looking nice:
 *
 * 1. **Typing never stops working.** The field is a plain text input; if no
 *    catalogue and no directory has heard of the drug, the doctor carries on and
 *    the line is saved as written. A typeahead that blocks free text is a
 *    typeahead a busy doctor turns off.
 * 2. **The list appears on the keystroke it can.** Local matches are scored
 *    synchronously — no debounce, no spinner — and the directory is asked once
 *    the typing pauses. A doctor never waits for the network to see a familiar
 *    brand.
 * 3. **Selection is one keystroke.** Arrow keys + Enter, or a click. Picking a
 *    medicine fills the molecule, the form, the schedule and the dose defaults.
 * 4. **The composition is always visible**, because that is what the chemist and
 *    the drug inspector read, and it is what the safety checks use.
 */
export default function MedicinePicker({
  value = '',
  onChange,
  onSelect,
  clinicHistory = [],
  placeholder = 'Start typing — brand, salt, strength or symptom',
  autoFocus = false,
  ariaLabel = 'Medicine name',
  /** Optional server search: `(term) => Promise<medicine[]>`. Absent → local only. */
  searchDirectory = null,
  debounceMs = DIRECTORY_DEBOUNCE_MS,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const requestSeq = useRef(0);
  const listId = useId();

  const query = value.trim();
  const longEnough = query.replace(/[^a-zA-Z0-9]/g, '').length >= MIN_QUERY_LENGTH;

  // The catalogue and this clinic's own history — answered synchronously.
  const local = useMemo(
    () => (open ? searchMedicines(value, { clinicHistory, limit: MAX_RESULTS }) : []),
    [value, open, clinicHistory],
  );

  // The directory — asked once the typing pauses, ignored if it is overtaken.
  useEffect(() => {
    if (!searchDirectory || !open || !longEnough) {
      requestSeq.current += 1;
      setRemote([]);
      setLoading(false);
      return undefined;
    }
    const mine = requestSeq.current + 1;
    requestSeq.current = mine;
    const timer = setTimeout(async () => {
      setLoading(true);
      let rows = [];
      try {
        rows = (await searchDirectory(query)) ?? [];
      } catch {
        rows = [];
      }
      // A newer keystroke has already issued its own request: this answer is stale.
      if (requestSeq.current !== mine) return;
      setRemote(Array.isArray(rows) ? rows : []);
      setLoading(false);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, open, longEnough, searchDirectory, debounceMs]);

  const results = useMemo(() => {
    // Score the directory rows with the same rules as the local list, minus a
    // small penalty: the browser's answer already knows this clinic's habits.
    const scored = remote.map((med) => ({
      ...med,
      score: Math.max(1, scoreMedicine(med, query) - TIERS.directoryPenalty),
    }));
    return mergeSearchResults(local, scored, { limit: MAX_RESULTS + 2 });
  }, [local, remote, query]);

  useEffect(() => { setActive(0); }, [value]);
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Clicking anywhere else closes the list; the input keeps its value.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row inside the scroll box, however the user got there.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listId]);

  function choose(med) {
    onSelect?.(med);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (e.key === 'Enter') {
      if (open && results[active]) { e.preventDefault(); choose(results[active]); }
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const showEmpty = open && longEnough && !loading && results.length === 0;
  const showHint = open && !longEnough;

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
        {loading ? <Loader2 size={13} className="med-picker-spinner" aria-hidden="true" /> : null}
      </div>

      {open && results.length ? (
        <ul className="med-picker-list" id={listId} role="listbox" aria-label="Medicine suggestions">
          {results.map((med, i) => {
            const schedule = med.schedule ? SCHEDULES[med.schedule] : null;
            const formLabel = med.form ? (FORMS[med.form] ?? med.form) : '';
            const composition = med.salt || 'composition not recorded';
            const sourceLabel = SOURCE_LABEL[med.source];
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
                    {med.source === 'history'
                      ? <History size={12} className="med-option-src" aria-hidden="true" />
                      : med.source === 'directory'
                        ? <Database size={12} className="med-option-src" aria-hidden="true" />
                        : <Pill size={12} className="med-option-src" aria-hidden="true" />}
                    <BrandText text={medicineName(med)} ranges={med.highlight} />
                  </span>
                  <span className="med-option-salt">
                    {composition}
                    {formLabel ? ` · ${formLabel}` : ''}
                    {med.manufacturer ? ` · ${med.manufacturer}` : ''}
                  </span>
                </span>
                <span className="med-option-side">
                  {sourceLabel ? <span className="med-option-tag">{sourceLabel}</span> : null}
                  {schedule ? <span className={`med-schedule ${med.schedule.toLowerCase()}`}>{schedule.label}</span> : null}
                  {i === active ? <CornerDownLeft size={12} className="med-option-enter" aria-hidden="true" /> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Screen readers get the count; the sighted see the same thing in the list. */}
      <p className="sr-only" role="status" aria-live="polite">
        {open && results.length ? `${results.length} medicine${results.length === 1 ? '' : 's'} suggested` : ''}
      </p>

      {showHint ? (
        <p className="med-picker-empty">
          One more letter — or type the brand as you would say it, “augmentin”, “dolo 650”.
        </p>
      ) : null}

      {showEmpty ? (
        <p className="med-picker-empty">
          Not in the clinic list or the directory — keep typing and it is saved exactly as written.
        </p>
      ) : null}
    </div>
  );
}
