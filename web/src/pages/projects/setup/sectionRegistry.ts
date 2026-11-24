import type React from "react";
import type { ProjectSetupSectionId } from "@insite/shared";
import type { StepProps } from "./setupContext";
import { BasicsSection } from "./sections/BasicsSection";
import { PartiesSection } from "./sections/PartiesSection";
import { SiteSection } from "./sections/SiteSection";
import { ContractorSection } from "./sections/ContractorSection";
import { ContractSection } from "./sections/ContractSection";
import { FacilitySection } from "./sections/FacilitySection";
import { ScopeSection } from "./sections/ScopeSection";
import { StandardsSection } from "./sections/StandardsSection";
import { TeamSection } from "./sections/TeamSection";
import { VisitsSection } from "./sections/VisitsSection";
import { ProcessSection } from "./sections/ProcessSection";

/** Section id → component (redesign R6a). Every section renders inside `id="section-<id>"`. */
export const SECTION_COMPONENTS: Record<ProjectSetupSectionId, React.ComponentType<StepProps>> = {
  basics: BasicsSection,
  parties: PartiesSection,
  site: SiteSection,
  contractor: ContractorSection,
  contract: ContractSection,
  facility: FacilitySection,
  scope: ScopeSection,
  standards: StandardsSection,
  team: TeamSection,
  visits: VisitsSection,
  process: ProcessSection,
};
