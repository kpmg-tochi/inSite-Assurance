import { z } from 'zod';
import { DisbursementMechanismEnum, type DisbursementMechanism } from '../enums';

/**
 * Payment milestones (Phase 12, decision K). A tranche (shown as "payment milestone" through
 * terminology) pays either MEASURED value (verified % × item budget, today) or a FIXED amount once
 * its completion rule is met. Fixed basis works with direct milestone verification only (D-12.2).
 */

export const TranchePaymentBasisEnum = z.enum(['MEASURED', 'FIXED_ON_COMPLETION']);
export type TranchePaymentBasis = z.infer<typeof TranchePaymentBasisEnum>;

/** Phase 13 adds CONTRACT_MILESTONE_DONE. */
export const TrancheCompletionRuleEnum = z.enum(['ALL_ITEMS_COMPLETE', 'WEIGHTED_PROGRESS_REACHED']);
export type TrancheCompletionRule = z.infer<typeof TrancheCompletionRuleEnum>;

export const TRANCHE_PAYMENT_BASIS_META: Record<TranchePaymentBasis, { label: string; description: string }> = {
  MEASURED: {
    label: 'Measured value',
    description: 'Pays the verified percentage of each item times its budget, as progress is verified.',
  },
  FIXED_ON_COMPLETION: {
    label: 'Fixed amount on completion',
    description: 'Pays a fixed amount once the completion rule is verified. Nothing is paid before that.',
  },
};

export const TRANCHE_COMPLETION_RULE_META: Record<TrancheCompletionRule, { label: string; description: string }> = {
  ALL_ITEMS_COMPLETE: {
    label: 'All items complete',
    description: 'Every item mapped to it is verified at or above the required percentage (100% by default).',
  },
  WEIGHTED_PROGRESS_REACHED: {
    label: 'Weighted progress reached',
    description: 'Budget-weighted verified progress of its items reaches the target completion percentage.',
  },
};

export const DEFAULT_COMPLETION_RULE: TrancheCompletionRule = 'ALL_ITEMS_COMPLETE';
export const DEFAULT_REQUIRED_ITEM_PCT = 100;

/** Message when the fixed basis is combined with contractor IPC claims, or null when compatible. */
export function paymentBasisMechanismConflict(
  mechanism: DisbursementMechanism | null | undefined,
  basis: TranchePaymentBasis | null | undefined
): string | null {
  if (basis === 'FIXED_ON_COMPLETION' && mechanism === 'IPC_CLAIM_REQUIRED') {
    return 'Fixed-amount payment milestones work with direct milestone verification only, not with contractor IPC claims.';
  }
  return null;
}

/** `ProjectTypeConfig.payments`: defaults for new payment milestones of a project of this type. */
export const ProjectTypePaymentsConfigSchema = z
  .object({
    defaultBasis: TranchePaymentBasisEnum.default('MEASURED'),
    /** Used with the fixed basis; null = ALL_ITEMS_COMPLETE. */
    defaultCompletionRule: TrancheCompletionRuleEnum.nullable().default(null),
    /** The disbursement mechanism the type expects (informational, checked against the basis). */
    mechanism: DisbursementMechanismEnum.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const conflict = paymentBasisMechanismConflict(v.mechanism, v.defaultBasis);
    if (conflict) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultBasis'], message: conflict });
  });
export type ProjectTypePaymentsConfig = z.infer<typeof ProjectTypePaymentsConfigSchema>;

/** Payment fields on a tranche of the Facility step. Omitted on an existing tranche = unchanged. */
export const TranchePaymentInputSchema = z.object({
  paymentBasis: TranchePaymentBasisEnum.optional(),
  completionRule: TrancheCompletionRuleEnum.nullable().optional(),
  /** Fixed basis: the amount paid on completion; null = the allocated amount. */
  fixedReleaseAmountNgn: z.number().positive().nullable().optional(),
  /** ALL_ITEMS_COMPLETE: the percentage every mapped item must reach (default 100). */
  completionRequiredItemPct: z.number().min(1).max(100).optional(),
});
export type TranchePaymentInput = z.infer<typeof TranchePaymentInputSchema>;

// ---------------------------------------------------------------------------
// Completion and amount maths (pure; the server is the only caller that decides)
// ---------------------------------------------------------------------------

export interface MilestoneCompletionItem {
  boqItemId: string;
  wbsCode: string;
  budgetedCostNgn: number;
  /** Cumulative verified percentage after this verification. */
  verifiedCumulativePct: number;
}

export interface MilestoneCompletionResult {
  met: boolean;
  /** Budget-weighted verified progress of the items, 0–100, two decimals. */
  weightedProgressPct: number;
  /** Items below the required percentage (ALL_ITEMS_COMPLETE). */
  itemsBelowRequired: string[];
  unmetReasons: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateMilestoneCompletion(params: {
  rule: TrancheCompletionRule | null | undefined;
  requiredItemPct?: number | null;
  targetCompletionPct: number;
  items: MilestoneCompletionItem[];
}): MilestoneCompletionResult {
  const rule = params.rule ?? DEFAULT_COMPLETION_RULE;
  const items = params.items;
  const budget = items.reduce((s, i) => s + Math.max(0, i.budgetedCostNgn), 0);
  const weighted =
    budget > 0
      ? items.reduce((s, i) => s + Math.max(0, i.budgetedCostNgn) * Math.min(100, Math.max(0, i.verifiedCumulativePct)), 0) / budget
      : 0;
  const weightedProgressPct = round2(weighted);
  if (items.length === 0) {
    return { met: false, weightedProgressPct: 0, itemsBelowRequired: [], unmetReasons: ['No bill of quantities items are mapped to this payment milestone.'] };
  }
  if (rule === 'ALL_ITEMS_COMPLETE') {
    const required = params.requiredItemPct ?? DEFAULT_REQUIRED_ITEM_PCT;
    const below = items.filter((i) => i.verifiedCumulativePct + 1e-9 < required);
    return {
      met: below.length === 0,
      weightedProgressPct,
      itemsBelowRequired: below.map((i) => i.wbsCode),
      unmetReasons: below.map((i) => `${i.wbsCode} is verified at ${round2(i.verifiedCumulativePct)}%, below the required ${required}%.`),
    };
  }
  const target = params.targetCompletionPct;
  const met = weightedProgressPct + 1e-9 >= target;
  return {
    met,
    weightedProgressPct,
    itemsBelowRequired: [],
    unmetReasons: met ? [] : [`Weighted verified progress is ${weightedProgressPct}%, below the target ${target}%.`],
  };
}

/** The fixed amount still to pay on a tranche: fixed (or allocated) amount less what was released. */
export function fixedMilestoneDue(t: { fixedReleaseAmountNgn: number | null; allocatedAmountNgn: number; releasedAmountNgn: number }) {
  const fixed = round2(t.fixedReleaseAmountNgn ?? t.allocatedAmountNgn);
  const already = round2(t.releasedAmountNgn);
  return { fixedReleaseAmountNgn: fixed, alreadyReleasedNgn: already, dueNgn: round2(Math.max(0, fixed - already)) };
}

/** Released amount at which a tranche counts as fully released. */
export function trancheReleaseTarget(t: {
  paymentBasis: TranchePaymentBasis | string;
  fixedReleaseAmountNgn: number | null;
  allocatedAmountNgn: number;
}): number {
  return t.paymentBasis === 'FIXED_ON_COMPLETION' ? t.fixedReleaseAmountNgn ?? t.allocatedAmountNgn : t.allocatedAmountNgn;
}

/** Shown on the direct milestone panel, the lender decision and the PDF. */
export const MilestonePaymentTermsSchema = z.object({
  paymentBasis: TranchePaymentBasisEnum,
  completionRule: TrancheCompletionRuleEnum.nullable(),
  completionRequiredItemPct: z.number().nullable(),
  targetCompletionPct: z.number(),
  /** Null for the measured basis. */
  completionMet: z.boolean().nullable(),
  unmetReasons: z.array(z.string()),
  weightedProgressPct: z.number().nullable(),
  fixedReleaseAmountNgn: z.number().nullable(),
  alreadyReleasedNgn: z.number(),
});
export type MilestonePaymentTerms = z.infer<typeof MilestonePaymentTermsSchema>;

export function describeCompletionRule(rule: TrancheCompletionRule | null, requiredItemPct: number | null, targetCompletionPct: number): string {
  if ((rule ?? DEFAULT_COMPLETION_RULE) === 'ALL_ITEMS_COMPLETE') {
    return `Every item verified at ${requiredItemPct ?? DEFAULT_REQUIRED_ITEM_PCT}% or more`;
  }
  return `Weighted verified progress of ${targetCompletionPct}% or more`;
}
