import { z } from 'zod';
import { ProjectTypeSupervisionConfigSchema } from './inspection.schema';
import { ProjectTypePaymentsConfigSchema } from './payment.schema';
import {
  ContractMilestoneTemplateListSchema,
  ProjectTypeDefaultCasesConfigSchema,
  ProjectTypeDocumentRequirementsSchema,
  ProjectTypeKickoffConfigSchema,
} from './contract.schema';
import { ProjectTypeClosureConfigSchema } from './closure.schema';
import { ProjectTypeKpiTargetsSchema } from './kpi.schema';
import { ProjectTypeVisitFormsConfigSchema } from './form.schema';
import { ProjectTypeMonitoringConfigSchema } from './visit.schema';

/**
 * Project types (Phase 11): a delivery model ("Central Delivery Model", "Co-Funded Delivery
 * Model"). A type references a workflow template (process switches and approval chains) and holds
 * everything else in its own config. Applying a type to a draft writes a snapshot of the config on
 * the project, so later edits to the type affect new projects only.
 *
 * Every key of the config is optional with a default, so a type saved now stays valid when later
 * phases add keys. Reserved keys are filled by Phases 12–16.
 */

const Uuid = z.string().uuid();

export const ProjectTypeOwnershipConfigSchema = z
  .object({
    owningOrganizationRequired: z.boolean().default(false),
    /** null: any organisation of the tenant may own a project of this type. */
    allowedOwningOrganizationIds: z.array(Uuid).max(200).nullable().default(null),
    defaultOwningOrganizationId: Uuid.nullable().default(null),
  })
  .refine(
    (v) =>
      !v.defaultOwningOrganizationId ||
      !v.allowedOwningOrganizationIds ||
      v.allowedOwningOrganizationIds.includes(v.defaultOwningOrganizationId),
    { message: 'The default owner must be one of the allowed owners', path: ['defaultOwningOrganizationId'] }
  );
export type ProjectTypeOwnershipConfig = z.infer<typeof ProjectTypeOwnershipConfigSchema>;

/**
 * How the funding organisation is pre-filled when the Parties step leaves it empty:
 * NONE (no default), OWNER (the owning organisation funds the project, e.g. Co-Funded), FIXED
 * (`defaultFunderOrganizationId`, e.g. the flagship for Central delivery).
 */
export const ProjectTypeFunderDefaultEnum = z.enum(['NONE', 'OWNER', 'FIXED']);
export type ProjectTypeFunderDefault = z.infer<typeof ProjectTypeFunderDefaultEnum>;

export const ProjectTypePartiesConfigSchema = z
  .object({
    monitorRequired: z.boolean().default(true),
    funderRequired: z.boolean().default(true),
    beneficiaryRequired: z.boolean().default(false),
    regionRequired: z.boolean().default(false),
    funderDefault: ProjectTypeFunderDefaultEnum.default('NONE'),
    defaultFunderOrganizationId: Uuid.nullable().default(null),
  })
  .refine((v) => v.funderDefault !== 'FIXED' || Boolean(v.defaultFunderOrganizationId), {
    message: 'Choose the default funding organisation',
    path: ['defaultFunderOrganizationId'],
  });
export type ProjectTypePartiesConfig = z.infer<typeof ProjectTypePartiesConfigSchema>;

export const ProjectTypeConfigSchema = z.object({
  ownership: ProjectTypeOwnershipConfigSchema.default({}),
  parties: ProjectTypePartiesConfigSchema.default({}),
  // Reserved, filled by later phases (kept as-is until then).
  /** Redesign R1b: retention defaults for new projects (payments are recorded, not made, here). */
  payments: ProjectTypePaymentsConfigSchema,
  /** Phase 13: dated obligations created on the project when the type is applied. */
  contractMilestones: ContractMilestoneTemplateListSchema.default([]),
  /** Phase 13: documents needed before activation and before mobilisation. */
  documentRequirements: ProjectTypeDocumentRequirementsSchema.default({}),
  /** Phase 13: kick-off quorum groups and notice lead time. */
  kickoff: ProjectTypeKickoffConfigSchema.default({}),
  /** Phase 13: contractor default cases (Legal role, automatic opening). */
  defaultCases: ProjectTypeDefaultCasesConfigSchema.default({}),
  /** Phase 14: who counts as a supervisor and the workload warning thresholds. */
  supervision: ProjectTypeSupervisionConfigSchema.default({}),
  /** Phase 15: Certificate of Completion signatories and gates, closure checklists, ratings sharing. */
  closure: ProjectTypeClosureConfigSchema.default({}),
  /** Phase 16: KPI targets and which KPIs are shown (catalogue defaults for missing keys). */
  kpiTargets: ProjectTypeKpiTargetsSchema.default({}),
  /** Redesign R3: visit form template code per visit kind (form library). */
  visitForms: ProjectTypeVisitFormsConfigSchema.default({}),
  /** Redesign R4: the visit plan, deadlines, escalation and the contractor findings email. */
  monitoring: ProjectTypeMonitoringConfigSchema.default({}),
});
export type ProjectTypeConfig = z.infer<typeof ProjectTypeConfigSchema>;
export type ProjectTypeConfigInput = z.input<typeof ProjectTypeConfigSchema>;

export const PROJECT_TYPE_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,31}$/;
export const PROJECT_TYPE_COLOUR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const SaveProjectTypeRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PROJECT_TYPE_CODE_REGEX, 'Code: 2 to 32 capital letters, digits or underscores, e.g. CENTRAL'),
  name: z.string().trim().min(3, 'Enter at least 3 characters').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  colour: z.string().trim().regex(PROJECT_TYPE_COLOUR_REGEX, 'Use a hex colour, e.g. #6546FC').nullable().optional(),
  workflowTemplateId: Uuid,
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  config: ProjectTypeConfigSchema,
});
export type SaveProjectTypeRequest = z.infer<typeof SaveProjectTypeRequestSchema>;
export type SaveProjectTypeRequestInput = z.input<typeof SaveProjectTypeRequestSchema>;

export const ProjectTypeDtoSchema = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  colour: z.string().nullable(),
  workflowTemplateId: Uuid,
  workflowTemplateName: z.string().nullable(),
  config: ProjectTypeConfigSchema,
  version: z.number().int(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  projectCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectTypeDto = z.infer<typeof ProjectTypeDtoSchema>;

/** What `Project.projectTypeSnapshotJson` holds: the type as it was when applied. */
export const ProjectTypeSnapshotSchema = z.object({
  projectTypeId: Uuid,
  code: z.string(),
  name: z.string(),
  colour: z.string().nullable(),
  version: z.number().int(),
  workflowTemplateId: Uuid.nullable(),
  config: ProjectTypeConfigSchema,
  appliedAt: z.string(),
});
export type ProjectTypeSnapshot = z.infer<typeof ProjectTypeSnapshotSchema>;

/**
 * The config a project runs on: its snapshot's config, or null for a project without a type
 * (today's behaviour everywhere). A snapshot that no longer parses falls back to the defaults.
 */
export function resolveProjectTypeConfig(snapshot: unknown): ProjectTypeConfig | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const parsed = ProjectTypeConfigSchema.safeParse((snapshot as Record<string, unknown>).config ?? {});
  return parsed.success ? parsed.data : ProjectTypeConfigSchema.parse({});
}

/** The party rules for a project: the type's, or today's rules (monitor and funder required). */
export function partyRulesFor(config: ProjectTypeConfig | null): ProjectTypePartiesConfig & { owningOrganizationRequired: boolean } {
  const parties = config?.parties ?? ProjectTypePartiesConfigSchema.parse({});
  return { ...parties, owningOrganizationRequired: config?.ownership.owningOrganizationRequired ?? false };
}
