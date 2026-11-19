-- CreateEnum
CREATE TYPE "DocumentRequirementMode" AS ENUM ('REQUIRED_AT_CREATION', 'OPTIONAL_AT_CREATION', 'DISABLED');

-- CreateEnum
CREATE TYPE "DisbursementMechanism" AS ENUM ('IPC_CLAIM_REQUIRED', 'MILESTONE_DIRECT_DISBURSEMENT');

-- CreateEnum
CREATE TYPE "StandardCategory" AS ENUM ('MATERIAL_QUALITY', 'EXECUTION_METHOD', 'TESTING_TOLERANCE', 'SAFETY_ENVIRONMENT', 'GENERAL_SPECIFICATION');

-- CreateEnum
CREATE TYPE "NeedsAssessmentDocType" AS ENUM ('COMMUNITY_NEEDS_ASSESSMENT', 'FEASIBILITY_STUDY', 'ENVIRONMENTAL_SOCIAL_IMPACT', 'STAKEHOLDER_REQUIREMENTS', 'TECHNICAL_BASELINE');

-- CreateEnum
CREATE TYPE "ApprovalChainType" AS ENUM ('REPORT', 'DISBURSEMENT');

-- CreateEnum
CREATE TYPE "ApprovalSubjectType" AS ENUM ('WORKDAY_REPORT', 'VALUATION_REPORT');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'RETURN', 'REJECT');

-- CreateEnum
CREATE TYPE "BriefPersona" AS ENUM ('CONTRACTOR_EXECUTOR', 'INDEPENDENT_VERIFIER');

-- CreateEnum
CREATE TYPE "ReportQuerySource" AS ENUM ('MONITOR', 'AI_OMISSION_CHECK', 'AI_STANDARDS_CHECK');

-- CreateEnum
CREATE TYPE "ValuationSource" AS ENUM ('IPC_CLAIM', 'MILESTONE_DIRECT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'WORKFLOW_TEMPLATE_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_PROCESS_CONFIG_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_STANDARD_CREATED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_STANDARD_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_STANDARD_DELETED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_ASSESSMENT_UPLOADED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_ASSESSMENT_DELETED';
ALTER TYPE "AuditActionType" ADD VALUE 'WORKDAY_REPORT_APPROVED';
ALTER TYPE "AuditActionType" ADD VALUE 'WORKDAY_REPORT_RETURNED';
ALTER TYPE "AuditActionType" ADD VALUE 'STANDARDS_VIOLATION_FLAGGED';
ALTER TYPE "AuditActionType" ADD VALUE 'APPROVAL_STEP_ACTIONED';
ALTER TYPE "AuditActionType" ADD VALUE 'DIRECT_MILESTONE_VERIFIED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkdayReportStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "WorkdayReportStatus" ADD VALUE 'APPROVED_COMPLETED';
ALTER TYPE "WorkdayReportStatus" ADD VALUE 'RETURNED_FOR_REVISION';

-- DropIndex
DROP INDEX "morning_deliverable_briefs_projectId_boqItemId_workdayDate_key";

-- AlterTable (hand-edited: projectId and trancheId are backfilled from the IPC before NOT NULL)
ALTER TABLE "ValuationReport" ADD COLUMN     "approvalChainVersion" INTEGER,
ADD COLUMN     "currentApprovalStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "milestoneVerificationId" UUID,
ADD COLUMN     "projectId" UUID,
ADD COLUMN     "source" "ValuationSource" NOT NULL DEFAULT 'IPC_CLAIM',
ADD COLUMN     "trancheId" UUID,
ALTER COLUMN "ipcClaimId" DROP NOT NULL;

UPDATE "ValuationReport" v
SET "projectId" = c."projectId", "trancheId" = c."trancheId"
FROM "IpcClaim" c
WHERE v."ipcClaimId" = c."id";

ALTER TABLE "ValuationReport" ALTER COLUMN "projectId" SET NOT NULL,
ALTER COLUMN "trancheId" SET NOT NULL;

-- ipcClaimId is set exactly when the valuation comes from an IPC (Phase 7). Keep when regenerating.
ALTER TABLE "ValuationReport" ADD CONSTRAINT "ValuationReport_source_ipc_check"
  CHECK (("source" = 'IPC_CLAIM') = ("ipcClaimId" IS NOT NULL));
-- A direct valuation always points at its verification.
ALTER TABLE "ValuationReport" ADD CONSTRAINT "ValuationReport_source_verification_check"
  CHECK (("source" = 'MILESTONE_DIRECT') = ("milestoneVerificationId" IS NOT NULL));

-- AlterTable
ALTER TABLE "morning_deliverable_briefs" ADD COLUMN     "appliedStandardsJson" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "targetPersona" "BriefPersona" NOT NULL DEFAULT 'CONTRACTOR_EXECUTOR';

-- AlterTable
-- (hand-edited: the text column is converted in place instead of dropped and recreated)
ALTER TABLE "report_queries" ADD COLUMN     "standardsViolationsPayload" JSONB;
ALTER TABLE "report_queries" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "report_queries" ALTER COLUMN "source" TYPE "ReportQuerySource" USING ("source"::"ReportQuerySource");
ALTER TABLE "report_queries" ALTER COLUMN "source" SET DEFAULT 'MONITOR';

-- AlterTable
ALTER TABLE "workday_reports" ADD COLUMN     "approvalChainVersion" INTEGER,
ADD COLUMN     "approvedCompletedAt" TIMESTAMP(3),
ADD COLUMN     "currentApprovalStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reporterPersonaType" "FieldPersonaType" NOT NULL DEFAULT 'INDEPENDENT_VERIFIER',
ADD COLUMN     "standardsCompliancePassed" BOOLEAN,
ADD COLUMN     "standardsViolationsJson" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "milestone_verifications" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "trancheId" UUID NOT NULL,
    "verifiedByUserId" UUID NOT NULL,
    "verificationSummary" TEXT NOT NULL,
    "lineVerificationsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "configJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_process_configs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workflowTemplateId" UUID,
    "needsAssessmentMode" "DocumentRequirementMode" NOT NULL DEFAULT 'OPTIONAL_AT_CREATION',
    "standardsSpecificationMode" "DocumentRequirementMode" NOT NULL DEFAULT 'OPTIONAL_AT_CREATION',
    "disbursementMechanism" "DisbursementMechanism" NOT NULL DEFAULT 'IPC_CLAIM_REQUIRED',
    "enableTranchesAndCps" BOOLEAN NOT NULL DEFAULT true,
    "enableHoldPoints" BOOLEAN NOT NULL DEFAULT true,
    "allowContractorFieldReporting" BOOLEAN NOT NULL DEFAULT true,
    "enableContractorIdentityAssurance" BOOLEAN NOT NULL DEFAULT true,
    "enableAiOmissionCheck" BOOLEAN NOT NULL DEFAULT true,
    "enableAiStandardsCheck" BOOLEAN NOT NULL DEFAULT true,
    "requireReportApproval" BOOLEAN NOT NULL DEFAULT false,
    "enableHandoverModule" BOOLEAN NOT NULL DEFAULT false,
    "enableRetentionModule" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_process_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "chainType" "ApprovalChainType" NOT NULL,
    "version" INTEGER NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "requiredPermissionKey" TEXT NOT NULL,
    "requiredRoleId" UUID,
    "minAmountThresholdNgn" DECIMAL(18,2),
    "isSystemStep" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "chainType" "ApprovalChainType" NOT NULL,
    "subjectType" "ApprovalSubjectType" NOT NULL,
    "subjectId" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_standard_specifications" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "StandardCategory" NOT NULL,
    "specificationText" TEXT NOT NULL,
    "documentObjectKey" TEXT,
    "applicableWbsCodes" JSONB NOT NULL DEFAULT '[]',
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_standard_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_needs_assessment_documents" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "documentType" "NeedsAssessmentDocType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "extractedSummaryText" TEXT,
    "keyFindingsJson" JSONB NOT NULL DEFAULT '[]',
    "summaryStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "summaryEngine" TEXT,
    "uploadedByUserId" UUID NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_needs_assessment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestone_verifications_projectId_trancheId_idx" ON "milestone_verifications"("projectId", "trancheId");

-- CreateIndex
CREATE INDEX "workflow_templates_tenantId_idx" ON "workflow_templates"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_templates_tenantId_name_key" ON "workflow_templates"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_process_configs_projectId_key" ON "project_process_configs"("projectId");

-- CreateIndex
CREATE INDEX "approval_steps_projectId_chainType_isActive_idx" ON "approval_steps"("projectId", "chainType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_projectId_chainType_version_stepOrder_key" ON "approval_steps"("projectId", "chainType", "version", "stepOrder");

-- CreateIndex
CREATE INDEX "approval_actions_subjectType_subjectId_createdAt_idx" ON "approval_actions"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "approval_actions_projectId_chainType_idx" ON "approval_actions"("projectId", "chainType");

-- CreateIndex
CREATE UNIQUE INDEX "project_standard_specifications_projectId_code_key" ON "project_standard_specifications"("projectId", "code");

-- CreateIndex
CREATE INDEX "project_needs_assessment_documents_projectId_idx" ON "project_needs_assessment_documents"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationReport_milestoneVerificationId_key" ON "ValuationReport"("milestoneVerificationId");

-- CreateIndex
CREATE INDEX "ValuationReport_projectId_source_idx" ON "ValuationReport"("projectId", "source");

-- CreateIndex
CREATE INDEX "ValuationReport_trancheId_idx" ON "ValuationReport"("trancheId");

-- CreateIndex
CREATE UNIQUE INDEX "morning_deliverable_briefs_projectId_boqItemId_workdayDate__key" ON "morning_deliverable_briefs"("projectId", "boqItemId", "workdayDate", "targetPersona");

-- AddForeignKey
ALTER TABLE "ValuationReport" ADD CONSTRAINT "ValuationReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationReport" ADD CONSTRAINT "ValuationReport_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "FacilityTranche"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValuationReport" ADD CONSTRAINT "ValuationReport_milestoneVerificationId_fkey" FOREIGN KEY ("milestoneVerificationId") REFERENCES "milestone_verifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_verifications" ADD CONSTRAINT "milestone_verifications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_verifications" ADD CONSTRAINT "milestone_verifications_trancheId_fkey" FOREIGN KEY ("trancheId") REFERENCES "FacilityTranche"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_verifications" ADD CONSTRAINT "milestone_verifications_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_process_configs" ADD CONSTRAINT "project_process_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "approval_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_standard_specifications" ADD CONSTRAINT "project_standard_specifications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_needs_assessment_documents" ADD CONSTRAINT "project_needs_assessment_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
