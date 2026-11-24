import React, { useMemo, useState } from "react";
import {
  COMMON_TIME_ZONES,
  ProjectGeofenceSchema,
  type ProjectGeofenceInput,
  type ProjectSetupDto,
  type ProjectSiteStepInput,
} from "@insite/shared";
import { GeofenceEditor } from "../../../../components/geofence/GeofenceEditor";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import {
  extractErrors,
  FieldError,
  inputClass,
  labelClass,
  NO_ERRORS,
  StepSection,
  useLatestSetup,
  useRegisterSection,
  useSyncedState,
  type FormErrors,
  type StepProps,
} from "../setupContext";

function siteFrom(setup: ProjectSetupDto) {
  return {
    geofence: (setup.site.geofence as ProjectGeofenceInput | null) ?? null,
    // "" = use the tenant default.
    tolerance: setup.site.geofenceToleranceMeters === null ? "" : String(setup.site.geofenceToleranceMeters),
    timezone: setup.site.timezone,
  };
}

/**
 * Section `site` (step 1 "Project": "Location"): the site boundary (a radial pin starts at the
 * workspace default radius; a perimeter on request), with tolerance and time zone collapsed.
 */
export function SiteSection({ projectId, setup, readOnly }: StepProps) {
  const initial = useMemo(() => siteFrom(setup), [setup]);
  const [state, setState, dirty] = useSyncedState(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);
  const tenantDefault = setup.site.tenantDefaultToleranceMeters;
  const toleranceValue = state.tolerance.trim() === "" ? tenantDefault : Number(state.tolerance);
  const zones = COMMON_TIME_ZONES.includes(state.timezone) ? COMMON_TIME_ZONES : [state.timezone, ...COMMON_TIME_ZONES];

  useRegisterSection("site", dirty, async (opts) => {
    if (!dirty && !opts?.force) return true;
    const v = dirty ? state : siteFrom(latest());
    const fields: Record<string, string> = {};
    if (v.geofence) {
      const parsed = ProjectGeofenceSchema.safeParse(v.geofence);
      if (!parsed.success) fields.geofence = parsed.error.issues[0]?.message ?? "The geofence is not valid";
    }
    const tol = v.tolerance.trim() === "" ? null : Number(v.tolerance);
    if (tol !== null && (!Number.isInteger(tol) || tol < 0 || tol > 1000)) {
      fields.geofenceToleranceMeters = "Whole metres from 0 to 1000, or leave empty for the workspace default";
    }
    if (Object.keys(fields).length > 0) {
      setErrors({ fields, general: "Some fields need attention." });
      return false;
    }
    const body: ProjectSiteStepInput = { geofence: v.geofence, geofenceToleranceMeters: tol, timezone: v.timezone };
    try {
      await save.mutateAsync({ sectionId: "site", body, silent: opts?.silent });
      setState(siteFrom(latest()));
      setErrors(NO_ERRORS);
      return true;
    } catch (err) {
      setErrors(extractErrors(err));
      return false;
    }
  });

  const geofenceError =
    errors.fields.geofence ??
    Object.entries(errors.fields).find(([k]) => k.startsWith("geofence."))?.[1] ??
    (errors.general && !Object.keys(errors.fields).length ? errors.general : null);

  return (
    <div className="space-y-5">
      <StepSection
        title="Location"
        description={`Field captures and visit check-ins are checked against this boundary. A new radial boundary starts at the workspace default radius (${setup.site.tenantDefaultRadiusMeters} m); set this project's own radius below.`}
      >
        <GeofenceEditor
          value={state.geofence}
          onChange={(geofence) => setState((s) => ({ ...s, geofence }))}
          enabledModes={setup.site.enabledGeofenceModes}
          lockedMode={setup.site.geofenceMode}
          toleranceMeters={Number.isFinite(toleranceValue) ? toleranceValue : 0}
          defaultRadiusMeters={setup.site.tenantDefaultRadiusMeters}
          disabled={readOnly}
          error={geofenceError}
        />
      </StepSection>

      <details
        className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm"
        open={Boolean(errors.fields.geofenceToleranceMeters || errors.fields.timezone)}
      >
        <summary className="cursor-pointer text-sm font-bold text-slate-900">Location: advanced</summary>
        <p className="mt-1 text-[11px] text-slate-500">Tolerance outside the boundary and the project time zone.</p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="site-tolerance">
              Tolerance outside the boundary (metres)
            </label>
            <input
              id="site-tolerance"
              inputMode="numeric"
              className={inputClass(Boolean(errors.fields.geofenceToleranceMeters))}
              value={state.tolerance}
              placeholder={`Workspace default: ${tenantDefault} m`}
              onChange={(e) => setState((s) => ({ ...s, tolerance: e.target.value }))}
              disabled={readOnly}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              A position this far outside the boundary still counts, and is noted on the capture or check-in. Leave empty to use
              the workspace default ({tenantDefault} m).
            </p>
            <FieldError message={errors.fields.geofenceToleranceMeters} />
          </div>
          <div>
            <label className={labelClass} htmlFor="site-timezone">
              Project time zone
            </label>
            <select
              id="site-timezone"
              className={inputClass(Boolean(errors.fields.timezone))}
              value={state.timezone}
              onChange={(e) => setState((s) => ({ ...s, timezone: e.target.value }))}
              disabled={readOnly}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              Dates on this project (visit days, deadlines, milestones) are counted in this zone.
            </p>
            <FieldError message={errors.fields.timezone} />
          </div>
        </div>
      </details>
    </div>
  );
}
