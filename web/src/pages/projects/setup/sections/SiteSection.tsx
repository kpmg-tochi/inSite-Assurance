import React, { useMemo, useState } from "react";
import { z } from "zod";
import {
  COMMON_TIME_ZONES,
  ProjectGeofenceSchema,
  ProjectSiteStepSchema,
  type ProjectGeofenceInput,
  type ProjectSetupDto,
} from "@insite/shared";
import { FieldError, visibleError } from "../../../../lib/forms";
import { GeofenceEditor } from "../../../../components/geofence/GeofenceEditor";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import {
  extractErrors,
  inputClass,
  labelClass,
  numberOrNull,
  setField,
  StepSection,
  textProps,
  useLatestSetup,
  useRegisterSection,
  useSectionForm,
  type StepProps,
} from "../setupContext";

function siteFrom(setup: ProjectSetupDto) {
  return {
    geofence: (setup.site.geofence as ProjectGeofenceInput | null) ?? null,
    // "" = use the tenant default.
    geofenceToleranceMeters: setup.site.geofenceToleranceMeters === null ? "" : String(setup.site.geofenceToleranceMeters),
    timezone: setup.site.timezone,
  };
}

const TOLERANCE_MESSAGE = "Whole metres from 0 to 1000, or leave empty for the workspace default";

/**
 * Form schema: the boundary (`ProjectGeofenceSchema`; the editor explains its issue in plain words),
 * the tolerance typed as text (empty = workspace default) and the time zone → `ProjectSiteStepSchema`.
 */
const SiteFormSchema = z
  .object({
    geofence: ProjectGeofenceSchema.nullable(),
    geofenceToleranceMeters: numberOrNull("Tolerance").pipe(
      z.number().int(TOLERANCE_MESSAGE).min(0, TOLERANCE_MESSAGE).max(1000, TOLERANCE_MESSAGE).nullable()
    ),
    timezone: ProjectSiteStepSchema.shape.timezone,
  })
  .pipe(ProjectSiteStepSchema);

/** Server paths → form fields (a boundary issue is shown under the editor). */
const sitePath = (path: string) => (path.startsWith("geofence.") ? "geofence" : path);

/**
 * Section `site` (step 1 "Project": "Location"): the site boundary (a radial pin starts at the
 * workspace default radius; a perimeter on request), with tolerance and time zone collapsed.
 */
export function SiteSection({ projectId, setup, readOnly }: StepProps) {
  const initial = useMemo(() => siteFrom(setup), [setup]);
  const section = useSectionForm(SiteFormSchema, initial);
  const { form, dirty } = section;
  const state = section.values as ReturnType<typeof siteFrom>;
  const [general, setGeneral] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const latest = useLatestSetup(projectId, setup);
  const err = (name: string) => visibleError(form, name);
  const tenantDefault = setup.site.tenantDefaultToleranceMeters;
  const toleranceValue = state.geofenceToleranceMeters.trim() === "" ? tenantDefault : Number(state.geofenceToleranceMeters);
  const zones = COMMON_TIME_ZONES.includes(state.timezone) ? COMMON_TIME_ZONES : [state.timezone, ...COMMON_TIME_ZONES];
  // "Location: advanced" opens on an error and stays open while it is fixed.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useRegisterSection(
    "site",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const body = await section.submit(dirty ? undefined : siteFrom(latest()));
      if (!body) return false;
      try {
        await save.mutateAsync({ sectionId: "site", body, silent: opts?.silent });
        section.reset(siteFrom(latest()));
        setGeneral(null);
        return true;
      } catch (error) {
        const message = section.showServerErrors(error, sitePath);
        // Field errors show on their fields; a message without them shows under the editor.
        setGeneral(Object.keys(extractErrors(error).fields).length > 0 ? null : message);
        return false;
      }
    },
    section
  );

  // The editor explains an invalid shape itself; this shows a failed save's message.
  const geofenceError = err("geofence") ?? general;

  return (
    <div className="space-y-5">
      <StepSection
        title="Location"
        description={`Field captures and visit check-ins are checked against this boundary. A new radial boundary starts at the workspace default radius (${setup.site.tenantDefaultRadiusMeters} m); set this project's own radius below.`}
      >
        <GeofenceEditor
          value={state.geofence}
          onChange={(geofence) => setField(form, "geofence", geofence, true)}
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
        open={advancedOpen || Boolean(err("geofenceToleranceMeters") || err("timezone"))}
        onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
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
              className={inputClass(Boolean(err("geofenceToleranceMeters")))}
              {...textProps(form, "geofenceToleranceMeters")}
              placeholder={`Workspace default: ${tenantDefault} m`}
              disabled={readOnly}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              A position this far outside the boundary still counts, and is noted on the capture or check-in. Leave empty to use
              the workspace default ({tenantDefault} m).
            </p>
            <FieldError form={form} name="geofenceToleranceMeters" />
          </div>
          <div>
            <label className={labelClass} htmlFor="site-timezone">
              Project time zone
            </label>
            <select
              id="site-timezone"
              className={inputClass(Boolean(err("timezone")))}
              {...textProps(form, "timezone")}
              onChange={(e) => setField(form, "timezone", e.target.value, true)}
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
            <FieldError form={form} name="timezone" />
          </div>
        </div>
      </details>
    </div>
  );
}
