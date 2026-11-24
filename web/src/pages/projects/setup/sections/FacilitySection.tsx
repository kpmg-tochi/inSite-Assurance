import { useMemo, useState } from "react";
import { formatMoney, type ProjectFacilityStep, type ProjectSetupDto } from "@insite/shared";
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
  useLatestSetup,
  useRegisterSection,
  useSyncedState,
  type FormErrors,
  type StepProps,
} from "../setupContext";

function retentionFrom(setup: ProjectSetupDto) {
  const r = setup.facility.retention;
  return {
    pct: r.retentionPercentage === null ? "" : String(r.retentionPercentage),
    months: r.retentionDurationMonths === null ? "" : String(r.retentionDurationMonths),
    completionPct: String(r.retentionReleaseAtCompletionPct),
  };
}

/**
 * Section `facility` (step 2 "Contract": "Retention and defects liability"). Redesign R1b: payments are made outside the platform,
 * so there are no tranches or conditions precedent any more. The step holds the retention
 * percentage and the defects liability period; recorded payments hold retention at this rate.
 */
export function FacilitySection({ projectId, setup, readOnly }: StepProps) {
  const settings = useTenantSettingsQuery();
  const term = useTerm();
  const currency = settings.data?.defaultCurrency ?? "NGN";
  const save = useSaveSetupStepMutation(projectId);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const retentionOn = setup.process.config.enableRetentionModule;
  const r0 = setup.facility.retention;
  const initial = useMemo(() => retentionFrom(setup), [setup]);
  const [retentionValues, setRetention, changed] = useSyncedState(initial);
  const dirty = retentionOn && changed;
  const latest = useLatestSetup(projectId, setup);

  useRegisterSection("facility", dirty, async (opts) => {
    if (!dirty && !opts?.force) return true;
    // With the module off there is nothing to send; a forced save only marks the section reviewed.
    if (!retentionOn) {
      try {
        await save.mutateAsync({ sectionId: "facility", body: {}, silent: opts?.silent });
        return true;
      } catch (err) {
        setErrors(extractErrors(err));
        return false;
      }
    }
    const retention = dirty ? retentionValues : retentionFrom(latest());
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
      await save.mutateAsync({ sectionId: "facility", body, silent: opts?.silent });
      setRetention(retentionFrom(latest()));
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  return (
    <StepSection
      title={`${term("retention")} and defects liability`}
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
              <label className={labelClass} htmlFor="retention-pct">{term("retention")} (%)</label>
              <input id="retention-pct" inputMode="decimal" placeholder="e.g. 5" className={inputClass(Boolean(errors.fields["retention.retentionPercentage"]))} value={retentionValues.pct} onChange={(e) => setRetention((x) => ({ ...x, pct: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionPercentage"]} />
            </div>
            <div>
              <label className={labelClass} htmlFor="retention-months">Defects liability period (months)</label>
              <input id="retention-months" inputMode="numeric" placeholder="e.g. 6" className={inputClass(Boolean(errors.fields["retention.retentionDurationMonths"]))} value={retentionValues.months} onChange={(e) => setRetention((x) => ({ ...x, months: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionDurationMonths"]} />
            </div>
            <div>
              <label className={labelClass} htmlFor="retention-completion">Released at practical completion (%)</label>
              <input id="retention-completion" inputMode="decimal" className={inputClass(Boolean(errors.fields["retention.retentionReleaseAtCompletionPct"]))} value={retentionValues.completionPct} onChange={(e) => setRetention((x) => ({ ...x, completionPct: e.target.value }))} disabled={readOnly} />
              <FieldError message={errors.fields["retention.retentionReleaseAtCompletionPct"]} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">0% at practical completion means everything is released at the end of the period (the default).</p>
        </div>
      )}
    </StepSection>
  );
}
