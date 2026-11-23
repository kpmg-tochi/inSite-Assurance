-- CreateEnum
CREATE TYPE "HandoverLinkPurpose" AS ENUM ('HANDOVER');

-- CreateEnum
CREATE TYPE "CompletionCertificateStatus" AS ENUM ('DRAFT', 'PENDING_SIGNATURES', 'ISSUED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ClosureChecklistList" AS ENUM ('BEFORE_CLOSE', 'BEFORE_ARCHIVE');

-- CreateEnum
CREATE TYPE "ClosureChecklistItemStatus" AS ENUM ('PENDING', 'DONE', 'WAIVED');

-- CreateEnum
CREATE TYPE "ContractorRatingStage" AS ENUM ('COMPLETION', 'POST_CLOSURE');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ClosurePackStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'COC_DRAFTED';
ALTER TYPE "AuditActionType" ADD VALUE 'COC_SIGNED';
ALTER TYPE "AuditActionType" ADD VALUE 'COC_ISSUED';
ALTER TYPE "AuditActionType" ADD VALUE 'COC_REVOKED';
ALTER TYPE "AuditActionType" ADD VALUE 'HANDOVER_CERTIFICATE_ISSUED';
ALTER TYPE "AuditActionType" ADD VALUE 'CLOSURE_ITEM_COMPLETED';
ALTER TYPE "AuditActionType" ADD VALUE 'CLOSURE_ITEM_WAIVED';
ALTER TYPE "AuditActionType" ADD VALUE 'CLOSURE_AUDIT_SIGNED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_RATED';
ALTER TYPE "AuditActionType" ADD VALUE 'LESSON_PUBLISHED';
ALTER TYPE "AuditActionType" ADD VALUE 'CLOSURE_PACK_EXPORTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContractMilestoneAnchor" ADD VALUE 'COC_ISSUED';
ALTER TYPE "ContractMilestoneAnchor" ADD VALUE 'PROJECT_CLOSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MilestoneCompletionMode" ADD VALUE 'AUTO_COC_ISSUED';
ALTER TYPE "MilestoneCompletionMode" ADD VALUE 'AUTO_HANDOVER_ACCEPTED';
ALTER TYPE "MilestoneCompletionMode" ADD VALUE 'AUTO_FINAL_EVALUATION_APPROVED';

-- AlterTable
ALTER TABLE "handover_links" ADD COLUMN     "purpose" "HandoverLinkPurpose" NOT NULL DEFAULT 'HANDOVER';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "ratingCriteriaJson" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "completion_certificates" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "status" "CompletionCertificateStatus" NOT NULL DEFAULT 'DRAFT',
    "scopeSummary" TEXT NOT NULL,
    "completionDate" TEXT NOT NULL,
    "finalEvaluationInspectionId" UUID,
    "documentId" UUID,
    "slotsJson" JSONB NOT NULL DEFAULT '[]',
    "issuedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "revokedByUserId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "completion_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completion_certificate_signatures" (
    "id" UUID NOT NULL,
    "certificateId" UUID NOT NULL,
    "slotKey" TEXT NOT NULL,
    "slotLabel" TEXT NOT NULL,
    "userId" UUID,
    "roleId" UUID,
    "organizationId" UUID,
    "isBeneficiary" BOOLEAN NOT NULL DEFAULT false,
    "beneficiaryName" TEXT,
    "beneficiaryRole" TEXT,
    "evidenceDocumentId" UUID,
    "recordedByUserId" UUID,
    "registrationText" TEXT,
    "statement" TEXT NOT NULL,
    "statementHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completion_certificate_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closure_checklist_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "list" "ClosureChecklistList" NOT NULL,
    "itemKey" TEXT NOT NULL,
    "status" "ClosureChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "completedByUserId" UUID,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "closure_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_performance_ratings" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "projectContractorId" UUID NOT NULL,
    "stage" "ContractorRatingStage" NOT NULL,
    "criteriaJson" JSONB NOT NULL,
    "overallScore" DECIMAL(4,2) NOT NULL,
    "comments" TEXT,
    "ratedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_performance_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons_learned" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "LessonStatus" NOT NULL DEFAULT 'DRAFT',
    "sharedWithContractor" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lessons_learned_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "closure_pack_exports" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" "ClosurePackStatus" NOT NULL DEFAULT 'QUEUED',
    "documentId" UUID,
    "byteSize" INTEGER,
    "entryCount" INTEGER,
    "chainVerified" BOOLEAN,
    "requestedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "closure_pack_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "completion_certificates_projectId_status_idx" ON "completion_certificates"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "completion_certificates_projectId_certificateNumber_key" ON "completion_certificates"("projectId", "certificateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "completion_certificate_signatures_certificateId_slotKey_key" ON "completion_certificate_signatures"("certificateId", "slotKey");

-- CreateIndex
CREATE UNIQUE INDEX "completion_certificate_signatures_certificateId_userId_key" ON "completion_certificate_signatures"("certificateId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "closure_checklist_items_projectId_list_itemKey_key" ON "closure_checklist_items"("projectId", "list", "itemKey");

-- CreateIndex
CREATE INDEX "contractor_performance_ratings_projectId_idx" ON "contractor_performance_ratings"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_performance_ratings_projectContractorId_stage_ra_key" ON "contractor_performance_ratings"("projectContractorId", "stage", "ratedByUserId");

-- CreateIndex
CREATE INDEX "lessons_learned_tenantId_status_idx" ON "lessons_learned"("tenantId", "status");

-- CreateIndex
CREATE INDEX "lessons_learned_projectId_idx" ON "lessons_learned"("projectId");

-- CreateIndex
CREATE INDEX "closure_pack_exports_projectId_createdAt_idx" ON "closure_pack_exports"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "closure_pack_exports_status_idx" ON "closure_pack_exports"("status");

-- AddForeignKey
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_certificate_signatures" ADD CONSTRAINT "completion_certificate_signatures_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "completion_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completion_certificate_signatures" ADD CONSTRAINT "completion_certificate_signatures_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "project_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closure_checklist_items" ADD CONSTRAINT "closure_checklist_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_performance_ratings" ADD CONSTRAINT "contractor_performance_ratings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_performance_ratings" ADD CONSTRAINT "contractor_performance_ratings_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons_learned" ADD CONSTRAINT "lessons_learned_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closure_pack_exports" ADD CONSTRAINT "closure_pack_exports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "closure_pack_exports" ADD CONSTRAINT "closure_pack_exports_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 15 (hand-written, keep): at most one live (non-revoked) Certificate of Completion per project.
CREATE UNIQUE INDEX "completion_certificates_one_live_per_project" ON "completion_certificates"("projectId") WHERE "status" <> 'REVOKED';
