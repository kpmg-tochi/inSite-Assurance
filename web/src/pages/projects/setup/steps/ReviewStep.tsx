import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Circle, Pencil } from "lucide-react";
import {
  DOCUMENT_MODE_META,
  ISO_WEEKDAY_SHORT,
  PROJECT_SETUP_STEPS,
  formatMoney,
  geofenceModeLabel,
  type ActivationIssue,
  type ProjectSetupDto,
} from "@insite/shared";
import { useAuth, useTerm } from "../../../../lib/auth-context";
import { useGuardedNavigate } from "../../../../lib/navigationGuard";
import { useActivateProjectMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { sectionHref, StepSection } from "../setupContext";
import type { WizardStepProps } from "./SectionsStep";

type Term = ReturnType<typeof useTerm>;

function summaryFor(sectionId: string, s: ProjectSetupDto, currency: string, term: Term): string[] {
  switch (sectionId) {
    case "basics":
      return [
        `${s.basics.name} (${s.basics.codePrefix})${s.basics.projectType ? ` · ${s.basics.projectType.name}` : ""}`,
        [s.basics.stateLocation, s.basics.lgaLocation].filter(Boolean).join(", ") || "No location",
        s.basics.totalBudgetNgn ? formatMoney(s.basics.totalBudgetNgn, { currency }) : "No budget",
      ];
    case "parties": {
      const primary = s.parties.beneficiaries.find((b) => b.isPrimary);
      return [
        `${term("beneficiary")}: ${primary?.name ?? "not set"}${s.parties.beneficiaries.length > 1 ? ` (+${s.parties.beneficiaries.length - 1})` : ""}`,
        `Owner: ${s.parties.owningOrganization?.name ?? "not set"}`,
        `${term("monitorParty")}: ${s.parties.monitorOrganization?.name ?? "not set"}`,
        `${term("funderParty")}: ${s.parties.lenderOrganization?.name ?? "not set"}`,
      ];
    }
    case "site":
      return [
        s.site.geofenceMode ? `${geofenceModeLabel(s.site.geofenceMode)} boundary` : "No site boundary",
        `Tolerance ${s.site.effectiveToleranceMeters} m${s.site.geofenceToleranceMeters === null ? " (workspace default)" : ""}`,
        `Time zone ${s.site.timezone}`,
      ];
    case "contractor": {
      const c = s.parties.contractors[0];
      return c
        ? [`${c.organizationName}`, c.plannedCompletionDate ? `Planned completion ${c.plannedCompletionDate}` : "No planned completion"]
        : ["No contractor"];
    }
    case "contract": {
      const c = s.contract;
      return [
        c.contractReference ? `Contract ${c.contractReference}` : "No contract reference",
        c.contractSumNgn ? `Contract sum ${formatMoney(c.contractSumNgn, { currency })}` : "No contract sum",
        c.kickoffDate ? `Planned kick-off ${c.kickoffDate}` : "No planned kick-off",
      ];
    }
    case "facility": {
      const r = s.facility.retention;
      if (!s.process.config.enableRetentionModule) return [`${term("retention")} off`];
      return [
        r.retentionPercentage ? `${r.retentionPercentage}% held from each payment` : "No retention percentage set",
        r.retentionDurationMonths ? `${r.retentionDurationMonths}-month defects liability period` : "No liability period set",
      ];
    }
    case "scope":
      return [
        `${s.scope.sprintCount} sprint(s), ${s.scope.unitCount} facility unit(s)`,
        `${s.scope.lineCount} BoQ line(s), ${formatMoney(s.scope.totalBudgetedCostNgn, { currency })}`,
      ];
    case "standards":
      return [
        `${s.standards.needsAssessmentCount} needs-assessment document(s) (${DOCUMENT_MODE_META[s.process.config.needsAssessmentMode].label.toLowerCase()})`,
        `${s.standards.standardCount} standard(s) (${DOCUMENT_MODE_META[s.process.config.standardsSpecificationMode].label.toLowerCase()})`,
      ];
    case "team":
      return [`${s.team.userIds.length} person(s) assigned`];
    case "visits":
      return [
        `Working days: ${s.visits.workWeekDays.map((d) => ISO_WEEKDAY_SHORT[d]).join(", ") || "none"}`,
        `${s.visits.defaultOfficerIds.length} visit officer(s)`,
      ];
    case "process": {
      const p = s.process;
      return [
        p.workflowTemplateName ? `Template: ${p.workflowTemplateName}` : "No template applied",
        p.config.requireReportApproval ? `Report approval: ${p.reportChain.steps.length} step(s)` : "Report approval off",
      ];
    }
    default:
      return [];
  }
}

/**
 * Step 5 "Review" (redesign R6a): one card per wizard step with its sections' summary, issues and
 * warnings, each issue with a "Fix" link to its section; then "Go live".
 */
export function ReviewStep({ projectId, setup, mode }: WizardStepProps) {
  const { hasPermission } = useAuth();
  const term = useTerm();
  const navigate = useGuardedNavigate();
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const [setActive, setSetActive] = useState(false);
  const [serverIssues, setServerIssues] = useState<ActivationIssue[]>([]);
  const activate = useActivateProjectMutation(projectId);
  const base = `/app/projects/${projectId}/${mode}`;

  const sections = setup.steps;
  const sectionTitle = (id: string) => sections.find((s) => s.stepId === id)?.title ?? id;
  const stepTitle = (id: string | undefined) => PROJECT_SETUP_STEPS.find((s) => s.id === id)?.title ?? "Setup";
  const blocking = sections.filter((s) => s.required && !s.complete);
  const blockingSteps = setup.wizardSteps.filter((w) => w.required && !w.complete);
  const canActivatePermission = hasPermission("projects:activate");
  const isDraft = setup.status === "DRAFT";
  const toggleDisabledReason = !isDraft
    ? "This project is already active."
    : !canActivatePermission
      ? "Your role cannot activate projects."
      : blockingSteps.length > 0
        ? `Finish ${blockingSteps.map((b) => b.title).join(", ")} first.`
        : null;

  const onSave = async () => {
    if (!setActive) {
      navigate("/app/projects?tab=drafts");
      return;
    }
    try {
      await activate.mutateAsync();
      navigate(`/app/projects/${projectId}/dashboard`);
    } catch (err) {
      const issues = (err as { response?: { data?: { error?: { details?: { issues?: ActivationIssue[] } } } } })?.response?.data?.error
        ?.details?.issues;
      setServerIssues(issues ?? []);
    }
  };

  // Group a list of section issues by wizard step, in step order.
  const groupByStep = <T extends { stepId: string; wizardStepId?: string }>(items: T[]) =>
    setup.wizardSteps
      .map((w) => ({ step: w, items: items.filter((i) => (i.wizardStepId ?? sections.find((s) => s.stepId === i.stepId)?.wizardStepId) === w.id) }))
      .filter((g) => g.items.length > 0);

  const numbered = PROJECT_SETUP_STEPS.filter((s) => !s.settingsOnly && s.id !== "review");
  const advanced = PROJECT_SETUP_STEPS.filter((s) => s.settingsOnly);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...numbered, ...advanced].map((def) => {
          const w = setup.wizardSteps.find((x) => x.id === def.id);
          if (!w) return null;
          const own = sections.filter((s) => s.wizardStepId === def.id);
          return (
            <section key={def.id} aria-labelledby={`review-${def.id}`} className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {w.complete ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  ) : w.required ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-300" aria-hidden="true" />
                  )}
                  <h3 id={`review-${def.id}`} className="text-xs font-bold text-slate-900">
                    {def.settingsOnly ? def.title : `${def.order}. ${def.title}`}
                  </h3>
                  <span className="text-[10px] text-slate-500">
                    {w.complete ? "Complete" : w.required ? "Needs attention" : "Optional"}
                  </span>
                </div>
                <Link to={`${base}/${def.route}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-primary hover:underline">
                  <Pencil className="w-3 h-3" aria-hidden="true" /> Edit<span className="sr-only"> {def.title}</span>
                </Link>
              </div>
              <div className="mt-2 space-y-2">
                {own.map((sec) => (
                  <div key={sec.stepId}>
                    <p className="text-[11px] font-semibold text-slate-700">{sec.title}</p>
                    <ul className="space-y-0.5 text-[11px] text-slate-600">
                      {summaryFor(sec.stepId, setup, currency, term).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                    {sec.issues.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800">
                        {sec.issues.map((iss, i) => (
                          <li key={i}>
                            • {iss.message}{" "}
                            <Link to={sectionHref(base, sec.stepId)} className="font-semibold underline">
                              Fix<span className="sr-only">: {sec.title}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {sec.warnings.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                        {sec.warnings.map((wa, i) => (
                          <li key={i}>Note: {wa.message}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {isDraft && (
        <StepSection title="Go live" description="Active projects appear on mobile and in portfolio views. A project cannot go back to draft.">
          {blocking.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <p className="font-semibold">Before it can go live:</p>
              {groupByStep(blocking.flatMap((b) => b.issues.map((iss) => ({ ...iss, stepId: b.stepId, wizardStepId: b.wizardStepId })))).map((g) => (
                <div key={g.step.id} className="mt-2">
                  <p className="font-semibold">{g.step.title}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {g.items.map((iss, i) => (
                      <li key={`${iss.stepId}-${i}`}>
                        {sectionTitle(iss.stepId)}: {iss.message}{" "}
                        <Link to={sectionHref(base, iss.stepId)} className="font-semibold underline">
                          Fix<span className="sr-only">: {sectionTitle(iss.stepId)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {serverIssues.length > 0 && (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-800" role="alert">
              <p className="font-semibold">The server refused activation:</p>
              <ul className="mt-1 space-y-0.5">
                {serverIssues.map((iss, i) => (
                  <li key={i}>
                    {stepTitle(iss.wizardStepId)} · {sectionTitle(iss.stepId)}: {iss.message}{" "}
                    <Link to={sectionHref(base, iss.stepId)} className="font-semibold underline">
                      Fix
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className={`flex items-center gap-3 text-sm ${toggleDisabledReason ? "opacity-60" : ""}`}>
            <button
              type="button"
              role="switch"
              aria-checked={setActive}
              aria-label="Set project active"
              disabled={Boolean(toggleDisabledReason)}
              onClick={() => setSetActive((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                setActive ? "bg-brand-primary" : "bg-slate-300"
              }`}
            >
              <span className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition ${setActive ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
            <span className="font-semibold text-slate-900">Set project active</span>
          </label>
          {toggleDisabledReason && <p className="text-[11px] text-slate-500">{toggleDisabledReason}</p>}
          <button
            type="button"
            onClick={onSave}
            disabled={activate.isPending}
            className="rounded-xl bg-brand-primary px-5 py-2.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {activate.isPending ? "Activating…" : setActive ? "Save and set active" : "Save draft"}
          </button>
        </StepSection>
      )}
    </div>
  );
}
