import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Archive, Pencil, Plus, Star } from "lucide-react";
import {
  PROJECT_TYPE_CONFIG_GROUP_DEFS,
  PROJECT_TYPE_CONFIG_GROUP_IDS,
  ProjectTypeFunderDefaultEnum,
  projectTypeEditorSectionForPath,
  SaveProjectTypeRequestSchema,
  type ProjectTypeConfigGroupId,
  type ProjectTypeEditorSectionId,
  type ProjectTypeConfigInput,
  type ProjectTypeMonitoringConfigInput,
  type ProjectTypeDto,
  type ProjectTypeKpiTargets,
  type ProjectTypeFunderDefault,
  type SaveProjectTypeRequestInput,
} from "@insite/shared";
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from "../table";
import { CustomSelect } from "../common";
import { Tabs, tabId, tabPanelId } from "../common/Tabs";
import { useGuardedAction, useLeaveGuard } from "../../lib/navigationGuard";
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
import { MonitoringPlanEditor } from "./MonitoringPlanEditor";
import { DocumentRulesEditor, type DocumentRules } from "./DocumentRulesEditor";

const inputCls =
  "w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary";
const sectionCls = "rounded-2xl border border-slate-200 bg-white p-4 space-y-3";
const TAB_PREFIX = "project-type-rules";

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
  /** Redesign R1b: retention defaults for new projects of this type ("" = none). */
  retentionPct: string;
  retentionMonths: string;
  /** Phase 13: contract milestone templates and kick-off rules. */
  contract: ContractRules;
  /** Phase 15: Certificate of Completion and closure rules. */
  closure: ClosureRules;
  /** Phase 16: KPI targets and which KPIs are shown. */
  kpiTargets: ProjectTypeKpiTargets;
  /** Visit form templates (redesign R3) and supervision (Phase 14). */
  monitoring: MonitoringRules;
  /** Phase 13 (editable since Phase 16): required documents and default cases. */
  documents: DocumentRules;
  /** Redesign R4: the config key `monitoring` (visit plan, deadlines, escalation). */
  visitPlan: ProjectTypeMonitoringConfigInput;
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
  const { ownership, parties, contractMilestones, kickoff, closure, kpiTargets, supervision, visitForms, documentRequirements, defaultCases, monitoring, ...rest } = (c ?? {}) as ProjectTypeDto["config"];
  // Redesign R5f: the legacy Phase 14 key `inspections` is gone; a stored value is not sent back.
  delete (rest as Record<string, unknown>).inspections;
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
    visitPlan: monitoring ? { ...monitoring, visitPlan: (monitoring.visitPlan ?? []).map((r) => ({ ...r })) } : {},
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
    supervision: d.monitoring.supervision,
    // Redesign R3
    visitForms: d.monitoring.visitForms,
    documentRequirements: d.documents.documentRequirements,
    defaultCases: d.documents.defaultCases,
    // Redesign R4
    monitoring: d.visitPlan,
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

const SECTION_LABELS: Record<ProjectTypeEditorSectionId, string> = {
  general: "General",
  ...(Object.fromEntries(PROJECT_TYPE_CONFIG_GROUP_DEFS.map((g) => [g.id, g.label])) as Record<ProjectTypeConfigGroupId, string>),
};

interface EditorIssue {
  section: ProjectTypeEditorSectionId;
  message: string;
}

const NO_ISSUES: EditorIssue[] = [];

/** Plain-language checks on inputs the payload turns into numbers (the shared schema would say "NaN"). */
function draftIssues(d: Draft): EditorIssue[] {
  const out: EditorIssue[] = [];
  const pct = d.retentionPct.trim();
  if (pct !== "" && !(Number.isFinite(Number(pct)) && Number(pct) >= 0 && Number(pct) <= 20)) {
    out.push({ section: "completion", message: "Retention: enter a percentage from 0 to 20, or leave it empty." });
  }
  const months = d.retentionMonths.trim();
  if (months !== "" && !(Number.isInteger(Number(months)) && Number(months) >= 0 && Number(months) <= 60)) {
    out.push({ section: "completion", message: "Defects liability period: enter whole months from 0 to 60, or leave it empty." });
  }
  return out;
}

/** Validation issues of the draft: plain checks first, then the save payload against SaveProjectTypeRequestSchema. */
function issuesForDraft(d: Draft): EditorIssue[] {
  const local = draftIssues(d);
  const shared = issuesFor(payloadFrom(d), local.length > 0);
  return [...local, ...shared];
}

/** Validation issues of the save payload, each placed in the general block or a tab. */
function issuesFor(payload: SaveProjectTypeRequestInput, skipPayments = false): EditorIssue[] {
  const parsed = SaveProjectTypeRequestSchema.safeParse(payload);
  if (parsed.success) return [];
  const relevant = skipPayments ? parsed.error.issues.filter((i) => !(i.path[0] === "config" && i.path[1] === "payments")) : parsed.error.issues;
  return relevant.map((i) => {
    const section = projectTypeEditorSectionForPath(i.path);
    const [root, key, index, field] = i.path;
    if (root === "config" && key === "contractMilestones" && typeof index === "number") {
      return { section, message: `Milestone ${index + 1}${field ? ` (${String(field)})` : ""}: ${i.message}` };
    }
    if (root === "workflowTemplateId") return { section, message: "Choose a workflow template." };
    const where = (root === "config" ? i.path.slice(1) : i.path).map(String).join(".");
    return { section, message: where ? `${where}: ${i.message}` : i.message };
  });
}

function IssueList({ issues }: { issues: EditorIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 pl-6 text-xs text-rose-700 list-disc">
      {issues.map((e, i) => (
        <li key={`${i}-${e.message}`}>{e.message}</li>
      ))}
    </ul>
  );
}

/**
 * Redesign R6e (D-R6.24): the editor. General fields above five tabs (Kick-off & mobilisation,
 * Monitoring, Completion & closure, KPI targets, Advanced); every config key belongs to one tab
 * (`PROJECT_TYPE_CONFIG_GROUP_DEFS`). Validation errors are listed in their tab, with a count on
 * the tab. While there are unsaved changes, leaving the page (or the editor) asks first.
 */
function ProjectTypeEditor({
  initial,
  templateOptions,
  orgs,
  onClose,
}: {
  initial: Draft;
  templateOptions: Array<{ value: string; label: string; description?: string }>;
  orgs: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const term = useTerm();
  const save = useSaveProjectTypeMutation();
  const requestLeave = useGuardedAction();
  const [draft, setDraft] = useState<Draft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [tab, setTab] = useState<ProjectTypeConfigGroupId>("kickoff");

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const initialJson = useMemo(() => JSON.stringify(payloadFrom(initial)), [initial]);
  const dirty = JSON.stringify(payloadFrom(draft)) !== initialJson;
  // Validated as you edit; listed in their tabs once something changed (or a save was tried).
  const liveIssues = useMemo(() => issuesForDraft(draft), [draft]);
  const issues = dirty || attempted ? liveIssues : NO_ISSUES;
  const orgOptions = useMemo(() => orgs.map((o) => ({ value: o.id, label: o.name })), [orgs]);
  const allowedSet = new Set(draft.allowedOwnerIds ?? []);

  const countBySection = useMemo(() => {
    const m = new Map<ProjectTypeEditorSectionId, number>();
    for (const i of issues) m.set(i.section, (m.get(i.section) ?? 0) + 1);
    return m;
  }, [issues]);

  /** Validates and saves; resolves false when it could not (errors shown, first tab with errors opened). */
  const saveDraft = useCallback(async (): Promise<boolean> => {
    const payload = payloadFrom(draft);
    const found = issuesForDraft(draft);
    setAttempted(true);
    if (found.length > 0) {
      const firstTab = found.find((i) => i.section !== "general")?.section;
      if (firstTab && !found.some((i) => i.section === "general")) setTab(firstTab as ProjectTypeConfigGroupId);
      return false;
    }
    try {
      await save.mutateAsync({ projectTypeId: draft.id, payload });
      onClose();
      return true;
    } catch {
      return false; // Toast from the mutation hook.
    }
  }, [draft, save, onClose]);

  const guard = useMemo(
    () => (dirty ? { label: `${draft.name.trim() || "New project type"}`, save: saveDraft } : null),
    [dirty, draft.name, saveDraft]
  );
  useLeaveGuard(guard);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const close = () => requestLeave(onClose);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void saveDraft();
  };

  const tabs = PROJECT_TYPE_CONFIG_GROUP_DEFS.map((g) => {
    const n = countBySection.get(g.id) ?? 0;
    return {
      id: g.id,
      label: (
        <>
          {g.label}
          {n > 0 && (
            <span className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full bg-rose-100 px-1.5 text-[11px] font-bold text-rose-700">
              {n}
              <span className="sr-only"> {n === 1 ? "error" : "errors"}</span>
            </span>
          )}
        </>
      ),
    };
  });
  const inTab = (id: ProjectTypeEditorSectionId) => issues.filter((i) => i.section === id);
  const panel = (id: ProjectTypeConfigGroupId, children: React.ReactNode) => (
    <div
      key={id}
      role="tabpanel"
      id={tabPanelId(TAB_PREFIX, id)}
      aria-labelledby={tabId(TAB_PREFIX, id)}
      hidden={tab !== id}
      tabIndex={0}
      className="space-y-4 focus:outline-none"
    >
      <p className="text-xs text-slate-500">{PROJECT_TYPE_CONFIG_GROUP_DEFS.find((g) => g.id === id)?.description}</p>
      <IssueList issues={inTab(id)} />
      {children}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <button type="button" onClick={close} className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" /> All project types
      </button>

      <section className={sectionCls} aria-labelledby="pt-general">
        <div className="flex items-center justify-between gap-2">
          <h3 id="pt-general" className="text-sm font-bold text-slate-900">
            General
          </h3>
          {dirty && <span className="text-[11px] font-semibold text-amber-700">Unsaved changes</span>}
        </div>
        <IssueList issues={inTab("general")} />
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

      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Project type rules" idPrefix={TAB_PREFIX} />

      {panel(
        "kickoff",
        <>
          <ContractRulesEditor value={draft.contract} onChange={(contract) => set({ contract })} />
          <DocumentRulesEditor value={draft.documents} onChange={(documents) => set({ documents })} />
        </>
      )}

      {panel(
        "monitoring",
        <>
          <MonitoringPlanEditor value={draft.visitPlan} onChange={(visitPlan) => set({ visitPlan })} />
          <MonitoringRulesEditor value={draft.monitoring} onChange={(monitoring) => set({ monitoring })} />
        </>
      )}

      {panel(
        "completion",
        <>
          <ClosureRulesEditor value={draft.closure} onChange={(closure) => set({ closure })} />
          <section className={sectionCls}>
            <h3 className="text-sm font-bold text-slate-900">{term("retention")} defaults</h3>
            <p className="text-[11px] text-slate-500">
              Pre-fills the {term("retention", { lower: true })} settings of a new project of this type. Payments are made outside the platform and
              recorded on each project's Payments page; {term("retention", { lower: true })} is held from each recorded payment at this rate.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-700">{term("retention")} (%)</span>
                <input inputMode="decimal" className={inputCls} placeholder="None" value={draft.retentionPct} onChange={(e) => set({ retentionPct: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-700">Defects liability period (months)</span>
                <input inputMode="numeric" className={inputCls} placeholder="None" value={draft.retentionMonths} onChange={(e) => set({ retentionMonths: e.target.value })} />
              </label>
            </div>
          </section>
        </>
      )}

      {panel("kpis", <KpiTargetsEditor value={draft.kpiTargets} onChange={(kpiTargets) => set({ kpiTargets })} />)}

      {panel(
        "advanced",
        <>
          <section className={sectionCls}>
            <h3 className="text-sm font-bold text-slate-900">Workflow template</h3>
            <p className="text-xs text-slate-500">Process switches and approval chains come from this template when the type is applied to a draft.</p>
            <CustomSelect label="Template" value={draft.workflowTemplateId} onChange={(v) => set({ workflowTemplateId: v })} options={templateOptions} placeholder="Choose a template" />
          </section>

          <section className={sectionCls}>
            <h3 className="text-sm font-bold text-slate-900">Ownership</h3>
            <Toggle label="An owning organisation is required" checked={draft.ownerRequired} onChange={(v) => set({ ownerRequired: v })} />
            <div>
              <p className="text-xs font-medium text-slate-700 mb-1">Allowed owners</p>
              <Toggle label="Any organisation" checked={draft.allowedOwnerIds === null} onChange={(v) => set({ allowedOwnerIds: v ? null : [] })} />
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
            <CustomSelect
              label="Default owner"
              value={draft.defaultOwnerId}
              onChange={(v) => set({ defaultOwnerId: v })}
              options={[{ value: "", label: "No default" }, ...orgOptions.filter((o) => draft.allowedOwnerIds === null || allowedSet.has(o.value))]}
              searchable
            />
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
              <CustomSelect
                label={`When the ${term("funderParty", { lower: true })} is left empty`}
                value={draft.funderDefault}
                onChange={(v) => set({ funderDefault: v as ProjectTypeFunderDefault })}
                options={ProjectTypeFunderDefaultEnum.options.map((o) => ({
                  value: o,
                  label: o === "NONE" ? "Leave it empty" : o === "OWNER" ? "Use the owning organisation" : "Use a fixed organisation",
                }))}
              />
              {draft.funderDefault === "FIXED" && (
                <CustomSelect
                  label={`Default ${term("funderParty", { lower: true })}`}
                  value={draft.defaultFunderId}
                  onChange={(v) => set({ defaultFunderId: v })}
                  options={orgOptions}
                  searchable
                  placeholder="Choose"
                />
              )}
            </div>
          </section>
        </>
      )}

      {issues.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <p className="font-semibold">
            {issues.length} {issues.length === 1 ? "problem" : "problems"} to fix before saving:
          </p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {(["general", ...PROJECT_TYPE_CONFIG_GROUP_IDS] as ProjectTypeEditorSectionId[])
              .filter((id) => countBySection.has(id))
              .map((id) => (
                <li key={id}>
                  {id === "general" ? (
                    <span>
                      {SECTION_LABELS[id]} ({countBySection.get(id)})
                    </span>
                  ) : (
                    <button type="button" className="font-semibold underline hover:text-rose-900" onClick={() => setTab(id)}>
                      {SECTION_LABELS[id]} ({countBySection.get(id)})
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={close} className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700">
          Cancel
        </button>
        <span className="inline-flex flex-col items-end gap-1">
          <button
            type="submit"
            disabled={save.isPending || liveIssues.length > 0}
            aria-describedby={liveIssues.length > 0 ? "pt-save-hint" : undefined}
            className="rounded-xl bg-brand-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {save.isPending ? "Saving..." : draft.id ? "Save new version" : "Create project type"}
          </button>
          {liveIssues.length > 0 && (
            <span id="pt-save-hint" className="max-w-md text-right text-[11px] text-slate-500">
              Fix to save: {liveIssues[0].message}
              {liveIssues.length > 1 && ` (+${liveIssues.length - 1} more)`}
            </span>
          )}
        </span>
      </div>
    </form>
  );
}

/**
 * Phase 11: delivery models. A type references a workflow template and holds ownership, party,
 * contract, monitoring, closure and KPI rules. Saving writes a new version; projects keep the
 * version they were created with.
 */
export function ProjectTypesTab() {
  const { data: types = [], isLoading } = useProjectTypesQuery(true);
  const { data: templates = [] } = useWorkflowTemplatesQuery();
  const { data: orgs = [] } = useOrganizationsQuery({});
  const archive = useArchiveProjectTypeMutation();
  const { ask: confirm, dialog } = useConfirmDialog();
  const [draft, setDraft] = useState<Draft | null>(null);
  const closeEditor = useCallback(() => setDraft(null), []);

  const templateOptions = useMemo(
    () => templates.map((t) => ({ value: t.id, label: t.name, description: t.description ?? undefined })),
    [templates]
  );

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
          <TableActionButton onClick={() => setDraft(draftFrom(t))} icon={<Pencil className="w-3.5 h-3.5" />}>
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
    return <ProjectTypeEditor key={draft.id ?? "new"} initial={draft} templateOptions={templateOptions} orgs={orgs} onClose={closeEditor} />;
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
            onClick={() => setDraft(draftFrom(null))}
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
