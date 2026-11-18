-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TRIAL');

-- CreateEnum
CREATE TYPE "RoleSurface" AS ENUM ('WEB', 'MOBILE', 'BOTH');

-- CreateEnum
CREATE TYPE "FieldPersonaType" AS ENUM ('INDEPENDENT_VERIFIER', 'CONTRACTOR_EXECUTOR', 'NONE');

-- CreateEnum
CREATE TYPE "OrganizationCategory" AS ENUM ('ADVISORY_MONITOR', 'FINANCIER_LENDER', 'CONTRACTOR', 'CLIENT_OWNER', 'GOVERNMENT_MDA', 'OTHER');

-- CreateEnum
CREATE TYPE "PermissionCategory" AS ENUM ('TENANT_ADMIN', 'PORTFOLIO_PROJECTS', 'BOQ_SCHEDULE', 'MOBILIZATION_ASSURANCE', 'FIELD_PRESENCE', 'REPORT_APPROVALS', 'FINANCIAL_IPC', 'AUDIT_CLOSEOUT');

-- CreateEnum
CREATE TYPE "ProfessionalLicenseType" AS ENUM ('QSRBN', 'COREN', 'ARCON', 'CORBON', 'ICAN', 'OTHER');

-- CreateEnum
CREATE TYPE "GeofenceMode" AS ENUM ('RADIAL', 'LINEAR_CORRIDOR');

-- CreateEnum
CREATE TYPE "ReportingCadence" AS ENUM ('DAILY', 'WEEKLY', 'BI_WEEKLY', 'INSPECTION_ONLY');

-- CreateEnum
CREATE TYPE "PortfolioHealth" AS ENUM ('EVIDENCE_SUPPORTED', 'EVIDENCE_PARTIAL', 'EVIDENCE_CONFLICT');

-- CreateEnum
CREATE TYPE "EvidenceStrengthRating" AS ENUM ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED');

-- CreateEnum
CREATE TYPE "EvidenceLogStatus" AS ENUM ('LOCAL_CAPTURED', 'QUEUED_OFFLINE', 'UPLOADING_SYNC', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'FLAGGED_INTEGRITY');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('SITE_PHOTO', 'VOICE_NOTE', 'WAYBILL_DOCUMENT', 'LAB_CUBE_TEST_CERT', 'MILL_CERTIFICATE', 'BOQ_SPREADSHEET', 'VALUATION_REPORT_PDF');

-- CreateEnum
CREATE TYPE "ConditionPrecedentStatus" AS ENUM ('PENDING', 'SATISFIED', 'WAIVED', 'BREACHED');

-- CreateEnum
CREATE TYPE "IpcClaimStatus" AS ENUM ('SUBMITTED', 'AI_RECONCILED', 'QUERIED_BY_MONITOR', 'MONITOR_CERTIFIED', 'LENDER_DECIDED');

-- CreateEnum
CREATE TYPE "MonitorRecommendation" AS ENUM ('SUPPORT_FULL_RELEASE', 'SUPPORT_WITH_HOLDBACK', 'HOLD');

-- CreateEnum
CREATE TYPE "LenderDecisionType" AS ENUM ('APPROVE_FULL', 'APPROVE_WITH_HOLDBACK', 'HOLD');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('OPEN', 'RESPONDED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('WEB_USER', 'FIELD_AGENT', 'AI_SYSTEM');

-- CreateEnum
CREATE TYPE "ContractorAssuranceStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditActionType" AS ENUM ('TENANT_CREATED', 'TENANT_BRANDING_UPDATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'USER_PROJECT_ASSIGNED', 'PROJECT_CREATED', 'BASELINE_UPDATED', 'BOQ_UPLOADED', 'JOIN_CODE_ISSUED', 'FIELD_AGENT_JOINED', 'FIELD_SESSION_STATUS_UPDATED', 'CONTRACTOR_ASSURANCE_SUBMITTED', 'CONTRACTOR_ASSURANCE_APPROVED', 'CONTRACTOR_ASSURANCE_REJECTED', 'EVIDENCE_EXTRACTED', 'EVIDENCE_CONFIRMED', 'EVIDENCE_FLAGGED_INTEGRITY', 'IPC_SUBMITTED', 'AI_RECONCILIATION_COMPLETED', 'MONITOR_QUERY_RAISED', 'CONTRACTOR_QUERY_RESPONDED', 'VALUATION_REPORT_CERTIFIED', 'LENDER_TRANCHE_DECIDED', 'INCIDENT_REPORT_SUBMITTED', 'INCIDENT_STATUS_UPDATED', 'PUSH_TOKEN_REGISTERED', 'WORKDAY_REPORT_SUBMITTED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'JOIN_CODE_ROTATED', 'LOGIN_FAILED_LOCKOUT');

-- CreateEnum
CREATE TYPE "MobileNotificationType" AS ENUM ('ASSURANCE_PENDING', 'ASSURANCE_APPROVED', 'ASSURANCE_REJECTED', 'BACKLOG_REVIEW_REQUIRED', 'REPORT_QUERY', 'HOLD_POINT_ALERT', 'MORNING_DELIVERABLE_READY', 'SITE_GEOFENCE_WARNING');

-- CreateEnum
CREATE TYPE "NotificationActionType" AS ENUM ('NONE', 'OPEN_REPORT_SUMMARY', 'OPEN_WBS_CHAT', 'OPEN_BACKLOG_REVIEW', 'OPEN_ASSURANCE_WIZARD');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'NGN',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "brandingConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "PermissionCategory" NOT NULL,
    "surface" "RoleSurface" NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeSuffix" TEXT,
    "description" TEXT,
    "surface" "RoleSurface" NOT NULL DEFAULT 'WEB',
    "fieldPersonaType" "FieldPersonaType" NOT NULL DEFAULT 'NONE',
    "assuranceWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "requiresIdentityAssurance" BOOLEAN NOT NULL DEFAULT false,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "OrganizationCategory" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isPlatformSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "roleId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "professionalLicenseType" "ProfessionalLicenseType",
    "professionalLicenseNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_project_assignments" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "roleId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_project_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL,
    "stateLocation" TEXT NOT NULL,
    "lgaLocation" TEXT,
    "description" TEXT,
    "totalBudgetNgn" DECIMAL(18,2) NOT NULL,
    "disbursedToDateNgn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "certifiedProgressPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "reportingCadence" "ReportingCadence" NOT NULL DEFAULT 'WEEKLY',
    "workdayStartTime" TEXT NOT NULL DEFAULT '08:00',
    "workdayEndTime" TEXT NOT NULL DEFAULT '17:00',
    "geofenceMode" "GeofenceMode" NOT NULL,
    "geofenceGeoJson" JSONB NOT NULL,
    "portfolioHealth" "PortfolioHealth" NOT NULL DEFAULT 'EVIDENCE_PARTIAL',
    "monitorOrganizationId" UUID NOT NULL,
    "lenderOrganizationId" UUID NOT NULL,
    "contractorOrganizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectJoinCode" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "rotatedFromId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectJoinCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldAgentSession" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "joinCodeId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "roleNameSnapshot" TEXT NOT NULL,
    "fieldPersonaType" "FieldPersonaType" NOT NULL DEFAULT 'INDEPENDENT_VERIFIER',
    "assuranceWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "agentFullName" TEXT NOT NULL,
    "agentPhoneNumber" TEXT NOT NULL,
    "agentPinHash" TEXT,
    "deviceId" TEXT NOT NULL,
    "deviceModel" TEXT,
    "deviceOs" TEXT,
    "deviceSecretHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "revokeReason" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assuranceStatus" "ContractorAssuranceStatus" NOT NULL DEFAULT 'APPROVED',
    "idDocumentType" TEXT,
    "idDocumentUrl" TEXT,
    "selfieImageUrl" TEXT,
    "selfieLeftUrl" TEXT,
    "selfieRightUrl" TEXT,
    "livenessScore" DOUBLE PRECISION,
    "livenessPassed" BOOLEAN NOT NULL DEFAULT false,
    "livenessMetadata" JSONB,
    "corenLicenseNumber" TEXT,
    "experienceSummary" TEXT,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "FieldAgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityTranche" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "trancheNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "allocatedAmountNgn" DECIMAL(18,2) NOT NULL,
    "releasedAmountNgn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "targetCompletionPct" DECIMAL(5,2) NOT NULL,
    "isReleased" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityTranche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionPrecedent" (
    "id" UUID NOT NULL,
    "trancheId" UUID NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isMandatoryForRelease" BOOLEAN NOT NULL DEFAULT true,
    "status" "ConditionPrecedentStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceDocumentUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConditionPrecedent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqItem" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "trancheId" UUID,
    "aiSuggestedTrancheId" UUID,
    "trancheMappingConfirmedByMonitor" BOOLEAN NOT NULL DEFAULT false,
    "wbsCode" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "totalQuantity" DECIMAL(14,3) NOT NULL,
    "rateNgn" DECIMAL(18,2) NOT NULL,
    "budgetedCostNgn" DECIMAL(18,2) NOT NULL,
    "isHoldPoint" BOOLEAN NOT NULL DEFAULT false,
    "isScheduledToday" BOOLEAN NOT NULL DEFAULT false,
    "planningTier" TEXT NOT NULL DEFAULT 'UNBLOCKED_POOL',
    "dailyTargetQuantity" DECIMAL(14,3),
    "expectedDeliverable" TEXT,
    "holdPointInstruction" TEXT,
    "isOpaqueLumpSum" BOOLEAN NOT NULL DEFAULT false,
    "opacityWarningReason" TEXT,
    "cumulativeCertifiedPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldEvidenceLog" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "boqItemId" UUID,
    "fieldSessionId" UUID NOT NULL,
    "clientCaptureId" UUID NOT NULL,
    "reporterRoleId" UUID,
    "reporterRoleName" TEXT NOT NULL DEFAULT 'Field Reporter',
    "fieldPersonaType" "FieldPersonaType" NOT NULL DEFAULT 'INDEPENDENT_VERIFIER',
    "assuranceWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "status" "EvidenceLogStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitudeMeters" DOUBLE PRECISION,
    "gpsAccuracyMeters" DOUBLE PRECISION NOT NULL,
    "isMockLocation" BOOLEAN NOT NULL DEFAULT false,
    "isWithinGeofence" BOOLEAN NOT NULL,
    "chainageKm" DOUBLE PRECISION,
    "chainageLabel" TEXT,
    "corridorOffsetMeters" DOUBLE PRECISION,
    "verificationBadgeText" TEXT NOT NULL,
    "devicePitchDeg" DOUBLE PRECISION,
    "deviceRollDeg" DOUBLE PRECISION,
    "deviceAzimuthDeg" DOUBLE PRECISION,
    "deviceSignatureHash" TEXT NOT NULL,
    "integrityPassed" BOOLEAN NOT NULL DEFAULT true,
    "integrityFlags" JSONB NOT NULL DEFAULT '[]',
    "rawTextNote" TEXT,
    "rawWhisperTranscript" TEXT,
    "confirmedSummary" TEXT,
    "confirmedQuantities" JSONB NOT NULL DEFAULT '[]',
    "siteBlockers" JSONB NOT NULL DEFAULT '[]',
    "visionObservationSummary" TEXT,
    "wasEditedByAgent" BOOLEAN NOT NULL DEFAULT false,
    "confirmationSignatureHash" TEXT,
    "capturedAtDevice" TIMESTAMP(3) NOT NULL,
    "syncedAtServer" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "FieldEvidenceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceMedia" (
    "id" UUID NOT NULL,
    "evidenceLogId" UUID NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileUrl" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256FileHash" TEXT NOT NULL,
    "perceptualHash" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpcClaim" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "trancheId" UUID NOT NULL,
    "ipcNumber" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "contractorCoverNote" TEXT,
    "totalClaimedAmountNgn" DECIMAL(18,2) NOT NULL,
    "totalCertifiedNgn" DECIMAL(18,2),
    "status" "IpcClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
    "aiExecutiveSummary" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpcClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpcLineItem" (
    "id" UUID NOT NULL,
    "ipcClaimId" UUID NOT NULL,
    "boqItemId" UUID NOT NULL,
    "previousCertifiedPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "contractorClaimedPct" DECIMAL(5,2) NOT NULL,
    "contractorClaimedNgn" DECIMAL(18,2) NOT NULL,
    "contractorRemarks" TEXT,
    "aiEvidenceRating" "EvidenceStrengthRating" NOT NULL DEFAULT 'UNSUPPORTED',
    "aiRationale" TEXT,
    "visitPlannerFlag" BOOLEAN NOT NULL DEFAULT false,
    "visitPlannerReason" TEXT,
    "missingHoldPointFlag" BOOLEAN NOT NULL DEFAULT false,
    "highestCorroboratingRoleName" TEXT,
    "highestCorroboratingWeight" DOUBLE PRECISION,
    "corroboratingEvidenceLogIds" JSONB NOT NULL DEFAULT '[]',
    "monitorCertifiedPct" DECIMAL(5,2),
    "monitorCertifiedNgn" DECIMAL(18,2),
    "monitorRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpcLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpcSupportingDocument" (
    "id" UUID NOT NULL,
    "ipcClaimId" UUID NOT NULL,
    "boqItemId" UUID,
    "title" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileUrl" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpcSupportingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorQuery" (
    "id" UUID NOT NULL,
    "ipcLineItemId" UUID NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'OPEN',
    "queryReason" TEXT NOT NULL,
    "requestedProofTypes" JSONB NOT NULL DEFAULT '[]',
    "contractorResponseText" TEXT,
    "revisedClaimedCumulativePct" DECIMAL(5,2),
    "attachedDocumentsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "MonitorQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValuationReport" (
    "id" UUID NOT NULL,
    "ipcClaimId" UUID NOT NULL,
    "certifiedByUserId" UUID NOT NULL,
    "trancheRecommendation" "MonitorRecommendation" NOT NULL,
    "recommendedReleaseAmountNgn" DECIMAL(18,2) NOT NULL,
    "recommendedHoldbackAmountNgn" DECIMAL(18,2) NOT NULL,
    "executiveCertificationSummary" TEXT NOT NULL,
    "certifierFullName" TEXT NOT NULL,
    "certifierLicenseType" "ProfessionalLicenseType" NOT NULL DEFAULT 'QSRBN',
    "certifierLicenseNumber" TEXT NOT NULL,
    "reportPdfObjectKey" TEXT,
    "reportPdfUrl" TEXT,
    "certifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValuationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrancheDecision" (
    "id" UUID NOT NULL,
    "valuationReportId" UUID NOT NULL,
    "decidedByUserId" UUID NOT NULL,
    "decision" "LenderDecisionType" NOT NULL,
    "approvedDisbursementAmountNgn" DECIMAL(18,2) NOT NULL,
    "heldBackAmountNgn" DECIMAL(18,2) NOT NULL,
    "creditCommitteeReference" TEXT,
    "approverNotes" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrancheDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID,
    "seq" BIGINT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorDisplayName" TEXT NOT NULL,
    "action" "AuditActionType" NOT NULL,
    "summaryText" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "previousHash" TEXT NOT NULL,
    "entryHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "deviceToken" TEXT NOT NULL,
    "devicePlatform" TEXT NOT NULL,
    "appVersion" TEXT,
    "sessionId" UUID,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_reports" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "reporterSessionId" UUID NOT NULL,
    "wbsItemId" UUID,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'HIGH',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isConfidentialWhistleblower" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "photoEvidenceUrls" TEXT[],
    "voiceNoteUrl" TEXT,
    "deviceGpsCoordinates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "incident_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workday_reports" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "reporterSessionId" UUID NOT NULL,
    "wbsItemId" UUID NOT NULL,
    "workdayDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED_UNVERIFIED',
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "parentReportId" UUID,
    "resolvedQueryId" UUID,
    "summaryText" TEXT NOT NULL,
    "reportedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitOfMeasure" TEXT NOT NULL,
    "isHoldPointClaimed" BOOLEAN NOT NULL DEFAULT false,
    "evidenceItems" JSONB NOT NULL,
    "voiceNoteUrl" TEXT,
    "submissionGeotag" JSONB,
    "aiParsedConfidence" DOUBLE PRECISION,
    "aiReasoning" TEXT,
    "humanConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workday_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_telemetry_pings" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fieldSessionId" UUID NOT NULL,
    "wbsItemId" UUID,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "altitudeMeters" DOUBLE PRECISION,
    "isMocked" BOOLEAN NOT NULL DEFAULT false,
    "isWithinGeofence" BOOLEAN,
    "chainageLabel" TEXT,
    "distanceMeters" DOUBLE PRECISION,
    "pingSource" TEXT NOT NULL DEFAULT 'HOURLY_TELEMETRY',
    "deviceSignatureHash" TEXT NOT NULL,
    "capturedAtDevice" TIMESTAMP(3) NOT NULL,
    "syncedAtServer" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_telemetry_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "morning_deliverable_briefs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "boqItemId" UUID NOT NULL,
    "workdayDate" TEXT NOT NULL,
    "planningTier" TEXT NOT NULL DEFAULT 'PLAN_A',
    "headline" TEXT NOT NULL,
    "expectedDeliverable" TEXT NOT NULL,
    "reportingChecklist" JSONB NOT NULL DEFAULT '[]',
    "dailyTargetQuantity" DECIMAL(14,3),
    "generatedByAi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "morning_deliverable_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_notifications" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fieldSessionId" UUID,
    "type" "MobileNotificationType" NOT NULL,
    "actionType" "NotificationActionType" NOT NULL DEFAULT 'NONE',
    "requiresAction" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_queries" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "boqItemId" UUID NOT NULL,
    "workdayReportId" UUID,
    "ipcLineItemId" UUID,
    "raisedByUserId" UUID,
    "source" TEXT NOT NULL DEFAULT 'MONITOR',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "monitorComment" TEXT,
    "aiOmissionPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "report_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wbs_chat_messages" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "boqItemId" UUID NOT NULL,
    "workdayReportId" UUID,
    "reportQueryId" UUID,
    "fieldSessionId" UUID,
    "senderName" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "textContent" TEXT,
    "mediaUrls" JSONB NOT NULL DEFAULT '[]',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "chainageLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wbs_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_notifications" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "targetPermissionKey" TEXT NOT NULL DEFAULT 'reports:view_all',
    "targetRoleId" UUID,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_notification_reads" (
    "notificationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_notification_reads_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_category_idx" ON "permissions"("category");

-- CreateIndex
CREATE INDEX "roles_tenantId_surface_idx" ON "roles"("tenantId", "surface");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_code_key" ON "roles"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_codeSuffix_key" ON "roles"("tenantId", "codeSuffix");

-- CreateIndex
CREATE INDEX "role_permissions_roleId_idx" ON "role_permissions"("roleId");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "Organization_tenantId_idx" ON "Organization"("tenantId");

-- CreateIndex
CREATE INDEX "Organization_category_idx" ON "Organization"("category");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "user_project_assignments_userId_idx" ON "user_project_assignments"("userId");

-- CreateIndex
CREATE INDEX "user_project_assignments_projectId_idx" ON "user_project_assignments"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "user_project_assignments_userId_projectId_key" ON "user_project_assignments"("userId", "projectId");

-- CreateIndex
CREATE INDEX "Project_tenantId_idx" ON "Project"("tenantId");

-- CreateIndex
CREATE INDEX "Project_portfolioHealth_idx" ON "Project"("portfolioHealth");

-- CreateIndex
CREATE INDEX "Project_monitorOrganizationId_idx" ON "Project"("monitorOrganizationId");

-- CreateIndex
CREATE INDEX "Project_lenderOrganizationId_idx" ON "Project"("lenderOrganizationId");

-- CreateIndex
CREATE INDEX "Project_contractorOrganizationId_idx" ON "Project"("contractorOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_codePrefix_key" ON "Project"("tenantId", "codePrefix");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectJoinCode_code_key" ON "ProjectJoinCode"("code");

-- CreateIndex
CREATE INDEX "ProjectJoinCode_projectId_idx" ON "ProjectJoinCode"("projectId");

-- CreateIndex
CREATE INDEX "ProjectJoinCode_roleId_idx" ON "ProjectJoinCode"("roleId");

-- CreateIndex
CREATE INDEX "FieldAgentSession_projectId_roleId_idx" ON "FieldAgentSession"("projectId", "roleId");

-- CreateIndex
CREATE INDEX "FieldAgentSession_projectId_assuranceStatus_idx" ON "FieldAgentSession"("projectId", "assuranceStatus");

-- CreateIndex
CREATE INDEX "FieldAgentSession_deviceId_idx" ON "FieldAgentSession"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityTranche_projectId_trancheNumber_key" ON "FacilityTranche"("projectId", "trancheNumber");

-- CreateIndex
CREATE INDEX "ConditionPrecedent_trancheId_idx" ON "ConditionPrecedent"("trancheId");

-- CreateIndex
CREATE INDEX "BoqItem_projectId_trancheId_idx" ON "BoqItem"("projectId", "trancheId");

-- CreateIndex
CREATE UNIQUE INDEX "BoqItem_projectId_wbsCode_key" ON "BoqItem"("projectId", "wbsCode");

-- CreateIndex
CREATE UNIQUE INDEX "FieldEvidenceLog_clientCaptureId_key" ON "FieldEvidenceLog"("clientCaptureId");

-- CreateIndex
CREATE INDEX "FieldEvidenceLog_projectId_status_idx" ON "FieldEvidenceLog"("projectId", "status");

-- CreateIndex
CREATE INDEX "FieldEvidenceLog_projectId_boqItemId_idx" ON "FieldEvidenceLog"("projectId", "boqItemId");

-- CreateIndex
CREATE INDEX "FieldEvidenceLog_projectId_reporterRoleId_idx" ON "FieldEvidenceLog"("projectId", "reporterRoleId");

-- CreateIndex
CREATE INDEX "EvidenceMedia_evidenceLogId_idx" ON "EvidenceMedia"("evidenceLogId");

-- CreateIndex
CREATE INDEX "EvidenceMedia_perceptualHash_idx" ON "EvidenceMedia"("perceptualHash");

-- CreateIndex
CREATE INDEX "EvidenceMedia_sha256FileHash_idx" ON "EvidenceMedia"("sha256FileHash");

-- CreateIndex
CREATE INDEX "IpcClaim_projectId_status_idx" ON "IpcClaim"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IpcClaim_projectId_ipcNumber_key" ON "IpcClaim"("projectId", "ipcNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IpcLineItem_ipcClaimId_boqItemId_key" ON "IpcLineItem"("ipcClaimId", "boqItemId");

-- CreateIndex
CREATE INDEX "IpcSupportingDocument_ipcClaimId_idx" ON "IpcSupportingDocument"("ipcClaimId");

-- CreateIndex
CREATE INDEX "MonitorQuery_ipcLineItemId_status_idx" ON "MonitorQuery"("ipcLineItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationReport_ipcClaimId_key" ON "ValuationReport"("ipcClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "TrancheDecision_valuationReportId_key" ON "TrancheDecision"("valuationReportId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_entryHash_key" ON "AuditLog"("entryHash");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_seq_idx" ON "AuditLog"("projectId", "seq");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_seq_idx" ON "AuditLog"("tenantId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_tenantId_projectId_seq_key" ON "AuditLog"("tenantId", "projectId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_deviceToken_key" ON "push_tokens"("deviceToken");

-- CreateIndex
CREATE INDEX "push_tokens_sessionId_idx" ON "push_tokens"("sessionId");

-- CreateIndex
CREATE INDEX "push_tokens_userId_idx" ON "push_tokens"("userId");

-- CreateIndex
CREATE INDEX "incident_reports_projectId_category_idx" ON "incident_reports"("projectId", "category");

-- CreateIndex
CREATE INDEX "incident_reports_projectId_status_idx" ON "incident_reports"("projectId", "status");

-- CreateIndex
CREATE INDEX "workday_reports_projectId_wbsItemId_workdayDate_idx" ON "workday_reports"("projectId", "wbsItemId", "workdayDate");

-- CreateIndex
CREATE INDEX "workday_reports_projectId_status_idx" ON "workday_reports"("projectId", "status");

-- CreateIndex
CREATE INDEX "workday_reports_parentReportId_idx" ON "workday_reports"("parentReportId");

-- CreateIndex
CREATE INDEX "site_telemetry_pings_projectId_capturedAtDevice_idx" ON "site_telemetry_pings"("projectId", "capturedAtDevice");

-- CreateIndex
CREATE INDEX "site_telemetry_pings_fieldSessionId_capturedAtDevice_idx" ON "site_telemetry_pings"("fieldSessionId", "capturedAtDevice");

-- CreateIndex
CREATE INDEX "morning_deliverable_briefs_projectId_workdayDate_idx" ON "morning_deliverable_briefs"("projectId", "workdayDate");

-- CreateIndex
CREATE UNIQUE INDEX "morning_deliverable_briefs_projectId_boqItemId_workdayDate_key" ON "morning_deliverable_briefs"("projectId", "boqItemId", "workdayDate");

-- CreateIndex
CREATE INDEX "mobile_notifications_projectId_isRead_createdAt_idx" ON "mobile_notifications"("projectId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "mobile_notifications_fieldSessionId_isRead_createdAt_idx" ON "mobile_notifications"("fieldSessionId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "report_queries_projectId_boqItemId_status_idx" ON "report_queries"("projectId", "boqItemId", "status");

-- CreateIndex
CREATE INDEX "report_queries_workdayReportId_idx" ON "report_queries"("workdayReportId");

-- CreateIndex
CREATE INDEX "wbs_chat_messages_projectId_boqItemId_createdAt_idx" ON "wbs_chat_messages"("projectId", "boqItemId", "createdAt");

-- CreateIndex
CREATE INDEX "wbs_chat_messages_reportQueryId_idx" ON "wbs_chat_messages"("reportQueryId");

-- CreateIndex
CREATE INDEX "web_notifications_projectId_targetPermissionKey_createdAt_idx" ON "web_notifications"("projectId", "targetPermissionKey", "createdAt");

-- CreateIndex
CREATE INDEX "web_notification_reads_userId_idx" ON "web_notification_reads"("userId");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_project_assignments" ADD CONSTRAINT "user_project_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_project_assignments" ADD CONSTRAINT "user_project_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_project_assignments" ADD CONSTRAINT "user_project_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_monitorOrganizationId_fkey" FOREIGN KEY ("monitorOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_lenderOrganizationId_fkey" FOREIGN KEY ("lenderOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_contractorOrganizationId_fkey" FOREIGN KEY ("contractorOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJoinCode" ADD CONSTRAINT "ProjectJoinCode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJoinCode" ADD CONSTRAINT "ProjectJoinCode_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_joinCodeId_fkey" FOREIGN KEY ("joinCodeId") REFERENCES "ProjectJoinCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityTranche" ADD CONSTRAINT "FacilityTranche_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionPrecedent" ADD CONSTRAINT "ConditionPrecedent_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "FacilityTranche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "FacilityTranche"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldEvidenceLog" ADD CONSTRAINT "FieldEvidenceLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldEvidenceLog" ADD CONSTRAINT "FieldEvidenceLog_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldEvidenceLog" ADD CONSTRAINT "FieldEvidenceLog_fieldSessionId_fkey" FOREIGN KEY ("fieldSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceMedia" ADD CONSTRAINT "EvidenceMedia_evidenceLogId_fkey" FOREIGN KEY ("evidenceLogId") REFERENCES "FieldEvidenceLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcClaim" ADD CONSTRAINT "IpcClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcClaim" ADD CONSTRAINT "IpcClaim_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "FacilityTranche"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcLineItem" ADD CONSTRAINT "IpcLineItem_ipcClaimId_fkey" FOREIGN KEY ("ipcClaimId") REFERENCES "IpcClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcLineItem" ADD CONSTRAINT "IpcLineItem_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcSupportingDocument" ADD CONSTRAINT "IpcSupportingDocument_ipcClaimId_fkey" FOREIGN KEY ("ipcClaimId") REFERENCES "IpcClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorQuery" ADD CONSTRAINT "MonitorQuery_ipcLineItemId_fkey" FOREIGN KEY ("ipcLineItemId") REFERENCES "IpcLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationReport" ADD CONSTRAINT "ValuationReport_ipcClaimId_fkey" FOREIGN KEY ("ipcClaimId") REFERENCES "IpcClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationReport" ADD CONSTRAINT "ValuationReport_certifiedByUserId_fkey" FOREIGN KEY ("certifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrancheDecision" ADD CONSTRAINT "TrancheDecision_valuationReportId_fkey" FOREIGN KEY ("valuationReportId") REFERENCES "ValuationReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrancheDecision" ADD CONSTRAINT "TrancheDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FieldAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reporterSessionId_fkey" FOREIGN KEY ("reporterSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "BoqItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workday_reports" ADD CONSTRAINT "workday_reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workday_reports" ADD CONSTRAINT "workday_reports_reporterSessionId_fkey" FOREIGN KEY ("reporterSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workday_reports" ADD CONSTRAINT "workday_reports_wbsItemId_fkey" FOREIGN KEY ("wbsItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workday_reports" ADD CONSTRAINT "workday_reports_parentReportId_fkey" FOREIGN KEY ("parentReportId") REFERENCES "workday_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_telemetry_pings" ADD CONSTRAINT "site_telemetry_pings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_telemetry_pings" ADD CONSTRAINT "site_telemetry_pings_fieldSessionId_fkey" FOREIGN KEY ("fieldSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "morning_deliverable_briefs" ADD CONSTRAINT "morning_deliverable_briefs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "morning_deliverable_briefs" ADD CONSTRAINT "morning_deliverable_briefs_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_notifications" ADD CONSTRAINT "mobile_notifications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_notifications" ADD CONSTRAINT "mobile_notifications_fieldSessionId_fkey" FOREIGN KEY ("fieldSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_queries" ADD CONSTRAINT "report_queries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_queries" ADD CONSTRAINT "report_queries_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_queries" ADD CONSTRAINT "report_queries_workdayReportId_fkey" FOREIGN KEY ("workdayReportId") REFERENCES "workday_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_queries" ADD CONSTRAINT "report_queries_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_chat_messages" ADD CONSTRAINT "wbs_chat_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_chat_messages" ADD CONSTRAINT "wbs_chat_messages_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_chat_messages" ADD CONSTRAINT "wbs_chat_messages_workdayReportId_fkey" FOREIGN KEY ("workdayReportId") REFERENCES "workday_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_chat_messages" ADD CONSTRAINT "wbs_chat_messages_reportQueryId_fkey" FOREIGN KEY ("reportQueryId") REFERENCES "report_queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_chat_messages" ADD CONSTRAINT "wbs_chat_messages_fieldSessionId_fkey" FOREIGN KEY ("fieldSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_notifications" ADD CONSTRAINT "web_notifications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_notification_reads" ADD CONSTRAINT "web_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "web_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_notification_reads" ADD CONSTRAINT "web_notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

-- Organization names are unique per tenant, case-insensitively.
CREATE UNIQUE INDEX "Organization_tenantId_lower_name_key" ON "Organization"("tenantId", lower("name"));

-- Tenant-scope audit chain (projectId IS NULL): NULLs are distinct in a normal unique
-- index, so enforce sequence uniqueness for the tenant chain with a partial index.
CREATE UNIQUE INDEX "AuditLog_tenantId_seq_tenant_scope_key" ON "AuditLog"("tenantId", "seq") WHERE "projectId" IS NULL;
