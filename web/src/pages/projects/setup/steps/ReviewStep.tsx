import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Circle, Pencil } from "lucide-react";
import {
  CONTRACTOR_EXECUTION_MODE_META,
  formatMoney,
  geofenceModeLabel,
  type ProjectSetupDto,
  type SetupIssue,
} from "@insite/shared";
import { useAuth } from "../../../../lib/auth-context";
import { useActivateProjectMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { StepSection, useRegisterStep, type StepProps } from "../setupContext";
import { visibleSteps } from "../stepRegistry";

function summaryFor(stepId: string, s: ProjectSetupDto, currency: string): string[] {
  switch (stepId) {
    case "basics":
      return [
        `${s.basics.name} (${s.basics.codePrefix})`,
        [s.basics.stateLocation, s.basics.lgaLocation].filter(Boolean).join(", ") || "No location",
        s.basics.totalBudgetNgn ? formatMoney(s.basics.totalBudgetNgn, { currency }) : "No budget",
      ];
    case "parties":
      return [
        `Monitor: ${s.parties.monitorOrganization?.name ?? "not set"}`,
        `Lender: ${s.parties.lenderOrganization?.name ?? "not set"}`,
        s.parties.contractorExecutionMode
          ? CONTRACTOR_EXECUTION_MODE_META[s.parties.contractorExecutionMode].label
          : "Contractor model not chosen",
        s.parties.contractors.length
          ? s.parties.contractors.map((c) => `${c.organizationName} (${c.tradeCode}${c.isMainContractor ? ", main" : ""})`).join("; ")
          : "No contractors",
      ];
    case "site":
      return [
        s.site.geofenceMode ? `${geofenceModeLabel(s.site.geofenceMode)} geofence` : "No geofence",
        `Tolerance ${s.site.effectiveToleranceMeters} m${s.site.geofenceToleranceMeters === null ? " (workspace default)" : ""}`,
        `Time zone ${s.site.timezone}`,
      ];
    case "facility": {
      const total = s.facility.tranches.reduce((t, x) => t + x.allocatedAmountNgn, 0);
      return [
        `${s.facility.tranches.length} tranche(s), ${formatMoney(total, { currency })}`,
        `${s.facility.tranches.reduce((t, x) => t + x.conditionsPrecedent.length, 0)} condition(s) precedent`,
      ];
    }
    case "boq":
      return [
        `${s.boq.itemCount} item(s), ${formatMoney(s.boq.totalBudgetedCostNgn, { currency })}`,
        `${s.boq.holdPointCount} hold point(s)`,
        `${s.boq.unmappedCount} not mapped to a tranche`,
      ];
    case "reporting":
      return [`${s.reporting.reportingCadence.replace("_", " ").toLowerCase()} reports`, `${s.reporting.workdayStartTime}–${s.reporting.workdayEndTime}`];
    case "team":
      return [
        `${s.team.userIds.length} person(s) assigned`,
        s.team.joinCodeRoleIds === null ? "Join codes for every join-code role" : `Join codes for ${s.team.joinCodeRoleIds.length} role(s)`,
      ];
    default:
      return [];
  }
}

export function ReviewStep({ projectId, setup, mode }: StepProps) {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const settings = useTenantSettingsQuery();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const [setActive, setSetActive] = useState(false);
  const [serverIssues, setServerIssues] = useState<Array<SetupIssue & { stepId?: string }>>([]);
  const activate = useActivateProjectMutation(projectId);
  const base = mode === "settings" ? `/app/projects/${projectId}/settings` : `/app/projects/${projectId}/setup`;

  // The review step has nothing of its own to save.
  useRegisterStep(false, async () => true);

  const steps = setup.steps;
  const blocking = steps.filter((s) => s.required && !s.complete);
  const canActivatePermission = hasPermission("projects:activate");
  const isDraft = setup.status === "DRAFT";
  const toggleDisabledReason = !isDraft
    ? "This project is already active."
    : !canActivatePermission
      ? "Your role cannot activate projects."
      : blocking.length > 0
        ? `Finish ${blocking.map((b) => b.title).join(", ")} first.`
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
      const issues = (err as { response?: { data?: { error?: { details?: { issues?: SetupIssue[] } } } } })?.response?.data
        ?.error?.details?.issues;
      setServerIssues(issues ?? []);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visibleSteps()
          .filter((st) => st.id !== "review")
          .map((st) => {
            const status = steps.find((s) => s.stepId === st.id);
            const complete = status?.complete ?? false;
            return (
              <div key={st.id} className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {complete ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="Complete" />
                    ) : st.required ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600" aria-label="Incomplete" />
                    ) : (
                      <Circle className="w-4 h-4 text-slate-300" aria-label="Optional" />
                    )}
                    <h3 className="text-xs font-bold text-slate-900">{st.title}</h3>
                    {!st.required && <span className="text-[10px] text-slate-400">optional</span>}
                  </div>
                  <Link to={`${base}/${st.route}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-primary hover:underline">
                    <Pencil className="w-3 h-3" /> Edit
                  </Link>
                </div>
                <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600">
                  {summaryFor(st.id, setup, currency).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                {status && status.issues.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-amber-800">
                    {status.issues.map((iss, i) => (
                      <li key={i}>• {iss.message}</li>
                    ))}
                  </ul>
                )}
                {status && status.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                    {status.warnings.map((w, i) => (
                      <li key={i}>Note: {w.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
      </div>

      {isDraft && (
        <StepSection title="Go live" description="Active projects appear on mobile and in portfolio views, and join codes are issued. A project cannot go back to draft.">
          {blocking.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <p className="font-semibold">Before it can go live:</p>
              <ul className="mt-1 space-y-0.5">
                {blocking.flatMap((b) =>
                  b.issues.map((iss, i) => (
                    <li key={`${b.stepId}-${i}`}>
                      <Link to={`${base}/${b.stepId}`} className="font-semibold underline">
                        {b.title}
                      </Link>
                      : {iss.message}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
          {serverIssues.length > 0 && (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-800">
              <p className="font-semibold">The server refused activation:</p>
              <ul className="mt-1 space-y-0.5">
                {serverIssues.map((iss, i) => (
                  <li key={i}>
                    {iss.stepId ? `${iss.stepId}: ` : ""}
                    {iss.message}
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
