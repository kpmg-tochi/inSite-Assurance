-- AlterTable
ALTER TABLE "push_tokens" ADD COLUMN     "mobileDeviceId" UUID;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_mobileDeviceId_fkey" FOREIGN KEY ("mobileDeviceId") REFERENCES "mobile_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

