import { useMemo, useState } from "react";
import { formatMoney, type ProjectFacilityStep } from "@insite/shared";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { useTerm } from "../../../../lib/auth-context";
import {
  extractErrors,
  FieldError,
  inputClass,
  labelClass,
  NO_ERRORS,
  parseNumberInput,
  StepSection,
  useRegisterStep,
  type FormErrors,
} from "../setupContext";
import type { StepProps } from "../setupContext";

/**
 * Setup step "Retention" (route "facility"). Redesign R1b: payments are made outside the platform,
 * so there are no tranches or conditions precedent any more. The step holds the retention
 * percentage and the defects liability period; recorded payments hold retention at this rate.
 */
export function FacilityStep({ projectId, setup, readOnly }: StepProps) {
  const settings = useTenantSettingsQuery();
  const term = useTerm();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const save = useSaveSetupStepMutation(projectId);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const retentionOn = setup.process.config.enableRetentionModule;
  const r0 = setup.facility.retention;
  const initial = useMemo(
    () => ({
      pct: r0.retentionPercentage === null ? "" : String(r0.retentionPercentage),
      months: r0.retentionDurationMonths === null ? "" : String(r0.retentionDurationMonths),
      completionPct: String(r0.retentionReleaseAtCompletionPct),
    }),
    [r0]
  );
  const [retention, setRetention] = useState(initial);
  const dirty = retentionOn && JSON.stringify(retention) !== JSON.stringify(initial);

  useRegisterStep(dirty, async (opts) => {
    if (!dirty) return true;
    const fields: Record<string, string> = {};
    const pctValue = retention.pct.trim() === "" ? null : parseNumberInput(retention.pct);
    const monthsValue = retention.months.trim() === "" ? null : parseNumberInput(retention.months);
    const completionValue = parseNumberInput(retention.completionPct) ?? 0;
    if (pctValue !== null && (pctValue < 0 || pctValue > 20)) fields["retention.retentionPercentage"] = "0 to 20";
    if (pctValue && !monthsValue) fields["retention.retentionDurationMonths"] = "Set the liability period";
    if (monthsValue !== null && (!Number.isInteger(monthsValue) || monthsValue < 1 || monthsValue > 60)) fields["retention.retentionDurationMonths"] = "1 to 60 months";
    if (completionValue < 0 || completionValue > 100) fields["retention.retentionReleaseAtCompletionPct"] = "0 to 100";
    if (Object.keys(fields).length > 0) {
      setErrors({ fields, general: "Some fields need attention." });
      return false;
    }
    const body: ProjectFacilityStep = {
      retention: {
        retentionPercentage: pctValue,
        retentionDurationMonths: monthsValue,
        retentionReleaseAtCompletionPct: completionValue,
      },
    };
    try {
      await save.mutateAsync({ stepId: "facility", body, silent: opts?.silent });
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  return (
    <StepSection
      title={term("retention")}
      description="Payments to the contractor are made outside the platform and recorded on the Payments page. Retention is held from each recorded payment at this rate."
    >
      {!retentionOn ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {term("retention")} and defects are off in this project's process settings. Nothing to set here.
        </p>
      ) : (
        <div className="space-y-3">
          {errors.general && <p className="text-xs font-medium text-red-600">{errors.general}</p>}
          <p className="text-[11px] text-slate-500">
            A change applies to later payments only
            {r0.heldNgn > 0 ? ` (${formatMoney(r0.heldNgn, { currency })} is already held)` : ""}.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>{term("retention")} (%)</label>
              <input inputMode="decimal" placeholder="e.g. 5" className={inputClass(Boolean(errors.fields["retention.retentionPercentage"]))} value={retention.pct} onChange={(e) => setRetention((x) => ({ ...x, pct: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionPercentage"]} />
            </div>
            <div>
              <label className={labelClass}>Defects liability period (months)</label>
              <input inputMode="numeric" placeholder="e.g. 6" className={inputClass(Boolean(errors.fields["retention.retentionDurationMonths"]))} value={retention.months} onChange={(e) => setRetention((x) => ({ ...x, months: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionDurationMonths"]} />
            </div>
            <div>
              <label className={labelClass}>Released at practical completion (%)</label>
              <input inputMode="decimal" className={inputClass(Boolean(errors.fields["retention.retentionReleaseAtCompletionPct"]))} value={retention.completionPct} onChange={(e) => setRetention((x) => ({ ...x, completionPct: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionReleaseAtCompletionPct"]} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">0% at practical completion means everything is released at the end of the period (the default).</p>
        </div>
      )}
    </StepSection>
  );
}
