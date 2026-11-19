-- CreateEnum
CREATE TYPE "ReportingObligationStatus" AS ENUM ('PENDING', 'SUBMITTED', 'LATE', 'MISSED', 'EXCUSED');

-- CreateEnum
CREATE TYPE "MobilizationStatus" AS ENUM ('INVITED', 'REGISTERED_PENDING_ASSURANCE', 'READY_FOR_MOBILIZATION', 'MOBILIZED_ON_SITE', 'NO_SHOW_FLAGGED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AttendanceAlertType" AS ENUM ('MOBILIZATION_NO_SHOW', 'WORKDAY_MISSED_CHECKIN', 'UNVERIFIED_AT_MOBILIZATION');

-- CreateEnum
CREATE TYPE "AttendanceAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'EXCUSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboundChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "OutboundMessageStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'REPORT_SUBMITTED_LATE';
ALTER TYPE "AuditActionType" ADD VALUE 'REPORT_MISSED';
ALTER TYPE "AuditActionType" ADD VALUE 'PARTICIPANT_PREREGISTERED';
ALTER TYPE "AuditActionType" ADD VALUE 'PARTICIPANT_REMINDER_SENT';
ALTER TYPE "AuditActionType" ADD VALUE 'ATTENDANCE_ALERT_RAISED';
ALTER TYPE "AuditActionType" ADD VALUE 'ATTENDANCE_ALERT_RESOLVED';
ALTER TYPE "AuditActionType" ADD VALUE 'MANUAL_CHECKIN_RECORDED';
ALTER TYPE "AuditActionType" ADD VALUE 'REPORTING_OBLIGATION_EXCUSED';

-- AlterEnum
ALTER TYPE "AuditActorType" ADD VALUE 'SYSTEM';

-- AlterEnum
ALTER TYPE "MobileNotificationType" ADD VALUE 'REPORT_OVERDUE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportingCadence" ADD VALUE 'MONTHLY';
ALTER TYPE "ReportingCadence" ADD VALUE 'CUSTOM_INTERVAL';

-- DropIndex
DROP INDEX "morning_deliverable_briefs_projectId_boqItemId_workdayDate__key";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "cadenceAnchorDate" TEXT,
ADD COLUMN     "customIntervalDays" INTEGER,
ADD COLUMN     "mobilizationReminderOffsetsDays" INTEGER[] DEFAULT ARRAY[7, 3, 1]::INTEGER[],
ADD COLUMN     "periodStartDayOfWeek" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reportDueTime" TEXT,
ADD COLUMN     "reportGraceMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workWeekDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[];

-- AlterTable (hand-edited: existing rows get a one-day period ending at 23:59 UTC of workdayDate)
ALTER TABLE "morning_deliverable_briefs" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "reportingPeriodEnd" TEXT,
ADD COLUMN     "reportingPeriodStart" TEXT;
UPDATE "morning_deliverable_briefs" SET "reportingPeriodStart" = "workdayDate", "reportingPeriodEnd" = "workdayDate", "dueAt" = ("workdayDate" || 'T23:59:00Z')::timestamptz;
ALTER TABLE "morning_deliverable_briefs" ALTER COLUMN "dueAt" SET NOT NULL, ALTER COLUMN "reportingPeriodEnd" SET NOT NULL, ALTER COLUMN "reportingPeriodStart" SET NOT NULL;

-- AlterTable (hand-edited, as above)
ALTER TABLE "workday_reports" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "isLateSubmission" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lateByMinutes" INTEGER,
ADD COLUMN     "reportingPeriodEnd" TEXT,
ADD COLUMN     "reportingPeriodStart" TEXT;
UPDATE "workday_reports" SET "reportingPeriodStart" = "workdayDate", "reportingPeriodEnd" = "workdayDate", "dueAt" = ("workdayDate" || 'T23:59:00Z')::timestamptz;
ALTER TABLE "workday_reports" ALTER COLUMN "dueAt" SET NOT NULL, ALTER COLUMN "reportingPeriodEnd" SET NOT NULL, ALTER COLUMN "reportingPeriodStart" SET NOT NULL;

-- Hand-written (keep in regenerated migrations): one original report per reporter, WBS item and
-- reporting period. Replaces the Phase 4 per-day index; for DAILY cadence the two are the same.
DROP INDEX IF EXISTS "workday_reports_one_report_per_period";
CREATE UNIQUE INDEX "workday_reports_one_report_per_period"
  ON "workday_reports" ("reporterSessionId", "wbsItemId", "reportingPeriodStart")
  WHERE "parentReportId" IS NULL;

-- CreateTable
CREATE TABLE "reporting_obligations" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "boqItemId" UUID NOT NULL,
    "reporterScope" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lateAfter" TIMESTAMP(3) NOT NULL,
    "status" "ReportingObligationStatus" NOT NULL DEFAULT 'PENDING',
    "workdayReportId" UUID,
    "alertedAt" TIMESTAMP(3),
    "excusedNote" TEXT,
    "excusedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expected_project_participants" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "projectContractorId" UUID,
    "roleId" UUID NOT NULL,
    "userId" UUID,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phoneNumber" TEXT,
    "plannedMobilizationDate" TEXT NOT NULL,
    "expectedCheckInTime" TEXT,
    "checkInGraceMinutes" INTEGER NOT NULL DEFAULT 120,
    "reminderOffsetsDays" INTEGER[] DEFAULT ARRAY[7, 3, 1]::INTEGER[],
    "usesProjectReminderSchedule" BOOLEAN NOT NULL DEFAULT true,
    "lastReminderSentAt" TIMESTAMP(3),
    "linkedFieldSessionId" UUID,
    "mobilizationStatus" "MobilizationStatus" NOT NULL DEFAULT 'INVITED',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expected_project_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_attendance_alerts" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "participantId" UUID,
    "fieldSessionId" UUID,
    "workdayDate" TEXT NOT NULL,
    "alertType" "AttendanceAlertType" NOT NULL,
    "status" "AttendanceAlertStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" UUID,
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_attendance_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "jobName" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "detail" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID,
    "channel" "OutboundChannel" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL DEFAULT '{}',
    "status" "OutboundMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reporting_obligations_projectId_periodStart_idx" ON "reporting_obligations"("projectId", "periodStart");

-- CreateIndex
CREATE INDEX "reporting_obligations_status_lateAfter_idx" ON "reporting_obligations"("status", "lateAfter");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_obligations_projectId_boqItemId_reporterScope_per_key" ON "reporting_obligations"("projectId", "boqItemId", "reporterScope", "periodStart");

-- CreateIndex
CREATE INDEX "expected_project_participants_projectId_mobilizationStatus_idx" ON "expected_project_participants"("projectId", "mobilizationStatus");

-- CreateIndex
CREATE INDEX "expected_project_participants_projectId_plannedMobilization_idx" ON "expected_project_participants"("projectId", "plannedMobilizationDate");

-- CreateIndex
CREATE INDEX "expected_project_participants_userId_idx" ON "expected_project_participants"("userId");

-- CreateIndex
CREATE INDEX "site_attendance_alerts_projectId_status_idx" ON "site_attendance_alerts"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "site_attendance_alerts_projectId_participantId_workdayDate__key" ON "site_attendance_alerts"("projectId", "participantId", "workdayDate", "alertType");

-- CreateIndex
CREATE INDEX "job_runs_jobName_startedAt_idx" ON "job_runs"("jobName", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_jobName_scopeKey_key" ON "job_runs"("jobName", "scopeKey");

-- CreateIndex
CREATE INDEX "outbound_messages_status_nextAttemptAt_idx" ON "outbound_messages"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "outbound_messages_tenantId_createdAt_idx" ON "outbound_messages"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "outbound_messages_toAddress_createdAt_idx" ON "outbound_messages"("toAddress", "createdAt");

-- CreateIndex
CREATE INDEX "morning_deliverable_briefs_projectId_reportingPeriodStart_idx" ON "morning_deliverable_briefs"("projectId", "reportingPeriodStart");

-- CreateIndex
CREATE UNIQUE INDEX "morning_deliverable_briefs_projectId_boqItemId_reportingPer_key" ON "morning_deliverable_briefs"("projectId", "boqItemId", "reportingPeriodStart", "targetPersona");

-- CreateIndex
CREATE INDEX "workday_reports_projectId_reportingPeriodStart_idx" ON "workday_reports"("projectId", "reportingPeriodStart");

-- AddForeignKey
ALTER TABLE "reporting_obligations" ADD CONSTRAINT "reporting_obligations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_obligations" ADD CONSTRAINT "reporting_obligations_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_obligations" ADD CONSTRAINT "reporting_obligations_workdayReportId_fkey" FOREIGN KEY ("workdayReportId") REFERENCES "workday_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_project_participants" ADD CONSTRAINT "expected_project_participants_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_project_participants" ADD CONSTRAINT "expected_project_participants_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_project_participants" ADD CONSTRAINT "expected_project_participants_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_project_participants" ADD CONSTRAINT "expected_project_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_project_participants" ADD CONSTRAINT "expected_project_participants_linkedFieldSessionId_fkey" FOREIGN KEY ("linkedFieldSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_attendance_alerts" ADD CONSTRAINT "site_attendance_alerts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_attendance_alerts" ADD CONSTRAINT "site_attendance_alerts_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "expected_project_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_attendance_alerts" ADD CONSTRAINT "site_attendance_alerts_fieldSessionId_fkey" FOREIGN KEY ("fieldSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
