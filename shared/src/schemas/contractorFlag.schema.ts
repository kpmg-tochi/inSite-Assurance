import { z } from 'zod';

/**
 * Client demo updates F.4 (wave 3): contractor performance flags and decided actions. A flag is
 * raised (job, and when a monitoring report is accepted) when the tenant's flag rule is met on a
 * project: N accepted reports within D days rate workmanship at or below T (defaults 3, 60, 3 of 5;
 * `ContractorPerformanceSettingsSchema.flagRule`). One open flag per contractor and project; later
 * low reports join it as evidence. A person with `contractors:manage` decides actions with a reason.
 *
 * Effects (demo scope): ADDITIONAL_VISITS proposes visits through the visit plan; FORMAL_WARNING is
 * recorded (the letter comes later); PAYMENT_HOLD is in effect at once until lifted (payments banner,
 * a payment recorded during it needs an override reason and is flagged PAID_DURING_HOLD); DEDUCTION,
 * STOP_WORK, REPLACE_CONTRACTOR and SUSPEND_CONTRACTOR are recorded "Sent to Legal review" (their
 * effects come with the default-case chain, follow-ups); NO_FURTHER_ACTION closes the flag.
 */

export const ContractorFlagStatusEnum = z.enum(['OPEN', 'CLOSED']);
export type ContractorFlagStatus = z.infer<typeof ContractorFlagStatusEnum>;

export const ContractorFlagActionKindEnum = z.enum([
  'ADDITIONAL_VISITS',
  'FORMAL_WARNING',
  'PAYMENT_HOLD',
  'DEDUCTION',
  'STOP_WORK',
  'REPLACE_CONTRACTOR',
  'SUSPEND_CONTRACTOR',
  'NO_FURTHER_ACTION',
]);
export type ContractorFlagActionKind = z.infer<typeof ContractorFlagActionKindEnum>;

export const ContractorFlagActionStatusEnum = z.enum(['RECORDED', 'IN_EFFECT', 'SENT_TO_LEGAL_REVIEW', 'LIFTED']);
export type ContractorFlagActionStatus = z.infer<typeof ContractorFlagActionStatusEnum>;

export const CONTRACTOR_FLAG_ACTION_STATUS_LABELS: Record<ContractorFlagActionStatus, string> = {
  RECORDED: 'Recorded',
  IN_EFFECT: 'In effect',
  SENT_TO_LEGAL_REVIEW: 'Sent to Legal review',
  LIFTED: 'Lifted',
};

export interface ContractorFlagActionMeta {
  label: string;
  description: string;
  /** The status the action takes when decided. */
  initialStatus: ContractorFlagActionStatus;
  /** Deciding it closes the flag. */
  closesFlag: boolean;
}

export const CONTRACTOR_FLAG_ACTION_META: Record<ContractorFlagActionKind, ContractorFlagActionMeta> = {
  ADDITIONAL_VISITS: {
    label: 'Schedule additional monitoring visits',
    description: 'Proposes extra monitoring visits on the project for the monitoring planner to publish.',
    initialStatus: 'RECORDED',
    closesFlag: false,
  },
  FORMAL_WARNING: {
    label: 'Formal warning',
    description: 'Records a formal warning to the contractor; the warning letter follows.',
    initialStatus: 'RECORDED',
    closesFlag: false,
  },
  PAYMENT_HOLD: {
    label: 'Payment hold',
    description: 'Finance sees a payment hold on the project; a payment recorded during it needs a reason and is flagged.',
    initialStatus: 'IN_EFFECT',
    closesFlag: false,
  },
  DEDUCTION: {
    label: 'Deduction (e.g. liquidated damages)',
    description: 'Needs a contractual basis: sent to Legal review, then the Executive Secretary or SUBEB Executive Chairman.',
    initialStatus: 'SENT_TO_LEGAL_REVIEW',
    closesFlag: false,
  },
  STOP_WORK: {
    label: 'Stop-work order',
    description: 'Sent to Legal review, then the Executive Secretary or SUBEB Executive Chairman.',
    initialStatus: 'SENT_TO_LEGAL_REVIEW',
    closesFlag: false,
  },
  REPLACE_CONTRACTOR: {
    label: 'Replace the contractor',
    description: 'Termination and a new engagement for the remaining scope: sent to Legal review first.',
    initialStatus: 'SENT_TO_LEGAL_REVIEW',
    closesFlag: false,
  },
  SUSPEND_CONTRACTOR: {
    label: 'Suspend the contractor',
    description: 'No new projects for the contractor: sent to Legal review, then the Executive Secretary.',
    initialStatus: 'SENT_TO_LEGAL_REVIEW',
    closesFlag: false,
  },
  NO_FURTHER_ACTION: {
    label: 'No further action',
    description: 'Closes the flag with the reason.',
    initialStatus: 'RECORDED',
    closesFlag: true,
  },
};

export const ContractorFlagEvidenceSchema = z.object({
  visitSubmissionId: z.string().uuid(),
  visitId: z.string().uuid(),
  /** The monitoring visit date (YYYY-MM-DD). */
  date: z.string(),
  workmanship: z.number(),
  /** "Routine monitoring visit of 12 Nov 2026". */
  label: z.string(),
});
export type ContractorFlagEvidence = z.infer<typeof ContractorFlagEvidenceSchema>;

export const ContractorFlagActionDtoSchema = z.object({
  id: z.string().uuid(),
  kind: ContractorFlagActionKindEnum,
  status: ContractorFlagActionStatusEnum,
  reason: z.string(),
  params: z.record(z.unknown()),
  decidedByName: z.string(),
  decidedAt: z.string(),
  liftedAt: z.string().nullable(),
  liftedByName: z.string().nullable(),
  liftReason: z.string().nullable(),
  /** ADDITIONAL_VISITS: the visits it proposed. */
  visitIds: z.array(z.string().uuid()),
});
export type ContractorFlagActionDto = z.infer<typeof ContractorFlagActionDtoSchema>;

export const ContractorFlagDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  contractorName: z.string(),
  projectId: z.string().uuid(),
  projectCode: z.string(),
  projectName: z.string(),
  interventionYear: z.number().int().nullable(),
  status: ContractorFlagStatusEnum,
  raisedAt: z.string(),
  /** The rule as it was when raised. */
  rule: z.object({ reportCount: z.number().int(), workmanshipAtOrBelow: z.number(), withinDays: z.number().int() }),
  /** "3 monitoring reports rated workmanship 3 or below in 60 days". */
  summary: z.string(),
  evidence: z.array(ContractorFlagEvidenceSchema),
  actions: z.array(ContractorFlagActionDtoSchema),
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
  closeReason: z.string().nullable(),
  canDecide: z.boolean(),
});
export type ContractorFlagDto = z.infer<typeof ContractorFlagDtoSchema>;

/** GET /api/v1/contractor-flags?status=&projectId=&organizationId= */
export const ContractorFlagListQuerySchema = z.object({
  status: ContractorFlagStatusEnum.optional(),
  projectId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
});
export type ContractorFlagListQuery = z.infer<typeof ContractorFlagListQuerySchema>;

/** POST /api/v1/contractor-flags/:id/actions (`contractors:manage`). */
export const DecideContractorFlagActionRequestSchema = z
  .object({
    kind: ContractorFlagActionKindEnum,
    reason: z.string().trim().min(5, 'Say why').max(1000),
    /** ADDITIONAL_VISITS: how many (1–10), which kind, who (optional; default the project's visit officers). */
    visitCount: z.number().int().min(1).max(10).optional(),
    visitKind: z.string().trim().max(40).optional(),
    officerUserId: z.string().uuid().optional(),
    /** DEDUCTION: the amount and the contract clause, for Legal review. */
    deductionAmountNgn: z.number().positive().max(1e13).optional(),
    clause: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'ADDITIONAL_VISITS' && !v.visitCount) {
      ctx.addIssue({ code: 'custom', path: ['visitCount'], message: 'How many extra monitoring visits?' });
    }
  });
export type DecideContractorFlagActionRequest = z.infer<typeof DecideContractorFlagActionRequestSchema>;

/** POST /api/v1/contractor-flags/:flagId/actions/:actionId/lift (a payment hold; `contractors:manage`). */
export const LiftContractorFlagActionRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Say why').max(1000),
});
export type LiftContractorFlagActionRequest = z.infer<typeof LiftContractorFlagActionRequestSchema>;

/** On the project's payments summary: a payment hold in effect on its contractor. */
export const ProjectPaymentHoldDtoSchema = z.object({
  flagId: z.string().uuid(),
  actionId: z.string().uuid(),
  since: z.string(),
  reason: z.string(),
  decidedByName: z.string(),
});
export type ProjectPaymentHoldDto = z.infer<typeof ProjectPaymentHoldDtoSchema>;

// ---------------------------------------------------------------------------
// Pure rule
// ---------------------------------------------------------------------------

export interface FlagRuleReport {
  visitSubmissionId: string;
  visitId: string;
  date: string;
  workmanship: number;
  label: string;
}

export interface FlagRule {
  enabled: boolean;
  reportCount: number;
  workmanshipAtOrBelow: number;
  withinDays: number;
}

/**
 * Whether the flag rule is met on `today` for one contractor on one project: at least
 * `reportCount` accepted reports dated within the last `withinDays` days rated workmanship at or
 * below the threshold. Returns the qualifying reports (newest first) as evidence.
 */
export function contractorFlagDue(
  reports: FlagRuleReport[],
  rule: FlagRule,
  today: string
): { due: boolean; evidence: FlagRuleReport[] } {
  if (!rule.enabled) return { due: false, evidence: [] };
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const evidence = reports
    .filter((r) => {
      const age = (todayMs - Date.parse(`${r.date}T00:00:00Z`)) / 86_400_000;
      return age >= 0 && age <= rule.withinDays && r.workmanship <= rule.workmanshipAtOrBelow;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return { due: evidence.length >= rule.reportCount, evidence };
}

export function contractorFlagSummary(rule: { reportCount: number; workmanshipAtOrBelow: number; withinDays: number }, evidenceCount: number): string {
  return `${evidenceCount} monitoring report${evidenceCount === 1 ? '' : 's'} rated workmanship ${rule.workmanshipAtOrBelow} or below in ${rule.withinDays} days (rule: ${rule.reportCount})`;
}
