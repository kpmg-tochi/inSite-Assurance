import type {
  ConstructionPhase,
  ContractorExecutionMode,
  FieldPersonaType,
  GeofenceMode,
  ProjectDeliveryModelFields,
  ProjectGeofence,
  ProjectStatus,
  ReportingCadence,
  ScheduleVarianceBadge,
} from '@insite/shared';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** GET /projects and /projects/:id/baseline. Drafts are not in this list (see /projects/drafts). */
/** Phase 11: carries projectType, region, owningOrganization and primaryBeneficiary. */
export interface ProjectSummaryDto extends ProjectDeliveryModelFields {
  id: string;
  tenantId: string;
  status: ProjectStatus;
  /** Phase 10: where an active project is in its life. */
  constructionPhase: ConstructionPhase;
  practicalCompletionDate: string | null;
  retentionEndDate: string | null;
  /** Phase 10: percentage withheld from each release (applies only with the retention module on). */
  retentionPercentage: number | null;
  name: string;
  codePrefix: string;
  stateLocation: string;
  lgaLocation: string | null;
  description: string | null;
  totalBudgetNgn: number;
  disbursedToDateNgn: number;
  certifiedProgressPct: number;
  reportingCadence: ReportingCadence;
  workdayStartTime: string;
  workdayEndTime: string;
  /** IANA zone of the project's reporting day. */
  timezone: string;
  geofenceMode: GeofenceMode | null;
  geofence: ProjectGeofence | null;
  /** Effective tolerance band outside the boundary, in metres. */
  geofenceToleranceMeters: number;
  /** Phase 9: variance badge stored by the schedule-variance job; null until computed. */
  scheduleVariance: ScheduleVarianceBadge | null;
  monitorOrganizationName: string;
  lenderOrganizationName: string;
  /** Main contractor (or the only one). Use contractorCount for "+N". */
  contractorOrganizationName: string;
  contractorCount: number;
  contractorExecutionMode: ContractorExecutionMode | null;
  contractors: Array<{
    id: string;
    organizationId: string;
    organizationName: string;
    tradeCategory: string;
    tradeCode: string;
    isMainContractor: boolean;
    allowFieldReporting: boolean;
  }>;
  activatedAt: string | null;
  archivedAt: string | null;
  /** Phase 13: contract milestones past their due date (absent from servers before Phase 13). */
  overdueMilestoneCount?: number;
  totalBoqItems: number;
  opaqueLumpSumCount: number;
  lastFieldCaptureAt: string | null;
  joinCodes: Array<{
    id: string;
    code: string;
    roleId: string;
    roleCode: string;
    roleName: string;
    fieldPersonaType: FieldPersonaType;
    assuranceWeight: number;
    requiresIdentityAssurance: boolean;
    projectContractorId?: string | null;
    contractorName?: string | null;
    tradeCode?: string | null;
    isActive: boolean;
  }>;
}

export interface BoqItemRecordDto {
  id: string;
  projectId: string;
  projectContractorId?: string | null;
  lastRevisionId?: string | null;
  wbsCode: string;
  section: string;
  description: string;
  unit: string;
  totalQuantity: number;
  rateNgn: number;
  budgetedCostNgn: number;
  isHoldPoint: boolean;
  holdPointInstruction: string | null;
  isOpaqueLumpSum: boolean;
  opacityWarningReason: string | null;
  cumulativeCertifiedPct: number;
}

/** Server contract for GET /projects/:projectId/evidence (Phase 4). */
export type { CaptureListItemDto } from "@insite/shared";

export interface AuditTrailResponseDto {
  tenantId?: string;
  projectId: string | null;
  chainIntegrityVerified: boolean;
  totalEntries: number;
  brokenAtEntryId: string | null;
  latestHash: string | null;
  entries: Array<{
    id: string;
    tenantId: string;
    projectId: string | null;
    seq: number;
    actorType: string;
    actorId: string;
    actorDisplayName: string;
    action: string;
    summaryText: string;
    payload: Record<string, unknown>;
    previousHash: string;
    entryHash: string;
    createdAt: string;
  }>;
}

export type {
  ContractorVerificationRecordDto,
  ReviewContractorVerificationRequest,
  PortfolioExecutiveSummaryDto,
  PortfolioProjectHealthItem,
  PermissionDto,
  RoleDto,
  TenantDto,
  TenantUserDto,
  FieldSessionRosterDto,
} from '@insite/shared';
