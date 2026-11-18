import { z } from 'zod';
import {
  EVIDENCE_RATING_META,
  EvidenceRatingColorToken,
  EvidenceStrengthRating,
  EvidenceStrengthRatingEnum,
  PortfolioHealth,
} from './enums';

/**
 * Tenant-configurable evidence rating labels (decision B). Only the display label and description
 * change; the canonical value, its meaning and its colour are fixed. Storage, AI prompts and API
 * payloads always use the canonical value.
 */
export const RATING_LABEL_MAX_LENGTH = 40;
export const RATING_DESCRIPTION_MAX_LENGTH = 280;

export const EvidenceRatingLabelEntrySchema = z
  .object({
    label: z.string().trim().min(1).max(RATING_LABEL_MAX_LENGTH),
    description: z.string().trim().max(RATING_DESCRIPTION_MAX_LENGTH).default(''),
  })
  .strict();
export type EvidenceRatingLabelEntry = z.infer<typeof EvidenceRatingLabelEntrySchema>;

/** Partial map: a missing key falls back to `EVIDENCE_RATING_META`. Unknown keys are rejected. */
export const EvidenceRatingLabelsSchema = z
  .object({
    SUPPORTED: EvidenceRatingLabelEntrySchema.optional(),
    PARTIALLY_SUPPORTED: EvidenceRatingLabelEntrySchema.optional(),
    UNSUPPORTED: EvidenceRatingLabelEntrySchema.optional(),
    CONTRADICTED: EvidenceRatingLabelEntrySchema.optional(),
  })
  .strict();
export type EvidenceRatingLabels = z.infer<typeof EvidenceRatingLabelsSchema>;

export const UpdateEvidenceRatingLabelsRequestSchema = z.object({
  labels: EvidenceRatingLabelsSchema,
});
export type UpdateEvidenceRatingLabelsRequest = z.infer<
  typeof UpdateEvidenceRatingLabelsRequestSchema
>;

export const ResolvedRatingLabelSchema = z.object({
  rating: EvidenceStrengthRatingEnum,
  label: z.string(),
  description: z.string(),
  colorToken: z.enum(['emerald', 'amber', 'slate', 'rose']),
  /** The fixed default label and meaning, shown read-only beside the tenant's wording. */
  defaultLabel: z.string(),
  defaultDescription: z.string(),
  isCustomized: z.boolean(),
});
export type ResolvedRatingLabel = z.infer<typeof ResolvedRatingLabelSchema>;

export const ResolvedRatingLabelsSchema = z.object({
  SUPPORTED: ResolvedRatingLabelSchema,
  PARTIALLY_SUPPORTED: ResolvedRatingLabelSchema,
  UNSUPPORTED: ResolvedRatingLabelSchema,
  CONTRADICTED: ResolvedRatingLabelSchema,
});
export type ResolvedRatingLabels = z.infer<typeof ResolvedRatingLabelsSchema>;

export const EVIDENCE_RATING_ORDER: EvidenceStrengthRating[] = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED',
  'CONTRADICTED',
];

/** Parses stored tenant JSON leniently: invalid entries are dropped rather than failing a request. */
export function parseEvidenceRatingLabels(raw: unknown): EvidenceRatingLabels {
  if (!raw || typeof raw !== 'object') return {};
  const out: EvidenceRatingLabels = {};
  for (const rating of EVIDENCE_RATING_ORDER) {
    const parsed = EvidenceRatingLabelEntrySchema.safeParse((raw as Record<string, unknown>)[rating]);
    if (parsed.success) out[rating] = parsed.data;
  }
  return out;
}

export function resolveRatingLabels(tenantLabels?: unknown): ResolvedRatingLabels {
  const labels = parseEvidenceRatingLabels(tenantLabels);
  const entry = (rating: EvidenceStrengthRating): ResolvedRatingLabel => {
    const meta = EVIDENCE_RATING_META[rating];
    const custom = labels[rating];
    return {
      rating,
      label: custom?.label || meta.label,
      description: custom?.description || meta.description,
      colorToken: meta.colorToken as EvidenceRatingColorToken,
      defaultLabel: meta.label,
      defaultDescription: meta.description,
      isCustomized: Boolean(custom),
    };
  };
  return {
    SUPPORTED: entry('SUPPORTED'),
    PARTIALLY_SUPPORTED: entry('PARTIALLY_SUPPORTED'),
    UNSUPPORTED: entry('UNSUPPORTED'),
    CONTRADICTED: entry('CONTRADICTED'),
  };
}

// ---------------------------------------------------------------------------
// Derived reconciliation metrics (Phase 3 Step 6). One definition, used by reconciliation,
// the project list and the executive summary.
// ---------------------------------------------------------------------------

export interface RatedLineLike {
  aiEvidenceRating: EvidenceStrengthRating;
  missingHoldPointFlag: boolean;
}

/** Conflict wins over partial: any CONTRADICTED or UNSUPPORTED line marks the project in conflict. */
export function derivePortfolioHealth(lines: RatedLineLike[]): PortfolioHealth {
  if (lines.some((l) => l.aiEvidenceRating === 'CONTRADICTED' || l.aiEvidenceRating === 'UNSUPPORTED')) {
    return 'EVIDENCE_CONFLICT';
  }
  if (lines.length === 0 || lines.some((l) => l.aiEvidenceRating === 'PARTIALLY_SUPPORTED')) {
    return 'EVIDENCE_PARTIAL';
  }
  return 'EVIDENCE_SUPPORTED';
}

/**
 * Open conflicts: lines rated CONTRADICTED or UNSUPPORTED.
 * Unfulfilled hold points: lines whose hold point lacks independent evidence.
 * Both are counted on the project's latest IPC that has not been withdrawn.
 */
export function countReconciliationIssues(lines: RatedLineLike[]): {
  openConflictCount: number;
  unfulfilledHoldPointCount: number;
} {
  return {
    openConflictCount: lines.filter(
      (l) => l.aiEvidenceRating === 'CONTRADICTED' || l.aiEvidenceRating === 'UNSUPPORTED'
    ).length,
    unfulfilledHoldPointCount: lines.filter((l) => l.missingHoldPointFlag).length,
  };
}
