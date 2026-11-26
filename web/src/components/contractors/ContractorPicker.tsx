import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { ContractorSummaryDto } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useContractorsQuery } from "../../queries/contractors";
import { ContractorStars, ContractorStatusChip } from "./ContractorStars";
import { NewContractorDialog } from "./NewContractorDialog";
import { contractorStatusNote } from "./contractorUi";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function matches(c: ContractorSummaryDto, q: string): boolean {
  if (!q) return true;
  return norm(c.name).includes(q) || norm(c.registrationNumber ?? "").replace(/ /g, "").includes(q.replace(/ /g, ""));
}

/**
 * Client demo updates F.2: the contractor picker (step 2 Contract). Searchable by name and RC
 * number; each option shows the RC number, stars with the report count, and the status. Inactive
 * contractors show "Contract not yet on file"; suspended ones are greyed and cannot be picked
 * (unless already the project's). "+ New contractor" (`contractors:manage`) adds one, inactive.
 * The value is the organisation id; the section saves it as `organization: { id }`.
 */
export function ContractorPicker({
  value,
  selectedName,
  onChange,
  label = "Contractor",
  error,
  disabled,
}: {
  value: string | null;
  selectedName?: string | null;
  onChange: (next: { id: string; name: string } | null) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
}) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("contractors:manage");
  const query = useContractorsQuery({});
  const contractors = useMemo(() => query.data ?? [], [query.data]);
  const selected = value ? contractors.find((c) => c.id === value) : undefined;
  const currentLabel = selected?.name ?? selectedName ?? "";

  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const [text, setText] = useState(currentLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setText(currentLabel);
  }, [currentLabel, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const q = norm(text === currentLabel ? "" : text);
  const options = useMemo(() => contractors.filter((c) => matches(c, q)), [contractors, q]);
  const selectable = (c: ContractorSummaryDto) => c.status !== "SUSPENDED" || c.id === value;

  const choose = (c: ContractorSummaryDto) => {
    if (!selectable(c)) return;
    onChange({ id: c.id, name: c.name });
    setText(c.name);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      const c = options[active];
      if (c) choose(c);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const errorId = `${baseId}-error`;
  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={inputId} className="mb-1 block text-xs font-semibold text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={text}
          disabled={disabled}
          placeholder={query.isLoading ? "Loading contractors…" : "Search by name or RC number"}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={`w-full rounded-xl border px-3 py-2 pr-8 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary ${
            error ? "border-rose-400" : "border-slate-200"
          } ${disabled ? "cursor-not-allowed bg-slate-50 opacity-60" : "bg-white"}`}
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-[11px] text-rose-600">
          {error}
        </p>
      )}

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <ul id={listId} role="listbox" aria-label="Contractors" className="max-h-72 overflow-y-auto py-1">
            {options.length === 0 && (
              <li className="px-3 py-2 text-[11px] text-slate-500">{query.isError ? "The contractor register could not be loaded." : "No contractor matches."}</li>
            )}
            {options.map((c, i) => {
              const ok = selectable(c);
              const note = contractorStatusNote(c);
              return (
                <li
                  key={c.id}
                  id={`${listId}-${c.id}`}
                  role="option"
                  aria-selected={c.id === value}
                  aria-disabled={!ok}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(c)}
                  className={`px-3 py-2 text-xs ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${
                    i === active ? "bg-brand-primary/5" : ""
                  } ${c.id === value ? "font-semibold" : ""}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-900">{c.name}</span>
                    <ContractorStatusChip status={c.status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span>{c.registrationNumber ?? "No RC number"}</span>
                    <ContractorStars rating={c.rating} compact />
                    <span>
                      {c.activeProjectCount} active project{c.activeProjectCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  {note && <div className={`mt-0.5 text-[11px] ${c.status === "SUSPENDED" ? "text-rose-700" : "text-amber-700"}`}>{note}</div>}
                </li>
              );
            })}
          </ul>
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setCreating(text === currentLabel ? "" : text.trim());
              }}
              className="flex w-full items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-brand-primary hover:bg-brand-primary/5"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New contractor
            </button>
          )}
        </div>
      )}

      {selected && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ContractorStatusChip status={selected.status} />
          <ContractorStars rating={selected.rating} />
          {contractorStatusNote(selected) && <span className="text-[11px] text-amber-700">{contractorStatusNote(selected)}</span>}
        </div>
      )}

      {creating !== null && (
        <NewContractorDialog
          initialName={creating}
          onClose={() => setCreating(null)}
          onSelect={(c) => {
            setCreating(null);
            onChange(c);
            setText(c.name);
          }}
        />
      )}
    </div>
  );
}
