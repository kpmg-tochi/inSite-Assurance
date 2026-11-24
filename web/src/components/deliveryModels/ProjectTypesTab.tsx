import React, { useMemo, useState } from "react";
import { ArrowLeft, Archive, Pencil, Plus, Star } from "lucide-react";
import {
  ProjectTypeFunderDefaultEnum,
  SaveProjectTypeRequestSchema,
  type ProjectTypeConfigInput,
  type ProjectTypeDto,
  type ProjectTypeKpiTargets,
  type ProjectTypeFunderDefault,
  type SaveProjectTypeRequestInput,
} from "@insite/shared";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { CustomSelect } from "../common";
import { useProjectTypesQuery } from "../../queries/deliveryModels/useDeliveryModelQueries";
import { useWorkflowTemplatesQuery } from "../../queries/process/useProcessQueries";
import { useOrganizationsQuery } from "../../queries/organizations/useOrganizationQueries";
import { useArchiveProjectTypeMutation, useSaveProjectTypeMutation } from "../../mutations/deliveryModels/useDeliveryModelMutations";
import { useConfirmDialog } from "../process/ConfirmDialog";
import { useTerm } from "../../lib/auth-context";
import { ContractRulesEditor, type ContractRules } from "./ContractRulesEditor";
import { ClosureRulesEditor, type ClosureRules } from "./ClosureRulesEditor";
import { compactKpiTargets, KpiTargetsEditor } from "./KpiTargetsEditor";
import { MonitoringRulesEditor, type MonitoringRules } from "./MonitoringRulesEditor";
import { DocumentRulesEditor, type DocumentRules } from "./DocumentRulesEditor";
import { CadenceFields } from "./CadenceFields";

type ReportingDefaults = NonNullable<ProjectTypeConfigInput["reportingDefaults"]>;

const inputCls =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";

interface Draft {
  id: string | null;
  code: string;
  name: string;
  description: string;
  colour: string;
  workflowTemplateId: string;
  isDefault: boolean;
  isActive: boolean;
  ownerRequired: boolean;
  allowedOwnerIds: string[] | null;
  defaultOwnerId: string;
  monitorRequired: boolean;
  funderRequired: boolean;
  beneficiaryRequired: boolean;
  regionRequired: boolean;
  funderDefault: ProjectTypeFunderDefault;
  defaultFunderId: string;
  reportingOn: boolean;
  /** Every field of the Reporting step (since Phase 16, not only cadence and hours). */
  reporting: ReportingDefaults;
  /** Redesign R1b: retention defaults for new projects of this type ("" = none). */
  retentionPct: string;
  retentionMonths: string;
  /** Phase 13: contract milestone templates and kick-off rules. */
  contract: ContractRules;
  /** Phase 15: Certificate of Completion and closure rules. */
  closure: ClosureRules;
  /** Phase 16: KPI targets and which KPIs are shown. */
  kpiTargets: ProjectTypeKpiTargets;
  /** Phase 14 (editable since Phase 16): streams, inspection templates, supervision. */
  monitoring: MonitoringRules;
  /** Phase 13 (editable since Phase 16): required documents and default cases. */
  documents: DocumentRules;
  /** Keys added by later phases, kept untouched on save. */
  rest: Record<string, unknown>;
}

/** The R1b payment (retention) defaults as stored on the type (read leniently). */
function paymentsFrom(config: unknown) {
  const c = (config ?? {}) as {
    payments?: { retentionPercentage?: number | null; retentionDurationMonths?: number | null };
  };
  return {
    retentionPct: c.payments?.retentionPercentage != null ? String(c.payments.retentionPercentage) : "",
    retentionMonths: c.payments?.retentionDurationMonths != null ? String(c.payments.retentionDurationMonths) : "",
  };
}

function draftFrom(t: ProjectTypeDto | null): Draft {
  const c = t?.config;
  const { ownership, parties, reportingDefaults, contractMilestones, kickoff, closure, kpiTargets, reportingStreams, inspections, supervision, visitForms, documentRequirements, defaultCases, ...rest } = (c ?? {}) as ProjectTypeDto["config"];
  return {
    id: t?.id ?? null,
    code: t?.code ?? "",
    name: t?.name ?? "",
    description: t?.description ?? "",
    colour: t?.colour ?? "#6546FC",
    workflowTemplateId: t?.workflowTemplateId ?? "",
    isDefault: t?.isDefault ?? false,
    isActive: t?.isActive ?? true,
    ownerRequired: ownership?.owningOrganizationRequired ?? false,
    allowedOwnerIds: ownership?.allowedOwningOrganizationIds ?? null,
    defaultOwnerId: ownership?.defaultOwningOrganizationId ?? "",
    monitorRequired: parties?.monitorRequired ?? true,
    funderRequired: parties?.funderRequired ?? true,
    beneficiaryRequired: parties?.beneficiaryRequired ?? false,
    regionRequired: parties?.regionRequired ?? false,
    funderDefault: parties?.funderDefault ?? "NONE",
    defaultFunderId: parties?.defaultFunderOrganizationId ?? "",
    reportingOn: Boolean(reportingDefaults),
    reporting: reportingDefaults ? { ...reportingDefaults } : { reportingCadence: "WEEKLY", workdayStartTime: "08:00", workdayEndTime: "17:00" },
    ...paymentsFrom(c),
    contract: {
      milestones: (contractMilestones ?? []).map((m) => ({ ...m })),
      kickoff: {
        requiredStakeholderGroups: [...(kickoff?.requiredStakeholderGroups ?? [])],
        noticeLeadDays: kickoff?.noticeLeadDays ?? 7,
      },
    },
    closure: closure ? { ...closure } : {},
    kpiTargets: { ...(kpiTargets ?? {}) },
    monitoring: {
      reportingStreams: (reportingStreams ?? []).map((st) => ({ ...st, roleCodes: [...st.roleCodes] })),
      inspections: { templateCodeByVisitType: { ...(inspections?.templateCodeByVisitType ?? {}) } },
      supervision: { ...(supervision ?? {}), supervisorRoleCodes: [...(supervision?.supervisorRoleCodes ?? [])] },
      visitForms: { templateCodeByVisitKind: { ...(visitForms?.templateCodeByVisitKind ?? {}) } },
    },
    documents: {
      documentRequirements: {
        beforeActivation: [...(documentRequirements?.beforeActivation ?? [])],
        beforeMobilisation: [...(documentRequirements?.beforeMobilisation ?? [])],
      },
      defaultCases: { ...(defaultCases ?? {}) },
    },
    rest: rest as Record<string, unknown>,
  };
}

function payloadFrom(d: Draft): SaveProjectTypeRequestInput {
  const config: ProjectTypeConfigInput = {
    ...d.rest,
    ownership: {
      owningOrganizationRequired: d.ownerRequired,
      allowedOwningOrganizationIds: d.allowedOwnerIds && d.allowedOwnerIds.length ? d.allowedOwnerIds : null,
      defaultOwningOrganizationId: d.defaultOwnerId || null,
    },
    parties: {
      monitorRequired: d.monitorRequired,
      funderRequired: d.funderRequired,
      beneficiaryRequired: d.beneficiaryRequired,
      regionRequired: d.regionRequired,
      funderDefault: d.funderDefault,
      defaultFunderOrganizationId: d.funderDefault === "FIXED" ? d.defaultFunderId || null : null,
    },
    reportingDefaults: d.reportingOn
      ? d.reporting
      : null,
    payments: {
      retentionPercentage: d.retentionPct.trim() === "" ? null : Number(d.retentionPct),
      retentionDurationMonths: d.retentionMonths.trim() === "" ? null : Math.round(Number(d.retentionMonths)),
    },
    // Phase 13
    contractMilestones: d.contract.milestones.map((m) => ({
      ...m,
      label: m.label.trim(),
      anchorMilestoneKey: m.anchor === "MILESTONE" ? m.anchorMilestoneKey ?? null : null,
    })),
    kickoff: d.contract.kickoff,
    // Phase 15
    closure: {
      ...d.closure,
      cocSignatories: d.closure.cocSignatories?.map((s) => ({ ...s, label: s.label.trim() })),
      beforeClose: d.closure.beforeClose?.map((i) => ({ ...i, label: i.label.trim() })),
      beforeArchive: d.closure.beforeArchive?.map((i) => ({ ...i, label: i.label.trim() })),
    },
    // Phase 16
    kpiTargets: compactKpiTargets(d.kpiTargets),
    // Phases 13 and 14 (editors since Phase 16)
    reportingStreams: d.monitoring.reportingStreams.map((st) => ({ ...st, label: st.label.trim() })),
    inspections: d.monitoring.inspections,
    supervision: d.monitoring.supervision,
    // Redesign R3
    visitForms: d.monitoring.visitForms,
    documentRequirements: d.documents.documentRequirements,
    defaultCases: d.documents.defaultCases,
  };
  return {
    code: d.code,
    name: d.name,
    description: d.description || null,
    colour: d.colour || null,
    workflowTemplateId: d.workflowTemplateId,
    isDefault: d.isDefault,
    isActive: d.isActive,
    config,
  };
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-xs text-slate-700">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Phase 11: delivery models. A type references a workflow template and holds ownership, party and
 * reporting defaults. Saving writes a new version; projects keep the version they were created with.
 * Later phases add sections to this editor.
 */
export function ProjectTypesTab() {
  const term = useTerm();
  const { data: types = [], isLoading } = useProjectTypesQuery(true);
  const { data: templates = [] } = useWorkflowTemplatesQuery();
  const { data: orgs = [] } = useOrganizationsQuery({});
  const save = useSaveProjectTypeMutation();
  const archive = useArchiveProjectTypeMutation();
  const { ask: confirm, dialog } = useConfirmDialog();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const orgOptions = useMemo(() => orgs.map((o) => ({ value: o.id, label: o.name })), [orgs]);
  const templateOptions = templates.map((t) => ({ value: t.id, label: t.name, description: t.description ?? undefined }));

  const columns: TableColumnDef<ProjectTypeDto>[] = [
    {
      id: "name",
      header: "Project type",
      cell: (t) => (
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: t.colour ?? "#94a3b8" }} />
          <span className="font-semibold text-slate-900">{t.name}</span>
          <span className="text-[11px] text-slate-500">{t.code}</span>
          {t.isDefault && <Star className="w-3.5 h-3.5 text-amber-500" aria-label="Default" />}
        </div>
      ),
    },
    { id: "template", header: "Workflow template", cell: (t) => <span className="text-xs">{t.workflowTemplateName ?? "—"}</span> },
    { id: "version", header: "Version", cell: (t) => <span className="text-xs">v{t.version}</span> },
    { id: "projects", header: "Projects", cell: (t) => <span className="text-xs">{t.projectCount}</span> },
    {
      id: "status",
      header: "Status",
      cell: (t) => <TableBadge variant={t.isActive ? "success" : "neutral"}>{t.isActive ? "Active" : "Archived"}</TableBadge>,
    },
    {
      id: "actions",
      header: "",
      cell: (t) => (
        <div className="flex justify-end gap-1">
          <TableActionButton onClick={() => { setErrors([]); setDraft(draftFrom(t)); }} icon={<Pencil className="w-3.5 h-3.5" />}>
            Edit
          </TableActionButton>
          {t.isActive && (
            <TableActionButton
              onClick={async () => {
                const ok = await confirm({
                  title: `Archive ${t.name}?`,
                  message: "New projects can no longer choose it. Projects that have it keep their rules.",
                  confirmLabel: "Archive",
                });
                if (ok) archive.mutate(t.id);
              }}
              icon={<Archive className="w-3.5 h-3.5" />}
            >
              Archive
            </TableActionButton>
          )}
        </div>
      ),
    },
  ];

  if (draft) {
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
    const setReporting = (patch: Partial<ReportingDefaults>) => set({ reporting: { ...draft.reporting, ...patch } });
    const submit = (e: React.FormEvent) => {
      e.preventDefault();
      const payload = payloadFrom(draft);
      const parsed = SaveProjectTypeRequestSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(
          parsed.error.issues.map((i) => {
            const [, key, index, field] = i.path;
            if (key === "contractMilestones" && typeof index === "number") {
              return `Milestone ${index + 1}${field ? ` (${String(field)})` : ""}: ${i.message}`;
            }
            return `${i.path.join(".") || "type"}: ${i.message}`;
          })
        );
        return;
      }
      setErrors([]);
      save.mutate({ projectTypeId: draft.id, payload }, { onSuccess: () => setDraft(null) });
    };
    const allowedSet = new Set(draft.allowedOwnerIds ?? []);
    return (
      <form onSubmit={submit} className="space-y-4">
        {dialog}
        <button type="button" onClick={() => setDraft(null)} className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" /> All project types
        </button>

        <section className={sectionCls}>
          <h3 className="text-sm font-bold text-slate-900">General</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-medium text-slate-700">
              Name
              <input required className={inputCls} value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Code
              <input required className={inputCls} value={draft.code} maxLength={32} placeholder="e.g. CENTRAL" onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Colour
              <input type="color" className="mt-0.5 h-9 w-full rounded-xl border border-slate-300" value={draft.colour} onChange={(e) => set({ colour: e.target.value })} />
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-700">
            Description
            <textarea rows={2} className={inputCls} value={draft.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-6">
            <Toggle label="Default for new projects" checked={draft.isDefault} onChange={(v) => set({ isDefault: v })} />
            <Toggle label="Active" checked={draft.isActive} onChange={(v) => set({ isActive: v })} hint="Archived types cannot be chosen for new projects." />
          </div>
        </section>

        <section className={sectionCls}>
          <h3 className="text-sm font-bold text-slate-900">Workflow template</h3>
          <p className="text-xs text-slate-500">Process switches and approval chains come from this template when the type is applied to a draft.</p>
          <CustomSelect value={draft.workflowTemplateId} onChange={(v) => set({ workflowTemplateId: v })} options={templateOptions} placeholder="Choose a template" />
        </section>

        <section className={sectionCls}>
          <h3 className="text-sm font-bold text-slate-900">Ownership</h3>
          <Toggle label="An owning organisation is required" checked={draft.ownerRequired} onChange={(v) => set({ ownerRequired: v })} />
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Allowed owners</p>
            <Toggle
              label="Any organisation"
              checked={draft.allowedOwnerIds === null}
              onChange={(v) => set({ allowedOwnerIds: v ? null : [] })}
            />
            {draft.allowedOwnerIds !== null && (
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {orgs.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={allowedSet.has(o.id)}
                      onChange={(e) =>
                        set({
                          allowedOwnerIds: e.target.checked
                            ? [...(draft.allowedOwnerIds ?? []), o.id]
                            : (draft.allowedOwnerIds ?? []).filter((id) => id !== o.id),
                        })
                      }
                    />
                    {o.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Default owner</p>
            <CustomSelect
              value={draft.defaultOwnerId}
              onChange={(v) => set({ defaultOwnerId: v })}
              options={[{ value: "", label: "No default" }, ...orgOptions.filter((o) => draft.allowedOwnerIds === null || allowedSet.has(o.value))]}
              searchable
            />
          </div>
        </section>

        <section className={sectionCls}>
          <h3 className="text-sm font-bold text-slate-900">Parties</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Toggle label={`${term("monitorParty")} required`} checked={draft.monitorRequired} onChange={(v) => set({ monitorRequired: v })} />
            <Toggle label={`${term("funderParty")} required`} checked={draft.funderRequired} onChange={(v) => set({ funderRequired: v })} />
            <Toggle label={`At least one ${term("beneficiary", { lower: true })} required`} checked={draft.beneficiaryRequired} onChange={(v) => set({ beneficiaryRequired: v })} />
            <Toggle label="Region required" checked={draft.regionRequired} onChange={(v) => set({ regionRequired: v })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-slate-700 mb-1">When the {term("funderParty", { lower: true })} is left empty</p>
              <CustomSelect
                value={draft.funderDefault}
                onChange={(v) => set({ funderDefault: v as ProjectTypeFunderDefault })}
                options={ProjectTypeFunderDefaultEnum.options.map((o) => ({
                  value: o,
                  label: o === "NONE" ? "Leave it empty" : o === "OWNER" ? "Use the owning organisation" : "Use a fixed organisation",
                }))}
              />
            </div>
            {draft.funderDefault === "FIXED" && (
              <div>
                <p className="text-xs font-medium text-slate-700 mb-1">Default {term("funderParty", { lower: true })}</p>
                <CustomSelect value={draft.defaultFunderId} onChange={(v) => set({ defaultFunderId: v })} options={orgOptions} searchable placeholder="Choose" />
              </div>
            )}
          </div>
        </section>

        <section className={sectionCls}>
          <h3 className="text-sm font-bold text-slate-900">{term("retention")} defaults</h3>
          <p className="text-[11px] text-slate-500">
            Pre-fills the {term("retention", { lower: true })} step of a new project of this type. Payments are made outside the platform and
            recorded on each project's Payments page; {term("retention", { lower: true })} is held from each recorded payment at this rate.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">{term("retention")} (%)</span>
              <input
                inputMode="decimal"
                className={inputCls}
                placeholder="None"
                value={draft.retentionPct}
                onChange={(e) => set({ retentionPct: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Defects liability period (months)</span>
              <input
                inputMode="numeric"
                className={inputCls}
                placeholder="None"
                value={draft.retentionMonths}
                onChange={(e) => set({ retentionMonths: e.target.value })}
              />
            </label>
          </div>
        </section>

        <ContractRulesEditor value={draft.contract} onChange={(contract) => set({ contract })} />

        <DocumentRulesEditor value={draft.documents} onChange={(documents) => set({ documents })} />

        <MonitoringRulesEditor value={draft.monitoring} onChange={(monitoring) => set({ monitoring })} />

        <ClosureRulesEditor value={draft.closure} onChange={(closure) => set({ closure })} />

        <KpiTargetsEditor value={draft.kpiTargets} onChange={(kpiTargets) => set({ kpiTargets })} />

        <section className={sectionCls}>
          <h3 className="text-sm font-bold text-slate-900">Reporting defaults</h3>
          <Toggle label="Pre-fill the Reporting step of new projects" checked={draft.reportingOn} onChange={(v) => set({ reportingOn: v })} />
          {draft.reportingOn && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="text-xs font-medium text-slate-700">
                  Work starts
                  <input type="time" className={inputCls} value={draft.reporting.workdayStartTime} onChange={(e) => setReporting({ workdayStartTime: e.target.value })} />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Work ends
                  <input type="time" className={inputCls} value={draft.reporting.workdayEndTime} onChange={(e) => setReporting({ workdayEndTime: e.target.value })} />
                </label>
                {(draft.reporting.reportingCadence === "BI_WEEKLY" || draft.reporting.reportingCadence === "CUSTOM_INTERVAL") && (
                  <label className="text-xs font-medium text-slate-700">
                    First period starts on (blank: the project start)
                    <input type="date" className={inputCls} value={draft.reporting.cadenceAnchorDate ?? ""} onChange={(e) => setReporting({ cadenceAnchorDate: e.target.value || null })} />
                  </label>
                )}
              </div>
              <CadenceFields
                value={{ ...draft.reporting, quarterMonth: draft.reporting.cadenceQuarterAnchorMonth ?? null }}
                onChange={({ quarterMonth, ...patch }) => setReporting({ ...patch, ...(quarterMonth != null ? { cadenceQuarterAnchorMonth: quarterMonth } : {}) })}
              />
            </div>
          )}
        </section>

        {errors.length > 0 && (
          <ul className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 list-disc pl-6">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setDraft(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={save.isPending} className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {save.isPending ? "Saving..." : draft.id ? "Save new version" : "Create project type"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      {dialog}
      <StandardTable<ProjectTypeDto>
        title="Project types"
        subtitle="Delivery models. A new project picks its type first; the type sets its process, owner and party rules. Editing a type changes new projects only."
        headerActions={
          <button
            type="button"
            onClick={() => { setErrors([]); setDraft(draftFrom(null)); }}
            className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand-navy hover:bg-slate-100"
          >
            <Plus className="w-3.5 h-3.5" /> New project type
          </button>
        }
        columns={columns}
        data={types}
        keyExtractor={(t) => t.id}
        loading={isLoading}
        emptyState={{ title: "No project types", description: "Projects use the default workflow template until you add one." }}
      />
    </>
  );
}
