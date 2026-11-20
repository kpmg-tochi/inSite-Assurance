-- CreateEnum
CREATE TYPE "TranchePaymentBasis" AS ENUM ('MEASURED', 'FIXED_ON_COMPLETION');

-- CreateEnum
CREATE TYPE "TrancheCompletionRule" AS ENUM ('ALL_ITEMS_COMPLETE', 'WEIGHTED_PROGRESS_REACHED');

-- CreateEnum
CREATE TYPE "ReportingStreamKind" AS ENUM ('ITEM_REPORTS', 'INSPECTION');

-- CreateEnum
CREATE TYPE "InspectionVisitType" AS ENUM ('BASELINE', 'ROUTINE', 'MOBILISATION_CHECK', 'FINAL_EVALUATION');

-- CreateEnum
CREATE TYPE "InspectionOverallFinding" AS ENUM ('SATISFACTORY', 'MINOR_ISSUES', 'MAJOR_ISSUES');

-- CreateEnum
CREATE TYPE "SiteInspectionStatus" AS ENUM ('SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "InspectionFindingSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InspectionFindingStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "ApprovalSubjectType" ADD VALUE 'SITE_INSPECTION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'INSPECTION_SUBMITTED';
ALTER TYPE "AuditActionType" ADD VALUE 'INSPECTION_REVIEWED';
ALTER TYPE "AuditActionType" ADD VALUE 'INSPECTION_FINDING_RAISED';
ALTER TYPE "AuditActionType" ADD VALUE 'INSPECTION_FINDING_RESOLVED';
ALTER TYPE "AuditActionType" ADD VALUE 'REPORTING_STREAMS_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'CHECKLIST_TEMPLATE_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'CREDENTIAL_POLICY_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'REGISTRATION_BODY_SAVED';

-- AlterEnum
ALTER TYPE "MobileNotificationType" ADD VALUE 'INSPECTION_FINDING';

-- AlterEnum
ALTER TYPE "NotificationActionType" ADD VALUE 'OPEN_INSPECTION_FINDINGS';

-- AlterEnum
ALTER TYPE "ReportingCadence" ADD VALUE 'QUARTERLY';

-- DropIndex
DROP INDEX "reporting_obligations_projectId_boqItemId_reporterScope_per_key";

-- AlterTable
ALTER TABLE "FacilityTranche" ADD COLUMN     "completionRequiredItemPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
ADD COLUMN     "completionRule" "TrancheCompletionRule",
ADD COLUMN     "fixedReleaseAmountNgn" DECIMAL(18,2),
ADD COLUMN     "paymentBasis" "TranchePaymentBasis" NOT NULL DEFAULT 'MEASURED';

-- AlterTable
ALTER TABLE "FieldAgentSession" DROP COLUMN "corenLicenseNumber",
ADD COLUMN     "registrationBodyCode" TEXT,
ADD COLUMN     "registrationNumber" TEXT;

-- AlterTable
ALTER TABLE "FieldEvidenceLog" ADD COLUMN     "checklistItemKey" TEXT,
ADD COLUMN     "siteInspectionReportId" UUID;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "cadenceQuarterAnchorMonth" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "professionalLicenseNumber",
DROP COLUMN "professionalLicenseType",
ADD COLUMN     "professionalRegistrationBodyCode" TEXT,
ADD COLUMN     "professionalRegistrationNumber" TEXT;

-- AlterTable
ALTER TABLE "ValuationReport" ADD COLUMN     "certifierRegistrationBodyName" TEXT,
ADD COLUMN     "certifierRegistrationPrefix" TEXT,
DROP COLUMN "certifierLicenseType",
ADD COLUMN     "certifierLicenseType" TEXT,
ALTER COLUMN "certifierLicenseNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "milestone_verifications" ADD COLUMN     "paymentTermsJson" JSONB;

-- AlterTable
ALTER TABLE "reporting_obligations" ADD COLUMN     "siteInspectionReportId" UUID,
ADD COLUMN     "streamId" UUID,
ALTER COLUMN "boqItemId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "credentialPolicyJson" JSONB NOT NULL DEFAULT '{}';

-- DropEnum
DROP TYPE "ProfessionalLicenseType";

-- CreateTable
CREATE TABLE "professional_registration_bodies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayPrefix" TEXT NOT NULL,
    "exampleNumber" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "professional_registration_bodies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_reporting_streams" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "ReportingStreamKind" NOT NULL,
    "roleIds" UUID[],
    "projectContractorId" UUID,
    "reportingCadence" "ReportingCadence" NOT NULL,
    "workWeekDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "periodStartDayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "customIntervalDays" INTEGER,
    "quarterAnchorMonth" INTEGER,
    "reportDueTime" TEXT,
    "reportGraceMinutes" INTEGER NOT NULL DEFAULT 0,
    "cadenceAnchorDate" TEXT,
    "visitType" "InspectionVisitType",
    "submissionDeadlineDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "pendingCadenceJson" JSONB,
    "pendingCadenceEffectiveFrom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_reporting_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_checklist_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visitTypes" "InspectionVisitType"[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "sectionsJson" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_inspection_reports" (
    "id" UUID NOT NULL,
    "clientReportId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "streamId" UUID,
    "visitType" "InspectionVisitType" NOT NULL,
    "templateId" UUID NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "visitDate" TEXT NOT NULL,
    "reporterFieldSessionId" UUID,
    "reporterUserId" UUID,
    "reporterName" TEXT NOT NULL,
    "reporterRoleId" UUID,
    "reporterRoleName" TEXT NOT NULL,
    "reporterPersonaType" "FieldPersonaType" NOT NULL DEFAULT 'INDEPENDENT_VERIFIER',
    "reporterProjectContractorId" UUID,
    "answersJson" JSONB NOT NULL,
    "overallFinding" "InspectionOverallFinding" NOT NULL,
    "summaryText" TEXT NOT NULL,
    "submissionGeotag" JSONB,
    "geofenceStatus" "GeofenceStatus",
    "status" "SiteInspectionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reportingPeriodStart" TEXT,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "submissionDeadline" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "approvalChainVersion" INTEGER,
    "currentApprovalStep" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "returnedNotes" TEXT,
    "aiCheckStatus" "WorkdayAiCheckStatus" NOT NULL DEFAULT 'PENDING',
    "aiCheckEngine" TEXT,
    "aiFlagsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_inspection_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_findings" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "checklistItemKey" TEXT NOT NULL,
    "projectContractorId" UUID,
    "description" TEXT NOT NULL,
    "severity" "InspectionFindingSeverity" NOT NULL DEFAULT 'MAJOR',
    "status" "InspectionFindingStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedNotes" TEXT,
    "resolutionCaptureIds" UUID[],
    "raisedByUserId" UUID,
    "raisedByName" TEXT,
    "resolvedByUserId" UUID,
    "resolvedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "inspection_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "professional_registration_bodies_tenantId_idx" ON "professional_registration_bodies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "professional_registration_bodies_tenantId_code_key" ON "professional_registration_bodies"("tenantId", "code");

-- CreateIndex
CREATE INDEX "project_reporting_streams_projectId_isActive_idx" ON "project_reporting_streams"("projectId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "project_reporting_streams_projectId_key_key" ON "project_reporting_streams"("projectId", "key");

-- CreateIndex
CREATE INDEX "inspection_checklist_templates_tenantId_isArchived_idx" ON "inspection_checklist_templates"("tenantId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_checklist_templates_tenantId_code_version_key" ON "inspection_checklist_templates"("tenantId", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "site_inspection_reports_clientReportId_key" ON "site_inspection_reports"("clientReportId");

-- CreateIndex
CREATE INDEX "site_inspection_reports_projectId_visitType_visitDate_idx" ON "site_inspection_reports"("projectId", "visitType", "visitDate");

-- CreateIndex
CREATE INDEX "site_inspection_reports_projectId_status_idx" ON "site_inspection_reports"("projectId", "status");

-- CreateIndex
CREATE INDEX "site_inspection_reports_aiCheckStatus_updatedAt_idx" ON "site_inspection_reports"("aiCheckStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "inspection_findings_projectId_status_idx" ON "inspection_findings"("projectId", "status");

-- CreateIndex
CREATE INDEX "inspection_findings_inspectionId_idx" ON "inspection_findings"("inspectionId");

-- CreateIndex
CREATE INDEX "inspection_findings_projectContractorId_status_idx" ON "inspection_findings"("projectContractorId", "status");

-- CreateIndex
CREATE INDEX "FieldEvidenceLog_siteInspectionReportId_idx" ON "FieldEvidenceLog"("siteInspectionReportId");

-- CreateIndex
CREATE INDEX "reporting_obligations_projectId_boqItemId_reporterScope_per_idx" ON "reporting_obligations"("projectId", "boqItemId", "reporterScope", "periodStart");

-- CreateIndex
CREATE INDEX "reporting_obligations_streamId_periodStart_idx" ON "reporting_obligations"("streamId", "periodStart");

-- AddForeignKey
ALTER TABLE "FieldEvidenceLog" ADD CONSTRAINT "FieldEvidenceLog_siteInspectionReportId_fkey" FOREIGN KEY ("siteInspectionReportId") REFERENCES "site_inspection_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_obligations" ADD CONSTRAINT "reporting_obligations_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "project_reporting_streams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_obligations" ADD CONSTRAINT "reporting_obligations_siteInspectionReportId_fkey" FOREIGN KEY ("siteInspectionReportId") REFERENCES "site_inspection_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_registration_bodies" ADD CONSTRAINT "professional_registration_bodies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reporting_streams" ADD CONSTRAINT "project_reporting_streams_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reporting_streams" ADD CONSTRAINT "project_reporting_streams_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_checklist_templates" ADD CONSTRAINT "inspection_checklist_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_inspection_reports" ADD CONSTRAINT "site_inspection_reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_inspection_reports" ADD CONSTRAINT "site_inspection_reports_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "project_reporting_streams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_inspection_reports" ADD CONSTRAINT "site_inspection_reports_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "inspection_checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "site_inspection_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written (Phase 14): Prisma cannot express these. Keep them when regenerating.
CREATE UNIQUE INDEX "reporting_obligations_item_period_key"
  ON "reporting_obligations" ("projectId", "boqItemId", "reporterScope", "periodStart",
    COALESCE("streamId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "boqItemId" IS NOT NULL;
CREATE UNIQUE INDEX "reporting_obligations_inspection_period_key"
  ON "reporting_obligations" ("streamId", "reporterScope", "periodStart")
  WHERE "boqItemId" IS NULL;
ALTER TABLE "reporting_obligations"
  ADD CONSTRAINT "reporting_obligations_item_or_stream_check"
  CHECK ("boqItemId" IS NOT NULL OR "streamId" IS NOT NULL);
