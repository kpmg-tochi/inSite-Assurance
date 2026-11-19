import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import {
  ORGANIZATION_CATEGORY_META,
  type OrganizationCategory,
  type OrganizationDto,
  type OrganizationRef,
} from '@insite/shared';
import {
  useOrganizationsQuery,
  useTenantSettingsQuery,
} from '../../queries/organizations/useOrganizationQueries';

export interface OrganizationInputProps {
  /** `{ id }` for a directory pick, `{ name }` for typed text. */
  value: OrganizationRef | null;
  onChange: (next: OrganizationRef | null) => void;
  /** Filters the dropdown (e.g. 'CONTRACTOR'); typed names are created with this tag server-side. */
  tag?: OrganizationCategory;
  label?: string;
  placeholder?: string;
  error?: string | null;
  disabled?: boolean;
  /** Shown as the current choice when value is { id } (avoids a lookup flash). */
  selectedName?: string | null;
}

type Option =
  | { kind: 'org'; org: OrganizationDto }
  | { kind: 'new'; name: string };

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const inputClass = (hasError: boolean, disabled?: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-xs text-slate-900 placeholder-slate-400 transition focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary ${
    hasError ? 'border-rose-400' : 'border-slate-200'
  } ${disabled ? 'bg-slate-50 opacity-60 cursor-not-allowed' : 'bg-white'}`;

/**
 * Organisation field that follows the tenant's organisation input mode:
 * - FREE_TEXT: a text field; the value is `{ name }`.
 * - DIRECTORY: a searchable list of non-archived organisations (filtered by `tag`); the value is `{ id }`.
 * - BOTH: the same list, plus "Use "typed name"" to add a new organisation; `{ id }` or `{ name }`.
 */
export function OrganizationInput({
  value,
  onChange,
  tag,
  label,
  placeholder,
  error,
  disabled,
  selectedName,
}: OrganizationInputProps): JSX.Element {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const errorId = `${baseId}-error`;
  const hintId = `${baseId}-hint`;

  const { data: settings, isLoading: settingsLoading } = useTenantSettingsQuery();
  const mode = settings?.organizationInputMode ?? 'BOTH';
  const usesDirectory = mode !== 'FREE_TEXT';

  const { data: orgs = [], isLoading: orgsLoading } = useOrganizationsQuery(
    tag ? { tag } : {},
    usesDirectory && !settingsLoading,
  );

  const selectedOrg = value?.id ? orgs.find((o) => o.id === value.id) : undefined;
  const currentLabel = value?.id
    ? selectedOrg?.name ?? selectedName ?? ''
    : value?.name ?? '';

  const [query, setQuery] = useState(currentLabel);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  // Keep the visible text in step with the value when the list is closed.
  useEffect(() => {
    if (!open) setQuery(currentLabel);
  }, [currentLabel, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closeList();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentLabel, mode, orgs]);

  const options: Option[] = useMemo(() => {
    const q = normalise(query);
    const active = orgs.filter((o) => !o.isArchived);
    // When the text is just the current selection, show everything.
    const filtering = q.length > 0 && q !== normalise(currentLabel);
    const matches = filtering ? active.filter((o) => normalise(o.name).includes(q)) : active;
    // Exact (case-insensitive) match first so typing an existing name offers that organisation.
    const sorted = [...matches].sort((a, b) => {
      const ae = normalise(a.name) === q ? 0 : 1;
      const be = normalise(b.name) === q ? 0 : 1;
      return ae - be || a.name.localeCompare(b.name);
    });
    const list: Option[] = sorted.map((org) => ({ kind: 'org', org }));
    const exact = active.some((o) => normalise(o.name) === q);
    if (mode === 'BOTH' && filtering && q.length >= 2 && !exact) {
      list.push({ kind: 'new', name: query.trim().replace(/\s+/g, ' ') });
    }
    return list;
  }, [orgs, query, currentLabel, mode]);

  useEffect(() => {
    if (activeIndex >= options.length) setActiveIndex(0);
  }, [options.length, activeIndex]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  /**
   * Closing without a pick: in BOTH mode, typed text is kept (as the matching organisation if one
   * has that name, otherwise as a new name). In DIRECTORY mode, the text reverts to the selection.
   */
  function closeList(revert = false) {
    setOpen(false);
    const typed = queryRef.current.trim().replace(/\s+/g, ' ');
    if (!revert && mode === 'BOTH' && typed && normalise(typed) !== normalise(currentLabel)) {
      const match = orgs.find((o) => !o.isArchived && normalise(o.name) === normalise(typed));
      if (match) {
        onChange({ id: match.id });
        setQuery(match.name);
        return;
      }
      if (typed.length >= 2) {
        onChange({ name: typed });
        setQuery(typed);
        return;
      }
    }
    setQuery(currentLabel);
  }

  function choose(opt: Option) {
    if (opt.kind === 'org') onChange({ id: opt.org.id });
    else onChange({ name: opt.name });
    setQuery(opt.kind === 'org' ? opt.org.name : opt.name);
    setOpen(false);
  }

  const tagLabel = tag ? ORGANIZATION_CATEGORY_META[tag].label.toLowerCase() : null;
  const describedBy = [error ? errorId : null, hintId].filter(Boolean).join(' ') || undefined;
  const labelEl = label ? (
    <label htmlFor={inputId} className="block text-xs font-semibold text-slate-700 mb-1">
      {label}
    </label>
  ) : null;
  const errorEl = error ? (
    <p id={errorId} className="text-[11px] text-rose-600 mt-1">
      {error}
    </p>
  ) : null;

  // ---- FREE_TEXT: plain text field ----
  if (mode === 'FREE_TEXT') {
    return (
      <div>
        {labelEl}
        <input
          id={inputId}
          type="text"
          value={value?.name ?? ''}
          disabled={disabled}
          placeholder={placeholder ?? 'Organisation name'}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(e) => {
            const name = e.target.value;
            onChange(name.trim() ? { name } : null);
          }}
          className={inputClass(Boolean(error), disabled)}
        />
        <p id={hintId} className="text-[11px] text-slate-500 mt-1">
          A new organisation is added if no existing one has this name.
        </p>
        {errorEl}
      </div>
    );
  }

  // ---- DIRECTORY / BOTH: searchable (and in BOTH, creatable) list ----
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true);
        else setActiveIndex((i) => (options.length ? (i + 1) % options.length : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) setOpen(true);
        else setActiveIndex((i) => (options.length ? (i - 1 + options.length) % options.length : 0));
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActiveIndex(Math.max(options.length - 1, 0));
        }
        break;
      case 'Enter':
        if (open && options[activeIndex]) {
          e.preventDefault();
          choose(options[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          closeList(true);
        }
        break;
      case 'Tab':
        if (open) closeList();
        break;
    }
  };

  const isNewName = Boolean(value?.name && !value.id);
  const loading = settingsLoading || orgsLoading;
  const activeOptionId = open && options[activeIndex] ? `${baseId}-opt-${activeIndex}` : undefined;

  return (
    <div ref={containerRef} className="relative">
      {labelEl}
      <div className="relative">
        <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          value={query}
          disabled={disabled}
          placeholder={
            placeholder ??
            (mode === 'DIRECTORY' ? 'Search organisations' : 'Search or type a new organisation')
          }
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setOpen(true);
            // Clearing the text clears the value.
            if (!e.target.value.trim()) onChange(null);
          }}
          onKeyDown={handleKeyDown}
          className={`${inputClass(Boolean(error), disabled)} pl-8 pr-8`}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Close list' : 'Open list'}
          disabled={disabled}
          onClick={() => (open ? closeList() : setOpen(true))}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 disabled:cursor-not-allowed"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180 text-brand-primary' : ''}`} />
        </button>
      </div>

      {open && !disabled && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label ?? 'Organisations'}
          className="absolute left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl py-1 text-xs"
        >
          {loading && <li className="px-3.5 py-2.5 text-slate-400">Loading organisations...</li>}
          {!loading && options.length === 0 && (
            <li className="px-3.5 py-2.5 text-slate-500">
              {mode === 'DIRECTORY'
                ? `No ${tagLabel ? `${tagLabel} ` : ''}organisation matches. Ask an administrator to add it under Settings > Organisations.`
                : 'Type at least 2 characters to add a new organisation.'}
            </li>
          )}
          {!loading &&
            options.map((opt, index) => {
              const isActive = index === activeIndex;
              const isSelected = opt.kind === 'org' && value?.id === opt.org.id;
              return (
                <li
                  key={opt.kind === 'org' ? opt.org.id : `new-${opt.name}`}
                  id={`${baseId}-opt-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(opt)}
                  className={`px-3.5 py-2 flex items-center justify-between gap-2 cursor-pointer select-none ${
                    isActive ? 'bg-slate-100' : ''
                  } ${isSelected ? 'text-brand-primary font-semibold' : 'text-slate-700'} ${
                    opt.kind === 'new' ? 'border-t border-slate-100' : ''
                  }`}
                >
                  {opt.kind === 'org' ? (
                    <>
                      <span className="truncate">{opt.org.name}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {opt.org.categories.slice(0, 2).map((c) => (
                          <span
                            key={c}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200"
                          >
                            {ORGANIZATION_CATEGORY_META[c].label}
                          </span>
                        ))}
                        {isSelected && <Check className="w-3.5 h-3.5 text-brand-primary" />}
                      </span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Plus className="w-3.5 h-3.5 text-brand-primary shrink-0" />
                      <span className="truncate">
                        Use &ldquo;{opt.name}&rdquo;
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
                        New organisation
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
        </ul>
      )}

      <p id={hintId} className="text-[11px] text-slate-500 mt-1">
        {isNewName
          ? `"${value?.name}" will be added as a new organisation${tagLabel ? ` tagged ${tagLabel}` : ''} when you save.`
          : mode === 'DIRECTORY'
            ? 'Pick from your organisation directory.'
            : 'Pick an organisation, or type a name to add a new one.'}
      </p>
      {errorEl}
    </div>
  );
}
