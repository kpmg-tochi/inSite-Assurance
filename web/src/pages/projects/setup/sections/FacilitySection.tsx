import { useMemo, useState } from "react";
import { z } from "zod";
import { formatMoney, ProjectFacilityStepSchema, type ProjectSetupDto } from "@insite/shared";
import { FieldError, visibleError } from "../../../../lib/forms";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useTenantSettingsQuery } from "../../../../queries/organizations/useOrganizationQueries";
import { useTerm } from "../../../../lib/auth-context";
import {
  extractErrors,
  inputClass,
  labelClass,
  numberOrNull,
  StepSection,
  textProps,
  useLatestSetup,
  useRegisterSection,
  useSectionForm,
  type StepProps,
} from "../setupContext";

function retentionFrom(setup: ProjectSetupDto) {
  const r = setup.facility.retention;
  return {
    retention: {
      retentionPercentage: r.retentionPercentage === null ? "" : String(r.retentionPercentage),
      retentionDurationMonths: r.retentionDurationMonths === null ? "" : String(r.retentionDurationMonths),
      retentionReleaseAtCompletionPct: String(r.retentionReleaseAtCompletionPct),
    },
  };
}

/**
 * Form schema: text inputs → `ProjectFacilityStepSchema` (retention 0 to 20 %, a liability period of
 * 1 to 60 whole months, required when retention is held, 0 to 100 % released at practical completion).
 */
const FacilityFormSchema = z
  .object({
    retention: z
      .object({
        // The shared rules with plain-words messages; the final pipe checks the request shape again.
        retentionPercentage: numberOrNull("Retention").pipe(z.number().min(0, "0 to 20").max(20, "0 to 20").nullable()),
        retentionDurationMonths: numberOrNull("Defects liability period").pipe(
          z.number().int("1 to 60 months").min(1, "1 to 60 months").max(60, "1 to 60 months").nullable()
        ),
        retentionReleaseAtCompletionPct: numberOrNull("Release at completion")
          .transform((n) => n ?? 0)
          .pipe(z.number().min(0, "0 to 100").max(100, "0 to 100")),
      })
      .superRefine((r, ctx) => {
        if (r.retentionPercentage && !r.retentionDurationMonths) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["retentionDurationMonths"], message: "Set the defects liability period" });
        }
      }),
  })
  .pipe(ProjectFacilityStepSchema);

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
  const [general, setGeneral] = useState<string | null>(null);
  const retentionOn = setup.process.config.enableRetentionModule;
  const r0 = setup.facility.retention;
  const initial = useMemo(() => retentionFrom(setup), [setup]);
  const section = useSectionForm(FacilityFormSchema, initial);
  const { form } = section;
  const dirty = retentionOn && section.dirty;
  const latest = useLatestSetup(projectId, setup);
  const err = (name: string) => visibleError(form, name);

  useRegisterSection(
    "facility",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      // With the module off there is nothing to send; a forced save only marks the section reviewed.
      if (!retentionOn) {
        try {
          await save.mutateAsync({ sectionId: "facility", body: {}, silent: opts?.silent });
          return true;
        } catch (error) {
          setGeneral(extractErrors(error).general);
          return false;
        }
      }
      const body = await section.submit(dirty ? undefined : retentionFrom(latest()));
      if (!body) return false;
      try {
        await save.mutateAsync({ sectionId: "facility", body, silent: opts?.silent });
        section.reset(retentionFrom(latest()));
        setGeneral(null);
        return true;
      } catch (error) {
        setGeneral(section.showServerErrors(error));
        return false;
      }
    },
    // With the module off the fields are not shown or sent.
    { valid: !retentionOn || section.valid, reveal: section.reveal }
  );

  return (
    <StepSection
      title={`${term("retention")} and defects liability period`}
      description="Payments to the contractor are made outside the platform and recorded on the Payments page. Retention is held from each recorded payment at this rate."
    >
      {!retentionOn ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {term("retention")} and defects are off in this project's process settings. Nothing to set here.
        </p>
      ) : (
        <div className="space-y-3">
          {general && <p className="text-xs font-medium text-red-600">{general}</p>}
          <p className="text-[11px] text-slate-500">
            A change applies to later payments only
            {r0.heldNgn > 0 ? ` (${formatMoney(r0.heldNgn, { currency })} is already held)` : ""}.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="retention-pct">{term("retention")} (%)</label>
              <input id="retention-pct" inputMode="decimal" placeholder="e.g. 5" className={inputClass(Boolean(err("retention.retentionPercentage")))} {...textProps(form, "retention.retentionPercentage")} disabled={readOnly} />
              <FieldError form={form} name="retention.retentionPercentage" />
            </div>
            <div>
              <label className={labelClass} htmlFor="retention-months">Defects liability period (months)</label>
              <input id="retention-months" inputMode="numeric" placeholder="e.g. 6" className={inputClass(Boolean(err("retention.retentionDurationMonths")))} {...textProps(form, "retention.retentionDurationMonths")} disabled={readOnly} />
              <FieldError form={form} name="retention.retentionDurationMonths" />
            </div>
            <div>
              <label className={labelClass} htmlFor="retention-completion">Released at practical completion (%)</label>
              <input id="retention-completion" inputMode="decimal" className={inputClass(Boolean(err("retention.retentionReleaseAtCompletionPct")))} {...textProps(form, "retention.retentionReleaseAtCompletionPct")} disabled={readOnly} />
              <FieldError form={form} name="retention.retentionReleaseAtCompletionPct" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">0% at practical completion means everything is released at the end of the period (the default).</p>
        </div>
      )}
    </StepSection>
  );
}
