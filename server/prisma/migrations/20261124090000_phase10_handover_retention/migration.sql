-- CreateEnum
CREATE TYPE "ConstructionPhase" AS ENUM ('ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS', 'RETENTION_PERIOD', 'COMPLETED_CLOSED');

-- CreateEnum
CREATE TYPE "HandoverStakeholderType" AS ENUM ('COMMUNITY_REPRESENTATIVE', 'CLIENT_STAFF', 'END_USER', 'OTHER');

-- CreateEnum
CREATE TYPE "HandoverDecision" AS ENUM ('ACCEPTED', 'ACCEPTED_WITH_SNAGS', 'REJECTED');

-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DefectTicketStatus" AS ENUM ('OPEN', 'ASSIGNED', 'RECTIFIED_PENDING_VERIFICATION', 'VERIFIED_CLOSED', 'REJECTED_NOT_A_DEFECT');

-- CreateEnum
CREATE TYPE "RetentionReleaseStage" AS ENUM ('COMPLETION', 'FINAL');

-- CreateEnum
CREATE TYPE "RetentionReleaseRequestStatus" AS ENUM ('PENDING_CERTIFICATION', 'CERTIFIED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'HANDOVER_LINK_CREATED';
ALTER TYPE "AuditActionType" ADD VALUE 'HANDOVER_LINK_REVOKED';
ALTER TYPE "AuditActionType" ADD VALUE 'HANDOVER_SUBMITTED';
ALTER TYPE "AuditActionType" ADD VALUE 'HANDOVER_REVIEWED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_PHASE_CHANGED';
ALTER TYPE "AuditActionType" ADD VALUE 'RETENTION_WITHHELD';
ALTER TYPE "AuditActionType" ADD VALUE 'DEFECT_TICKET_RAISED';
ALTER TYPE "AuditActionType" ADD VALUE 'DEFECT_TICKET_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'DEFECT_TICKET_CLOSED';
ALTER TYPE "AuditActionType" ADD VALUE 'RETENTION_RELEASED';

-- AlterEnum
ALTER TYPE "ValuationSource" ADD VALUE 'RETENTION_RELEASE';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "constructionPhase" "ConstructionPhase" NOT NULL DEFAULT 'ACTIVE_CONSTRUCTION',
ADD COLUMN     "constructionPhaseChangedAt" TIMESTAMP(3),
ADD COLUMN     "practicalCompletionDate" TEXT,
ADD COLUMN     "retentionDurationMonths" INTEGER,
ADD COLUMN     "retentionEndDate" TEXT,
ADD COLUMN     "retentionHeldNgn" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionPercentage" DECIMAL(5,2),
ADD COLUMN     "retentionReleaseAtCompletionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionReleasedNgn" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionStartDate" TEXT;

-- AlterTable
ALTER TABLE "TrancheDecision" ADD COLUMN     "retentionAllocationJson" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "retentionWithheldNgn" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "project_contractors" ADD COLUMN     "retentionHeldNgn" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionReleasedNgn" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "handover_links" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientContact" TEXT NOT NULL,
    "stakeholderType" "HandoverStakeholderType" NOT NULL,
    "handoverSummary" TEXT NOT NULL,
    "requiresOtp" BOOLEAN NOT NULL DEFAULT true,
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxSubmissions" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "reissuedFromLinkId" UUID,
    "reservedUploadBytes" BIGINT NOT NULL DEFAULT 0,
    "reservedUploadCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" TIMESTAMP(3),

    CONSTRAINT "handover_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_submissions" (
    "id" UUID NOT NULL,
    "handoverLinkId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "decision" "HandoverDecision" NOT NULL,
    "submitterName" TEXT NOT NULL,
    "submitterRole" TEXT NOT NULL,
    "feedbackText" TEXT NOT NULL,
    "snagsJson" JSONB NOT NULL DEFAULT '[]',
    "attachmentsJson" JSONB NOT NULL DEFAULT '[]',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,

    CONSTRAINT "handover_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_defect_tickets" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "projectContractorId" UUID NOT NULL,
    "boqItemId" UUID,
    "sourceHandoverSubmissionId" UUID,
    "sourceSnagIndex" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "severity" "DefectSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "DefectTicketStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TEXT,
    "snagPhotoKeys" JSONB NOT NULL DEFAULT '[]',
    "raisedByUserId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3),
    "rectificationCaptureIds" JSONB NOT NULL DEFAULT '[]',
    "rectificationNotes" TEXT,
    "rectifiedAt" TIMESTAMP(3),
    "rectifiedByLabel" TEXT,
    "verificationCaptureIds" JSONB NOT NULL DEFAULT '[]',
    "verificationNotes" TEXT,
    "verifiedByUserId" UUID,
    "verifiedByLabel" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_defect_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_release_requests" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "projectContractorId" UUID NOT NULL,
    "stage" "RetentionReleaseStage" NOT NULL,
    "amountNgn" DECIMAL(18,2) NOT NULL,
    "status" "RetentionReleaseRequestStatus" NOT NULL DEFAULT 'PENDING_CERTIFICATION',
    "notes" TEXT,
    "requestedByUserId" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certifiedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "valuationReportId" UUID,

    CONSTRAINT "retention_release_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "handover_links_tokenHash_key" ON "handover_links"("tokenHash");

-- CreateIndex
CREATE INDEX "handover_links_projectId_createdAt_idx" ON "handover_links"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "handover_submissions_projectId_submittedAt_idx" ON "handover_submissions"("projectId", "submittedAt");

-- CreateIndex
CREATE INDEX "handover_submissions_handoverLinkId_idx" ON "handover_submissions"("handoverLinkId");

-- CreateIndex
CREATE INDEX "retention_defect_tickets_projectId_status_idx" ON "retention_defect_tickets"("projectId", "status");

-- CreateIndex
CREATE INDEX "retention_defect_tickets_projectContractorId_status_idx" ON "retention_defect_tickets"("projectContractorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "retention_defect_tickets_projectId_ticketNumber_key" ON "retention_defect_tickets"("projectId", "ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "retention_defect_tickets_sourceHandoverSubmissionId_sourceS_key" ON "retention_defect_tickets"("sourceHandoverSubmissionId", "sourceSnagIndex");

-- CreateIndex
CREATE UNIQUE INDEX "retention_release_requests_valuationReportId_key" ON "retention_release_requests"("valuationReportId");

-- CreateIndex
CREATE INDEX "retention_release_requests_projectId_status_idx" ON "retention_release_requests"("projectId", "status");

-- CreateIndex
CREATE INDEX "retention_release_requests_projectContractorId_idx" ON "retention_release_requests"("projectContractorId");

-- AddForeignKey
ALTER TABLE "handover_links" ADD CONSTRAINT "handover_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_submissions" ADD CONSTRAINT "handover_submissions_handoverLinkId_fkey" FOREIGN KEY ("handoverLinkId") REFERENCES "handover_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_submissions" ADD CONSTRAINT "handover_submissions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_defect_tickets" ADD CONSTRAINT "retention_defect_tickets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_defect_tickets" ADD CONSTRAINT "retention_defect_tickets_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_defect_tickets" ADD CONSTRAINT "retention_defect_tickets_sourceHandoverSubmissionId_fkey" FOREIGN KEY ("sourceHandoverSubmissionId") REFERENCES "handover_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_release_requests" ADD CONSTRAINT "retention_release_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_release_requests" ADD CONSTRAINT "retention_release_requests_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_release_requests" ADD CONSTRAINT "retention_release_requests_valuationReportId_fkey" FOREIGN KEY ("valuationReportId") REFERENCES "ValuationReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
