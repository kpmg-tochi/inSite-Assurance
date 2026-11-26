import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ISO_WEEKDAY_SHORT, ProjectVisitsStepSchema, SYSTEM_PERMISSIONS_CATALOG, VISIT_KIND_META } from "@insite/shared";
import { formatDateShort } from "../../../../lib/formatters";
import { FieldError } from "../../../../lib/forms";
import { projectSetupKey } from "../../../../queries/projects/useProjectSetupQueries";
import { useSaveSetupStepMutation } from "../../../../mutations/projects/useProjectSetupMutations";
import { useVisitOfficersQuery, useVisitPlanPreviewQuery } from "../../../../queries/visits/useVisitQueries";
import { useSaveVisitOfficersMutation } from "../../../../mutations/visits/useVisitMutations";
import { useAuth } from "../../../../lib/auth-context";
import Loader from "../../../../components/Loader";
import {
  labelClass,
  setField,
  StepSection,
  useLatestSetup,
  useRegisterSection,
  useSectionForm,
  type StepProps,
} from "../setupContext";

/**
 * Section `visits` (step 4 "Team & visits"; redesign R4, D-R4.39): who carries out the project's visits, its working days (visit dates, the
 * officers' move tolerance and deadlines count them) and a preview of the visit plan the project type
 * will propose on activation. Nothing about visits is stored on a draft except the officers.
 */

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** A permission's display name from the catalogue, so the hint follows any rename. */
const permissionName = (key: string) => SYSTEM_PERMISSIONS_CATALOG.find((p) => p.key === key)?.name ?? key;

const daysKey = (v: { workWeekDays: number[] }) => JSON.stringify([...v.workWeekDays].sort((a, b) => a - b));

export function VisitsSection({ projectId, setup, readOnly }: StepProps) {
  const { hasPermission } = useAuth();
  const canPlan = hasPermission("visits:plan");
  const queryClient = useQueryClient();
  const latest = useLatestSetup(projectId, setup);
  const initialDays = useMemo(() => ({ workWeekDays: setup.visits.workWeekDays }), [setup.visits.workWeekDays]);
  // Working days are validated against ProjectVisitsStepSchema (at least one day).
  const section = useSectionForm(ProjectVisitsStepSchema, initialDays, daysKey);
  const { form } = section;
  const days = (section.values as { workWeekDays: number[] }).workWeekDays;
  const daysDirty = section.dirty;
  const [general, setGeneral] = useState<string | null>(null);
  const save = useSaveSetupStepMutation(projectId);
  const officers = useVisitOfficersQuery(projectId, canPlan);
  const saveOfficers = useSaveVisitOfficersMutation(projectId);
  const preview = useVisitPlanPreviewQuery(projectId, canPlan);
  const [selected, setSelected] = useState<string[] | null>(null);
  const officerIds = selected ?? officers.data?.defaultOfficerIds ?? setup.visits.defaultOfficerIds;
  const officersDirty = selected !== null && JSON.stringify(selected) !== JSON.stringify(officers.data?.defaultOfficerIds ?? []);
  const dirty = !readOnly && (daysDirty || officersDirty);

  useRegisterSection(
    "visits",
    dirty,
    async (opts) => {
      if (!dirty && !opts?.force) return true;
      const body = await section.submit(daysDirty ? undefined : { workWeekDays: latest().visits.workWeekDays });
      if (!body) return false;
      try {
        if (daysDirty || opts?.force) await save.mutateAsync({ sectionId: "visits", body, silent: opts?.silent });
        if (officersDirty && selected) {
          await saveOfficers.mutateAsync(selected);
          // Officers are added to the project team: the Team section must see them.
          await queryClient.invalidateQueries({ queryKey: projectSetupKey(projectId) });
        }
        section.reset({ workWeekDays: latest().visits.workWeekDays });
        setSelected(null);
        setGeneral(null);
        return true;
      } catch (err) {
        setGeneral(section.showServerErrors(err));
        return false;
      }
    },
    section
  );

  const byDate = useMemo(() => preview.data?.items ?? [], [preview.data]);
  const toggleDay = (d: number) =>
    setField(form, "workWeekDays", days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b), true);
  const toggleOfficer = (id: string) => setSelected(officerIds.includes(id) ? officerIds.filter((x) => x !== id) : [...officerIds, id]);

  return (
    <>
      <StepSection title="Monitoring visits" description="Who carries out the monitoring visits and on which days of the week. Proposed monitoring visits get these officers; the first is the lead.">
        {general && <p className="text-xs font-medium text-red-600">{general}</p>}
        <fieldset>
          <legend className={labelClass}>Working days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                disabled={readOnly}
                aria-pressed={days.includes(d)}
                onClick={() => toggleDay(d)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${days.includes(d) ? "border-brand-primary bg-brand-primary/5 text-brand-primary" : "border-slate-200 text-slate-600"}`}
              >
                {ISO_WEEKDAY_SHORT[d]}
              </button>
            ))}
          </div>
          <FieldError form={form} name="workWeekDays" />
        </fieldset>

        {canPlan ? (
          <fieldset>
            <legend className={labelClass}>Monitoring officers</legend>
            {officers.isLoading ? (
              <Loader size="sm" />
            ) : (officers.data?.candidates ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">Nobody in this workspace has a field role that can carry out monitoring visits. Give a user a mobile role with “{permissionName("visits:submit")}”.</p>
            ) : (
              <div className="space-y-1">
                {(officers.data?.candidates ?? []).map((c) => (
                  <label key={c.userId} className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" disabled={readOnly} checked={officerIds.includes(c.userId)} onChange={() => toggleOfficer(c.userId)} />
                    <span className="font-medium">{c.fullName}</span>
                    <span className="text-[11px] text-slate-500">
                      {c.roleName}
                      {officerIds[0] === c.userId ? " · lead" : ""}
                      {c.onProject ? "" : " · added to the project when saved"}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        ) : (
          <p className="text-xs text-slate-500">Planning monitoring visits needs the “{permissionName("visits:plan")}” permission.</p>
        )}
      </StepSection>

      {canPlan && (
        <StepSection title="Monitoring plan" description="What the project type will propose. The M&E manager publishes the proposals to the officers.">
          {preview.isLoading ? (
            <Loader size="sm" />
          ) : !preview.data || preview.data.rules.length === 0 ? (
            <p className="text-xs text-slate-500">{preview.data?.assumptions[0] ?? "The project type has no monitoring plan; monitoring visits are planned by hand."}</p>
          ) : (
            <div className="space-y-2 text-xs">
              {preview.data.assumptions.map((a) => (
                <p key={a} className="text-[11px] text-slate-500">
                  {a}
                </p>
              ))}
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                {byDate.slice(0, 60).map((i) => (
                  <li key={`${i.ruleKey}-${i.date}`} className="rounded-lg bg-slate-50 px-2 py-1">
                    <span className="font-semibold tabular-nums">{formatDateShort(i.date)}</span> · {VISIT_KIND_META[i.visitKind].label}
                    {i.exists ? " (exists)" : ""}
                  </li>
                ))}
              </ul>
              {byDate.length > 60 && <p className="text-[11px] text-slate-500">and {byDate.length - 60} more.</p>}
              {preview.data.laterRules.map((l) => (
                <p key={l} className="text-[11px] text-slate-600">
                  {l}
                </p>
              ))}
            </div>
          )}
        </StepSection>
      )}
    </>
  );
}
