import type {
  EvidenceStrengthRating,
  IndependenceTier,
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
    independenceTier: IndependenceTier;
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
  independenceTier: IndependenceTier;
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
    independenceTier: IndependenceTier;
    deviceModel: string | null;
  };
}

export interface IpcLineItemRecordDto {
  id: string;
  ipcClaimId: string;
  boqItemId: string;
  previousCertifiedPct: number;
  contractorClaimedPct: number;
  contractorClaimedNgn: number;
  contractorRemarks: string | null;
  aiEvidenceRating: EvidenceStrengthRating;
  aiRationale: string | null;
  visitPlannerFlag: boolean;
  visitPlannerReason: string | null;
  missingHoldPointFlag: boolean;
  highestCorroboratingTier: IndependenceTier | null;
  corroboratingEvidenceLogIds: string[];
  monitorCertifiedPct: number | null;
  monitorCertifiedNgn: number | null;
  monitorRemarks: string | null;
  boqItem: BoqItemRecordDto & {
    evidenceLogs?: FieldEvidenceLogRecordDto[];
  };
  queries: Array<{
    id: string;
    status: 'OPEN' | 'RESPONDED' | 'RESOLVED';
    queryReason: string;
    contractorResponseText: string | null;
    revisedClaimedCumulativePct: number | null;
    createdAt: string;
    respondedAt: string | null;
  }>;
}

export interface IpcDetailsDto {
  id: string;
  projectId: string;
  trancheId: string;
  ipcNumber: number;
  periodStart: string;
  periodEnd: string;
  contractorCoverNote: string | null;
  totalClaimedAmountNgn: number;
  totalCertifiedNgn: number | null;
  status: string;
  aiExecutiveSummary: string | null;
  submittedAt: string;
  tranche: {
    id: string;
    trancheNumber: number;
    name: string;
    allocatedAmountNgn: number;
    releasedAmountNgn: number;
    targetCompletionPct: number;
    isReleased: boolean;
    conditionsPrecedent?: Array<{
      id: string;
      referenceCode: string;
      description: string;
      isMandatoryForRelease: boolean;
      status: 'PENDING' | 'SATISFIED' | 'WAIVED' | 'BREACHED';
    }>;
  };
  valuationReport: {
    id: string;
    trancheRecommendation: string;
    recommendedReleaseAmountNgn: number;
    recommendedHoldbackAmountNgn: number;
    executiveCertificationSummary: string;
    certifierFullName: string;
    certifierLicenseType: string;
    certifierLicenseNumber: string;
    certifiedAt: string;
    trancheDecision?: {
      id: string;
      decision: string;
      approvedDisbursementAmountNgn: number;
      heldBackAmountNgn: number;
      creditCommitteeReference: string | null;
      approverNotes: string | null;
      decidedAt: string;
    } | null;
  } | null;
  lineItems: IpcLineItemRecordDto[];
  smartVisitPlannerQueue?: Array<{
    ipcLineItemId: string;
    wbsCode: string;
    description: string;
    claimedAmountNgn: number;
    aiEvidenceRating: EvidenceStrengthRating;
    missingHoldPointFlag: boolean;
    visitPlannerReason: string;
  }>;
}

export interface AuditTrailResponseDto {
  projectId: string;
  chainIntegrityVerified: boolean;
  totalEntries: number;
  brokenAtEntryId: string | null;
  latestHash: string | null;
  entries: Array<{
    id: string;
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

