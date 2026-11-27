import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Controller, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { AlertTriangle, CalendarRange, Plus, Trash2 } from "lucide-react";
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
  type ProjectSiteDto,
  type ProjectSetupDto,
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
import { TabPanel, Tabs, useUrlTab, type TabItem } from "../common/Tabs";
import { ModalShell } from "../common/ModalShell";
import { useConfirmDialog } from "../process/ConfirmDialog";
import { primaryButton, secondaryButton, smallInput } from "../contracts/contractUi";
import Loader from "../Loader";
import { SprintVerifyDialog } from "./SprintVerifyDialog";
import { ScopeSummary } from "./ScopeSummary";
import { LinesTable, ScopeUnitsTable } from "./ScopeUnitsTable";
import { useAuth } from "../../lib/auth-context";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectSitesQuery, projectSitesKey } from "../../queries/sites";
import { projectSetupKey } from "../../queries/projects/useProjectSetupQueries";

/**
 * Redesign R2b: scope and sprints of one project (spec section 5). Used by the setup step
 * (/setup/scope), live settings (/settings/scope) and the project page (/scope).
 * Design refinement (2026-11-26): a summary head (BoQ total, % complete, work phases at a glance,
 * the needs assessment and work phase tools), then two tabs: "Units & BoQ" (one table of facility
 * units, each opening onto its BoQ lines) and "Work phases". The project page keeps the tab in
 * `?tab=` (`urlTabs`); the setup wizard keeps it in local state so the wizard owns its URL.
 * Amounts are computed by the server.
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

type ScopeTab = "units" | "phases" | "facilities";
const SCOPE_TAB_IDS: readonly ScopeTab[] = ["units", "phases"];
const SCOPE_TAB_IDS_WITH_FACILITIES: readonly ScopeTab[] = ["units", "phases", "facilities"];

export interface ScopeAndSprintsPanelProps {
  projectId: string;
  readOnly: boolean;
  /** Keep the open tab in `?tab=` (the project page). The setup wizard leaves it off. */
  urlTabs?: boolean;
  /**
   * Needs pipeline wave 4 (C5): a third tab, "Facilities" (the needs assessment's facilities
   * breakdown beside each unit's progress), given by the project page when the project has one.
   */
  facilitiesTab?: { count?: number | null; render: (scope: ProjectScopeDto) => ReactNode } | null;
}

export function ScopeAndSprintsPanel({ projectId, readOnly, urlTabs = false, facilitiesTab = null }: ScopeAndSprintsPanelProps) {
  const q = useProjectScopeQuery(projectId);
  const { hasPermission } = useAuth();
  const [verifying, setVerifying] = useState<string | null>(null);
  const facilitiesQ = useFacilitiesQuery(false, !readOnly);
  // Client demo updates C2 (wave 2): a multi-site project's units name their site.
  // On a draft the setup DTO (already loaded by the setup pages) carries the same list.
  const queryClient = useQueryClient();
  const sitesQ = useProjectSitesQuery(projectId);
  const sites = sitesQ.data?.sites ?? queryClient.getQueryData<ProjectSetupDto>(projectSetupKey(projectId))?.sites?.sites ?? [];
  const deleteUnit = useDeleteFacilityUnitMutation(projectId);
  const deleteLine = useDeleteScopeLineMutation(projectId);
  const { ask, dialog } = useConfirmDialog();
  const [sprintsOpen, setSprintsOpen] = useState(false);
  const [unitEditor, setUnitEditor] = useState<{ unit: FacilityUnitDto | null } | null>(null);
  const [lineEditor, setLineEditor] = useState<{ line: ScopeLineDto | null; unitId: string | null } | null>(null);
  const [urlTab, setUrlTab] = useUrlTab(facilitiesTab ? SCOPE_TAB_IDS_WITH_FACILITIES : SCOPE_TAB_IDS);
  const [localTab, setLocalTab] = useState<ScopeTab | null>(null);

  const scope = q.data;

  if (q.isLoading) return <Loader />;
  if (!scope) return <p className="text-sm text-rose-600">Could not load the BoQ and work phases.</p>;

  const live = scope.projectStatus !== "DRAFT";
  const unassigned = scope.lines.filter((l) => !l.facilityUnitId);
  // Setup: open on Work phases until there are some (units start and end in them).
  const tab: ScopeTab = urlTabs ? (urlTab ?? "units") : (localTab ?? (scope.sprints.length === 0 && !readOnly ? "phases" : "units"));
  const setTab = (t: ScopeTab) => (urlTabs ? setUrlTab(t) : setLocalTab(t));
  const tabs: readonly TabItem<ScopeTab>[] = [
    { id: "units", label: "Units & BoQ", count: scope.totals.unitCount },
    { id: "phases", label: "Work phases", count: scope.totals.sprintCount },
    ...(facilitiesTab ? [{ id: "facilities" as const, label: "Facilities", count: facilitiesTab.count ?? null }] : []),
  ];

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

  const canVerify = live && hasPermission("sprints:verify");
  const sprintColumns: TableColumnDef<ProjectSprintDto>[] = [
    { id: "n", header: "No.", width: "w-14", cell: (s) => <span className="text-xs font-bold tabular-nums">{s.number}</span> },
    { id: "name", header: "Work phase", cell: (s) => <span className="text-xs font-semibold text-slate-900">{s.name}</span> },
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
      width: "w-36",
      cell: (s) => (
        <div className="flex flex-col items-start gap-0.5">
          {s.status === "VERIFIED" && s.verificationOutcome ? (
            <TableBadge variant={OUTCOME_VARIANT[s.verificationOutcome]}>{SPRINT_VERIFICATION_OUTCOME_LABELS[s.verificationOutcome]}</TableBadge>
          ) : (
            <TableBadge variant={SPRINT_STATUS[s.status].variant}>{SPRINT_STATUS[s.status].label}</TableBadge>
          )}
          {live && (s.status === "ENDED" || s.status === "LATE") && !s.verificationOutcome && (
            <span className={`text-[11px] whitespace-nowrap ${s.status === "LATE" ? "font-semibold text-rose-700" : "text-slate-600"}`}>
              Verify by {formatDateShort(s.verificationDueDate)}
            </span>
          )}
        </div>
      ),
    },
    { id: "units", header: "Units", width: "w-16", align: "center", cell: (s) => <span className="text-xs tabular-nums">{s.unitCount}</span> },
    {
      id: "deliverables",
      header: "Deliverables",
      cell: (s) => <span className="text-[11px] text-slate-600 line-clamp-2">{s.deliverables || "–"}</span>,
    },
    // Redesign R4e: verification on live projects (D-R4.31). Due phases get a button, the rest a link.
    ...(canVerify
      ? [
          {
            id: "verify",
            header: <span className="sr-only">Verification</span>,
            width: "w-24",
            align: "right",
            cell: (s: ProjectSprintDto) => {
              if (s.status === "UPCOMING") return null;
              const label = `${s.verificationOutcome ? "Re-verify" : "Verify"} work phase ${s.number}: ${s.name}`;
              const due = !s.verificationOutcome && (s.status === "ENDED" || s.status === "LATE");
              return due ? (
                <TableActionButton onClick={() => setVerifying(s.id)} title={label} className="whitespace-nowrap">
                  <span aria-hidden="true">Verify</span>
                  <span className="sr-only">{label}</span>
                </TableActionButton>
              ) : (
                <button
                  type="button"
                  aria-label={label}
                  className="rounded text-xs font-semibold text-brand-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                  onClick={() => setVerifying(s.id)}
                >
                  {s.verificationOutcome ? "Re-verify" : "Verify"}
                </button>
              );
            },
          } as TableColumnDef<ProjectSprintDto>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {dialog}
      {verifying && <SprintVerifyDialog projectId={projectId} sprintId={verifying} onClose={() => setVerifying(null)} />}

      <ScopeSummary
        projectId={projectId}
        scope={scope}
        live={live}
        readOnly={readOnly}
        onEditSprints={() => setSprintsOpen(true)}
        onShowSprints={() => setTab("phases")}
      />

      {scope.budgetWarning && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{scope.budgetWarning}</span>
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} label="BoQ and work phases" idPrefix="scope" />
      <TabPanel idPrefix="scope" id={tab}>
        {tab === "units" ? (
          <div className="space-y-4">
            <ScopeUnitsTable
              scope={scope}
              sites={sites}
              live={live}
              readOnly={readOnly}
              removePending={deleteUnit.isPending}
              onAddUnit={() => setUnitEditor({ unit: null })}
              onEditUnit={(u) => setUnitEditor({ unit: u })}
              onRemoveUnit={removeUnit}
              onAddLine={(u) => setLineEditor({ line: null, unitId: u.id })}
              onEditLine={(l) => setLineEditor({ line: l, unitId: l.facilityUnitId })}
              onRemoveLine={removeLine}
              onEditSprints={() => setSprintsOpen(true)}
            />
            {unassigned.length > 0 && (
              <section className="rounded-2xl border border-amber-200 bg-white">
                <header className="border-b border-amber-100 px-4 py-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                    <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" /> Lines without a facility unit
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    {live
                      ? "Lines from before facility units existed. Edit a line to give it a unit."
                      : "Every line needs a facility unit before the project can be activated."}
                  </p>
                </header>
                <LinesTable
                  lines={unassigned}
                  readOnly={readOnly || scope.units.length === 0}
                  showProgress={live}
                  onEdit={(l) => setLineEditor({ line: l, unitId: null })}
                  onRemove={removeLine}
                />
              </section>
            )}
          </div>
        ) : tab === "facilities" && facilitiesTab ? (
          facilitiesTab.render(scope)
        ) : (
          <StandardTable<ProjectSprintDto>
            title="Work phases"
            subtitle="Named periods with deliverables. They may differ in length and leave gaps, but may not overlap. Numbers follow the dates."
            columns={sprintColumns}
            data={scope.sprints}
            keyExtractor={(s) => s.id}
            minWidth="min-w-[720px]"
            pageSize={false}
            emptyState={{
              title: "No work phases yet",
              description: "Add the work phases before you plan the facility units.",
              action: !readOnly ? (
                <button type="button" className={secondaryButton} onClick={() => setSprintsOpen(true)}>
                  <CalendarRange className="w-3.5 h-3.5" aria-hidden="true" /> Add work phases
                </button>
              ) : undefined,
            }}
          />
        )}
      </TabPanel>

      {sprintsOpen && <SprintsEditor projectId={projectId} scope={scope} onClose={() => setSprintsOpen(false)} />}
      {unitEditor && (
        <UnitEditor
          projectId={projectId}
          scope={scope}
          facilities={facilitiesQ.data ?? []}
          sites={sites}
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
    rows.append({ name: `Work phase ${values.length + 1}`, startDate: start, endDate: addDays(start, 27), deliverables: "", locked: false });
  };
  const submit = form.handleSubmit((body) => save.mutate(body, { onSuccess: onClose }));
  return (
    <ModalShell
      title="Edit work phases"
      subtitle={live ? "Moving a work phase moves the planned dates of its units' lines. The change is audited." : "Work phases are numbered by their dates when saved."}
      onClose={onClose}
      maxWidth="max-w-4xl"
    >
      <form onSubmit={submit} noValidate className="p-5 space-y-3">
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {rows.fields.length === 0 && <p className="text-xs text-slate-500">No work phases. Add the first one.</p>}
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
                    title={locked ? "A facility unit starts or ends in this work phase" : "Remove work phase"}
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
          <Plus className="w-3.5 h-3.5 inline -mt-0.5" /> Add work phase
        </button>
        {!live && scope.sprints.some((s) => s.referencedByUnits) && (
          <p className="text-[11px] text-slate-500">Removing a work phase clears it from the units that start or end in it.</p>
        )}
        <div className="flex items-start justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton form={form} pending={save.isPending} pendingLabel="Saving…" hint="Fix the work phases marked in red." className={primaryButton}>
            Save work phases
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
  sites,
  unit,
  onClose,
}: {
  projectId: string;
  scope: ProjectScopeDto;
  facilities: FacilityDto[];
  /** The project's sites; empty on a single-site project (no site picker). */
  sites: ProjectSiteDto[];
  unit: FacilityUnitDto | null;
  onClose: () => void;
}) {
  const save = useSaveFacilityUnitMutation(projectId);
  const queryClient = useQueryClient();
  const hasSites = sites.length > 0;

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
      siteId: z.string(),
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
      if (s && en && s.number > en.number) ctx.addIssue({ code: "custom", path: ["endSprintId"], message: "The end work phase cannot be before the start work phase" });
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
        ...(hasSites ? { siteId: v.siteId || null } : {}),
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
      siteId: unit?.siteId ?? (sites.length === 1 ? sites[0].id : ""),
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

  const submit = form.handleSubmit((body) =>
    save.mutate(unit ? { id: unit.id, update: body } : { create: body }, {
      onSuccess: () => {
        if (hasSites) void queryClient.invalidateQueries({ queryKey: projectSitesKey(projectId) });
        onClose();
      },
    })
  );
  const siteOptions = [
    { value: "", label: "Not set" },
    ...sites.map((s) => ({ value: s.id, label: `Site ${s.siteNumber} · ${s.schoolName}`, description: s.lgaName ?? undefined })),
  ];

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
        {hasSites && (
          <Controller
            control={form.control}
            name="siteId"
            render={({ field }) => (
              <CustomSelect
                label="Site"
                hint="The school this facility unit is at. Its progress counts towards that site."
                value={field.value}
                onChange={field.onChange}
                options={siteOptions}
                searchable={sites.length > 8}
                size="sm"
              />
            )}
          />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Controller
            control={form.control}
            name="startSprintId"
            render={({ field }) => <CustomSelect label="Start work phase" value={field.value} onChange={field.onChange} options={sprintOptions} size="sm" />}
          />
          <Controller
            control={form.control}
            name="endSprintId"
            render={({ field }) => (
              <CustomSelect
                label="End work phase"
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
