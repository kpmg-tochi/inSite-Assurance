-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PROPOSED', 'PLANNED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'APPROVED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VisitConfirmation" AS ENUM ('UNCONFIRMED', 'CONFIRMED', 'DECLINED');

-- CreateEnum
CREATE TYPE "VisitOrigin" AS ENUM ('PLAN', 'MANUAL', 'UNSCHEDULED');

-- AlterEnum
ALTER TYPE "ApprovalSubjectType" ADD VALUE 'VISIT_SUBMISSION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'VISITS_GENERATED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_CREATED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_PUBLISHED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_CANCELLED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_FORM_REBUILT';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_OFFICERS_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_RESPONDED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_DATE_DECIDED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_CHECKED_IN';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_SUBMITTED';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_MISSED';
ALTER TYPE "AuditActionType" ADD VALUE 'SITE_LOG_ADDED';
ALTER TYPE "AuditActionType" ADD VALUE 'SITE_LOG_HIDDEN';
ALTER TYPE "AuditActionType" ADD VALUE 'VISIT_REVIEWED';
ALTER TYPE "AuditActionType" ADD VALUE 'FINDING_ESCALATED';
ALTER TYPE "AuditActionType" ADD VALUE 'FINDINGS_SUMMARY_SENT';
ALTER TYPE "AuditActionType" ADD VALUE 'SPRINT_VERIFIED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MobileNotificationType" ADD VALUE 'VISIT_ASSIGNED';
ALTER TYPE "MobileNotificationType" ADD VALUE 'VISIT_CHANGED';
ALTER TYPE "MobileNotificationType" ADD VALUE 'VISIT_REMINDER';
ALTER TYPE "MobileNotificationType" ADD VALUE 'VISIT_RETURNED';
ALTER TYPE "MobileNotificationType" ADD VALUE 'VISIT_APPROVED';

-- AlterEnum
ALTER TYPE "NotificationActionType" ADD VALUE 'OPEN_VISIT';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defaultVisitOfficerIds" UUID[];

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "visitRescheduleToleranceWorkdays" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "visitKind" "VisitKind" NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'PROPOSED',
    "origin" "VisitOrigin" NOT NULL DEFAULT 'MANUAL',
    "generatorKey" TEXT,
    "originalPlannedDate" TEXT NOT NULL,
    "plannedDate" TEXT NOT NULL,
    "sprintId" UUID,
    "confirmation" "VisitConfirmation" NOT NULL DEFAULT 'UNCONFIRMED',
    "confirmedAt" TIMESTAMP(3),
    "formSnapshotId" UUID,
    "formHash" TEXT,
    "formAssembledAt" TIMESTAMP(3),
    "pickedFacilityIds" UUID[],
    "submissionDeadline" TEXT,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "cancelledByUserId" UUID,
    "missedAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "clientVisitId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_assignees" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visits_clientVisitId_key" ON "visits"("clientVisitId");

-- CreateIndex
CREATE INDEX "visits_projectId_plannedDate_idx" ON "visits"("projectId", "plannedDate");

-- CreateIndex
CREATE INDEX "visits_status_plannedDate_idx" ON "visits"("status", "plannedDate");

-- CreateIndex
CREATE UNIQUE INDEX "visits_projectId_generatorKey_key" ON "visits"("projectId", "generatorKey");

-- CreateIndex
CREATE INDEX "visit_assignees_userId_idx" ON "visit_assignees"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "visit_assignees_visitId_userId_key" ON "visit_assignees"("visitId", "userId");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "project_sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_formSnapshotId_fkey" FOREIGN KEY ("formSnapshotId") REFERENCES "visit_form_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_assignees" ADD CONSTRAINT "visit_assignees_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_assignees" ADD CONSTRAINT "visit_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permission backfill (contract register section 3): a migrated, not reseeded database gets the R4
-- permissions, granted to the default roles that hold them. Idempotent.
INSERT INTO "permissions" ("id", "key", "name", "description", "category", "surface") VALUES
  (gen_random_uuid(), 'visits:view', 'View Visits', 'See the visit plan and planner, visit forms, submissions, comments and the site log.', 'REPORT_APPROVALS', 'BOTH'),
  (gen_random_uuid(), 'visits:plan', 'Plan Visits', 'Create, generate, publish, move, reassign and cancel visits, and accept or reject date proposals from officers.', 'REPORT_APPROVALS', 'WEB'),
  (gen_random_uuid(), 'visits:submit', 'Carry Out Visits', 'Respond to assigned visits (confirm, move, propose, decline), check in and submit visit forms from the field app.', 'REPORT_APPROVALS', 'MOBILE'),
  (gen_random_uuid(), 'sprints:verify', 'Verify Sprints', 'Record whether an ended sprint was met, partly met or not met.', 'REPORT_APPROVALS', 'WEB'),
  (gen_random_uuid(), 'findings:receive_escalations', 'Receive Finding Escalations', 'Be notified when a finding stays open past the escalation period.', 'REPORT_APPROVALS', 'WEB')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r, "permissions" p
WHERE (p."key" IN ('visits:view', 'visits:plan', 'visits:submit', 'sprints:verify', 'findings:receive_escalations') AND r."code" = 'TENANT_SUPER_ADMIN')
   OR (p."key" IN ('visits:view', 'visits:plan', 'sprints:verify') AND r."code" = 'MONITOR')
   OR (p."key" = 'visits:view' AND r."code" = 'LENDER')
   OR (p."key" IN ('visits:view', 'findings:receive_escalations') AND r."code" = 'ORGANIZATION_ADMIN')
   OR (p."key" IN ('visits:view', 'visits:submit') AND r."code" IN ('MONITOR_INSPECTOR', 'INDEPENDENT_RESIDENT'))
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
