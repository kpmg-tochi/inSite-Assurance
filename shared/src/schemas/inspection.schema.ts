import { z } from 'zod';
import { CaptureSummarySchema } from './evidence.schema';

/**
 * Findings and supervision workload. Phase 14's checklist templates, site inspection reports and the
 * mobile inspection pack were deleted in redesign R5f: findings come from visit submissions (R4) and
 * R7 renames them.
 */

const Uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Project type config: supervision (Phase 14 key, kept)
// ---------------------------------------------------------------------------

export const ProjectTypeSupervisionConfigSchema = z.object({
  /** Roles whose holders count as supervisors (by role code). */
  supervisorRoleCodes: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  /** Warn when a supervisor would cover more active sites than this. null = no limit. */
  maxSitesPerSupervisor: z.number().int().min(1).max(500).nullable().default(null),
  /** Warn when a supervisor's sites are further apart than this (km between geofence centres). */
  maxSpreadKm: z.number().min(0.1).max(5000).nullable().default(null),
});
export type ProjectTypeSupervisionConfig = z.infer<typeof ProjectTypeSupervisionConfigSchema>;

// ---------------------------------------------------------------------------
// Findings (raised from visit submissions)
// ---------------------------------------------------------------------------

export const InspectionFindingSeverityEnum = z.enum(['MINOR', 'MAJOR', 'CRITICAL']);
export type InspectionFindingSeverity = z.infer<typeof InspectionFindingSeverityEnum>;
export const InspectionFindingStatusEnum = z.enum(['OPEN', 'RESOLVED', 'DISMISSED']);
export type InspectionFindingStatus = z.infer<typeof InspectionFindingStatusEnum>;

/** A finding raised from a visit submission (redesign R4d). Served by /findings. */
export const InspectionFindingDtoSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  /** The visit date. */
  inspectionVisitDate: z.string(),
  visitId: Uuid.nullable(),
  visitSubmissionId: Uuid.nullable(),
  visitKind: z.string().nullable(),
  facilityId: Uuid.nullable(),
  facilityName: z.string().nullable(),
  facilityUnitId: Uuid.nullable(),
  unitLabel: z.string().nullable(),
  questionKey: z.string().nullable(),
  /** The question as shown. */
  title: z.string(),
  recheckCount: z.number().int(),
  lastRecheckedAt: z.string().nullable(),
  escalatedAt: z.string().nullable(),
  /** The field key of the question. */
  checklistItemKey: z.string(),
  checklistItemLabel: z.string(),
  projectContractorId: Uuid.nullable(),
  contractorName: z.string().nullable(),
  description: z.string(),
  severity: InspectionFindingSeverityEnum,
  status: InspectionFindingStatusEnum,
  resolvedNotes: z.string().nullable(),
  resolutionCaptures: z.array(CaptureSummarySchema),
  raisedByName: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  /** Whether the viewer may resolve or dismiss it (server-computed). */
  canResolve: z.boolean(),
  canDismiss: z.boolean(),
});
export type InspectionFindingDto = z.infer<typeof InspectionFindingDtoSchema>;

export const ResolveInspectionFindingRequestSchema = z
  .object({
    notes: z.string().trim().max(2000).default(''),
    clientCaptureIds: z.array(Uuid).max(20).default([]),
  })
  .refine((v) => v.clientCaptureIds.length > 0 || v.notes.length >= 5, {
    message: 'Add photos of the fix or describe what was done',
    path: ['notes'],
  });
export type ResolveInspectionFindingRequest = z.infer<typeof ResolveInspectionFindingRequestSchema>;

export const DismissInspectionFindingRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Say why the finding is dismissed (at least 5 characters)').max(1000),
});
export type DismissInspectionFindingRequest = z.infer<typeof DismissInspectionFindingRequestSchema>;

// ---------------------------------------------------------------------------
// Supervision workload
// ---------------------------------------------------------------------------

export const SupervisorWorkloadDtoSchema = z.object({
  userId: Uuid,
  fullName: z.string(),
  roleName: z.string(),
  projects: z.array(
    z.object({
      projectId: Uuid,
      name: z.string(),
      codePrefix: z.string(),
      point: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
      /** The planned date of the supervisor's last submitted visit on the project (R5f: visits replaced inspections). */
      lastVisitDate: z.string().nullable(),
    })
  ),
  activeProjectCount: z.number().int(),
  /** Furthest distance between two of the supervisor's project geofence centres (km). */
  spreadKm: z.number().nullable(),
  maxSitesPerSupervisor: z.number().int().nullable(),
  maxSpreadKm: z.number().nullable(),
  overSiteLimit: z.boolean(),
  overSpread: z.boolean(),
});
export type SupervisorWorkloadDto = z.infer<typeof SupervisorWorkloadDtoSchema>;
