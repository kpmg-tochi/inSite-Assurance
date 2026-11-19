-- CreateEnum
CREATE TYPE "RoleOnboardingMode" AS ENUM ('JOIN_CODE', 'PROVISIONED_ACCOUNT');

-- CreateEnum
CREATE TYPE "FieldSessionOrigin" AS ENUM ('JOIN_CODE', 'PROVISIONED_ACCOUNT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'MOBILE_USER_SIGNED_IN';
ALTER TYPE "AuditActionType" ADD VALUE 'MOBILE_DEVICE_REVOKED';
ALTER TYPE "AuditActionType" ADD VALUE 'ROLE_ONBOARDING_MODE_CHANGED';

-- DropForeignKey
ALTER TABLE "user_project_assignments" DROP CONSTRAINT "user_project_assignments_roleId_fkey";

-- AlterTable
ALTER TABLE "FieldAgentSession" ADD COLUMN     "mobileDeviceId" UUID,
ADD COLUMN     "origin" "FieldSessionOrigin" NOT NULL DEFAULT 'JOIN_CODE',
ADD COLUMN     "userId" UUID,
ALTER COLUMN "joinCodeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mobileRoleId" UUID,
ADD COLUMN     "phoneNumber" TEXT;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "onboardingMode" "RoleOnboardingMode" NOT NULL DEFAULT 'JOIN_CODE';

-- AlterTable
ALTER TABLE "user_project_assignments" DROP COLUMN "roleId";

-- CreateTable
CREATE TABLE "mobile_devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceModel" TEXT,
    "deviceOs" TEXT,
    "publicKey" TEXT NOT NULL,
    "publicKeyAlg" TEXT NOT NULL,
    "publicKeyId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_devices_userId_idx" ON "mobile_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_devices_userId_deviceId_key" ON "mobile_devices"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "FieldAgentSession_userId_idx" ON "FieldAgentSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldAgentSession_userId_projectId_deviceId_key" ON "FieldAgentSession"("userId", "projectId", "deviceId");

-- CreateIndex
CREATE INDEX "User_mobileRoleId_idx" ON "User"("mobileRoleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_mobileRoleId_fkey" FOREIGN KEY ("mobileRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_mobileDeviceId_fkey" FOREIGN KEY ("mobileDeviceId") REFERENCES "mobile_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A field session comes from exactly one source: a join code, or a provisioned account on a device.
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_origin_source_check" CHECK (
  ("origin" = 'JOIN_CODE' AND "joinCodeId" IS NOT NULL AND "userId" IS NULL AND "mobileDeviceId" IS NULL)
  OR
  ("origin" = 'PROVISIONED_ACCOUNT' AND "joinCodeId" IS NULL AND "userId" IS NOT NULL AND "mobileDeviceId" IS NOT NULL)
);

-- A pre-provisioned role never requires identity assurance and is never web-only (decision G).
ALTER TABLE "roles" ADD CONSTRAINT "roles_provisioned_mode_check" CHECK (
  "onboardingMode" = 'JOIN_CODE' OR ("requiresIdentityAssurance" = false AND "surface" <> 'WEB')
);
