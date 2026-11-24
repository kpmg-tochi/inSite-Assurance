-- Redesign R1e: delete morning briefs, presence telemetry and manual check-in, the mobilisation
-- participant roster and attendance alerts, and the executive risk matrix permission.
-- Hand edits: the data clean-up below, so this applies on a database with data. No hand-written index
-- or CHECK listed in CLAUDE.md is touched. As in R1b/R1d, deleting audit rows breaks the hash chain on
-- a database that had them (the dev DB is disposable, decision A).

-- Data clean-up
DELETE FROM "AuditLog" WHERE "action"::text IN ('TELEMETRY_ANOMALY_SUMMARY', 'PARTICIPANT_PREREGISTERED', 'PARTICIPANT_REMINDER_SENT', 'ATTENDANCE_ALERT_RAISED', 'ATTENDANCE_ALERT_RESOLVED', 'MANUAL_CHECKIN_RECORDED');
DELETE FROM "mobile_notifications" WHERE "type"::text IN ('MORNING_DELIVERABLE_READY', 'SITE_GEOFENCE_WARNING');
DELETE FROM "web_notifications" WHERE "category" = 'ATTENDANCE_ALERT';
DELETE FROM "permissions" WHERE "key" IN ('projects:view_executive_matrix', 'mobilization:manage_roster', 'mobilization:configure_reminders', 'presence:view_telemetry', 'presence:manage_noshow_alerts', 'field:manual_checkin');
-- Queued mobilisation reminders have no template any more.
DELETE FROM "outbound_messages" WHERE "templateKey" = 'MOBILIZATION_REMINDER';
-- The brief-dispatch job is now reporting-obligations; attendance-check and mobilization-reminders are gone.
DELETE FROM "job_runs" WHERE "jobName" IN ('brief-dispatch', 'attendance-check', 'mobilization-reminders');

-- AlterEnum
BEGIN;
CREATE TYPE "AuditActionType_new" AS ENUM ('TENANT_CREATED', 'TENANT_BRANDING_UPDATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'USER_PROJECT_ASSIGNED', 'PROJECT_CREATED', 'BASELINE_UPDATED', 'BOQ_UPLOADED', 'FIELD_AGENT_JOINED', 'FIELD_SESSION_STATUS_UPDATED', 'EVIDENCE_EXTRACTED', 'EVIDENCE_CONFIRMED', 'EVIDENCE_FLAGGED_INTEGRITY', 'MONITOR_QUERY_RAISED', 'CONTRACTOR_QUERY_RESPONDED', 'INCIDENT_REPORT_SUBMITTED', 'INCIDENT_STATUS_UPDATED', 'PUSH_TOKEN_REGISTERED', 'WORKDAY_REPORT_SUBMITTED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'LOGIN_FAILED_LOCKOUT', 'TENANT_SETTINGS_UPDATED', 'CAPTURE_REGISTERED', 'CAPTURE_FLAGGED_INTEGRITY', 'WORKDAY_REPORTS_RELEASED', 'DEVICE_KEY_REGISTERED', 'REPORT_QUERY_RESOLVED', 'MOBILE_USER_SIGNED_IN', 'MOBILE_DEVICE_REVOKED', 'ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'PROJECT_DRAFT_CREATED', 'PROJECT_SETUP_STEP_SAVED', 'PROJECT_ACTIVATED', 'PROJECT_ARCHIVED', 'PROJECT_CONTRACTOR_ADDED', 'PROJECT_CONTRACTOR_REMOVED', 'BOQ_REVISED', 'PROJECT_DRAFT_DELETED', 'WORKFLOW_TEMPLATE_SAVED', 'PROJECT_PROCESS_CONFIG_UPDATED', 'PROJECT_STANDARD_CREATED', 'PROJECT_STANDARD_UPDATED', 'PROJECT_STANDARD_DELETED', 'NEEDS_ASSESSMENT_UPLOADED', 'NEEDS_ASSESSMENT_DELETED', 'WORKDAY_REPORT_APPROVED', 'WORKDAY_REPORT_RETURNED', 'STANDARDS_VIOLATION_FLAGGED', 'APPROVAL_STEP_ACTIONED', 'REPORT_SUBMITTED_LATE', 'REPORT_MISSED', 'REPORTING_OBLIGATION_EXCUSED', 'SCHEDULE_BASELINE_SET', 'SCHEDULE_REVISION_PROPOSED', 'SCHEDULE_REVISION_APPLIED', 'SCHEDULE_REVISION_REJECTED', 'SCHEDULE_REVISION_WITHDRAWN', 'HANDOVER_RECORDED', 'HANDOVER_REVIEWED', 'PROJECT_PHASE_CHANGED', 'RETENTION_WITHHELD', 'DEFECT_TICKET_RAISED', 'DEFECT_TICKET_UPDATED', 'DEFECT_TICKET_CLOSED', 'RETENTION_RELEASED', 'PROJECT_TYPE_SAVED', 'PROJECT_TYPE_APPLIED', 'ORGANIZATION_HIERARCHY_CHANGED', 'TERMINOLOGY_UPDATED', 'INSPECTION_SUBMITTED', 'INSPECTION_REVIEWED', 'INSPECTION_FINDING_RAISED', 'INSPECTION_FINDING_RESOLVED', 'REPORTING_STREAMS_SAVED', 'CHECKLIST_TEMPLATE_SAVED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERSIONED', 'DOCUMENT_SIGNED', 'DOCUMENT_ARCHIVED', 'DOCUMENT_TYPE_SAVED', 'CONTRACT_DETAILS_SAVED', 'MILESTONE_COMPLETED', 'MILESTONE_WAIVED', 'MILESTONE_DATES_RECOMPUTED', 'KICKOFF_SCHEDULED', 'KICKOFF_NOTICE_SENT', 'KICKOFF_HELD', 'DEFAULT_CASE_OPENED', 'DEFAULT_CASE_REVIEWED', 'DEFAULT_CASE_DECIDED', 'CONTRACTOR_TERMINATED', 'PROGRAMME_OF_WORKS_SUBMITTED', 'PROGRAMME_OF_WORKS_DECIDED', 'COC_DRAFTED', 'COC_SIGNED', 'COC_ISSUED', 'COC_REVOKED', 'HANDOVER_CERTIFICATE_ISSUED', 'CLOSURE_ITEM_COMPLETED', 'CLOSURE_ITEM_WAIVED', 'CLOSURE_AUDIT_SIGNED', 'CONTRACTOR_RATED', 'LESSON_PUBLISHED', 'CLOSURE_PACK_EXPORTED', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED');
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditActionType_new" USING ("action"::text::"AuditActionType_new");
ALTER TYPE "AuditActionType" RENAME TO "AuditActionType_old";
ALTER TYPE "AuditActionType_new" RENAME TO "AuditActionType";
DROP TYPE "public"."AuditActionType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "MobileNotificationType_new" AS ENUM ('BACKLOG_REVIEW_REQUIRED', 'REPORT_QUERY', 'HOLD_POINT_ALERT', 'REPORT_OVERDUE', 'DEFECT_UPDATE', 'INSPECTION_FINDING');
ALTER TABLE "mobile_notifications" ALTER COLUMN "type" TYPE "MobileNotificationType_new" USING ("type"::text::"MobileNotificationType_new");
ALTER TYPE "MobileNotificationType" RENAME TO "MobileNotificationType_old";
ALTER TYPE "MobileNotificationType_new" RENAME TO "MobileNotificationType";
DROP TYPE "public"."MobileNotificationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "expected_project_participants" DROP CONSTRAINT "expected_project_participants_linkedFieldSessionId_fkey";

-- DropForeignKey
ALTER TABLE "expected_project_participants" DROP CONSTRAINT "expected_project_participants_projectContractorId_fkey";

-- DropForeignKey
ALTER TABLE "expected_project_participants" DROP CONSTRAINT "expected_project_participants_projectId_fkey";

-- DropForeignKey
ALTER TABLE "expected_project_participants" DROP CONSTRAINT "expected_project_participants_roleId_fkey";

-- DropForeignKey
ALTER TABLE "expected_project_participants" DROP CONSTRAINT "expected_project_participants_userId_fkey";

-- DropForeignKey
ALTER TABLE "morning_deliverable_briefs" DROP CONSTRAINT "morning_deliverable_briefs_boqItemId_fkey";

-- DropForeignKey
ALTER TABLE "morning_deliverable_briefs" DROP CONSTRAINT "morning_deliverable_briefs_projectId_fkey";

-- DropForeignKey
ALTER TABLE "site_attendance_alerts" DROP CONSTRAINT "site_attendance_alerts_fieldSessionId_fkey";

-- DropForeignKey
ALTER TABLE "site_attendance_alerts" DROP CONSTRAINT "site_attendance_alerts_participantId_fkey";

-- DropForeignKey
ALTER TABLE "site_attendance_alerts" DROP CONSTRAINT "site_attendance_alerts_projectId_fkey";

-- DropForeignKey
ALTER TABLE "site_telemetry_pings" DROP CONSTRAINT "site_telemetry_pings_fieldSessionId_fkey";

-- DropForeignKey
ALTER TABLE "site_telemetry_pings" DROP CONSTRAINT "site_telemetry_pings_projectId_fkey";

-- DropForeignKey
ALTER TABLE "telemetry_anomaly_daily" DROP CONSTRAINT "telemetry_anomaly_daily_fieldSessionId_fkey";

-- DropForeignKey
ALTER TABLE "telemetry_anomaly_daily" DROP CONSTRAINT "telemetry_anomaly_daily_projectId_fkey";

-- DropTable
DROP TABLE "expected_project_participants";

-- DropTable
DROP TABLE "morning_deliverable_briefs";

-- DropTable
DROP TABLE "site_attendance_alerts";

-- DropTable
DROP TABLE "site_telemetry_pings";

-- DropTable
DROP TABLE "telemetry_anomaly_daily";

-- DropEnum
DROP TYPE "AttendanceAlertStatus";

-- DropEnum
DROP TYPE "AttendanceAlertType";

-- DropEnum
DROP TYPE "BriefPersona";

-- DropEnum
DROP TYPE "MobilizationStatus";
