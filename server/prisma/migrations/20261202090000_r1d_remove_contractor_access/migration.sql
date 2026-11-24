-- Redesign R1d: delete professional registration, contractor access (join codes, join-code
-- sessions, identity assurance, the public handover link) and multi-contractor modes.
-- Hand edits: the data clean-up below (so this applies on a database with data), the explicit drop of
-- the hand-written CHECK FieldAgentSession_origin_source_check, and the handover response backfill.
-- The hand-written index ProjectJoinCode_active_project_role_contractor_key goes with its table.

-- Data clean-up
ALTER TABLE "FieldAgentSession" DROP CONSTRAINT IF EXISTS "FieldAgentSession_origin_source_check";
-- Join-code sessions have no user: they go, with the captures they made (reports cascade).
DELETE FROM "FieldEvidenceLog" WHERE "fieldSessionId" IN (SELECT "id" FROM "FieldAgentSession" WHERE "userId" IS NULL);
DELETE FROM "FieldAgentSession" WHERE "userId" IS NULL;
DELETE FROM "AuditLog" WHERE "action"::text IN ('JOIN_CODE_ISSUED', 'CONTRACTOR_ASSURANCE_SUBMITTED', 'CONTRACTOR_ASSURANCE_APPROVED', 'CONTRACTOR_ASSURANCE_REJECTED', 'JOIN_CODE_ROTATED', 'ROLE_ONBOARDING_MODE_CHANGED', 'HANDOVER_LINK_CREATED', 'HANDOVER_LINK_REVOKED', 'CREDENTIAL_POLICY_UPDATED', 'REGISTRATION_BODY_SAVED', 'CONTRACTOR_REPLACED', 'HANDOVER_SUBMITTED');
DELETE FROM "mobile_notifications" WHERE "type"::text IN ('ASSURANCE_PENDING', 'ASSURANCE_APPROVED', 'ASSURANCE_REJECTED') OR "actionType"::text = 'OPEN_ASSURANCE_WIZARD';
-- Permissions: join and identity review are gone; managing links becomes recording responses.
DELETE FROM "permissions" WHERE "key" IN ('field:join_project', 'assurance:review_credentials');
UPDATE "permissions" SET "key" = 'handover:record_response', "name" = 'Record Handover Responses', "description" = 'Record the beneficiary''s handover response from the signed paper copy.' WHERE "key" = 'handover:manage_links';
-- Handover responses keep their stakeholder type and the link creator as the recorder.
ALTER TABLE "handover_submissions" ADD COLUMN "recordedByUserId" UUID, ADD COLUMN "stakeholderType" "HandoverStakeholderType";
UPDATE "handover_submissions" s SET "recordedByUserId" = l."createdByUserId", "stakeholderType" = l."stakeholderType" FROM "handover_links" l WHERE l."id" = s."handoverLinkId";
ALTER TABLE "handover_submissions" ALTER COLUMN "recordedByUserId" SET NOT NULL, ALTER COLUMN "stakeholderType" SET NOT NULL;

-- AlterEnum
BEGIN;
CREATE TYPE "AuditActionType_new" AS ENUM ('TENANT_CREATED', 'TENANT_BRANDING_UPDATED', 'ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_DELETED', 'USER_PROJECT_ASSIGNED', 'PROJECT_CREATED', 'BASELINE_UPDATED', 'BOQ_UPLOADED', 'FIELD_AGENT_JOINED', 'FIELD_SESSION_STATUS_UPDATED', 'EVIDENCE_EXTRACTED', 'EVIDENCE_CONFIRMED', 'EVIDENCE_FLAGGED_INTEGRITY', 'MONITOR_QUERY_RAISED', 'CONTRACTOR_QUERY_RESPONDED', 'INCIDENT_REPORT_SUBMITTED', 'INCIDENT_STATUS_UPDATED', 'PUSH_TOKEN_REGISTERED', 'WORKDAY_REPORT_SUBMITTED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'LOGIN_FAILED_LOCKOUT', 'TENANT_SETTINGS_UPDATED', 'CAPTURE_REGISTERED', 'CAPTURE_FLAGGED_INTEGRITY', 'TELEMETRY_ANOMALY_SUMMARY', 'WORKDAY_REPORTS_RELEASED', 'DEVICE_KEY_REGISTERED', 'REPORT_QUERY_RESOLVED', 'MOBILE_USER_SIGNED_IN', 'MOBILE_DEVICE_REVOKED', 'ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'PROJECT_DRAFT_CREATED', 'PROJECT_SETUP_STEP_SAVED', 'PROJECT_ACTIVATED', 'PROJECT_ARCHIVED', 'PROJECT_CONTRACTOR_ADDED', 'PROJECT_CONTRACTOR_REMOVED', 'BOQ_REVISED', 'PROJECT_DRAFT_DELETED', 'WORKFLOW_TEMPLATE_SAVED', 'PROJECT_PROCESS_CONFIG_UPDATED', 'PROJECT_STANDARD_CREATED', 'PROJECT_STANDARD_UPDATED', 'PROJECT_STANDARD_DELETED', 'NEEDS_ASSESSMENT_UPLOADED', 'NEEDS_ASSESSMENT_DELETED', 'WORKDAY_REPORT_APPROVED', 'WORKDAY_REPORT_RETURNED', 'STANDARDS_VIOLATION_FLAGGED', 'APPROVAL_STEP_ACTIONED', 'REPORT_SUBMITTED_LATE', 'REPORT_MISSED', 'PARTICIPANT_PREREGISTERED', 'PARTICIPANT_REMINDER_SENT', 'ATTENDANCE_ALERT_RAISED', 'ATTENDANCE_ALERT_RESOLVED', 'MANUAL_CHECKIN_RECORDED', 'REPORTING_OBLIGATION_EXCUSED', 'SCHEDULE_BASELINE_SET', 'SCHEDULE_REVISION_PROPOSED', 'SCHEDULE_REVISION_APPLIED', 'SCHEDULE_REVISION_REJECTED', 'SCHEDULE_REVISION_WITHDRAWN', 'HANDOVER_RECORDED', 'HANDOVER_REVIEWED', 'PROJECT_PHASE_CHANGED', 'RETENTION_WITHHELD', 'DEFECT_TICKET_RAISED', 'DEFECT_TICKET_UPDATED', 'DEFECT_TICKET_CLOSED', 'RETENTION_RELEASED', 'PROJECT_TYPE_SAVED', 'PROJECT_TYPE_APPLIED', 'ORGANIZATION_HIERARCHY_CHANGED', 'TERMINOLOGY_UPDATED', 'INSPECTION_SUBMITTED', 'INSPECTION_REVIEWED', 'INSPECTION_FINDING_RAISED', 'INSPECTION_FINDING_RESOLVED', 'REPORTING_STREAMS_SAVED', 'CHECKLIST_TEMPLATE_SAVED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERSIONED', 'DOCUMENT_SIGNED', 'DOCUMENT_ARCHIVED', 'DOCUMENT_TYPE_SAVED', 'CONTRACT_DETAILS_SAVED', 'MILESTONE_COMPLETED', 'MILESTONE_WAIVED', 'MILESTONE_DATES_RECOMPUTED', 'KICKOFF_SCHEDULED', 'KICKOFF_NOTICE_SENT', 'KICKOFF_HELD', 'DEFAULT_CASE_OPENED', 'DEFAULT_CASE_REVIEWED', 'DEFAULT_CASE_DECIDED', 'CONTRACTOR_TERMINATED', 'PROGRAMME_OF_WORKS_SUBMITTED', 'PROGRAMME_OF_WORKS_DECIDED', 'COC_DRAFTED', 'COC_SIGNED', 'COC_ISSUED', 'COC_REVOKED', 'HANDOVER_CERTIFICATE_ISSUED', 'CLOSURE_ITEM_COMPLETED', 'CLOSURE_ITEM_WAIVED', 'CLOSURE_AUDIT_SIGNED', 'CONTRACTOR_RATED', 'LESSON_PUBLISHED', 'CLOSURE_PACK_EXPORTED', 'PAYMENT_RECORDED', 'PAYMENT_VOIDED');
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditActionType_new" USING ("action"::text::"AuditActionType_new");
ALTER TYPE "AuditActionType" RENAME TO "AuditActionType_old";
ALTER TYPE "AuditActionType_new" RENAME TO "AuditActionType";
DROP TYPE "public"."AuditActionType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "MobileNotificationType_new" AS ENUM ('BACKLOG_REVIEW_REQUIRED', 'REPORT_QUERY', 'HOLD_POINT_ALERT', 'MORNING_DELIVERABLE_READY', 'SITE_GEOFENCE_WARNING', 'REPORT_OVERDUE', 'DEFECT_UPDATE', 'INSPECTION_FINDING');
ALTER TABLE "mobile_notifications" ALTER COLUMN "type" TYPE "MobileNotificationType_new" USING ("type"::text::"MobileNotificationType_new");
ALTER TYPE "MobileNotificationType" RENAME TO "MobileNotificationType_old";
ALTER TYPE "MobileNotificationType_new" RENAME TO "MobileNotificationType";
DROP TYPE "public"."MobileNotificationType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationActionType_new" AS ENUM ('NONE', 'OPEN_REPORT_SUMMARY', 'OPEN_WBS_CHAT', 'OPEN_BACKLOG_REVIEW', 'OPEN_DEFECTS', 'OPEN_INSPECTION_FINDINGS');
ALTER TABLE "public"."mobile_notifications" ALTER COLUMN "actionType" DROP DEFAULT;
ALTER TABLE "mobile_notifications" ALTER COLUMN "actionType" TYPE "NotificationActionType_new" USING ("actionType"::text::"NotificationActionType_new");
ALTER TYPE "NotificationActionType" RENAME TO "NotificationActionType_old";
ALTER TYPE "NotificationActionType_new" RENAME TO "NotificationActionType";
DROP TYPE "public"."NotificationActionType_old";
ALTER TABLE "mobile_notifications" ALTER COLUMN "actionType" SET DEFAULT 'NONE';
COMMIT;

-- DropForeignKey
ALTER TABLE "FieldAgentSession" DROP CONSTRAINT "FieldAgentSession_joinCodeId_fkey";

-- DropForeignKey
ALTER TABLE "FieldAgentSession" DROP CONSTRAINT "FieldAgentSession_projectContractorId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectJoinCode" DROP CONSTRAINT "ProjectJoinCode_projectContractorId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectJoinCode" DROP CONSTRAINT "ProjectJoinCode_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectJoinCode" DROP CONSTRAINT "ProjectJoinCode_roleId_fkey";

-- DropForeignKey
ALTER TABLE "handover_links" DROP CONSTRAINT "handover_links_projectId_fkey";

-- DropForeignKey
ALTER TABLE "handover_submissions" DROP CONSTRAINT "handover_submissions_handoverLinkId_fkey";

-- DropForeignKey
ALTER TABLE "professional_registration_bodies" DROP CONSTRAINT "professional_registration_bodies_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "project_contractors" DROP CONSTRAINT "project_contractors_replacesProjectContractorId_fkey";

-- DropIndex
DROP INDEX "FieldAgentSession_projectContractorId_idx";

-- DropIndex
DROP INDEX "FieldAgentSession_projectId_assuranceStatus_idx";

-- DropIndex
DROP INDEX "handover_submissions_handoverLinkId_idx";

-- DropIndex
DROP INDEX "roles_tenantId_codeSuffix_key";

-- AlterTable
ALTER TABLE "FieldAgentSession" DROP COLUMN "agentPinHash",
DROP COLUMN "assuranceStatus",
DROP COLUMN "experienceSummary",
DROP COLUMN "idDocumentType",
DROP COLUMN "idDocumentUrl",
DROP COLUMN "joinCodeId",
DROP COLUMN "livenessMetadata",
DROP COLUMN "livenessPassed",
DROP COLUMN "livenessScore",
DROP COLUMN "origin",
DROP COLUMN "projectContractorId",
DROP COLUMN "registrationBodyCode",
DROP COLUMN "registrationNumber",
DROP COLUMN "rejectionReason",
DROP COLUMN "reviewedAt",
DROP COLUMN "reviewedByUserId",
DROP COLUMN "selfieImageUrl",
DROP COLUMN "selfieLeftUrl",
DROP COLUMN "selfieRightUrl",
ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "contractorExecutionMode";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "professionalRegistrationBodyCode",
DROP COLUMN "professionalRegistrationNumber";

-- AlterTable
ALTER TABLE "completion_certificate_signatures" DROP COLUMN "registrationText";

-- AlterTable
ALTER TABLE "handover_submissions" DROP COLUMN "attachmentsJson",
DROP COLUMN "clientIp",
DROP COLUMN "handoverLinkId",
DROP COLUMN "userAgent";

-- AlterTable
ALTER TABLE "project_contractors" DROP COLUMN "allowFieldReporting",
DROP COLUMN "isMainContractor",
DROP COLUMN "replacesProjectContractorId";

-- AlterTable
ALTER TABLE "project_process_configs" DROP COLUMN "allowContractorFieldReporting",
DROP COLUMN "enableContractorIdentityAssurance";

-- AlterTable
ALTER TABLE "retention_defect_tickets" DROP COLUMN "snagPhotoKeys";

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "codeSuffix",
DROP COLUMN "onboardingMode",
DROP COLUMN "requiresIdentityAssurance";

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "credentialPolicyJson";

-- DropTable
DROP TABLE "ProjectJoinCode";

-- DropTable
DROP TABLE "handover_links";

-- DropTable
DROP TABLE "professional_registration_bodies";

-- DropEnum
DROP TYPE "ContractorAssuranceStatus";

-- DropEnum
DROP TYPE "ContractorExecutionMode";

-- DropEnum
DROP TYPE "FieldSessionOrigin";

-- DropEnum
DROP TYPE "HandoverLinkPurpose";

-- DropEnum
DROP TYPE "RoleOnboardingMode";
