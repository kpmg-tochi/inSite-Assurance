-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ContractMilestoneAnchor" AS ENUM ('CONTRACT_AWARD', 'CONTRACT_SIGNED', 'KICKOFF', 'ACTIVATION', 'MILESTONE');

-- CreateEnum
CREATE TYPE "MilestoneOffsetUnit" AS ENUM ('CALENDAR_DAYS', 'WORKING_DAYS');

-- CreateEnum
CREATE TYPE "ContractMilestoneStatus" AS ENUM ('PENDING', 'DUE', 'OVERDUE', 'DONE', 'WAIVED');

-- CreateEnum
CREATE TYPE "MilestoneCompletionMode" AS ENUM ('MANUAL', 'AUTO_CONTRACTOR_ON_SITE', 'AUTO_KICKOFF_NOTICE_SENT', 'AUTO_KICKOFF_QUORUM', 'AUTO_SCHEDULE_BASELINE_SET');

-- CreateEnum
CREATE TYPE "DefaultCaseTrigger" AS ENUM ('MILESTONE_OVERDUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "DefaultCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'CURE_PERIOD', 'EXTENSION_GRANTED', 'TERMINATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProgrammeOfWorksStatus" AS ENUM ('PENDING', 'ACCEPTED', 'RETURNED');

-- AlterEnum
ALTER TYPE "ApprovalChainType" ADD VALUE 'CONTRACT_DEFAULT';

-- AlterEnum
ALTER TYPE "ApprovalSubjectType" ADD VALUE 'CONTRACT_DEFAULT_CASE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'DOCUMENT_UPLOADED';
ALTER TYPE "AuditActionType" ADD VALUE 'DOCUMENT_VERSIONED';
ALTER TYPE "AuditActionType" ADD VALUE 'DOCUMENT_SIGNED';
ALTER TYPE "AuditActionType" ADD VALUE 'DOCUMENT_ARCHIVED';
ALTER TYPE "AuditActionType" ADD VALUE 'DOCUMENT_TYPE_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACT_DETAILS_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'MILESTONE_COMPLETED';
ALTER TYPE "AuditActionType" ADD VALUE 'MILESTONE_WAIVED';
ALTER TYPE "AuditActionType" ADD VALUE 'MILESTONE_DATES_RECOMPUTED';
ALTER TYPE "AuditActionType" ADD VALUE 'KICKOFF_SCHEDULED';
ALTER TYPE "AuditActionType" ADD VALUE 'KICKOFF_NOTICE_SENT';
ALTER TYPE "AuditActionType" ADD VALUE 'KICKOFF_HELD';
ALTER TYPE "AuditActionType" ADD VALUE 'DEFAULT_CASE_OPENED';
ALTER TYPE "AuditActionType" ADD VALUE 'DEFAULT_CASE_REVIEWED';
ALTER TYPE "AuditActionType" ADD VALUE 'DEFAULT_CASE_DECIDED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_TERMINATED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_REPLACED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROGRAMME_OF_WORKS_SUBMITTED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROGRAMME_OF_WORKS_DECIDED';

-- AlterEnum
ALTER TYPE "TrancheCompletionRule" ADD VALUE 'CONTRACT_MILESTONE_DONE';

-- AlterTable
ALTER TABLE "ConditionPrecedent" DROP COLUMN "evidenceDocumentUrl",
ADD COLUMN     "evidenceDocumentId" UUID;

-- AlterTable
ALTER TABLE "FacilityTranche" ADD COLUMN     "completionContractMilestoneKey" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "contractAwardDate" TEXT,
ADD COLUMN     "contractReference" TEXT,
ADD COLUMN     "contractSignedDate" TEXT,
ADD COLUMN     "contractSumNgn" DECIMAL(18,2),
ADD COLUMN     "kickoffDate" TEXT,
ADD COLUMN     "kickoffHeldAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "project_contractors" ADD COLUMN     "contractStatus" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "replacesProjectContractorId" UUID,
ADD COLUMN     "terminatedAt" TIMESTAMP(3),
ADD COLUMN     "terminationCaseId" UUID;

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibleToContractors" BOOLEAN NOT NULL DEFAULT false,
    "requiresSignOff" BOOLEAN NOT NULL DEFAULT false,
    "signOffPermissionKey" TEXT,
    "allowedMimeTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_documents" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "documentTypeId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "uploadedByUserId" UUID,
    "projectContractorId" UUID,
    "linkedMilestoneId" UUID,
    "linkedConditionPrecedentId" UUID,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_document_versions" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedByUserId" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "project_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_document_sign_offs" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID,
    "organizationId" UUID,
    "statement" TEXT NOT NULL,
    "statementHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_document_sign_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_contract_milestones" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "projectContractorId" UUID,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "anchor" "ContractMilestoneAnchor" NOT NULL,
    "anchorMilestoneKey" TEXT,
    "offsetValue" INTEGER NOT NULL,
    "offsetUnit" "MilestoneOffsetUnit" NOT NULL DEFAULT 'CALENDAR_DAYS',
    "anchorDateOverride" TEXT,
    "dueDate" TEXT,
    "status" "ContractMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "completionMode" "MilestoneCompletionMode" NOT NULL DEFAULT 'MANUAL',
    "requiredDocumentTypeCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresSignOffPermissionKey" TEXT,
    "responsibleRoleId" UUID,
    "responsibleOrganizationScope" TEXT NOT NULL DEFAULT 'ANY',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" UUID,
    "completedNotes" TEXT,
    "waivedReason" TEXT,
    "lastNotifiedAt" TIMESTAMP(3),
    "lastNotifiedStatus" "ContractMilestoneStatus",
    "remindedOffsetsDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_contract_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kickoff_meetings" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "virtualLink" TEXT,
    "agendaDocumentId" UUID,
    "minutesDocumentId" UUID,
    "noticeSentAt" TIMESTAMP(3),
    "noticeWaivedReason" TEXT,
    "heldAt" TIMESTAMP(3),
    "quorumMet" BOOLEAN,
    "quorumWaivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kickoff_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kickoff_invitees" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "stakeholderGroup" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "organizationId" UUID,
    "userId" UUID,
    "outboundMessageId" UUID,
    "attended" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kickoff_invitees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_default_cases" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "projectContractorId" UUID NOT NULL,
    "trigger" "DefaultCaseTrigger" NOT NULL,
    "milestoneId" UUID,
    "status" "DefaultCaseStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "outcomeNotes" TEXT,
    "newDueDate" TEXT,
    "cureLapsedAt" TIMESTAMP(3),
    "chainVersion" INTEGER NOT NULL,
    "currentStepOrder" INTEGER,
    "openedByUserId" UUID,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,

    CONSTRAINT "contractor_default_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_of_works_submissions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "projectContractorId" UUID,
    "submittedByUserId" UUID NOT NULL,
    "proposalJson" JSONB NOT NULL,
    "status" "ProgrammeOfWorksStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" UUID,
    "decisionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "programme_of_works_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_types_tenantId_code_key" ON "document_types"("tenantId", "code");

-- CreateIndex
CREATE INDEX "project_documents_projectId_documentTypeId_idx" ON "project_documents"("projectId", "documentTypeId");

-- CreateIndex
CREATE INDEX "project_documents_projectContractorId_idx" ON "project_documents"("projectContractorId");

-- CreateIndex
CREATE UNIQUE INDEX "project_document_versions_objectKey_key" ON "project_document_versions"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "project_document_versions_documentId_version_key" ON "project_document_versions"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "project_document_sign_offs_documentId_version_userId_key" ON "project_document_sign_offs"("documentId", "version", "userId");

-- CreateIndex
CREATE INDEX "project_contract_milestones_projectId_status_idx" ON "project_contract_milestones"("projectId", "status");

-- CreateIndex
CREATE INDEX "project_contract_milestones_projectContractorId_idx" ON "project_contract_milestones"("projectContractorId");

-- CreateIndex
CREATE UNIQUE INDEX "kickoff_meetings_projectId_key" ON "kickoff_meetings"("projectId");

-- CreateIndex
CREATE INDEX "kickoff_invitees_meetingId_idx" ON "kickoff_invitees"("meetingId");

-- CreateIndex
CREATE INDEX "contractor_default_cases_projectId_status_idx" ON "contractor_default_cases"("projectId", "status");

-- CreateIndex
CREATE INDEX "contractor_default_cases_projectContractorId_idx" ON "contractor_default_cases"("projectContractorId");

-- CreateIndex
CREATE INDEX "contractor_default_cases_milestoneId_idx" ON "contractor_default_cases"("milestoneId");

-- CreateIndex
CREATE INDEX "programme_of_works_submissions_projectId_status_idx" ON "programme_of_works_submissions"("projectId", "status");

-- AddForeignKey
ALTER TABLE "project_contractors" ADD CONSTRAINT "project_contractors_replacesProjectContractorId_fkey" FOREIGN KEY ("replacesProjectContractorId") REFERENCES "project_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionPrecedent" ADD CONSTRAINT "ConditionPrecedent_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_linkedMilestoneId_fkey" FOREIGN KEY ("linkedMilestoneId") REFERENCES "project_contract_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_document_versions" ADD CONSTRAINT "project_document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "project_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_document_sign_offs" ADD CONSTRAINT "project_document_sign_offs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "project_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contract_milestones" ADD CONSTRAINT "project_contract_milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contract_milestones" ADD CONSTRAINT "project_contract_milestones_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kickoff_meetings" ADD CONSTRAINT "kickoff_meetings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kickoff_meetings" ADD CONSTRAINT "kickoff_meetings_agendaDocumentId_fkey" FOREIGN KEY ("agendaDocumentId") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kickoff_meetings" ADD CONSTRAINT "kickoff_meetings_minutesDocumentId_fkey" FOREIGN KEY ("minutesDocumentId") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kickoff_invitees" ADD CONSTRAINT "kickoff_invitees_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "kickoff_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_default_cases" ADD CONSTRAINT "contractor_default_cases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_default_cases" ADD CONSTRAINT "contractor_default_cases_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_default_cases" ADD CONSTRAINT "contractor_default_cases_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "project_contract_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_of_works_submissions" ADD CONSTRAINT "programme_of_works_submissions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_of_works_submissions" ADD CONSTRAINT "programme_of_works_submissions_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 13 (hand-written): one milestone per project, key and contractor. Project-level rows have
-- projectContractorId NULL, so COALESCE makes it a real value. Keep in every regenerated migration.
CREATE UNIQUE INDEX "contract_milestones_project_key_contractor_key"
  ON "project_contract_milestones" ("projectId", "key",
    COALESCE("projectContractorId", '00000000-0000-0000-0000-000000000000'::uuid));
