-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_SEPARATION_OVERRIDE_REQUESTED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_RANKING_OVERRIDDEN';

-- AlterTable
ALTER TABLE "needs_cycles" ADD COLUMN     "fundingLineReason" TEXT,
ADD COLUMN     "scoringClosedAt" TIMESTAMP(3),
ADD COLUMN     "scoringClosedByName" TEXT,
ADD COLUMN     "scoringClosedByUserId" UUID,
ADD COLUMN     "scoringOpenedAt" TIMESTAMP(3),
ADD COLUMN     "scoringOpenedByName" TEXT,
ADD COLUMN     "scoringOpenedByUserId" UUID;
