-- AlterEnum
ALTER TYPE "MobileNotificationType" ADD VALUE 'DEFECT_UPDATE';

-- AlterEnum
ALTER TYPE "NotificationActionType" ADD VALUE 'OPEN_DEFECTS';

-- AlterTable
ALTER TABLE "web_notifications" ADD COLUMN     "hideFromProjectContractors" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetOrganizationId" UUID;
