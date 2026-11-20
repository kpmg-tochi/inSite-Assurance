import {
  credentialFieldRules,
  DEFAULT_REGISTRATION_BODIES,
  type CredentialFieldRules,
  type CredentialRequirement,
  type MobileBaselinePack,
  type RegistrationBodyOption,
} from '@insite/shared';

/**
 * Phase 12: what the identity assurance step asks about professional registration on a project.
 * The project's resolved fieldAssurance policy comes in the baseline pack; a pack saved before
 * Phase 12 has none, so the step behaves as before (required, default bodies). The server enforces
 * the same rule, so this decides only what is shown.
 */
export interface AssuranceRegistrationSetup {
  requirement: CredentialRequirement;
  rules: CredentialFieldRules;
  bodies: RegistrationBodyOption[];
}

export function assuranceRegistrationSetup(pack: Pick<MobileBaselinePack, 'fieldAssurance'> | null | undefined): AssuranceRegistrationSetup {
  const requirement = pack?.fieldAssurance?.registration ?? 'REQUIRED';
  const bodies =
    pack?.fieldAssurance?.registrationBodies ??
    DEFAULT_REGISTRATION_BODIES.map((b) => ({ code: b.code, fullName: b.fullName, displayPrefix: b.displayPrefix, exampleNumber: b.exampleNumber }));
  return { requirement, rules: credentialFieldRules(requirement, 'fieldAssurance'), bodies };
}

/** A message for the person when the entry cannot be accepted, or null. */
export function assuranceRegistrationError(rules: CredentialFieldRules, input: { number: string; bodyCode: string | null }): string | null {
  if (!rules.visible) return null;
  const number = input.number.trim();
  if (rules.required && !number) return 'Enter your professional registration number.';
  if (number && number.length < 2) return 'The registration number looks too short.';
  if (number && !input.bodyCode) return 'Choose the body that issued your registration.';
  return null;
}

/**
 * The registration fields sent with the submission: nothing when hidden or left empty (an optional
 * number), never a display string.
 */
export function assuranceRegistrationFields(
  rules: CredentialFieldRules,
  input: { number: string; bodyCode: string | null }
): { registrationNumber?: string; registrationBodyCode?: string } {
  const number = input.number.trim();
  if (!rules.visible || !number) return {};
  return { registrationNumber: number, ...(input.bodyCode ? { registrationBodyCode: input.bodyCode } : {}) };
}
