-- AlterTable
ALTER TABLE "mobile_notifications" ADD COLUMN     "actionedAt" TIMESTAMP(3),
ADD COLUMN     "actionedByName" TEXT,
ADD COLUMN     "actionedBySessionId" UUID,
ADD COLUMN     "actionedByUserId" UUID;

