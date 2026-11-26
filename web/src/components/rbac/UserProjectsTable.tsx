import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  formatProjectCode,
  lgaByCode,
  stateByCode,
  type ProjectSummaryDto,
  type UserProjectAssignmentDto,
} from '@insite/shared';

/** One row of the projects table: a directory project, or an assignment the directory does not list (e.g. a draft). */
interface ProjectRow {
  id: string;
  code: string;
  rawCode: string;
  year: number | null;
  name: string;
  state: string;
  lga: string;
  stage: string;
}

const DASH = '–';

function rowFromProject(p: ProjectSummaryDto): ProjectRow {
  return {
    id: p.id,
    code: formatProjectCode(p.codePrefix) || p.codePrefix,
    rawCode: p.codePrefix,
    year: p.interventionYear ?? null,
    name: p.name,
    state: stateByCode(p.stateCode)?.name ?? p.stateLocation ?? '',
    lga: lgaByCode(p.lgaCode)?.name ?? p.lgaLocation ?? '',
    stage: p.stage?.currentLabel ?? '',
  };
}

function rowFromAssignment(a: UserProjectAssignmentDto): ProjectRow {
  const raw = a.projectCodePrefix ?? '';
  return {
    id: a.projectId,
    code: formatProjectCode(raw) || raw || a.projectId.slice(0, 8),
    rawCode: raw,
    year: null,
    name: a.projectName ?? '',
    state: '',
    lga: '',
    stage: '',
  };
}

const byYearThenCode = (a: ProjectRow, b: ProjectRow) =>
  (b.year ?? 0) - (a.year ?? 0) || a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name);

/**
 * The projects a user can see, as a compact table with the assignment ticks in it: search (code,
 * name, State, LGA), "Selected only", select / clear the rows shown. The table scrolls inside its
 * own box, both ways, with a sticky header.
 */
export function UserProjectsTable(props: {
  /** The directory projects the admin can assign. */
  projects: ProjectSummaryDto[];
  /** The user's current assignments; those not in `projects` still show (code and name only). */
  assignments?: UserProjectAssignmentDto[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  /** Start with "Selected only" on (when the user already has projects). */
  initialSelectedOnly?: boolean;
  /** Visible heading of the block. */
  label: string;
}) {
  const { projects, assignments, selectedIds, onChange } = props;
  const uid = useId();
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(Boolean(props.initialSelectedOnly) && selectedIds.length > 0);
  /** Rows unticked while "Selected only" is on stay in view until the filter changes, so an untick can be undone. */
  const [keptInView, setKeptInView] = useState<Set<string>>(() => new Set());

  const rows = useMemo(() => {
    const listed = projects.map(rowFromProject);
    const listedIds = new Set(listed.map((r) => r.id));
    const extra = (assignments ?? []).filter((a) => !listedIds.has(a.projectId)).map(rowFromAssignment);
    return [...listed, ...extra].sort(byYearThenCode);
  }, [projects, assignments]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const term = search.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (selectedOnly && !selected.has(r.id) && !keptInView.has(r.id)) return false;
    if (!term) return true;
    return [r.code, r.rawCode, r.name, r.state, r.lga, r.year ? String(r.year) : ''].some((v) => v.toLowerCase().includes(term));
  });
  const shownSelected = shown.filter((r) => selected.has(r.id)).length;
  const allShownSelected = shown.length > 0 && shownSelected === shown.length;

  const headerBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = shownSelected > 0 && !allShownSelected;
  }, [shownSelected, allShownSelected]);

  const toggle = (id: string) => {
    if (selected.has(id)) {
      if (selectedOnly) setKeptInView((prev) => new Set(prev).add(id));
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };
  const selectShown = () => {
    const next = new Set(selectedIds);
    shown.forEach((r) => next.add(r.id));
    onChange([...next]);
  };
  const clearShown = () => {
    const ids = new Set(shown.map((r) => r.id));
    if (selectedOnly) setKeptInView((prev) => new Set([...prev, ...ids]));
    onChange(selectedIds.filter((x) => !ids.has(x)));
  };
  const toggleSelectedOnly = () => {
    setSelectedOnly((v) => !v);
    setKeptInView(new Set());
  };

  const labelId = `${uid}-label`;
  const countId = `${uid}-count`;
  const smallButton =
    'rounded-lg px-2 py-1 text-[11px] font-semibold text-brand-primary hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary';

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div id={labelId} className="font-semibold text-slate-700">
          {props.label}
        </div>
        <div className="shrink-0 text-[11px] font-semibold text-slate-600">
          {selectedIds.length} selected
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <label htmlFor={`${uid}-search`} className="sr-only">
            Search projects
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            id={`${uid}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Code, name, State or LGA"
            aria-describedby={countId}
            className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-xs text-slate-800 placeholder-slate-400 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <span id={countId} className="text-[11px] text-slate-600" aria-live="polite">
          {shown.length} of {rows.length}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <label className="mr-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100">
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={toggleSelectedOnly}
            className="h-3.5 w-3.5 rounded-sm border-slate-300 text-brand-primary"
          />
          Selected only
        </label>
        <button type="button" onClick={selectShown} disabled={shown.length === 0 || allShownSelected} className={smallButton}>
          Select all shown
        </button>
        <button type="button" onClick={clearShown} disabled={shownSelected === 0} className={smallButton}>
          Clear shown
        </button>
      </div>

      <div
        className="max-h-72 overflow-auto rounded-xl border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        tabIndex={0}
        role="region"
        aria-labelledby={labelId}
      >
        <table className="w-full min-w-[560px] border-collapse text-left text-xs">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              <th scope="col" className="sticky top-0 z-10 w-8 border-b border-slate-200 bg-slate-50 px-2 py-2">
                <input
                  ref={headerBox}
                  type="checkbox"
                  checked={allShownSelected}
                  disabled={shown.length === 0}
                  onChange={() => (allShownSelected ? clearShown() : selectShown())}
                  aria-label={allShownSelected ? 'Clear the projects shown' : 'Select the projects shown'}
                  className="h-3.5 w-3.5 rounded-sm border-slate-300 text-brand-primary"
                />
              </th>
              <th scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2">Code</th>
              <th scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2">Year</th>
              <th scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2">Project name</th>
              <th scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2">State · LGA</th>
              <th scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2">Stage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-600">
                  {rows.length === 0
                    ? 'No projects yet.'
                    : selectedOnly && selectedIds.length === 0 && !term
                      ? 'No projects selected. Untick "Selected only" to choose some.'
                      : 'No projects match.'}
                </td>
              </tr>
            ) : (
              shown.map((r) => {
                const isOn = selected.has(r.id);
                const place = [r.state, r.lga].filter(Boolean).join(' · ');
                return (
                  <tr
                    key={r.id}
                    onClick={() => toggle(r.id)}
                    className={`cursor-pointer ${isOn ? 'bg-brand-primary/5 hover:bg-brand-primary/10' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => toggle(r.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${r.code}${r.year ? ` (${r.year})` : ''} ${r.name}`.trim()}
                        className="h-3.5 w-3.5 rounded-sm border-slate-300 text-brand-primary"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-brand-primary">{r.code}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">{r.year ?? DASH}</td>
                    <td className="max-w-[14rem] truncate px-2 py-1.5 text-slate-800" title={r.name}>
                      {r.name || DASH}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{place || DASH}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{r.stage || DASH}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
