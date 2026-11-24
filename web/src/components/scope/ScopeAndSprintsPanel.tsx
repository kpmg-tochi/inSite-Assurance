import React, { useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Pencil, Plus, Trash2 } from "lucide-react";
import {
  addDays,
  FACILITY_ARCHETYPE_META,
  lineAmount,
  SPRINT_VERIFICATION_OUTCOME_LABELS,
  UNITS_OF_MEASURE,
  unitNeedsQuantity,
  validateSprints,
  type FacilityDto,
  type FacilityUnitDto,
  type ProjectScopeDto,
  type ProjectSprintDto,
  type ScopeLineDto,
  type SprintStatus,
} from "@insite/shared";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import { useProjectScopeQuery } from "../../queries/scope/useScopeQueries";
import { useFacilitiesQuery } from "../../queries/facilities/useFacilityQueries";
import {
  useDeleteFacilityUnitMutation,
  useDeleteScopeLineMutation,
  useSaveFacilityUnitMutation,
  useSaveScopeLineMutation,
  useSaveSprintsMutation,
} from "../../mutations/scope/useScopeMutations";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { CustomSelect } from "../common";
import { ModalShell } from "../common/ModalShell";
import { useConfirmDialog } from "../process/ConfirmDialog";
import { primaryButton, secondaryButton, smallInput } from "../contracts/contractUi";
import Loader from "../Loader";
import { ScopeWorkbookToolbar } from "./ScopeWorkbookToolbar";
import { SprintVerifyDialog } from "./SprintVerifyDialog";
import { useAuth } from "../../lib/auth-context";

/**
 * Redesign R2b: scope and sprints of one project (spec section 5). Used by the setup step
 * (/setup/scope), live settings (/settings/scope) and the project page (/scope).
 * Sprints → facility units (grouped by facility) → BoQ lines. Amounts are computed by the server.
 */

const SPRINT_STATUS: Record<SprintStatus, { label: string; variant: "info" | "success" | "neutral" | "warning" | "danger" }> = {
  UPCOMING: { label: "Upcoming", variant: "neutral" },
  ACTIVE: { label: "Active", variant: "info" },
  ENDED: { label: "Ended", variant: "neutral" },
  // Redesign R4e: ended and not verified within the verification period; verified (outcome shown).
  LATE: { label: "Late", variant: "warning" },
  VERIFIED: { label: "Verified", variant: "success" },
};
const OUTCOME_VARIANT = { MET: "success", PARTLY_MET: "warning", NOT_MET: "danger" } as const;

const UOM_OPTIONS = UNITS_OF_MEASURE.map((u) => ({ value: u.code as string, label: `${u.code} · ${u.label}` }));

function sprintRange(u: FacilityUnitDto) {
  if (u.startSprintNumber === null || u.endSprintNumber === null) return null;
  return u.startSprintNumber === u.endSprintNumber ? `Sprint ${u.startSprintNumber}` : `Sprints ${u.startSprintNumber}–${u.endSprintNumber}`;
}

export interface ScopeAndSprintsPanelProps {
  projectId: string;
  readOnly: boolean;
}

export function ScopeAndSprintsPanel({ projectId, readOnly }: ScopeAndSprintsPanelProps) {
  const q = useProjectScopeQuery(projectId);
  const { hasPermission } = useAuth();
  const [verifying, setVerifying] = useState<string | null>(null);
  const facilitiesQ = useFacilitiesQuery(false, !readOnly);
  const deleteUnit = useDeleteFacilityUnitMutation(projectId);
  const deleteLine = useDeleteScopeLineMutation(projectId);
  const { ask, dialog } = useConfirmDialog();
  const [sprintsOpen, setSprintsOpen] = useState(false);
  const [unitEditor, setUnitEditor] = useState<{ unit: FacilityUnitDto | null } | null>(null);
  const [lineEditor, setLineEditor] = useState<{ line: ScopeLineDto | null; unitId: string | null } | null>(null);

  const scope = q.data;
  const linesByUnit = useMemo(() => {
    const m = new Map<string, ScopeLineDto[]>();
    for (const l of scope?.lines ?? []) {
      if (!l.facilityUnitId) continue;
      m.set(l.facilityUnitId, [...(m.get(l.facilityUnitId) ?? []), l]);
    }
    return m;
  }, [scope?.lines]);

  if (q.isLoading) return <Loader />;
  if (!scope) return <p className="text-sm text-rose-600">Could not load the scope.</p>;

  const live = scope.projectStatus !== "DRAFT";
  const unitsById = new Map(scope.units.map((u) => [u.id, u]));
  const unassigned = scope.lines.filter((l) => !l.facilityUnitId);

  const removeUnit = async (u: FacilityUnitDto) => {
    const ok = await ask({
      title: `Remove ${u.code}?`,
      message: `"${u.label}" and its ${u.lineCount} BoQ line(s) will be removed.`,
      confirmLabel: "Remove unit",
      danger: true,
    });
    if (ok) deleteUnit.mutate(u.id);
  };
  const removeLine = async (l: ScopeLineDto) => {
    const ok = await ask({ title: `Remove line ${l.wbsCode}?`, message: l.description, confirmLabel: "Remove line", danger: true });
    if (ok) deleteLine.mutate(l.id);
  };

  const sprintColumns: TableColumnDef<ProjectSprintDto>[] = [
    { id: "n", header: "No.", width: "w-14", cell: (s) => <span className="text-xs font-bold tabular-nums">{s.number}</span> },
    { id: "name", header: "Sprint", cell: (s) => <span className="text-xs font-semibold text-slate-900">{s.name}</span> },
    {
      id: "dates",
      header: "Dates",
      width: "w-52",
      cell: (s) => (
        <span className="text-xs text-slate-700 whitespace-nowrap">
          {formatDateShort(s.startDate)} – {formatDateShort(s.endDate)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "w-24",
      cell: (s) =>
        s.status === "VERIFIED" && s.verificationOutcome ? (
          <TableBadge variant={OUTCOME_VARIANT[s.verificationOutcome]}>{SPRINT_VERIFICATION_OUTCOME_LABELS[s.verificationOutcome]}</TableBadge>
        ) : (
          <TableBadge variant={SPRINT_STATUS[s.status].variant}>{SPRINT_STATUS[s.status].label}</TableBadge>
        ),
    },
    { id: "units", header: "Units", width: "w-16", align: "center", cell: (s) => <span className="text-xs tabular-nums">{s.unitCount}</span> },
    {
      id: "deliverables",
      header: "Deliverables",
      cell: (s) => <span className="text-[11px] text-slate-600 line-clamp-2">{s.deliverables || "–"}</span>,
    },
    // Redesign R4e: verification on live projects (D-R4.31).
    ...(live && hasPermission("sprints:verify")
      ? [
          {
            id: "verify",
            header: "",
            width: "w-24",
            cell: (s: ProjectSprintDto) =>
              s.status === "UPCOMING" ? null : (
                <button type="button" className="text-xs font-semibold text-brand-primary hover:underline" onClick={() => setVerifying(s.id)}>
                  {s.verificationOutcome ? "Re-verify" : "Verify"}
                </button>
              ),
          } as TableColumnDef<ProjectSprintDto>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {dialog}
      {verifying && <SprintVerifyDialog projectId={projectId} sprintId={verifying} onClose={() => setVerifying(null)} />}
      {/* One summary: the total leads, the counts support it, the workbook sits beside it. */}
      <section aria-label="Scope summary" className="bg-white rounded-2xl border border-slate-200/80 shadow-sm px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-600">Scope total</p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-slate-900">{formatNaira(scope.totals.amountNgn)}</p>
            <p className="mt-1 text-sm text-slate-600">
              {countOf(scope.totals.sprintCount, "sprint")} · {countOf(scope.totals.unitCount, "facility unit")} · {countOf(scope.totals.lineCount, "BoQ line")}
              {scope.budgetNgn !== null &&
                (scope.budgetNgn === scope.totals.amountNgn ? " · matches the budget" : ` · budget ${formatNaira(scope.budgetNgn)}`)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ScopeWorkbookToolbar projectId={projectId} scope={scope} canEdit={!readOnly} />
          </div>
        </div>
        {live && !readOnly && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Changes are recorded in the audit ledger. Units and lines with site evidence cannot be removed.
          </p>
        )}
        {readOnly && <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">View only: changing the scope needs scope editing rights.</p>}
      </section>

      {scope.budgetWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{scope.budgetWarning}</span>
        </div>
      )}

      <StandardTable<ProjectSprintDto>
        title="Sprints"
        subtitle="Named periods with deliverables. They may differ in length and leave gaps, but may not overlap. Numbers follow the dates."
        headerActions={
          !readOnly && (
            <button
              type="button"
              onClick={() => setSprintsOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
            >
              <CalendarRange className="w-3.5 h-3.5" /> Edit sprints
            </button>
          )
        }
        columns={sprintColumns}
        data={scope.sprints}
        keyExtractor={(s) => s.id}
        minWidth="min-w-[720px]"
        emptyState={{ title: "No sprints yet", description: "Add the sprints before you plan the facility units." }}
      />

      <section className="rounded-2xl border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Facility units and BoQ lines</h3>
            <p className="text-[11px] text-slate-500">
              Each unit is one physical facility on site (e.g. "Ground floor male toilet"). Its lines take their planned dates from its sprints.
            </p>
          </div>
          {!readOnly && (
            <button type="button" className={primaryButton} onClick={() => setUnitEditor({ unit: null })}>
              <Plus className="w-3.5 h-3.5 inline -mt-0.5" /> Add unit
            </button>
          )}
        </header>
        {scope.facilityGroups.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-slate-500">No facility units yet.</p>
        )}
        <div className="divide-y divide-slate-100">
          {scope.facilityGroups.map((g) => (
            <div key={g.facility.id} className="px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-slate-900">
                  {g.facility.name}{" "}
                  <span className="font-normal text-slate-500">
                    · {FACILITY_ARCHETYPE_META[g.facility.archetype].label} · {g.unitIds.length} unit(s)
                  </span>
                  {g.facility.isRetired && <TableBadge variant="warning" className="ml-2">Retired</TableBadge>}
                </p>
                <p className="text-xs font-semibold tabular-nums text-slate-700">{formatNaira(g.amountNgn)}</p>
              </div>
              {g.unitIds.map((id) => {
                const u = unitsById.get(id)!;
                const range = sprintRange(u);
                return (
                  <div key={u.id} className="rounded-xl border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 rounded-t-xl">
                      <div className="text-xs">
                        <span className="font-mono font-bold text-slate-900">{u.code}</span>{" "}
                        <span className="font-semibold text-slate-800">{u.label}</span>
                        <span className="text-slate-500">
                          {" · "}
                          {range ?? <span className="text-rose-600 font-semibold">No sprints</span>}
                          {u.plannedQuantity !== null && ` · ${u.plannedQuantity.toLocaleString()} ${u.quantityUnit ?? ""}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold tabular-nums text-slate-700 mr-2">{formatNaira(u.amountNgn)}</span>
                        {!readOnly && (
                          <>
                            <TableActionButton onClick={() => setLineEditor({ line: null, unitId: u.id })}>Add line</TableActionButton>
                            <TableActionButton onClick={() => setUnitEditor({ unit: u })}>Edit</TableActionButton>
                            <TableActionButton
                              variant="danger"
                              disabled={u.hasEvidence || deleteUnit.isPending}
                              onClick={() => removeUnit(u)}
                            >
                              Remove
                            </TableActionButton>
                          </>
                        )}
                      </div>
                    </div>
                    <LinesTable
                      lines={linesByUnit.get(u.id) ?? []}
                      readOnly={readOnly}
                      onEdit={(l) => setLineEditor({ line: l, unitId: l.facilityUnitId })}
                      onRemove={removeLine}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {unassigned.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-white">
          <header className="border-b border-amber-100 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-900">Lines without a facility unit</h3>
            <p className="text-[11px] text-slate-500">
              {live
                ? "Lines from before facility units existed. Edit a line to give it a unit."
                : "Every line needs a facility unit before the project can be activated."}
            </p>
          </header>
          <LinesTable
            lines={unassigned}
            readOnly={readOnly || scope.units.length === 0}
            onEdit={(l) => setLineEditor({ line: l, unitId: null })}
            onRemove={removeLine}
          />
        </section>
      )}

      {sprintsOpen && <SprintsEditor projectId={projectId} scope={scope} onClose={() => setSprintsOpen(false)} />}
      {unitEditor && (
        <UnitEditor
          projectId={projectId}
          scope={scope}
          facilities={facilitiesQ.data ?? []}
          unit={unitEditor.unit}
          onClose={() => setUnitEditor(null)}
        />
      )}
      {lineEditor && (
        <LineEditor
          projectId={projectId}
          scope={scope}
          line={lineEditor.line}
          unitId={lineEditor.unitId}
          onClose={() => setLineEditor(null)}
        />
      )}
    </div>
  );
}

const countOf = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function LinesTable({
  lines,
  readOnly,
  onEdit,
  onRemove,
}: {
  lines: ScopeLineDto[];
  readOnly: boolean;
  onEdit: (l: ScopeLineDto) => void;
  onRemove: (l: ScopeLineDto) => void;
}) {
  if (lines.length === 0) return <p className="px-3 py-2 text-[11px] text-slate-500">No BoQ lines on this unit yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-1.5 font-semibold w-20">Item no.</th>
            <th className="px-3 py-1.5 font-semibold">Description</th>
            <th className="px-3 py-1.5 font-semibold text-right w-28">Quantity</th>
            <th className="px-3 py-1.5 font-semibold text-right w-28">Rate</th>
            <th className="px-3 py-1.5 font-semibold text-right w-32">Amount</th>
            <th className="px-3 py-1.5 font-semibold w-44">Planned</th>
            {!readOnly && <th className="px-3 py-1.5 w-20" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-1.5 font-mono font-semibold text-slate-900">{l.wbsCode}</td>
              <td className="px-3 py-1.5 text-slate-700">{l.description}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {l.totalQuantity.toLocaleString()} {l.unit}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatNaira(l.rateNgn)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{formatNaira(l.budgetedCostNgn)}</td>
              <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">
                {l.plannedStartDate && l.plannedEndDate ? `${formatDateShort(l.plannedStartDate)} – ${formatDateShort(l.plannedEndDate)}` : "–"}
              </td>
              {!readOnly && (
                <td className="px-3 py-1.5">
                  <div className="flex justify-end gap-1">
                    <button type="button" title="Edit line" className="p-1 text-slate-500 hover:text-slate-900" onClick={() => onEdit(l)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title={l.hasEvidence ? "This line has field evidence and cannot be removed" : "Remove line"}
                      disabled={l.hasEvidence}
                      className="p-1 text-slate-500 hover:text-rose-600 disabled:opacity-30"
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

interface SprintRow {
  key: string;
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  deliverables: string;
  locked: boolean;
}

function SprintsEditor({ projectId, scope, onClose }: { projectId: string; scope: ProjectScopeDto; onClose: () => void }) {
  const save = useSaveSprintsMutation(projectId);
  const live = scope.projectStatus !== "DRAFT";
  const [rows, setRows] = useState<SprintRow[]>(() =>
    scope.sprints.map((s) => ({
      key: s.id,
      id: s.id,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      deliverables: s.deliverables,
      locked: live && s.referencedByUnits,
    })),
  );
  const issues = validateSprints(rows);
  const set = (key: string, patch: Partial<SprintRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    const last = [...rows].sort((a, b) => a.endDate.localeCompare(b.endDate)).at(-1);
    const start = last?.endDate ? addDays(last.endDate, 1) : scope.today;
    setRows((rs) => [
      ...rs,
      { key: `new-${Date.now()}`, name: `Sprint ${rs.length + 1}`, startDate: start, endDate: addDays(start, 27), deliverables: "", locked: false },
    ]);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (issues.length) return;
    save.mutate(
      { sprints: rows.map((r) => ({ id: r.id, name: r.name.trim(), startDate: r.startDate, endDate: r.endDate, deliverables: r.deliverables.trim() })) },
      { onSuccess: onClose },
    );
  };
  return (
    <ModalShell
      title="Edit sprints"
      subtitle={live ? "Moving a sprint moves the planned dates of its units' lines. The change is audited." : "Sprints are numbered by their dates when saved."}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <form onSubmit={submit} className="p-5 space-y-3">
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {rows.length === 0 && <p className="text-xs text-slate-500">No sprints. Add the first one.</p>}
          {rows.map((r, index) => {
            const rowIssues = issues.filter((i) => i.index === index);
            return (
              <div key={r.key} className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_150px_auto] gap-2 items-end">
                  <label className="text-[11px] font-semibold text-slate-700">
                    Name
                    <input className={smallInput} value={r.name} maxLength={120} onChange={(e) => set(r.key, { name: e.target.value })} />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700">
                    Start
                    <input type="date" className={smallInput} value={r.startDate} onChange={(e) => set(r.key, { startDate: e.target.value })} />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700">
                    End
                    <input type="date" className={smallInput} value={r.endDate} onChange={(e) => set(r.key, { endDate: e.target.value })} />
                  </label>
                  <button
                    type="button"
                    className="p-2 text-slate-500 hover:text-rose-600 disabled:opacity-30"
                    disabled={r.locked}
                    title={r.locked ? "A facility unit starts or ends in this sprint" : "Remove sprint"}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <label className="block text-[11px] font-semibold text-slate-700">
                  Deliverables
                  <textarea
                    className={`${smallInput} min-h-[44px]`}
                    value={r.deliverables}
                    maxLength={4000}
                    onChange={(e) => set(r.key, { deliverables: e.target.value })}
                  />
                </label>
                {rowIssues.map((i) => (
                  <p key={`${i.code}-${i.field}`} className="text-[11px] font-medium text-rose-600">
                    {i.message}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
        <button type="button" className={secondaryButton} onClick={add}>
          <Plus className="w-3.5 h-3.5 inline -mt-0.5" /> Add sprint
        </button>
        {!live && scope.sprints.some((s) => s.referencedByUnits) && (
          <p className="text-[11px] text-slate-500">Removing a sprint clears it from the units that start or end in it.</p>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={save.isPending || issues.length > 0}>
            {save.isPending ? "Saving…" : "Save sprints"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function UnitEditor({
  projectId,
  scope,
  facilities,
  unit,
  onClose,
}: {
  projectId: string;
  scope: ProjectScopeDto;
  facilities: FacilityDto[];
  unit: FacilityUnitDto | null;
  onClose: () => void;
}) {
  const save = useSaveFacilityUnitMutation(projectId);
  const [facilityId, setFacilityId] = useState(unit?.facility.id ?? "");
  const [label, setLabel] = useState(unit?.label ?? "");
  const [code, setCode] = useState(unit?.code ?? "");
  const [startSprintId, setStart] = useState(unit?.startSprintId ?? "");
  const [endSprintId, setEnd] = useState(unit?.endSprintId ?? "");
  const [plannedQuantity, setQty] = useState(unit?.plannedQuantity?.toString() ?? "");
  const [quantityUnit, setQtyUnit] = useState(unit?.quantityUnit ?? "nr");
  const [error, setError] = useState<string | null>(null);

  const facilityOptions = useMemo(() => {
    const list = facilities.map((f) => ({ value: f.id, label: f.name, description: `${f.code} · ${FACILITY_ARCHETYPE_META[f.archetype].label}` }));
    if (unit && !facilities.some((f) => f.id === unit.facility.id)) {
      list.unshift({ value: unit.facility.id, label: `${unit.facility.name} (retired)`, description: unit.facility.code });
    }
    return list;
  }, [facilities, unit]);
  const archetype = facilities.find((f) => f.id === facilityId)?.archetype ?? (unit?.facility.id === facilityId ? unit.facility.archetype : undefined);
  const needsQty = archetype ? unitNeedsQuantity(archetype) : false;
  const sprintOptions = [
    { value: "", label: "Not set" },
    ...scope.sprints.map((s) => ({ value: s.id, label: `${s.number} · ${s.name}`, description: `${formatDateShort(s.startDate)} – ${formatDateShort(s.endDate)}` })),
  ];
  const nextCode = (() => {
    const used = new Set(scope.units.map((u) => u.code));
    for (let n = 1; ; n++) {
      const c = `U${String(n).padStart(2, "0")}`;
      if (!used.has(c)) return c;
    }
  })();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityId) return setError("Choose the facility.");
    if (label.trim().length < 2) return setError("Enter a label, e.g. Ground floor male toilet.");
    const qty = plannedQuantity.trim() === "" ? null : Number(plannedQuantity);
    if (needsQty && !(qty !== null && qty > 0)) return setError("Enter the planned quantity of this supply item.");
    const s = scope.sprints.find((x) => x.id === startSprintId);
    const en = scope.sprints.find((x) => x.id === endSprintId);
    if (s && en && s.number > en.number) return setError("The end sprint cannot be before the start sprint.");
    setError(null);
    const body = {
      facilityId,
      label: label.trim(),
      ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
      startSprintId: startSprintId || null,
      endSprintId: endSprintId || null,
      plannedQuantity: needsQty ? qty : null,
      quantityUnit: needsQty ? (quantityUnit as (typeof UNITS_OF_MEASURE)[number]["code"]) : null,
    };
    save.mutate(unit ? { id: unit.id, update: body } : { create: body }, { onSuccess: onClose });
  };

  return (
    <ModalShell title={unit ? `Edit ${unit.code}` : "Add a facility unit"} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} className="p-5 space-y-3">
        <CustomSelect label="Facility" value={facilityId} onChange={setFacilityId} options={facilityOptions} searchable size="sm" placeholder="Choose a facility" />
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
          <label className="text-xs font-semibold text-slate-700">
            Label
            <input className={smallInput} value={label} maxLength={160} placeholder="Ground floor male toilet" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Unit ID
            <input
              className={`${smallInput} font-mono uppercase`}
              value={code}
              maxLength={20}
              placeholder={unit ? undefined : `Auto (${nextCode})`}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CustomSelect label="Start sprint" value={startSprintId} onChange={setStart} options={sprintOptions} size="sm" />
          <CustomSelect label="End sprint" value={endSprintId} onChange={setEnd} options={sprintOptions} size="sm" />
        </div>
        {needsQty && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-700">
              Planned quantity
              <input type="number" min={0} step="any" className={smallInput} value={plannedQuantity} onChange={(e) => setQty(e.target.value)} />
            </label>
            <CustomSelect label="Unit of measure" value={quantityUnit} onChange={setQtyUnit} options={UOM_OPTIONS} size="sm" />
          </div>
        )}
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save unit"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function LineEditor({
  projectId,
  scope,
  line,
  unitId,
  onClose,
}: {
  projectId: string;
  scope: ProjectScopeDto;
  line: ScopeLineDto | null;
  unitId: string | null;
  onClose: () => void;
}) {
  const save = useSaveScopeLineMutation(projectId);
  const [facilityUnitId, setUnitId] = useState(unitId ?? line?.facilityUnitId ?? "");
  const [wbsCode, setWbs] = useState(line?.wbsCode ?? "");
  const [description, setDescription] = useState(line?.description ?? "");
  const [uom, setUom] = useState(line?.unit ?? "m2");
  const [quantity, setQuantity] = useState(line?.totalQuantity?.toString() ?? "");
  const [rate, setRate] = useState(line?.rateNgn?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  const unitOptions = scope.units.map((u) => ({ value: u.id, label: `${u.code} · ${u.label}`, description: u.facility.name }));
  const uomOptions = UNITS_OF_MEASURE.some((u) => u.code === uom) ? UOM_OPTIONS : [{ value: uom, label: `${uom} (not on the list)` }, ...UOM_OPTIONS];
  const q = Number(quantity);
  const r = Number(rate);
  const amount = Number.isFinite(q) && Number.isFinite(r) ? lineAmount(q, r) : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityUnitId) return setError("Choose the facility unit.");
    if (!wbsCode.trim()) return setError("Enter the item no.");
    if (description.trim().length < 3) return setError("Enter a description of at least 3 characters.");
    if (!(q > 0)) return setError("The quantity must be above zero.");
    if (!(r >= 0) || rate.trim() === "") return setError("Enter the rate.");
    setError(null);
    const body = { facilityUnitId, wbsCode: wbsCode.trim(), description: description.trim(), totalQuantity: q, rateNgn: r };
    save.mutate(
      line
        ? { id: line.id, update: { ...body, unit: uom } }
        : { create: { ...body, unit: uom as (typeof UNITS_OF_MEASURE)[number]["code"] } },
      { onSuccess: onClose },
    );
  };

  return (
    <ModalShell title={line ? `Edit line ${line.wbsCode}` : "Add a BoQ line"} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} className="p-5 space-y-3">
        <CustomSelect label="Facility unit" value={facilityUnitId} onChange={setUnitId} options={unitOptions} searchable size="sm" placeholder="Choose a unit" />
        <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-3">
          <label className="text-xs font-semibold text-slate-700">
            Item no.
            <input className={`${smallInput} font-mono`} value={wbsCode} maxLength={32} onChange={(e) => setWbs(e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Description
            <input className={smallInput} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <CustomSelect label="Unit of measure" value={uom} onChange={setUom} options={uomOptions} size="sm" />
          <label className="text-xs font-semibold text-slate-700">
            Quantity
            <input type="number" min={0} step="any" className={smallInput} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Rate (NGN)
            <input type="number" min={0} step="any" className={smallInput} value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-slate-600">
          Amount: <span className="font-bold tabular-nums text-slate-900">{formatNaira(amount)}</span>{" "}
          <span className="text-slate-400">(quantity × rate, recomputed by the server)</span>
        </p>
        {line?.hasEvidence && (
          <p className="text-[11px] text-slate-500">This line has field evidence: its quantity cannot go below the work already done.</p>
        )}
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save line"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
