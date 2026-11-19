import type {
  ContractorExecutionMode,
  FieldPersonaType,
  GeofenceMode,
  PortfolioHealth,
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
export interface ProjectSummaryDto {
  id: string;
  tenantId: string;
  status: ProjectStatus;
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
  portfolioHealth: PortfolioHealth;
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
  openConflictCount: number;
  unfulfilledHoldPointCount: number;
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
  tranches: Array<{
    id: string;
    trancheNumber: number;
    name: string;
    allocatedAmountNgn: number;
    releasedAmountNgn: number;
    targetCompletionPct: number;
    isReleased: boolean;
    conditionsPrecedent: Array<{
      id: string;
      referenceCode: string;
      description: string;
      isMandatoryForRelease: boolean;
      status: 'PENDING' | 'SATISFIED' | 'WAIVED' | 'BREACHED';
    }>;
  }>;
}

export interface BoqItemRecordDto {
  id: string;
  projectId: string;
  trancheId: string | null;
  projectContractorId?: string | null;
  lastRevisionId?: string | null;
  aiSuggestedTrancheId: string | null;
  trancheMappingConfirmedByMonitor: boolean;
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
  tranche?: {
    id: string;
    trancheNumber: number;
    name: string;
  } | null;
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

// IPC, query, valuation and decision contracts come from @insite/shared (Phase 3).
export type {
  IpcClaimDto,
  IpcLineItemDto,
  MonitorQueryDto,
  ValuationReportDto,
  TrancheDecisionDto,
  ConditionPrecedentDto,
  ProvidedEvidenceItem,
  CertificationComputation,
  ResolvedRatingLabels,
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
