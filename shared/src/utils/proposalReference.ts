import { stateByCode } from '../data/nigeriaAdminAreas';
import type { NeedsReferencePrefix } from '../schemas/needsPipeline.schema';

/**
 * Needs pipeline N1 (D-N.15): the reference of a proposed project, shown everywhere.
 * Direct Intervention `<year>-DI-<nnn>` ("2027-DI-014"); Matching Grants `<year>-MG-<state>-<nnn>`
 * ("2027-MG-KN-007"). The year is the intervention year; the number runs per cycle, at least three
 * digits. A converted Direct Intervention draft keeps the reference as its code until Procurement
 * assigns a lot (wave 4 widens `PROJECT_CODE_PREFIX_REGEX` for it).
 */

export const PROPOSAL_REFERENCE_REGEX = /^(\d{4})-(DI|MG)(?:-([A-Z]{2}))?-(\d{3,})$/;

export interface ProposalReferenceParts {
  interventionYear: number;
  prefix: NeedsReferencePrefix;
  /** Matching Grants only. */
  stateCode: string | null;
  sequence: number;
}

export function formatProposalReference(parts: ProposalReferenceParts): string {
  const sequence = String(parts.sequence).padStart(3, '0');
  if (parts.prefix === 'MG') {
    const state = (parts.stateCode ?? '').trim().toUpperCase();
    if (!stateByCode(state)) throw new Error('A Matching Grants reference needs a State code');
    return `${parts.interventionYear}-MG-${state}-${sequence}`;
  }
  return `${parts.interventionYear}-DI-${sequence}`;
}

/** The parts of a reference; null when the text is not one (case and outer spaces are ignored). */
export function parseProposalReference(text: string | null | undefined): ProposalReferenceParts | null {
  const m = PROPOSAL_REFERENCE_REGEX.exec(String(text ?? '').trim().toUpperCase());
  if (!m) return null;
  const prefix = m[2] as NeedsReferencePrefix;
  const stateCode = m[3] ?? null;
  // A State belongs to Matching Grants references only, and must be a real one.
  if (prefix === 'MG' ? !stateByCode(stateCode) : stateCode !== null) return null;
  const sequence = Number(m[4]);
  if (sequence < 1) return null;
  return { interventionYear: Number(m[1]), prefix, stateCode, sequence };
}
