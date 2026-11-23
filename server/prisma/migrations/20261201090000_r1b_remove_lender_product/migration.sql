-- Redesign R1b: remove the lender product (IPC claims, reconciliation, valuations, tranches,
-- conditions precedent, disbursement chain, retention release requests) and add the payment record.
--
-- Data cleanup first, so the enum narrowing below succeeds on an existing (disposable, decision A)
-- database. On a fresh database these statements change nothing.
DELETE FROM "approval_actions" WHERE "chainType"::text = 'DISBURSEMENT' OR "subjectType"::text = 'VALUATION_REPORT';
DELETE FROM "approval_steps" WHERE "chainType"::text = 'DISBURSEMENT';
DELETE FROM "AuditLog" WHERE "action"::text IN ('IPC_SUBMITTED', 'AI_RECONCILIATION_COMPLETED', 'VALUATION_REPORT_CERTIFIED', 'LENDER_TRANCHE_DECIDED', 'CP_STATUS_CHANGED', 'CP_WAIVED', 'MONITOR_QUERY_RESOLVED', 'IPC_WITHDRAWN', 'TRANCHE_DECISION_REVERSED', 'DIRECT_MILESTONE_VERIFIED', 'RETENTION_RELEASE_REQUESTED', 'RETENTION_RELEASE_CANCELLED');
DELETE FROM "EvidenceMedia" WHERE "mediaType"::text = 'VALUATION_REPORT_PDF';
DELETE FROM "permissions" WHERE "category"::text = 'FINANCIAL_IPC';

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('INTERIM', 'FINAL', 'RETENTION_RELEASE');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('MANUAL', 'ERP');

-- AlterEnum
BEGIN;
CREATE TYPE "ApprovalChainType_new" AS ENUM ('REPORT', 'CONTRACT_DEFAULT');
ALTER TABLE "approval_steps" ALTER COLUMN "chainType" TYPE "ApprovalChainType_new" USING ("chainType"::text::"ApprovalChainType_new");
ALTER TABLE "approval_actions" ALTER COLUMN "chainType" TYPE "ApprovalChainType_new" USING ("chainType"::text::"ApprovalChainType_new");
ALTER TYPE "ApprovalChainType" RENAME TO "ApprovalChainType_old";
ALTER TYPE "ApprovalChainType_new" RENAME TO "ApprovalChainType";
DROP TYPE "public"."ApprovalChainType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ApprovalSubjectType_new" AS ENUM ('WORKDAY_REPORT', 'SITE_INSPECTION', 'CONTRACT_DEFAULT_CASE');
ALTER TABLE "approval_actions" ALTER COLUMN "subjectType" TYPE "ApprovalSubjectType_new" USING ("subjectType"::text::"ApprovalSubjectType_new");
ALTER TYPE "ApprovalSubjectType" RENAME TO "ApprovalSubjectType_old";
ALTER TYPE "ApprovalSubjectType_new" RENAME TO "ApprovalSubjectType";
DROP TYPE "public"."ApprovalSubjectType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "AuditActionType_new" AS ENUM ('TENANT_CREATED', 'TENANT_BRANDING_UPDATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'USER_PROJECT_ASSIGNED', 'PROJECT_CREATED', 'BASELINE_UPDATED', 'BOQ_UPLOADED', 'JOIN_CODE_ISSUED', 'FIELD_AGENT_JOINED', 'FIELD_SESSION_STATUS_UPDATED', 'CONTRACTOR_ASSURANCE_SUBMITTED', 'CONTRACTOR_ASSURANCE_APPROVED', 'CONTRACTOR_ASSURANCE_REJECTED', 'EVIDENCE_EXTRACTED', 'EVIDENCE_CONFIRMED', 'EVIDENCE_FLAGGED_INTEGRITY', 'MONITOR_QUERY_RAISED', 'CONTRACTOR_QUERY_RESPONDED', 'INCIDENT_REPORT_SUBMITTED', 'INCIDENT_STATUS_UPDATED', 'PUSH_TOKEN_REGISTERED', 'WORKDAY_REPORT_SUBMITTED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'JOIN_CODE_ROTATED', 'LOGIN_FAILED_LOCKOUT', 'TENANT_SETTINGS_UPDATED', 'CAPTURE_REGISTERED', 'CAPTURE_FLAGGED_INTEGRITY', 'TELEMETRY_ANOMALY_SUMMARY', 'WORKDAY_REPORTS_RELEASED', 'DEVICE_KEY_REGISTERED', 'REPORT_QUERY_RESOLVED', 'MOBILE_USER_SIGNED_IN', 'MOBILE_DEVICE_REVOKED', 'ROLE_ONBOARDING_MODE_CHANGED', 'ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'PROJECT_DRAFT_CREATED', 'PROJECT_SETUP_STEP_SAVED', 'PROJECT_ACTIVATED', 'PROJECT_ARCHIVED', 'PROJECT_CONTRACTOR_ADDED', 'PROJECT_CONTRACTOR_REMOVED', 'BOQ_REVISED', 'PROJECT_DRAFT_DELETED', 'WORKFLOW_TEMPLATE_SAVED', 'PROJECT_PROCESS_CONFIG_UPDATED', 'PROJECT_STANDARD_CREATED', 'PROJECT_STANDARD_UPDATED', 'PROJECT_STANDARD_DELETED', 'NEEDS_ASSESSMENT_UPLOADED', 'NEEDS_ASSESSMENT_DELETED', 'WORKDAY_REPORT_APPROVED', 'WORKDAY_REPORT_RETURNED', 'STANDARDS_VIOLATION_FLAGGED', 'APPROVAL_STEP_ACTIONED', 'REPORT_SUBMITTED_LATE', 'REPORT_MISSED', 'PARTICIPANT_PREREGISTERED', 'PARTICIPANT_REMINDER_SENT', 'ATTENDANCE_ALERT_RAISED', 'ATTENDANCE_ALERT_RESOLVED', 'MANUAL_CHECKIN_RECORDED', 'REPORTING_OBLIGATION_EXCUSED', 'SCHEDULE_BASELINE_SET', 'SCHEDULE_REVISION_PROPOSED', 'SCHEDULE_REVISION_APPLIED', 'SCHEDULE_REVISION_REJECTED', 'SCHEDULE_REVISION_WITHDRAWN', 'HANDOVER_LINK_CREATED', 'HANDOVER_LINK_REVOKED', 'HANDOVER_SUBMITTED', 'HANDOVER_REVIEWED', 'PROJECT_PHASE_CHANGED', 'RETENTION_WITHHELD', 'DEFECT_TICKET_RAISED', 'DEFECT_TICKET_UPDATED', 'DEFECT_TICKET_CLOSED', 'RETENTION_RELEASED', 'PROJECT_TYPE_SAVED', 'PROJECT_TYPE_APPLIED', 'ORGANIZATION_HIERARCHY_CHANGED', 'TERMINOLOGY_UPDATED', 'INSPECTION_SUBMITTED', 'INSPECTION_REVIEWED', 'INSPECTION_FINDING_RAISED', 'INSPECTION_FINDING_RESOLVED', 'REPORTING_STREAMS_SAVED', 'CHECKLIST_TEMPLATE_SAVED', 'CREDENTIAL_POLICY_UPDATED', 'REGISTRATION_BODY_SAVED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERSIONED', 'DOCUMENT_SIGNED', 'DOCUMENT_ARCHIVED', 'DOCUMENT_TYPE_SAVED', 'CONTRACT_DETAILS_SAVED', 'MILESTONE_COMPLETED', 'MILESTONE_WAIVED', 'MILESTONE_DATES_RECOMPUTED', 'KICKOFF_SCHEDULED', 'KICKOFF_NOTICE_SENT', 'KICKOFF_HELD', 'DEFAULT_CASE_OPENED', 'DEFAULT_CASE_REVIEWED', 'DEFAULT_CASE_DECIDED', 'CONTRACTOR_TERMINATED', 'CONTRACTOR_REPLACED', 'PROGRAMME_OF_WORKS_SUBMITTED', 'PROGRAMME_OF_WORKS_DECIDED', 'COC_DRAFTED', 'COC_SIGNED', 'COC_ISSUED', 'COC_REVOKED', 'HANDOVER_CERTIFICATE_ISSUED', 'CLOSURE_ITEM_COMPLETED', 'CLOSURE_ITEM_WAIVED', 'CLOSURE_AUDIT_SIGNED', 'CONTRACTOR_RATED', 'LESSON_PUBLISHED', 'CLOSURE_PACK_EXPORTED', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED');
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditActionType_new" USING ("action"::text::"AuditActionType_new");
ALTER TYPE "AuditActionType" RENAME TO "AuditActionType_old";
ALTER TYPE "AuditActionType_new" RENAME TO "AuditActionType";
DROP TYPE "public"."AuditActionType_old";
COMMIT;


-- AlterEnum
BEGIN;
CREATE TYPE "PermissionCategory_new" AS ENUM ('TENANT_ADMIN', 'PORTFOLIO_PROJECTS', 'BOQ_SCHEDULE', 'MOBILIZATION_ASSURANCE', 'FIELD_PRESENCE', 'REPORT_APPROVALS', 'PAYMENTS', 'AUDIT_CLOSEOUT');
ALTER TABLE "permissions" ALTER COLUMN "category" TYPE "PermissionCategory_new" USING ("category"::text::"PermissionCategory_new");
ALTER TYPE "PermissionCategory" RENAME TO "PermissionCategory_old";
ALTER TYPE "PermissionCategory_new" RENAME TO "PermissionCategory";
DROP TYPE "public"."PermissionCategory_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "BoqItem" DROP CONSTRAINT "BoqItem_trancheId_fkey";

-- DropForeignKey
ALTER TABLE "ConditionPrecedent" DROP CONSTRAINT "ConditionPrecedent_evidenceDocumentId_fkey";

-- DropForeignKey
ALTER TABLE "ConditionPrecedent" DROP CONSTRAINT "ConditionPrecedent_trancheId_fkey";

-- DropForeignKey
ALTER TABLE "ConditionPrecedent" DROP CONSTRAINT "ConditionPrecedent_waivedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "FacilityTranche" DROP CONSTRAINT "FacilityTranche_projectId_fkey";

-- DropForeignKey
ALTER TABLE "IpcClaim" DROP CONSTRAINT "IpcClaim_projectContractorId_fkey";

-- DropForeignKey
ALTER TABLE "IpcClaim" DROP CONSTRAINT "IpcClaim_projectId_fkey";

-- DropForeignKey
ALTER TABLE "IpcClaim" DROP CONSTRAINT "IpcClaim_submittedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "IpcClaim" DROP CONSTRAINT "IpcClaim_trancheId_fkey";

-- DropForeignKey
ALTER TABLE "IpcLineItem" DROP CONSTRAINT "IpcLineItem_boqItemId_fkey";

-- DropForeignKey
ALTER TABLE "IpcLineItem" DROP CONSTRAINT "IpcLineItem_ipcClaimId_fkey";

-- DropForeignKey
ALTER TABLE "IpcSupportingDocument" DROP CONSTRAINT "IpcSupportingDocument_ipcClaimId_fkey";

-- DropForeignKey
ALTER TABLE "MonitorQuery" DROP CONSTRAINT "MonitorQuery_ipcLineItemId_fkey";

-- DropForeignKey
ALTER TABLE "MonitorQuery" DROP CONSTRAINT "MonitorQuery_raisedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "MonitorQuery" DROP CONSTRAINT "MonitorQuery_resolvedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "MonitorQuery" DROP CONSTRAINT "MonitorQuery_respondedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "TrancheDecision" DROP CONSTRAINT "TrancheDecision_decidedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "TrancheDecision" DROP CONSTRAINT "TrancheDecision_reversesDecisionId_fkey";

-- DropForeignKey
ALTER TABLE "TrancheDecision" DROP CONSTRAINT "TrancheDecision_valuationReportId_fkey";

-- DropForeignKey
ALTER TABLE "ValuationReport" DROP CONSTRAINT "ValuationReport_certifiedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "ValuationReport" DROP CONSTRAINT "ValuationReport_ipcClaimId_fkey";

-- DropForeignKey
ALTER TABLE "ValuationReport" DROP CONSTRAINT "ValuationReport_milestoneVerificationId_fkey";

-- DropForeignKey
ALTER TABLE "ValuationReport" DROP CONSTRAINT "ValuationReport_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ValuationReport" DROP CONSTRAINT "ValuationReport_trancheId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_verifications" DROP CONSTRAINT "milestone_verifications_projectId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_verifications" DROP CONSTRAINT "milestone_verifications_trancheId_fkey";

-- DropForeignKey
ALTER TABLE "milestone_verifications" DROP CONSTRAINT "milestone_verifications_verifiedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "retention_release_requests" DROP CONSTRAINT "retention_release_requests_projectContractorId_fkey";

-- DropForeignKey
ALTER TABLE "retention_release_requests" DROP CONSTRAINT "retention_release_requests_projectId_fkey";

-- DropForeignKey
ALTER TABLE "retention_release_requests" DROP CONSTRAINT "retention_release_requests_valuationReportId_fkey";

-- DropIndex
DROP INDEX "BoqItem_projectId_trancheId_idx";

-- DropIndex
DROP INDEX "Project_portfolioHealth_idx";

-- AlterTable
ALTER TABLE "BoqItem" DROP COLUMN "aiSuggestedTrancheId",
DROP COLUMN "trancheId",
DROP COLUMN "trancheMappingConfirmedByMonitor";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "portfolioHealth";

-- AlterTable
ALTER TABLE "project_contractors" DROP COLUMN "retentionHeldNgn",
DROP COLUMN "retentionReleasedNgn";

-- AlterTable
ALTER TABLE "project_documents" DROP COLUMN "linkedConditionPrecedentId";

-- AlterTable
ALTER TABLE "project_process_configs" DROP COLUMN "disbursementMechanism",
DROP COLUMN "enableTranchesAndCps";

-- AlterTable
ALTER TABLE "report_queries" DROP COLUMN "ipcLineItemId";

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "evidenceRatingLabels";

-- DropTable
DROP TABLE "ConditionPrecedent";

-- DropTable
DROP TABLE "FacilityTranche";

-- DropTable
DROP TABLE "IpcClaim";

-- DropTable
DROP TABLE "IpcLineItem";

-- DropTable
DROP TABLE "IpcSupportingDocument";

-- DropTable
DROP TABLE "MonitorQuery";

-- DropTable
DROP TABLE "TrancheDecision";

-- DropTable
DROP TABLE "ValuationReport";

-- DropTable
DROP TABLE "milestone_verifications";

-- DropTable
DROP TABLE "retention_release_requests";

-- MediaType is narrowed after IpcSupportingDocument (which also used it) is dropped.
-- AlterEnum
BEGIN;
CREATE TYPE "MediaType_new" AS ENUM ('SITE_PHOTO', 'VOICE_NOTE', 'WAYBILL_DOCUMENT', 'LAB_CUBE_TEST_CERT', 'MILL_CERTIFICATE', 'BOQ_SPREADSHEET', 'IDENTITY_DOCUMENT', 'IDENTITY_SELFIE', 'PROJECT_DOCUMENT');
ALTER TABLE "EvidenceMedia" ALTER COLUMN "mediaType" TYPE "MediaType_new" USING ("mediaType"::text::"MediaType_new");
ALTER TYPE "MediaType" RENAME TO "MediaType_old";
ALTER TYPE "MediaType_new" RENAME TO "MediaType";
DROP TYPE "public"."MediaType_old";
COMMIT;

-- DropEnum
DROP TYPE "ConditionPrecedentStatus";

-- DropEnum
DROP TYPE "DisbursementMechanism";

-- DropEnum
DROP TYPE "EvidenceStrengthRating";

-- DropEnum
DROP TYPE "IpcClaimStatus";

-- DropEnum
DROP TYPE "LenderDecisionType";

-- DropEnum
DROP TYPE "MonitorRecommendation";

-- DropEnum
DROP TYPE "PortfolioHealth";

-- DropEnum
DROP TYPE "RetentionReleaseRequestStatus";

-- DropEnum
DROP TYPE "RetentionReleaseStage";

-- DropEnum
DROP TYPE "TrancheCompletionRule";

-- DropEnum
DROP TYPE "TranchePaymentBasis";

-- DropEnum
DROP TYPE "ValuationSource";

-- CreateTable
CREATE TABLE "project_payments" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "paidOn" TEXT NOT NULL,
    "grossAmountNgn" DECIMAL(18,2) NOT NULL,
    "retentionHeldNgn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmountNgn" DECIMAL(18,2) NOT NULL,
    "retentionOverrideReason" TEXT,
    "reference" TEXT NOT NULL,
    "description" TEXT,
    "source" "PaymentSource" NOT NULL DEFAULT 'MANUAL',
    "externalReference" TEXT,
    "exceptionsJson" JSONB NOT NULL DEFAULT '[]',
    "recordedByUserId" UUID,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedByName" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "project_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_payments_projectId_paidOn_idx" ON "project_payments"("projectId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "project_payments_projectId_externalReference_key" ON "project_payments"("projectId", "externalReference");

-- AddForeignKey
ALTER TABLE "project_payments" ADD CONSTRAINT "project_payments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
