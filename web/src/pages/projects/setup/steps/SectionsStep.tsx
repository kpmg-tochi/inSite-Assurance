import React from "react";
import { AlertTriangle, Info } from "lucide-react";
import type { ProjectSetupSectionId, ProjectSetupStepDefinition } from "@insite/shared";
import type { StepProps } from "../setupContext";
import { SECTION_COMPONENTS } from "../sectionRegistry";

export interface WizardStepProps extends StepProps {
  step: ProjectSetupStepDefinition;
}

/**
 * A wizard step page (redesign R6a, D-R6.2): the step's sections in order, each rendered with
 * `id="section-<id>"` so links (Review "Fix", old step URLs) can scroll to it. Sections the server
 * leaves out for this project (e.g. standards with both document modes off) are not shown.
 *
 * Steps: 1 Project = basics, parties, site; 2 Contract = contractor, contract, facility; 3 Scope &
 * sprints = scope, standards; 4 Team & visits = team, visits; Advanced = process.
 */
export function SectionsStep({ step, ...props }: WizardStepProps) {
  const { setup } = props;
  const visible = step.sectionIds.filter((id) => setup.steps.some((s) => s.stepId === id));
  return (
    <div className="space-y-8">
      {visible.map((id) => (
        <SectionBlock key={id} sectionId={id} {...props} />
      ))}
    </div>
  );
}

function SectionBlock({ sectionId, ...props }: StepProps & { sectionId: ProjectSetupSectionId }) {
  const Component = SECTION_COMPONENTS[sectionId];
  const status = props.setup.steps.find((s) => s.stepId === sectionId);
  // Server issues are shown once the section was saved (fresh drafts would only repeat "not saved");
  // scope and standards list their own.
  const issues =
    status && status.saved && sectionId !== "scope" && sectionId !== "standards"
      ? status.issues.filter((i) => i.code !== "STEP_NOT_SAVED")
      : [];
  const warnings = status?.warnings ?? [];
  return (
    <div id={`section-${sectionId}`} tabIndex={-1} className="scroll-mt-6 space-y-3 focus:outline-none" aria-label={status?.title}>
      {issues.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <ul className="space-y-0.5">
            {issues.map((i, n) => (
              <li key={`${i.code}-${n}`}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div role="note" className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <ul className="space-y-0.5">
            {warnings.map((w, n) => (
              <li key={`${w.code}-${n}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
      <Component {...props} />
    </div>
  );
}
