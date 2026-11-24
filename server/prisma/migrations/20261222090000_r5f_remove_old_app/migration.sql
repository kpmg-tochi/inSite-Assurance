-- Redesign R5f: the old field app's server side is deleted (workday reports, report queries, WBS chat,
-- Phase 14 site inspections and checklist templates, hold points, the reporting cadence, the
-- contractor persona). Data clean-up first, as R1d, R1e and R4f did: rows that only these features
-- wrote. Deleting audit rows breaks hash-chain verification on a database with data (the dev database
-- is disposable, decision A).
DELETE FROM "AuditLog" WHERE "action" IN (
  'MONITOR_QUERY_RAISED', 'CONTRACTOR_QUERY_RESPONDED', 'WORKDAY_REPORT_SUBMITTED', 'WORKDAY_REPORTS_RELEASED',
  'REPORT_QUERY_RESOLVED', 'WORKDAY_REPORT_APPROVED', 'WORKDAY_REPORT_RETURNED', 'STANDARDS_VIOLATION_FLAGGED',
  'REPORT_SUBMITTED_LATE', 'REPORT_MISSED', 'INSPECTION_SUBMITTED', 'INSPECTION_REVIEWED', 'CHECKLIST_TEMPLATE_SAVED'
);
-- Web notifications of the removed categories (reads cascade).
DELETE FROM "web_notifications" WHERE "category" IN (
  'REPORT_RESUBMITTED', 'MONITOR_QUERY', 'AI_OMISSION_FLAG', 'STANDARDS_VIOLATION_FLAGGED', 'REPORT_PENDING_APPROVAL',
  'REPORT_MISSED', 'INSPECTION_PENDING_APPROVAL', 'INSPECTION_FINDING'
);
-- Mobile notifications of the removed types or actions, including the stored action-required ones the
-- phone can no longer complete (reads cascade).
DELETE FROM "mobile_notifications"
WHERE "type"::text IN ('BACKLOG_REVIEW_REQUIRED', 'REPORT_QUERY', 'HOLD_POINT_ALERT', 'REPORT_OVERDUE', 'INSPECTION_FINDING')
   OR "actionType"::text IN ('OPEN_REPORT_SUMMARY', 'OPEN_WBS_CHAT', 'OPEN_BACKLOG_REVIEW', 'OPEN_INSPECTION_FINDINGS');
-- Approval history of reports and inspections.
DELETE FROM "approval_actions" WHERE "subjectType"::text IN ('WORKDAY_REPORT', 'SITE_INSPECTION');
-- Findings raised by Phase 14 inspections go with their inspections (the relation cascaded). Visit
-- findings never carry an inspection, so the hand-written CHECK inspection_findings_source_check stays
-- satisfied and is kept (R7 renames the table).
DELETE FROM "inspection_findings" WHERE "visitSubmissionId" IS NULL;
UPDATE "inspection_findings" SET "inspectionId" = NULL WHERE "inspectionId" IS NOT NULL;
-- The contractor persona (no role could take it since R1d): history keeps "no persona".
UPDATE "roles" SET "fieldPersonaType" = 'NONE' WHERE "fieldPersonaType"::text = 'CONTRACTOR_EXECUTOR';
UPDATE "FieldAgentSession" SET "fieldPersonaType" = 'NONE' WHERE "fieldPersonaType"::text = 'CONTRACTOR_EXECUTOR';
UPDATE "FieldEvidenceLog" SET "fieldPersonaType" = 'NONE' WHERE "fieldPersonaType"::text = 'CONTRACTOR_EXECUTOR';
-- Removed config keys (the parsers strip them anyway): the type key "inspections", the hold-point term.
UPDATE "project_types" SET "configJson" = "configJson" - 'inspections' WHERE "configJson" ? 'inspections';
UPDATE "Project" SET "projectTypeSnapshotJson" = "projectTypeSnapshotJson" - 'inspections'
WHERE "projectTypeSnapshotJson" IS NOT NULL AND jsonb_typeof("projectTypeSnapshotJson") = 'object' AND "projectTypeSnapshotJson" ? 'inspections';
UPDATE "tenants" SET "terminologyLabels" = "terminologyLabels" - 'holdPoint' WHERE "terminologyLabels" ? 'holdPoint';
-- Line progress: lines without unit progress keep their stored cumulativeCertifiedPct (owner decision);
-- captures stay without their report, checklist-item and BoQ-line links.
-- The hand-written index workday_reports_one_report_per_period goes with its table. No other
-- hand-written index or CHECK is touched.

-- DropForeignKey
ALTER TABLE "FieldEvidenceLog" DROP CONSTRAINT "FieldEvidenceLog_boqItemId_fkey";

-- DropForeignKey
ALTER TABLE "FieldEvidenceLog" DROP CONSTRAINT "FieldEvidenceLog_siteInspectionReportId_fkey";

-- DropForeignKey
ALTER TABLE "FieldEvidenceLog" DROP CONSTRAINT "FieldEvidenceLog_workdayReportId_fkey";

-- DropForeignKey
ALTER TABLE "incident_reports" DROP CONSTRAINT "incident_reports_wbsItemId_fkey";

-- DropForeignKey
ALTER TABLE "inspection_checklist_templates" DROP CONSTRAINT "inspection_checklist_templates_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "inspection_findings" DROP CONSTRAINT "inspection_findings_inspectionId_fkey";

-- DropForeignKey
ALTER TABLE "report_queries" DROP CONSTRAINT "report_queries_boqItemId_fkey";

-- DropForeignKey
ALTER TABLE "report_queries" DROP CONSTRAINT "report_queries_projectId_fkey";

-- DropForeignKey
ALTER TABLE "report_queries" DROP CONSTRAINT "report_queries_raisedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "report_queries" DROP CONSTRAINT "report_queries_workdayReportId_fkey";

-- DropForeignKey
ALTER TABLE "site_inspection_reports" DROP CONSTRAINT "site_inspection_reports_projectId_fkey";

-- DropForeignKey
ALTER TABLE "site_inspection_reports" DROP CONSTRAINT "site_inspection_reports_templateId_fkey";

-- DropForeignKey
ALTER TABLE "wbs_chat_messages" DROP CONSTRAINT "wbs_chat_messages_boqItemId_fkey";

-- DropForeignKey
ALTER TABLE "wbs_chat_messages" DROP CONSTRAINT "wbs_chat_messages_captureId_fkey";

-- DropForeignKey
ALTER TABLE "wbs_chat_messages" DROP CONSTRAINT "wbs_chat_messages_fieldSessionId_fkey";

-- DropForeignKey
ALTER TABLE "wbs_chat_messages" DROP CONSTRAINT "wbs_chat_messages_projectId_fkey";

-- DropForeignKey
ALTER TABLE "wbs_chat_messages" DROP CONSTRAINT "wbs_chat_messages_reportQueryId_fkey";

-- DropForeignKey
ALTER TABLE "wbs_chat_messages" DROP CONSTRAINT "wbs_chat_messages_senderSessionId_fkey";

-- DropForeignKey
ALTER TABLE "wbs_chat_messages" DROP CONSTRAINT "wbs_chat_messages_workdayReportId_fkey";

-- DropForeignKey
ALTER TABLE "workday_reports" DROP CONSTRAINT "workday_reports_parentReportId_fkey";

-- DropForeignKey
ALTER TABLE "workday_reports" DROP CONSTRAINT "workday_reports_projectId_fkey";

-- DropForeignKey
ALTER TABLE "workday_reports" DROP CONSTRAINT "workday_reports_reporterSessionId_fkey";

-- DropForeignKey
ALTER TABLE "workday_reports" DROP CONSTRAINT "workday_reports_wbsItemId_fkey";

-- DropIndex
DROP INDEX "FieldEvidenceLog_projectId_boqItemId_idx";

-- DropIndex
DROP INDEX "FieldEvidenceLog_siteInspectionReportId_idx";

-- DropIndex
DROP INDEX "FieldEvidenceLog_workdayReportId_idx";

-- DropIndex
DROP INDEX "inspection_findings_inspectionId_idx";

-- AlterTable
ALTER TABLE "BoqItem" DROP COLUMN "holdPointInstruction",
DROP COLUMN "isHoldPoint",
DROP COLUMN "planningTier";

-- AlterTable
ALTER TABLE "FieldEvidenceLog" DROP COLUMN "boqItemId",
DROP COLUMN "checklistItemKey",
DROP COLUMN "siteInspectionReportId",
DROP COLUMN "workdayReportId";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "cadenceAnchorDate",
DROP COLUMN "cadenceQuarterAnchorMonth",
DROP COLUMN "customIntervalDays",
DROP COLUMN "pendingCadenceEffectiveFrom",
DROP COLUMN "pendingCadenceJson",
DROP COLUMN "periodStartDayOfWeek",
DROP COLUMN "reportDueTime",
DROP COLUMN "reportGraceMinutes",
DROP COLUMN "reportingCadence";

-- AlterTable
ALTER TABLE "completion_certificates" DROP COLUMN "finalEvaluationInspectionId";

-- AlterTable
ALTER TABLE "incident_reports" DROP COLUMN "wbsItemId";

-- AlterTable
ALTER TABLE "project_process_configs" DROP COLUMN "enableAiOmissionCheck",
DROP COLUMN "enableAiStandardsCheck",
DROP COLUMN "enableHoldPoints";

-- DropTable
DROP TABLE "inspection_checklist_templates";

-- DropTable
DROP TABLE "report_queries";

-- DropTable
DROP TABLE "site_inspection_reports";

-- DropTable
DROP TABLE "wbs_chat_messages";

-- DropTable
DROP TABLE "workday_reports";

-- AlterEnum
BEGIN;
CREATE TYPE "ApprovalSubjectType_new" AS ENUM ('CONTRACT_DEFAULT_CASE', 'VISIT_SUBMISSION');
ALTER TABLE "approval_actions" ALTER COLUMN "subjectType" TYPE "ApprovalSubjectType_new" USING ("subjectType"::text::"ApprovalSubjectType_new");
ALTER TYPE "ApprovalSubjectType" RENAME TO "ApprovalSubjectType_old";
ALTER TYPE "ApprovalSubjectType_new" RENAME TO "ApprovalSubjectType";
DROP TYPE "public"."ApprovalSubjectType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "AuditActionType_new" AS ENUM ('TENANT_CREATED', 'TENANT_BRANDING_UPDATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'USER_PROJECT_ASSIGNED', 'PROJECT_CREATED', 'BASELINE_UPDATED', 'BOQ_UPLOADED', 'FIELD_AGENT_JOINED', 'FIELD_SESSION_STATUS_UPDATED', 'EVIDENCE_EXTRACTED', 'EVIDENCE_CONFIRMED', 'EVIDENCE_FLAGGED_INTEGRITY', 'INCIDENT_REPORT_SUBMITTED', 'INCIDENT_STATUS_UPDATED', 'PUSH_TOKEN_REGISTERED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'LOGIN_FAILED_LOCKOUT', 'TENANT_SETTINGS_UPDATED', 'CAPTURE_REGISTERED', 'CAPTURE_FLAGGED_INTEGRITY', 'DEVICE_KEY_REGISTERED', 'MOBILE_USER_SIGNED_IN', 'MOBILE_DEVICE_REVOKED', 'ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'PROJECT_DRAFT_CREATED', 'PROJECT_SETUP_STEP_SAVED', 'PROJECT_ACTIVATED', 'PROJECT_ARCHIVED', 'PROJECT_CONTRACTOR_ADDED', 'PROJECT_CONTRACTOR_REMOVED', 'BOQ_REVISED', 'PROJECT_DRAFT_DELETED', 'WORKFLOW_TEMPLATE_SAVED', 'PROJECT_PROCESS_CONFIG_UPDATED', 'PROJECT_STANDARD_CREATED', 'PROJECT_STANDARD_UPDATED', 'PROJECT_STANDARD_DELETED', 'NEEDS_ASSESSMENT_UPLOADED', 'NEEDS_ASSESSMENT_DELETED', 'APPROVAL_STEP_ACTIONED', 'HANDOVER_RECORDED', 'HANDOVER_REVIEWED', 'PROJECT_PHASE_CHANGED', 'RETENTION_WITHHELD', 'DEFECT_TICKET_RAISED', 'DEFECT_TICKET_UPDATED', 'DEFECT_TICKET_CLOSED', 'RETENTION_RELEASED', 'PROJECT_TYPE_SAVED', 'PROJECT_TYPE_APPLIED', 'ORGANIZATION_HIERARCHY_CHANGED', 'TERMINOLOGY_UPDATED', 'INSPECTION_FINDING_RAISED', 'INSPECTION_FINDING_RESOLVED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERSIONED', 'DOCUMENT_SIGNED', 'DOCUMENT_ARCHIVED', 'DOCUMENT_TYPE_SAVED', 'CONTRACT_DETAILS_SAVED', 'MILESTONE_COMPLETED', 'MILESTONE_WAIVED', 'MILESTONE_DATES_RECOMPUTED', 'KICKOFF_SCHEDULED', 'KICKOFF_NOTICE_SENT', 'KICKOFF_HELD', 'DEFAULT_CASE_OPENED', 'DEFAULT_CASE_REVIEWED', 'DEFAULT_CASE_DECIDED', 'CONTRACTOR_TERMINATED', 'COC_DRAFTED', 'COC_SIGNED', 'COC_ISSUED', 'COC_REVOKED', 'HANDOVER_CERTIFICATE_ISSUED', 'CLOSURE_ITEM_COMPLETED', 'CLOSURE_ITEM_WAIVED', 'CLOSURE_AUDIT_SIGNED', 'CONTRACTOR_RATED', 'LESSON_PUBLISHED', 'CLOSURE_PACK_EXPORTED', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED', 'FACILITY_SAVED', 'SCOPE_UPDATED', 'SPRINTS_SAVED', 'SCOPE_IMPORTED', 'FORM_COMPONENT_SAVED', 'VISITS_GENERATED', 'VISIT_CREATED', 'VISIT_PUBLISHED', 'VISIT_UPDATED', 'VISIT_CANCELLED', 'VISIT_FORM_REBUILT', 'VISIT_OFFICERS_SAVED', 'VISIT_RESPONDED', 'VISIT_DATE_DECIDED', 'VISIT_CHECKED_IN', 'VISIT_SUBMITTED', 'VISIT_MISSED', 'SITE_LOG_ADDED', 'SITE_LOG_HIDDEN', 'VISIT_REVIEWED', 'FINDING_ESCALATED', 'FINDINGS_SUMMARY_SENT', 'SPRINT_VERIFIED');
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditActionType_new" USING ("action"::text::"AuditActionType_new");
ALTER TYPE "AuditActionType" RENAME TO "AuditActionType_old";
ALTER TYPE "AuditActionType_new" RENAME TO "AuditActionType";
DROP TYPE "public"."AuditActionType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "FieldPersonaType_new" AS ENUM ('INDEPENDENT_VERIFIER', 'NONE');
ALTER TABLE "public"."FieldAgentSession" ALTER COLUMN "fieldPersonaType" DROP DEFAULT;
ALTER TABLE "public"."FieldEvidenceLog" ALTER COLUMN "fieldPersonaType" DROP DEFAULT;
ALTER TABLE "public"."roles" ALTER COLUMN "fieldPersonaType" DROP DEFAULT;
ALTER TABLE "roles" ALTER COLUMN "fieldPersonaType" TYPE "FieldPersonaType_new" USING ("fieldPersonaType"::text::"FieldPersonaType_new");
ALTER TABLE "FieldAgentSession" ALTER COLUMN "fieldPersonaType" TYPE "FieldPersonaType_new" USING ("fieldPersonaType"::text::"FieldPersonaType_new");
ALTER TABLE "FieldEvidenceLog" ALTER COLUMN "fieldPersonaType" TYPE "FieldPersonaType_new" USING ("fieldPersonaType"::text::"FieldPersonaType_new");
ALTER TYPE "FieldPersonaType" RENAME TO "FieldPersonaType_old";
ALTER TYPE "FieldPersonaType_new" RENAME TO "FieldPersonaType";
DROP TYPE "public"."FieldPersonaType_old";
ALTER TABLE "FieldAgentSession" ALTER COLUMN "fieldPersonaType" SET DEFAULT 'INDEPENDENT_VERIFIER';
ALTER TABLE "FieldEvidenceLog" ALTER COLUMN "fieldPersonaType" SET DEFAULT 'INDEPENDENT_VERIFIER';
ALTER TABLE "roles" ALTER COLUMN "fieldPersonaType" SET DEFAULT 'NONE';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "MobileNotificationType_new" AS ENUM ('DEFECT_UPDATE', 'VISIT_ASSIGNED', 'VISIT_CHANGED', 'VISIT_REMINDER', 'VISIT_RETURNED', 'VISIT_APPROVED');
ALTER TABLE "mobile_notifications" ALTER COLUMN "type" TYPE "MobileNotificationType_new" USING ("type"::text::"MobileNotificationType_new");
ALTER TYPE "MobileNotificationType" RENAME TO "MobileNotificationType_old";
ALTER TYPE "MobileNotificationType_new" RENAME TO "MobileNotificationType";
DROP TYPE "public"."MobileNotificationType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationActionType_new" AS ENUM ('NONE', 'OPEN_DEFECTS', 'OPEN_VISIT');
ALTER TABLE "public"."mobile_notifications" ALTER COLUMN "actionType" DROP DEFAULT;
ALTER TABLE "mobile_notifications" ALTER COLUMN "actionType" TYPE "NotificationActionType_new" USING ("actionType"::text::"NotificationActionType_new");
ALTER TYPE "NotificationActionType" RENAME TO "NotificationActionType_old";
ALTER TYPE "NotificationActionType_new" RENAME TO "NotificationActionType";
DROP TYPE "public"."NotificationActionType_old";
ALTER TABLE "mobile_notifications" ALTER COLUMN "actionType" SET DEFAULT 'NONE';
COMMIT;

-- DropEnum
DROP TYPE "InspectionOverallFinding";

-- DropEnum
DROP TYPE "InspectionVisitType";

-- DropEnum
DROP TYPE "QueryStatus";

-- DropEnum
DROP TYPE "ReportQuerySource";

-- DropEnum
DROP TYPE "ReportingCadence";

-- DropEnum
DROP TYPE "SiteInspectionStatus";

-- DropEnum
DROP TYPE "WorkdayAiCheckStatus";

-- DropEnum
DROP TYPE "WorkdayReportStatus";
