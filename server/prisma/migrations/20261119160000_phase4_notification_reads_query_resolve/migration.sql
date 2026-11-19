-- Phase 4: per-session read state for mobile notifications (Phase 2 carry-over) and the
-- report-query resolve action (Phase 3 carry-over).

-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'REPORT_QUERY_RESOLVED';

-- CreateTable
CREATE TABLE "mobile_notification_reads" (
    "notificationId" UUID NOT NULL,
    "fieldSessionId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_notification_reads_pkey" PRIMARY KEY ("notificationId","fieldSessionId")
);

-- Keep the read state of notifications addressed to one session. Broadcast reads cannot be
-- attributed to a session, so broadcasts start unread for everyone.
INSERT INTO "mobile_notification_reads" ("notificationId", "fieldSessionId", "readAt")
SELECT "id", "fieldSessionId", COALESCE("readAt", CURRENT_TIMESTAMP)
FROM "mobile_notifications"
WHERE "isRead" = true AND "fieldSessionId" IS NOT NULL;

-- DropIndex
DROP INDEX "mobile_notifications_fieldSessionId_isRead_createdAt_idx";

-- DropIndex
DROP INDEX "mobile_notifications_projectId_isRead_createdAt_idx";

-- AlterTable
ALTER TABLE "mobile_notifications" DROP COLUMN "isRead",
DROP COLUMN "readAt";

-- CreateIndex
CREATE INDEX "mobile_notification_reads_fieldSessionId_idx" ON "mobile_notification_reads"("fieldSessionId");

-- CreateIndex
CREATE INDEX "mobile_notifications_projectId_createdAt_idx" ON "mobile_notifications"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "mobile_notifications_fieldSessionId_createdAt_idx" ON "mobile_notifications"("fieldSessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "mobile_notification_reads" ADD CONSTRAINT "mobile_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "mobile_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_notification_reads" ADD CONSTRAINT "mobile_notification_reads_fieldSessionId_fkey" FOREIGN KEY ("fieldSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
