-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('MONITOR', 'LENDER', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "ProfessionalLicenseType" AS ENUM ('QSRBN', 'COREN', 'ARCON', 'CORBON', 'ICAN', 'OTHER');

-- CreateEnum
CREATE TYPE "IndependenceTier" AS ENUM ('MONITOR_INSPECTOR', 'INDEPENDENT_RESIDENT', 'CONTRACTOR_ENGINEER');

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
CREATE TYPE "AuditActionType" AS ENUM ('PROJECT_CREATED', 'BASELINE_UPDATED', 'BOQ_UPLOADED', 'JOIN_CODE_ISSUED', 'FIELD_AGENT_JOINED', 'EVIDENCE_EXTRACTED', 'EVIDENCE_CONFIRMED', 'EVIDENCE_FLAGGED_INTEGRITY', 'IPC_SUBMITTED', 'AI_RECONCILIATION_COMPLETED', 'MONITOR_QUERY_RAISED', 'CONTRACTOR_QUERY_RESPONDED', 'VALUATION_REPORT_CERTIFIED', 'LENDER_TRANCHE_DECIDED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "roleType" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "organizationId" UUID NOT NULL,
    "professionalLicenseType" "ProfessionalLicenseType",
    "professionalLicenseNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL,
    "stateLocation" TEXT NOT NULL,
    "lgaLocation" TEXT,
    "description" TEXT,
    "totalBudgetNgn" DECIMAL(18,2) NOT NULL,
    "disbursedToDateNgn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "certifiedProgressPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "reportingCadence" "ReportingCadence" NOT NULL DEFAULT 'WEEKLY',
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
    "code" TEXT NOT NULL,
    "independenceTier" "IndependenceTier" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectJoinCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldAgentSession" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "joinCodeId" UUID NOT NULL,
    "independenceTier" "IndependenceTier" NOT NULL,
    "agentFullName" TEXT NOT NULL,
    "agentPhoneNumber" TEXT NOT NULL,
    "agentPinHash" TEXT,
    "deviceId" TEXT NOT NULL,
    "deviceModel" TEXT,
    "deviceOs" TEXT,
    "deviceSecretHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "independenceTier" "IndependenceTier" NOT NULL,
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
    "highestCorroboratingTier" "IndependenceTier",
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
    "projectId" UUID NOT NULL,
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

-- CreateIndex
CREATE INDEX "Organization_roleType_idx" ON "Organization"("roleType");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Project_codePrefix_key" ON "Project"("codePrefix");

-- CreateIndex
CREATE INDEX "Project_portfolioHealth_idx" ON "Project"("portfolioHealth");

-- CreateIndex
CREATE INDEX "Project_monitorOrganizationId_idx" ON "Project"("monitorOrganizationId");

-- CreateIndex
CREATE INDEX "Project_lenderOrganizationId_idx" ON "Project"("lenderOrganizationId");

-- CreateIndex
CREATE INDEX "Project_contractorOrganizationId_idx" ON "Project"("contractorOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectJoinCode_code_key" ON "ProjectJoinCode"("code");

-- CreateIndex
CREATE INDEX "ProjectJoinCode_projectId_idx" ON "ProjectJoinCode"("projectId");

-- CreateIndex
CREATE INDEX "FieldAgentSession_projectId_independenceTier_idx" ON "FieldAgentSession"("projectId", "independenceTier");

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
CREATE INDEX "FieldEvidenceLog_projectId_independenceTier_idx" ON "FieldEvidenceLog"("projectId", "independenceTier");

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
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_monitorOrganizationId_fkey" FOREIGN KEY ("monitorOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_lenderOrganizationId_fkey" FOREIGN KEY ("lenderOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_contractorOrganizationId_fkey" FOREIGN KEY ("contractorOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJoinCode" ADD CONSTRAINT "ProjectJoinCode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_joinCodeId_fkey" FOREIGN KEY ("joinCodeId") REFERENCES "ProjectJoinCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
