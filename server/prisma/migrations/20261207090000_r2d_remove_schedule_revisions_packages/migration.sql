-- Redesign R2d: delete what sprints replace (plan D-R2.14 to D-R2.16): item dependencies, schedule
-- revisions (the hand-written index schedule_revisions_one_pending_per_project goes with its table),
-- programme-of-works submissions, contractor packages on BoQ lines, the original item windows, the
-- current projected end and the earned-schedule variance.
-- Hand edits: the data clean-up below (so this applies on a database with data).

-- Data clean-up
DELETE FROM "AuditLog" WHERE "action"::text IN ('SCHEDULE_BASELINE_SET', 'SCHEDULE_REVISION_PROPOSED', 'SCHEDULE_REVISION_APPLIED', 'SCHEDULE_REVISION_REJECTED', 'SCHEDULE_REVISION_WITHDRAWN', 'PROGRAMME_OF_WORKS_SUBMITTED', 'PROGRAMME_OF_WORKS_DECIDED');
DELETE FROM "web_notifications" WHERE "category" IN ('SCHEDULE_REVISION_PENDING', 'SCHEDULE_REVISION_DECIDED', 'PROGRAMME_OF_WORKS');
-- Role grants cascade with the permission rows.
DELETE FROM "permissions" WHERE "key" IN ('boq:configure_hold_points', 'schedule:catch_up_refactor', 'schedule:approve_refactor', 'schedule:propose_programme');
-- The programme of works is now a document whose sign-off accepts it (D-R2.16).
UPDATE "document_types" SET "requiresSignOff" = true WHERE "code" = 'PROGRAMME_OF_WORKS';

-- AlterEnum
BEGIN;
CREATE TYPE "AuditActionType_new" AS ENUM ('TENANT_CREATED', 'TENANT_BRANDING_UPDATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'USER_PROJECT_ASSIGNED', 'PROJECT_CREATED', 'BASELINE_UPDATED', 'BOQ_UPLOADED', 'FIELD_AGENT_JOINED', 'FIELD_SESSION_STATUS_UPDATED', 'EVIDENCE_EXTRACTED', 'EVIDENCE_CONFIRMED', 'EVIDENCE_FLAGGED_INTEGRITY', 'MONITOR_QUERY_RAISED', 'CONTRACTOR_QUERY_RESPONDED', 'INCIDENT_REPORT_SUBMITTED', 'INCIDENT_STATUS_UPDATED', 'PUSH_TOKEN_REGISTERED', 'WORKDAY_REPORT_SUBMITTED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'LOGIN_FAILED_LOCKOUT', 'TENANT_SETTINGS_UPDATED', 'CAPTURE_REGISTERED', 'CAPTURE_FLAGGED_INTEGRITY', 'WORKDAY_REPORTS_RELEASED', 'DEVICE_KEY_REGISTERED', 'REPORT_QUERY_RESOLVED', 'MOBILE_USER_SIGNED_IN', 'MOBILE_DEVICE_REVOKED', 'ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'PROJECT_DRAFT_CREATED', 'PROJECT_SETUP_STEP_SAVED', 'PROJECT_ACTIVATED', 'PROJECT_ARCHIVED', 'PROJECT_CONTRACTOR_ADDED', 'PROJECT_CONTRACTOR_REMOVED', 'BOQ_REVISED', 'PROJECT_DRAFT_DELETED', 'WORKFLOW_TEMPLATE_SAVED', 'PROJECT_PROCESS_CONFIG_UPDATED', 'PROJECT_STANDARD_CREATED', 'PROJECT_STANDARD_UPDATED', 'PROJECT_STANDARD_DELETED', 'NEEDS_ASSESSMENT_UPLOADED', 'NEEDS_ASSESSMENT_DELETED', 'WORKDAY_REPORT_APPROVED', 'WORKDAY_REPORT_RETURNED', 'STANDARDS_VIOLATION_FLAGGED', 'APPROVAL_STEP_ACTIONED', 'REPORT_SUBMITTED_LATE', 'REPORT_MISSED', 'REPORTING_OBLIGATION_EXCUSED', 'HANDOVER_RECORDED', 'HANDOVER_REVIEWED', 'PROJECT_PHASE_CHANGED', 'RETENTION_WITHHELD', 'DEFECT_TICKET_RAISED', 'DEFECT_TICKET_UPDATED', 'DEFECT_TICKET_CLOSED', 'RETENTION_RELEASED', 'PROJECT_TYPE_SAVED', 'PROJECT_TYPE_APPLIED', 'ORGANIZATION_HIERARCHY_CHANGED', 'TERMINOLOGY_UPDATED', 'INSPECTION_SUBMITTED', 'INSPECTION_REVIEWED', 'INSPECTION_FINDING_RAISED', 'INSPECTION_FINDING_RESOLVED', 'REPORTING_STREAMS_SAVED', 'CHECKLIST_TEMPLATE_SAVED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERSIONED', 'DOCUMENT_SIGNED', 'DOCUMENT_ARCHIVED', 'DOCUMENT_TYPE_SAVED', 'CONTRACT_DETAILS_SAVED', 'MILESTONE_COMPLETED', 'MILESTONE_WAIVED', 'MILESTONE_DATES_RECOMPUTED', 'KICKOFF_SCHEDULED', 'KICKOFF_NOTICE_SENT', 'KICKOFF_HELD', 'DEFAULT_CASE_OPENED', 'DEFAULT_CASE_REVIEWED', 'DEFAULT_CASE_DECIDED', 'CONTRACTOR_TERMINATED', 'COC_DRAFTED', 'COC_SIGNED', 'COC_ISSUED', 'COC_REVOKED', 'HANDOVER_CERTIFICATE_ISSUED', 'CLOSURE_ITEM_COMPLETED', 'CLOSURE_ITEM_WAIVED', 'CLOSURE_AUDIT_SIGNED', 'CONTRACTOR_RATED', 'LESSON_PUBLISHED', 'CLOSURE_PACK_EXPORTED', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED', 'FACILITY_SAVED', 'SCOPE_UPDATED', 'SPRINTS_SAVED', 'SCOPE_IMPORTED');
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditActionType_new" USING ("action"::text::"AuditActionType_new");
ALTER TYPE "AuditActionType" RENAME TO "AuditActionType_old";
ALTER TYPE "AuditActionType_new" RENAME TO "AuditActionType";
DROP TYPE "public"."AuditActionType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "BoqItem" DROP CONSTRAINT "BoqItem_projectContractorId_fkey";

-- DropForeignKey
ALTER TABLE "boq_item_dependencies" DROP CONSTRAINT "boq_item_dependencies_predecessorBoqItemId_fkey";

-- DropForeignKey
ALTER TABLE "boq_item_dependencies" DROP CONSTRAINT "boq_item_dependencies_projectId_fkey";

-- DropForeignKey
ALTER TABLE "boq_item_dependencies" DROP CONSTRAINT "boq_item_dependencies_successorBoqItemId_fkey";

-- DropForeignKey
ALTER TABLE "programme_of_works_submissions" DROP CONSTRAINT "programme_of_works_submissions_projectContractorId_fkey";

-- DropForeignKey
ALTER TABLE "programme_of_works_submissions" DROP CONSTRAINT "programme_of_works_submissions_projectId_fkey";

-- DropForeignKey
ALTER TABLE "schedule_revisions" DROP CONSTRAINT "schedule_revisions_approvedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "schedule_revisions" DROP CONSTRAINT "schedule_revisions_initiatedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "schedule_revisions" DROP CONSTRAINT "schedule_revisions_projectId_fkey";

-- DropIndex
DROP INDEX "BoqItem_projectId_projectContractorId_idx";

-- AlterTable
ALTER TABLE "BoqItem" DROP COLUMN "originalPlannedEndDate",
DROP COLUMN "originalPlannedStartDate",
DROP COLUMN "projectContractorId";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "currentProjectedEndDate",
DROP COLUMN "scheduleVarianceWorkdays";

-- DropTable
DROP TABLE "boq_item_dependencies";

-- DropTable
DROP TABLE "programme_of_works_submissions";

-- DropTable
DROP TABLE "schedule_revisions";

-- DropEnum
DROP TYPE "ProgrammeOfWorksStatus";

-- DropEnum
DROP TYPE "ScheduleRevisionStatus";
