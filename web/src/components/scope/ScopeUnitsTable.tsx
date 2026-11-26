import React, { Fragment, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import {
  FACILITY_ARCHETYPE_META,
  type FacilityUnitDto,
  type ProjectScopeDto,
  type ProjectSiteDto,
  type ScopeLineDto,
} from "@insite/shared";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import { TAB_LIST_CLASS, tabItemClass } from "../common/Tabs";
import { TableBadge } from "../table";
import { ProgressMeter } from "./ProgressMeter";
import { RowActionsMenu } from "./RowActionsMenu";

/**
 * Design refinement (2026-11-26): the facility units of a project as one table, grouped by facility
 * (or by site on a multi-site project). Each unit row opens to show its BoQ lines; unit actions sit
 * in the row's "…" menu, and "Add line" also at the foot of the open unit. Used on the live page and
 * in the draft setup step; progress columns appear on live projects only.
 */

type GroupBy = "facility" | "site";

interface UnitGroup {
  key: string;
  title: string;
  meta: string | null;
  amountNgn: number;
  unitIds: string[];
  retired?: boolean;
  /** Units with no site on a multi-site project. */
  noSite?: boolean;
}

export const countOf = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function sprintRange(u: FacilityUnitDto): string | null {
  if (u.startSprintNumber === null || u.endSprintNumber === null) return null;
  return u.startSprintNumber === u.endSprintNumber ? String(u.startSprintNumber) : `${u.startSprintNumber}–${u.endSprintNumber}`;
}

/**
 * WEB-DEMO1-09: a unit's % complete on a live project. The latest accepted monitoring report sets it
 * (with that visit's date); before one, a unit whose lines kept older stored progress shows their
 * amount-weighted figure, else it says no report has been accepted yet.
 */
export function unitProgress(unit: FacilityUnitDto, lines: ScopeLineDto[]): { pct: number | null; note: string } {
  if (unit.progressPct !== null) {
    return {
      pct: unit.progressPct,
      note: unit.progressAsOf ? `As of the monitoring visit of ${formatDateShort(unit.progressAsOf)}` : "From the latest monitoring report",
    };
  }
  const amount = lines.reduce((s, l) => s + l.budgetedCostNgn, 0);
  const weighted = amount > 0 ? lines.reduce((s, l) => s + l.budgetedCostNgn * l.cumulativeCertifiedPct, 0) / amount : 0;
  return weighted > 0
    ? { pct: weighted, note: "From its BoQ lines · no monitoring report yet" }
    : { pct: null, note: "No monitoring report accepted yet" };
}

export interface ScopeUnitsTableProps {
  scope: ProjectScopeDto;
  sites: ProjectSiteDto[];
  live: boolean;
  readOnly: boolean;
  removePending: boolean;
  onAddUnit: () => void;
  onEditUnit: (u: FacilityUnitDto) => void;
  onRemoveUnit: (u: FacilityUnitDto) => void;
  onAddLine: (u: FacilityUnitDto) => void;
  onEditLine: (l: ScopeLineDto) => void;
  onRemoveLine: (l: ScopeLineDto) => void;
  onEditSprints: () => void;
}

export function ScopeUnitsTable({
  scope,
  sites,
  live,
  readOnly,
  removePending,
  onAddUnit,
  onEditUnit,
  onRemoveUnit,
  onAddLine,
  onEditLine,
  onRemoveLine,
  onEditSprints,
}: ScopeUnitsTableProps) {
  const hasSites = sites.length > 0;
  const [groupByChoice, setGroupBy] = useState<GroupBy>("facility");
  const groupBy: GroupBy = hasSites ? groupByChoice : "facility";
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const unitsById = useMemo(() => new Map(scope.units.map((u) => [u.id, u])), [scope.units]);
  const linesByUnit = useMemo(() => {
    const m = new Map<string, ScopeLineDto[]>();
    for (const l of scope.lines) {
      if (!l.facilityUnitId) continue;
      m.set(l.facilityUnitId, [...(m.get(l.facilityUnitId) ?? []), l]);
    }
    return m;
  }, [scope.lines]);
  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const siteLabel = (siteId: string | null | undefined) => {
    const s = siteId ? siteById.get(siteId) : undefined;
    return s ? `Site ${s.siteNumber} · ${s.schoolName}` : null;
  };

  const groups: UnitGroup[] = useMemo(() => {
    if (groupBy === "facility") {
      return scope.facilityGroups.map((g) => ({
        key: g.facility.id,
        title: g.facility.name,
        meta: FACILITY_ARCHETYPE_META[g.facility.archetype].label,
        amountNgn: g.amountNgn,
        unitIds: g.unitIds,
        retired: g.facility.isRetired,
      }));
    }
    const bySite = new Map<string, string[]>();
    const none: string[] = [];
    for (const u of scope.units) {
      if (u.siteId && siteById.has(u.siteId)) bySite.set(u.siteId, [...(bySite.get(u.siteId) ?? []), u.id]);
      else none.push(u.id);
    }
    const sum = (ids: string[]) => ids.reduce((s, id) => s + (unitsById.get(id)?.amountNgn ?? 0), 0);
    const list: UnitGroup[] = [...sites]
      .sort((a, b) => a.siteNumber - b.siteNumber)
      .filter((s) => bySite.has(s.id))
      .map((s) => {
        const ids = bySite.get(s.id)!;
        return { key: s.id, title: `Site ${s.siteNumber} · ${s.schoolName}`, meta: s.lgaName ?? null, amountNgn: sum(ids), unitIds: ids };
      });
    if (none.length) list.push({ key: "no-site", title: "No site", meta: "Edit a unit to give it a site", amountNgn: sum(none), unitIds: none, noSite: true });
    return list;
  }, [groupBy, scope.facilityGroups, scope.units, sites, siteById, unitsById]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOpen = scope.units.length > 0 && scope.units.every((u) => expanded.has(u.id));

  const showFacilityCol = groupBy === "site";
  const showSiteCol = hasSites && groupBy === "facility";
  const colCount = 4 + (showFacilityCol ? 1 : 0) + (showSiteCol ? 1 : 0) + (live ? 1 : 0) + (readOnly ? 0 : 1);
  const th = "px-3 py-2.5 font-semibold";

  return (
    <section aria-labelledby="scope-units-title" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex flex-col gap-3 bg-brand-navy px-5 py-3.5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="scope-units-title" className="text-sm font-bold tracking-tight">
            Facility units and BoQ lines
          </h2>
          <p className="mt-0.5 text-xs text-white/70">One unit per physical facility on site. Its lines take their planned dates from its work phases.</p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onAddUnit}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-brand-navy hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:self-auto"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add unit
          </button>
        )}
      </header>

      {scope.units.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
          {hasSites ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600" id="scope-group-label">
                Group by
              </span>
              <div role="group" aria-labelledby="scope-group-label" className={TAB_LIST_CLASS}>
                {(["facility", "site"] as const).map((g) => (
                  <button key={g} type="button" aria-pressed={groupBy === g} onClick={() => setGroupBy(g)} className={tabItemClass(groupBy === g)}>
                    {g === "facility" ? "Facility" : "Site"}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600">
              {countOf(scope.units.length, "unit")} in {countOf(scope.facilityGroups.length, "facility")}
            </p>
          )}
          <button
            type="button"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(scope.units.map((u) => u.id)))}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-primary hover:bg-brand-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            {allOpen ? "Hide all BoQ lines" : "Show all BoQ lines"}
          </button>
        </div>
      )}

      {scope.units.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-xs font-bold text-slate-700">No facility units yet.</p>
          {scope.sprints.length === 0 ? (
            <>
              <p className="mt-1 text-[11px] text-slate-500">Add the work phases before you plan the facility units.</p>
              {!readOnly && (
                <button
                  type="button"
                  onClick={onEditSprints}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" /> Add work phases
                </button>
              )}
            </>
          ) : (
            !readOnly && <p className="mt-1 text-[11px] text-slate-500">Add a unit for each facility on site, then list its BoQ lines.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary" tabIndex={0} role="region" aria-labelledby="scope-units-title">
          <table className={`w-full ${live ? "min-w-[880px]" : "min-w-[720px]"} border-collapse text-left text-xs`}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                <th className={`${th} pl-5`}>Unit</th>
                {showFacilityCol && <th className={th}>Facility</th>}
                {showSiteCol && <th className={th}>Site</th>}
                <th className={`${th} w-28`}>Work phases</th>
                <th className={`${th} w-16 text-right`}>Lines</th>
                <th className={`${th} w-32 text-right`}>Amount</th>
                {live && <th className={`${th} w-44`}>% complete</th>}
                {!readOnly && (
                  <th className={`${th} w-12`}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key} className="border-b border-slate-200/70 last:border-b-0">
                <tr className="bg-slate-50/70">
                  <th scope="rowgroup" colSpan={colCount} className="px-5 py-2 text-left font-normal">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                      <span className="text-xs">
                        {g.noSite ? (
                          <span className="inline-flex items-center gap-1 font-bold text-amber-800">
                            <AlertTriangle className="h-3.5 w-3.5 self-center" aria-hidden="true" /> {g.title}
                          </span>
                        ) : (
                          <span className="font-bold text-slate-900">{g.title}</span>
                        )}
                        <span className="text-slate-600">
                          {g.meta ? ` · ${g.meta}` : ""} · {countOf(g.unitIds.length, "unit")}
                        </span>
                        {g.retired && (
                          <TableBadge variant="warning" className="ml-2">
                            Retired
                          </TableBadge>
                        )}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-slate-700">{formatNaira(g.amountNgn)}</span>
                    </div>
                  </th>
                </tr>
                {g.unitIds.map((id) => {
                  const u = unitsById.get(id);
                  if (!u) return null;
                  const lines = linesByUnit.get(u.id) ?? [];
                  const open = expanded.has(u.id);
                  const range = sprintRange(u);
                  const progress = live ? unitProgress(u, lines) : null;
                  const panelId = `scope-unit-lines-${u.id}`;
                  return (
                    <Fragment key={u.id}>
                      <tr
                        onClick={() => toggle(u.id)}
                        className={`cursor-pointer border-t border-slate-100 transition-colors ${open ? "bg-brand-primary/[0.04]" : "hover:bg-slate-50/70"}`}
                      >
                        <td className="py-2.5 pl-3 pr-3">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={panelId}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(u.id);
                            }}
                            className="flex min-w-0 items-start gap-1.5 rounded-lg p-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                          >
                            <ChevronRight
                              className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0">
                              <span className="font-mono font-bold text-slate-900">{u.code}</span>{" "}
                              <span className="font-semibold text-slate-800">{u.label}</span>
                              <span className="sr-only">{open ? ", BoQ lines shown" : ", show BoQ lines"}</span>
                              {u.plannedQuantity !== null && (
                                <span className="block text-[11px] font-normal text-slate-600">
                                  {u.plannedQuantity.toLocaleString()} {u.quantityUnit ?? ""} planned
                                </span>
                              )}
                            </span>
                          </button>
                        </td>
                        {showFacilityCol && <td className="px-3 py-2.5 text-slate-700">{u.facility.name}</td>}
                        {showSiteCol && (
                          <td className="max-w-[16rem] px-3 py-2.5">
                            {siteLabel(u.siteId) ? (
                              <span className="line-clamp-2 text-slate-700">{siteLabel(u.siteId)}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> No site
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {range ? (
                            <span className="tabular-nums text-slate-700">
                              <span className="sr-only">Work phases </span>
                              {range}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> No work phases
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{u.lineCount}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{formatNaira(u.amountNgn)}</td>
                        {progress && (
                          <td className="px-3 py-2.5" title={progress.note}>
                            {progress.pct === null ? (
                              <span className="text-slate-500">No report yet</span>
                            ) : (
                              <ProgressMeter pct={progress.pct} label={`${u.code} ${u.label} % complete`} />
                            )}
                          </td>
                        )}
                        {!readOnly && (
                          <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                            <RowActionsMenu
                              label={`Actions for ${u.code} ${u.label}`}
                              items={[
                                {
                                  id: "add-line",
                                  label: "Add BoQ line",
                                  icon: <Plus className="h-3.5 w-3.5" />,
                                  onSelect: () => {
                                    setExpanded((prev) => new Set(prev).add(u.id));
                                    onAddLine(u);
                                  },
                                },
                                { id: "edit", label: "Edit unit", icon: <Pencil className="h-3.5 w-3.5" />, onSelect: () => onEditUnit(u) },
                                {
                                  id: "remove",
                                  label: "Remove unit",
                                  icon: <Trash2 className="h-3.5 w-3.5" />,
                                  danger: true,
                                  disabledReason: u.hasEvidence
                                    ? "It has site evidence, so it cannot be removed."
                                    : removePending
                                      ? "A removal is in progress."
                                      : null,
                                  onSelect: () => onRemoveUnit(u),
                                },
                              ]}
                            />
                          </td>
                        )}
                      </tr>
                      {open && (
                        <tr id={panelId} className="bg-brand-primary/[0.04]">
                          <td colSpan={colCount} className="px-5 pb-4 pt-0">
                            <div className="ml-2 border-l-2 border-brand-primary/30 pl-4">
                              <LinesTable lines={lines} readOnly={readOnly} showProgress={live} onEdit={onEditLine} onRemove={onRemoveLine} nested />
                              {(progress || !readOnly) && (
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                  {progress ? <p className="text-[11px] text-slate-600">% complete: {progress.note}</p> : <span />}
                                  {!readOnly && (
                                    <button
                                      type="button"
                                      onClick={() => onAddLine(u)}
                                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-primary hover:bg-brand-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                                    >
                                      <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add line to {u.code}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
}

export function LinesTable({
  lines,
  readOnly,
  showProgress,
  onEdit,
  onRemove,
  nested = false,
}: {
  lines: ScopeLineDto[];
  readOnly: boolean;
  /** Live projects: each line's % complete (its unit's, once a monitoring report is accepted). */
  showProgress: boolean;
  onEdit: (l: ScopeLineDto) => void;
  onRemove: (l: ScopeLineDto) => void;
  /** Inside an open unit row: no own scroll container, tighter cells. */
  nested?: boolean;
}) {
  if (lines.length === 0) return <p className="px-3 py-2 text-[11px] text-slate-600">No BoQ lines on this unit yet.</p>;
  const cell = nested ? "px-2 py-1.5" : "px-3 py-1.5";
  const table = (
    <table className={`w-full ${nested ? "" : showProgress ? "min-w-[880px]" : "min-w-[720px]"} text-xs`}>
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
          <th className={`${cell} font-semibold w-20`}>Item no.</th>
          <th className={`${cell} font-semibold`}>Description</th>
          <th className={`${cell} font-semibold text-right w-24`}>Quantity</th>
          <th className={`${cell} font-semibold text-right w-24`}>Rate</th>
          <th className={`${cell} font-semibold text-right w-28`}>Amount</th>
          <th className={`${cell} font-semibold w-44`}>Planned</th>
          {showProgress && <th className={`${cell} font-semibold w-36`}>% complete</th>}
          {!readOnly && (
            <th className={`${cell} w-16`}>
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200/70">
        {lines.map((l) => (
          <tr key={l.id}>
            <td className={`${cell} font-mono font-semibold text-slate-900`}>{l.wbsCode}</td>
            <td className={`${cell} text-slate-700`}>{l.description}</td>
            <td className={`${cell} text-right tabular-nums whitespace-nowrap`}>
              {l.totalQuantity.toLocaleString()} {l.unit}
            </td>
            <td className={`${cell} text-right tabular-nums`}>{formatNaira(l.rateNgn)}</td>
            <td className={`${cell} text-right tabular-nums font-semibold`}>{formatNaira(l.budgetedCostNgn)}</td>
            <td className={`${cell} text-slate-600 whitespace-nowrap`}>
              {l.plannedStartDate && l.plannedEndDate ? `${formatDateShort(l.plannedStartDate)} – ${formatDateShort(l.plannedEndDate)}` : "–"}
            </td>
            {showProgress && (
              <td className={cell}>
                <ProgressMeter pct={l.cumulativeCertifiedPct} label={`Line ${l.wbsCode} % complete`} />
              </td>
            )}
            {!readOnly && (
              <td className={cell}>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    title="Edit line"
                    aria-label={`Edit line ${l.wbsCode}`}
                    className="rounded p-1 text-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                    onClick={() => onEdit(l)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title={l.hasEvidence ? "This line has field evidence and cannot be removed" : "Remove line"}
                    aria-label={l.hasEvidence ? `Line ${l.wbsCode} has field evidence and cannot be removed` : `Remove line ${l.wbsCode}`}
                    disabled={l.hasEvidence}
                    className="rounded p-1 text-slate-500 hover:text-rose-600 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                    onClick={() => onRemove(l)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return nested ? table : <div className="overflow-x-auto">{table}</div>;
}
