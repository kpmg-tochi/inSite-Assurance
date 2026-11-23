import type React from "react";
import { PROJECT_SETUP_STEPS, type ProjectSetupStepDefinition } from "@insite/shared";
import type { StepProps } from "./setupContext";
import { BasicsStep } from "./steps/BasicsStep";
import { PartiesStep } from "./steps/PartiesStep";
import { ContractStep } from "./steps/ContractStep";
import { SiteStep } from "./steps/SiteStep";
import { FacilityStep } from "./steps/FacilityStep";
import { BoqStep } from "./steps/BoqStep";
import { ScheduleStep } from "./steps/ScheduleStep";
import { ReportingStep } from "./steps/ReportingStep";
import { ProcessStep } from "./steps/ProcessStep";
import { StandardsStep } from "./steps/StandardsStep";
import { TeamStep } from "./steps/TeamStep";
import { ReviewStep } from "./steps/ReviewStep";

/**
 * The wizard's step list. Definitions (id, title, route, required flag, order) come from
 * `PROJECT_SETUP_STEPS` in @insite/shared, which the server validates against; this maps each id to
 * its page. A later phase adds a step by adding a shared definition, a server saver and an entry
 * here; the shell does not change.
 */
export interface RegisteredStep extends ProjectSetupStepDefinition {
  component: React.ComponentType<StepProps>;
}

const COMPONENTS: Record<string, React.ComponentType<StepProps>> = {
  basics: BasicsStep,
  parties: PartiesStep,
  contract: ContractStep,
  site: SiteStep,
  facility: FacilityStep,
  boq: BoqStep,
  schedule: ScheduleStep,
  reporting: ReportingStep,
  process: ProcessStep,
  standards: StandardsStep,
  team: TeamStep,
  review: ReviewStep,
};

export function visibleSteps(): RegisteredStep[] {
  return [...PROJECT_SETUP_STEPS]
    .filter((s) => COMPONENTS[s.id])
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ ...s, component: COMPONENTS[s.id] }));
}

export function findStep(route: string | undefined): RegisteredStep | undefined {
  return visibleSteps().find((s) => s.route === route);
}
