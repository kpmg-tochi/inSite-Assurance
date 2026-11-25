import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { AlertTriangle, CalendarRange, Pencil, Plus, Trash2 } from "lucide-react";
import {
  addDays,
  CreateFacilityUnitRequestSchema,
  CreateScopeLineRequestSchema,
  FACILITY_ARCHETYPE_META,
  FACILITY_UNIT_CODE_REGEX,
  lineAmount,
  SaveSprintsRequestSchema,
  SPRINT_VERIFICATION_OUTCOME_LABELS,
  UNITS_OF_MEASURE,
  unitNeedsQuantity,
  validateSprints,
  type CreateFacilityUnitRequest,
  type FacilityDto,
  type FacilityUnitDto,
  type ProjectScopeDto,
  type ProjectSprintDto,
  type SaveSprintsRequest,
  type ScopeLineDto,
  type SprintStatus,
} from "@insite/shared";
import { formatDateShort, formatNaira } from "../../lib/formatters";
import { FieldError, SubmitButton, fieldA11y, invalidClass, useZodForm, visibleError, zChoice, zNumberText } from "../../lib/forms";
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
      {/* One summary: the total leads, the counts support it, the needs assessment sits beside it. */}
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

const SprintRowFormSchema = z.object({
  /** The saved sprint's id (absent for a new row). Not called `id`: the field array keys rows by `id`. */
  sprintId: z.string().optional(),
  name: z.string().trim().max(120, "Name is too long (at most 120 characters)"),
  startDate: z.string(),
  endDate: z.string(),
  deliverables: z.string().trim().max(4000, "Deliverables are too long (at most 4000 characters)"),
  locked: z.boolean(),
});

/** The shared sprint rules (names, dates, no overlaps) as form errors on the row and field. */
const SprintsFormSchema = z
  .object({ sprints: z.array(SprintRowFormSchema) })
  .superRefine((v, ctx) => {
    for (const issue of validateSprints(v.sprints)) {
      ctx.addIssue({ code: "custom", path: ["sprints", issue.index ?? 0, issue.field ?? "name"], message: issue.message });
    }
  })
  .transform((v): SaveSprintsRequest => ({
    sprints: v.sprints.map((r) => ({ id: r.sprintId, name: r.name, startDate: r.startDate, endDate: r.endDate, deliverables: r.deliverables })),
  }))
  .pipe(SaveSprintsRequestSchema);

function SprintsEditor({ projectId, scope, onClose }: { projectId: string; scope: ProjectScopeDto; onClose: () => void }) {
  const save = useSaveSprintsMutation(projectId);
  const live = scope.projectStatus !== "DRAFT";
  const form = useZodForm(SprintsFormSchema, {
    defaultValues: {
      sprints: scope.sprints.map((s) => ({
        sprintId: s.id,
        name: s.name,
        startDate: s.startDate,
        endDate: s.endDate,
        deliverables: s.deliverables,
        locked: live && s.referencedByUnits,
      })),
    },
  });
  const rows = useFieldArray({ control: form.control, name: "sprints" });
  const values = form.watch("sprints");
  const issues = validateSprints(values);
  const add = () => {
    const last = [...values].sort((a, b) => a.endDate.localeCompare(b.endDate)).at(-1);
    const start = last?.endDate ? addDays(last.endDate, 1) : scope.today;
    rows.append({ name: `Sprint ${values.length + 1}`, startDate: start, endDate: addDays(start, 27), deliverables: "", locked: false });
  };
  const submit = form.handleSubmit((body) => save.mutate(body, { onSuccess: onClose }));
  return (
    <ModalShell
      title="Edit sprints"
      subtitle={live ? "Moving a sprint moves the planned dates of its units' lines. The change is audited." : "Sprints are numbered by their dates when saved."}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <form onSubmit={submit} noValidate className="p-5 space-y-3">
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {rows.fields.length === 0 && <p className="text-xs text-slate-500">No sprints. Add the first one.</p>}
          {rows.fields.map((r, index) => {
            const rowIssues = issues.filter((i) => i.index === index);
            const locked = values[index]?.locked ?? false;
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_150px_auto] gap-2 items-end">
                  <label className="text-[11px] font-semibold text-slate-700">
                    Name
                    <input
                      className={`${smallInput} ${rowIssues.some((i) => i.field === "name") ? "border-rose-400" : ""}`}
                      maxLength={120}
                      aria-invalid={rowIssues.some((i) => i.field === "name") || undefined}
                      {...form.register(`sprints.${index}.name`)}
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700">
                    Start
                    <input
                      type="date"
                      className={`${smallInput} ${rowIssues.some((i) => i.field === "startDate") ? "border-rose-400" : ""}`}
                      aria-invalid={rowIssues.some((i) => i.field === "startDate") || undefined}
                      {...form.register(`sprints.${index}.startDate`)}
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700">
                    End
                    <input
                      type="date"
                      className={`${smallInput} ${rowIssues.some((i) => i.field === "endDate") ? "border-rose-400" : ""}`}
                      aria-invalid={rowIssues.some((i) => i.field === "endDate") || undefined}
                      {...form.register(`sprints.${index}.endDate`)}
                    />
                  </label>
                  <button
                    type="button"
                    className="p-2 text-slate-500 hover:text-rose-600 disabled:opacity-30"
                    disabled={locked}
                    title={locked ? "A facility unit starts or ends in this sprint" : "Remove sprint"}
                    onClick={() => rows.remove(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <label className="block text-[11px] font-semibold text-slate-700">
                  Deliverables
                  <textarea className={`${smallInput} min-h-[44px]`} maxLength={4000} {...form.register(`sprints.${index}.deliverables`)} />
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
        <div className="flex items-start justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton form={form} pending={save.isPending} pendingLabel="Saving…" hint="Fix the sprints marked in red." className={primaryButton}>
            Save sprints
          </SubmitButton>
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

  const facilityOptions = useMemo(() => {
    const list = facilities.map((f) => ({ value: f.id, label: f.name, description: `${f.code} · ${FACILITY_ARCHETYPE_META[f.archetype].label}` }));
    if (unit && !facilities.some((f) => f.id === unit.facility.id)) {
      list.unshift({ value: unit.facility.id, label: `${unit.facility.name} (retired)`, description: unit.facility.code });
    }
    return list;
  }, [facilities, unit]);
  const archetypeOf = (facilityId: string) =>
    facilities.find((f) => f.id === facilityId)?.archetype ?? (unit?.facility.id === facilityId ? unit.facility.archetype : undefined);
  const needsQtyFor = (facilityId: string) => {
    const archetype = archetypeOf(facilityId);
    return archetype ? unitNeedsQuantity(archetype) : false;
  };

  // Built per render: the quantity rule depends on the facility's archetype and the sprint order on the project's sprints.
  const schema = z
    .object({
      facilityId: zChoice("facility"),
      label: CreateFacilityUnitRequestSchema.shape.label,
      code: z
        .string()
        .trim()
        .refine((v) => !v || FACILITY_UNIT_CODE_REGEX.test(v), "Unit ID: up to 20 letters, digits, dots, dashes or underscores, e.g. U01"),
      startSprintId: z.string(),
      endSprintId: z.string(),
      plannedQuantity: z.string().trim(),
      quantityUnit: z.string(),
    })
    .superRefine((v, ctx) => {
      if (needsQtyFor(v.facilityId)) {
        const qty = Number(v.plannedQuantity);
        if (v.plannedQuantity === "" || !Number.isFinite(qty) || qty <= 0) {
          ctx.addIssue({ code: "custom", path: ["plannedQuantity"], message: "Enter the planned quantity of this supply item (above zero)" });
        }
      }
      const s = scope.sprints.find((x) => x.id === v.startSprintId);
      const en = scope.sprints.find((x) => x.id === v.endSprintId);
      if (s && en && s.number > en.number) ctx.addIssue({ code: "custom", path: ["endSprintId"], message: "The end sprint cannot be before the start sprint" });
    })
    .transform((v): CreateFacilityUnitRequest => {
      const needsQty = needsQtyFor(v.facilityId);
      return {
        facilityId: v.facilityId,
        label: v.label,
        ...(v.code ? { code: v.code.toUpperCase() } : {}),
        startSprintId: v.startSprintId || null,
        endSprintId: v.endSprintId || null,
        plannedQuantity: needsQty ? Number(v.plannedQuantity) : null,
        quantityUnit: needsQty ? (v.quantityUnit as (typeof UNITS_OF_MEASURE)[number]["code"]) : null,
      };
    });
  const form = useZodForm(schema, {
    defaultValues: {
      facilityId: unit?.facility.id ?? "",
      label: unit?.label ?? "",
      code: unit?.code ?? "",
      startSprintId: unit?.startSprintId ?? "",
      endSprintId: unit?.endSprintId ?? "",
      plannedQuantity: unit?.plannedQuantity?.toString() ?? "",
      quantityUnit: unit?.quantityUnit ?? "nr",
    },
  });
  const needsQty = needsQtyFor(form.watch("facilityId"));
  // A facility change can switch the quantity rule on or off: re-check it.
  useEffect(() => {
    void form.trigger("plannedQuantity");
  }, [form, needsQty]);

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

  const submit = form.handleSubmit((body) => save.mutate(unit ? { id: unit.id, update: body } : { create: body }, { onSuccess: onClose }));

  return (
    <ModalShell title={unit ? `Edit ${unit.code}` : "Add a facility unit"} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} noValidate className="p-5 space-y-3">
        <Controller
          control={form.control}
          name="facilityId"
          render={({ field }) => (
            <CustomSelect
              label="Facility"
              value={field.value}
              onChange={(v) => {
                field.onChange(v);
                field.onBlur();
              }}
              error={visibleError(form, "facilityId")}
              options={facilityOptions}
              searchable
              size="sm"
              placeholder="Choose a facility"
            />
          )}
        />
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
          <label className="text-xs font-semibold text-slate-700">
            Label
            <input
              className={`${smallInput} ${invalidClass(form, "label")}`}
              maxLength={160}
              placeholder="Ground floor male toilet"
              {...form.register("label")}
              {...fieldA11y(form, "label")}
            />
            <FieldError form={form} name="label" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Unit ID
            <input
              className={`${smallInput} font-mono uppercase ${invalidClass(form, "code")}`}
              maxLength={20}
              placeholder={unit ? undefined : `Auto (${nextCode})`}
              {...form.register("code", { setValueAs: (v: string) => v.toUpperCase() })}
              {...fieldA11y(form, "code")}
            />
            <FieldError form={form} name="code" />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Controller
            control={form.control}
            name="startSprintId"
            render={({ field }) => <CustomSelect label="Start sprint" value={field.value} onChange={field.onChange} options={sprintOptions} size="sm" />}
          />
          <Controller
            control={form.control}
            name="endSprintId"
            render={({ field }) => (
              <CustomSelect
                label="End sprint"
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  field.onBlur();
                }}
                error={visibleError(form, "endSprintId")}
                options={sprintOptions}
                size="sm"
              />
            )}
          />
        </div>
        {needsQty && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-700">
              Planned quantity
              <input
                type="number"
                min={0}
                step="any"
                className={`${smallInput} ${invalidClass(form, "plannedQuantity")}`}
                {...form.register("plannedQuantity")}
                {...fieldA11y(form, "plannedQuantity")}
              />
              <FieldError form={form} name="plannedQuantity" />
            </label>
            <Controller
              control={form.control}
              name="quantityUnit"
              render={({ field }) => <CustomSelect label="Unit of measure" value={field.value} onChange={field.onChange} options={UOM_OPTIONS} size="sm" />}
            />
          </div>
        )}
        <div className="flex items-start justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton form={form} pending={save.isPending} pendingLabel="Saving…" className={primaryButton}>
            Save unit
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}

const LineFormSchema = z.object({
  facilityUnitId: zChoice("facility unit"),
  wbsCode: CreateScopeLineRequestSchema.shape.wbsCode,
  description: CreateScopeLineRequestSchema.shape.description,
  unit: z.string().trim().min(1, "Choose the unit of measure").max(32),
  quantity: zNumberText("Quantity").refine((n) => n > 0, "Quantity must be above zero"),
  rate: zNumberText("Rate").refine((n) => n >= 0, "The rate cannot be negative"),
});

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
  const form = useZodForm(LineFormSchema, {
    defaultValues: {
      facilityUnitId: unitId ?? line?.facilityUnitId ?? "",
      wbsCode: line?.wbsCode ?? "",
      description: line?.description ?? "",
      unit: line?.unit ?? "m2",
      quantity: line?.totalQuantity?.toString() ?? "",
      rate: line?.rateNgn?.toString() ?? "",
    },
  });
  const uom = form.watch("unit");

  const unitOptions = scope.units.map((u) => ({ value: u.id, label: `${u.code} · ${u.label}`, description: u.facility.name }));
  const uomOptions = UNITS_OF_MEASURE.some((u) => u.code === uom) ? UOM_OPTIONS : [{ value: uom, label: `${uom} (not on the list)` }, ...UOM_OPTIONS];
  const q = Number(form.watch("quantity"));
  const r = Number(form.watch("rate"));
  const amount = Number.isFinite(q) && Number.isFinite(r) ? lineAmount(q, r) : 0;

  const submit = form.handleSubmit((v) => {
    const body = { facilityUnitId: v.facilityUnitId, wbsCode: v.wbsCode, description: v.description, totalQuantity: v.quantity, rateNgn: v.rate };
    save.mutate(
      line
        ? { id: line.id, update: { ...body, unit: v.unit } }
        : { create: { ...body, unit: v.unit as (typeof UNITS_OF_MEASURE)[number]["code"] } },
      { onSuccess: onClose },
    );
  });

  return (
    <ModalShell title={line ? `Edit line ${line.wbsCode}` : "Add a BoQ line"} onClose={onClose} maxWidth="max-w-lg">
      <form onSubmit={submit} noValidate className="p-5 space-y-3">
        <Controller
          control={form.control}
          name="facilityUnitId"
          render={({ field }) => (
            <CustomSelect
              label="Facility unit"
              value={field.value}
              onChange={(v) => {
                field.onChange(v);
                field.onBlur();
              }}
              error={visibleError(form, "facilityUnitId")}
              options={unitOptions}
              searchable
              size="sm"
              placeholder="Choose a unit"
            />
          )}
        />
        <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-3">
          <label className="text-xs font-semibold text-slate-700">
            Item no.
            <input className={`${smallInput} font-mono ${invalidClass(form, "wbsCode")}`} maxLength={32} {...form.register("wbsCode")} {...fieldA11y(form, "wbsCode")} />
            <FieldError form={form} name="wbsCode" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Description
            <input className={`${smallInput} ${invalidClass(form, "description")}`} maxLength={600} {...form.register("description")} {...fieldA11y(form, "description")} />
            <FieldError form={form} name="description" />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Controller
            control={form.control}
            name="unit"
            render={({ field }) => <CustomSelect label="Unit of measure" value={field.value} onChange={field.onChange} options={uomOptions} size="sm" />}
          />
          <label className="text-xs font-semibold text-slate-700">
            Quantity
            <input type="number" min={0} step="any" className={`${smallInput} ${invalidClass(form, "quantity")}`} {...form.register("quantity")} {...fieldA11y(form, "quantity")} />
            <FieldError form={form} name="quantity" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Rate (NGN)
            <input type="number" min={0} step="any" className={`${smallInput} ${invalidClass(form, "rate")}`} {...form.register("rate")} {...fieldA11y(form, "rate")} />
            <FieldError form={form} name="rate" />
          </label>
        </div>
        <p className="text-xs text-slate-600">
          Amount: <span className="font-bold tabular-nums text-slate-900">{formatNaira(amount)}</span>{" "}
          <span className="text-slate-400">(quantity × rate, recomputed by the server)</span>
        </p>
        {line?.hasEvidence && (
          <p className="text-[11px] text-slate-500">This line has field evidence: its quantity cannot go below the work already done.</p>
        )}
        <div className="flex items-start justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton form={form} pending={save.isPending} pendingLabel="Saving…" className={primaryButton}>
            Save line
          </SubmitButton>
        </div>
      </form>
    </ModalShell>
  );
}
