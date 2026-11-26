import React from "react";
import { AlertTriangle, FileSpreadsheet, Info } from "lucide-react";
import {
  NEEDS_ASSESSMENT_FIELD_LABELS,
  type NeedsAssessmentFieldKey,
  type NeedsAssessmentImportState,
  type ProjectSetupSectionId,
  type ProjectSetupStepDefinition,
} from "@insite/shared";
import { formatDateShort } from "../../../../lib/formatters";
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
      {setup.needsAssessmentImport && <NeedsAssessmentNotice state={setup.needsAssessmentImport} sectionIds={visible} />}
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

/** Client demo updates D1 (wave 2): the section that holds each needs assessment field. */
const NEEDS_ASSESSMENT_SECTION: Record<NeedsAssessmentFieldKey, ProjectSetupSectionId> = {
  name: "basics",
  projectTypeId: "basics",
  interventionYear: "basics",
  lot: "basics",
  stateCode: "basics",
  lgaCode: "basics",
  fundingSourceCode: "basics",
  totalBudgetNgn: "basics",
  description: "basics",
  strategicJustification: "basics",
  assumptions: "basics",
  sites: "sites",
  scope: "scope",
};

/** Scrolls to a section of this step and focuses it (as `#section-<id>` links do from other pages). */
function goToSection(e: React.MouseEvent<HTMLAnchorElement>, sectionId: ProjectSetupSectionId) {
  const el = document.getElementById(`section-${sectionId}`);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

/**
 * A draft created from the needs assessment: where it came from and, for this step's sections,
 * the fields still to give ("Needs your input"). Nothing when the draft was started without one.
 */
function NeedsAssessmentNotice({ state, sectionIds }: { state: NeedsAssessmentImportState; sectionIds: ProjectSetupSectionId[] }) {
  const pending = state.needsInput.filter((key) => sectionIds.includes(NEEDS_ASSESSMENT_SECTION[key]));
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-slate-600">
        <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-brand-primary" aria-hidden="true" />
        <span>
          From needs assessment{state.fileName ? <>: <span className="font-semibold text-slate-800">{state.fileName}</span></> : null} ·
          imported {formatDateShort(state.importedAt)}
        </span>
      </p>
      {pending.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="font-semibold">Needs your input</p>
            <p className="mt-0.5">The needs assessment did not give these: fill them in below.</p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {pending.map((key) => {
                const sectionId = NEEDS_ASSESSMENT_SECTION[key];
                return (
                  <li key={key}>
                    <a
                      href={`#section-${sectionId}`}
                      onClick={(e) => goToSection(e, sectionId)}
                      className="font-semibold underline underline-offset-2 hover:text-amber-950"
                    >
                      {NEEDS_ASSESSMENT_FIELD_LABELS[key]}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
