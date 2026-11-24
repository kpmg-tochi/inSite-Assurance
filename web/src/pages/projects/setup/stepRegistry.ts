import type React from "react";
import {
  PROJECT_SETUP_STEPS,
  resolveSetupRoute,
  type ProjectSetupSectionId,
  type ProjectSetupStepDefinition,
} from "@insite/shared";
import { SectionsStep, type WizardStepProps } from "./steps/SectionsStep";
import { ReviewStep } from "./steps/ReviewStep";

/**
 * The setup wizard (redesign R6a, D-R6.2). Wizard steps and the sections on each come from
 * `PROJECT_SETUP_STEPS` / `PROJECT_SETUP_SECTIONS` in @insite/shared, which the server validates
 * against; this file maps each step to its page (sections: `sectionRegistry.ts`). A later slice
 * adds a section by adding a shared definition, a server saver and an entry in the section
 * registry; the shell does not change.
 */

export interface RegisteredStep extends ProjectSetupStepDefinition {
  component: React.ComponentType<WizardStepProps>;
}

const register = (s: ProjectSetupStepDefinition): RegisteredStep => ({
  ...s,
  component: s.id === "review" ? ReviewStep : SectionsStep,
});

/** Numbered steps in order, then the settings-only entries (Advanced). */
export function visibleSteps(): RegisteredStep[] {
  return [...PROJECT_SETUP_STEPS]
    .sort((a, b) => Number(a.settingsOnly) - Number(b.settingsOnly) || a.order - b.order)
    .map(register);
}

/**
 * Resolves a URL segment: a step route, or an old step URL (a section id, D-R6.10) that redirects
 * to the step holding the section with `#section-<id>`.
 */
export function findStep(
  route: string | undefined
): { step: RegisteredStep; sectionId: ProjectSetupSectionId | null; legacy: boolean } | undefined {
  const resolved = resolveSetupRoute(route);
  if (!resolved) return undefined;
  return { step: register(resolved.step), sectionId: resolved.sectionId, legacy: resolved.legacy };
}

