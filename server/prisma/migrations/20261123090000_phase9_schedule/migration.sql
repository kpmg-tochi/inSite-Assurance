-- CreateEnum
CREATE TYPE "ScheduleRevisionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPLIED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'SCHEDULE_BASELINE_SET';
ALTER TYPE "AuditActionType" ADD VALUE 'SCHEDULE_REVISION_PROPOSED';
ALTER TYPE "AuditActionType" ADD VALUE 'SCHEDULE_REVISION_APPLIED';
ALTER TYPE "AuditActionType" ADD VALUE 'SCHEDULE_REVISION_REJECTED';

-- AlterTable
ALTER TABLE "BoqItem" DROP COLUMN "isScheduledToday",
ADD COLUMN     "actualCompletionDate" TEXT,
ADD COLUMN     "actualStartDate" TEXT,
ADD COLUMN     "originalPlannedEndDate" TEXT,
ADD COLUMN     "originalPlannedStartDate" TEXT,
ADD COLUMN     "plannedEndDate" TEXT,
ADD COLUMN     "plannedStartDate" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "actualStartDate" TEXT,
ADD COLUMN     "currentProjectedEndDate" TEXT,
ADD COLUMN     "originalPlannedEndDate" TEXT,
ADD COLUMN     "plannedEndDate" TEXT,
ADD COLUMN     "plannedStartDate" TEXT,
ADD COLUMN     "scheduleBehindAlertedAt" TIMESTAMP(3),
ADD COLUMN     "scheduleStatus" TEXT,
ADD COLUMN     "scheduleVarianceComputedAt" TIMESTAMP(3),
ADD COLUMN     "scheduleVarianceWorkdays" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "boq_item_dependencies" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "predecessorBoqItemId" UUID NOT NULL,
    "successorBoqItemId" UUID NOT NULL,
    "lagWorkdays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_item_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_revisions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "initiatedByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "status" "ScheduleRevisionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "decisionNotes" TEXT,
    "previousProjectedEndDate" TEXT,
    "newProjectedEndDate" TEXT,
    "totalShiftedWorkdays" INTEGER NOT NULL DEFAULT 0,
    "itemAdjustmentsJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "schedule_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boq_item_dependencies_projectId_idx" ON "boq_item_dependencies"("projectId");

-- CreateIndex
CREATE INDEX "boq_item_dependencies_successorBoqItemId_idx" ON "boq_item_dependencies"("successorBoqItemId");

-- CreateIndex
CREATE UNIQUE INDEX "boq_item_dependencies_predecessorBoqItemId_successorBoqItem_key" ON "boq_item_dependencies"("predecessorBoqItemId", "successorBoqItemId");

-- CreateIndex
CREATE INDEX "schedule_revisions_projectId_status_idx" ON "schedule_revisions"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_revisions_projectId_revisionNumber_key" ON "schedule_revisions"("projectId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "boq_item_dependencies" ADD CONSTRAINT "boq_item_dependencies_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_item_dependencies" ADD CONSTRAINT "boq_item_dependencies_predecessorBoqItemId_fkey" FOREIGN KEY ("predecessorBoqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_item_dependencies" ADD CONSTRAINT "boq_item_dependencies_successorBoqItemId_fkey" FOREIGN KEY ("successorBoqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_revisions" ADD CONSTRAINT "schedule_revisions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_revisions" ADD CONSTRAINT "schedule_revisions_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_revisions" ADD CONSTRAINT "schedule_revisions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written (Phase 9): at most one revision waiting for approval per project. Keep it when
-- regenerating migrations.
CREATE UNIQUE INDEX "schedule_revisions_one_pending_per_project" ON "schedule_revisions"("projectId") WHERE "status" = 'PENDING_APPROVAL';
