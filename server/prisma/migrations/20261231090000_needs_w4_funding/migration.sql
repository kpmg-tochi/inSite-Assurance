-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_SUBMISSION_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_COUNTERPART_RECORDED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_LOTS_ASSIGNED';

-- AlterTable
ALTER TABLE "needs_proposals" ADD COLUMN     "outOfCycleDetails" TEXT;

-- AlterTable
ALTER TABLE "needs_submission_items" ADD COLUMN     "plannedEndDate" TEXT,
ADD COLUMN     "plannedStartDate" TEXT;

-- AlterTable
ALTER TABLE "needs_submissions" ADD COLUMN     "counterpartRecordedAt" TIMESTAMP(3),
ADD COLUMN     "counterpartRecordedByName" TEXT,
ADD COLUMN     "counterpartRecordedByUserId" UUID,
ADD COLUMN     "narrativeDocumentId" UUID;

-- CreateTable
CREATE TABLE "needs_funding_records" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "recordedOn" TEXT NOT NULL,
    "amountNgn" DECIMAL(18,2),
    "documentId" UUID,
    "approvedListId" UUID,
    "fileName" TEXT,
    "sha256" TEXT,
    "note" TEXT,
    "summaryJson" JSONB NOT NULL DEFAULT '{}',
    "recordedByUserId" UUID NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_funding_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "needs_funding_records_cycleId_kind_idx" ON "needs_funding_records"("cycleId", "kind");

-- AddForeignKey
ALTER TABLE "needs_funding_records" ADD CONSTRAINT "needs_funding_records_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
