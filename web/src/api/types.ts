import type {
  FieldPersonaType,
  PortfolioHealth,
  ProjectGeofence,
  ReportingCadence,
} from '@insite/shared';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface ProjectSummaryDto {
  id: string;
  tenantId: string;
  name: string;
  codePrefix: string;
  stateLocation: string;
  lgaLocation: string | null;
  description: string | null;
  totalBudgetNgn: number;
  disbursedToDateNgn: number;
  certifiedProgressPct: number;
  reportingCadence: ReportingCadence;
  geofenceMode: 'RADIAL' | 'LINEAR_CORRIDOR';
  geofence: ProjectGeofence;
  portfolioHealth: PortfolioHealth;
  monitorOrganizationName: string;
  lenderOrganizationName: string;
  contractorOrganizationName: string;
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

export interface FieldEvidenceLogRecordDto {
  id: string;
  projectId: string;
  boqItemId: string | null;
  reporterRoleId: string | null;
  reporterRoleName: string;
  fieldPersonaType: FieldPersonaType;
  assuranceWeight: number;
  status: string;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  isMockLocation: boolean;
  isWithinGeofence: boolean;
  chainageKm: number | null;
  chainageLabel: string | null;
  corridorOffsetMeters: number | null;
  verificationBadgeText: string;
  deviceSignatureHash: string;
  integrityPassed: boolean;
  integrityFlags: string[];
  rawTextNote: string | null;
  rawWhisperTranscript: string | null;
  confirmedSummary: string | null;
  confirmedQuantities: Array<{
    materialOrWork: string;
    quantity: number;
    unit: string;
    boqWbsCodeHint?: string | null;
  }>;
  siteBlockers: string[];
  visionObservationSummary: string | null;
  capturedAtDevice: string;
  confirmedAt: string | null;
  boqItem?: {
    id: string;
    wbsCode: string;
    description: string;
    unit: string;
    isHoldPoint: boolean;
  } | null;
  fieldSession?: {
    id: string;
    agentFullName: string;
    agentPhoneNumber: string;
    roleId: string;
    roleNameSnapshot: string;
    fieldPersonaType: FieldPersonaType;
    assuranceWeight: number;
    deviceModel: string | null;
  };
}

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
