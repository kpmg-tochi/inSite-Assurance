-- Phase 3: disbursement integrity, reconciliation workflow and rating labels.
-- Adds NOT NULL columns without defaults (decision A: the dev database is disposable).
-- Apply to an empty or reset database: npx prisma migrate reset

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'CP_STATUS_CHANGED';
ALTER TYPE "AuditActionType" ADD VALUE 'CP_WAIVED';
ALTER TYPE "AuditActionType" ADD VALUE 'MONITOR_QUERY_RESOLVED';
ALTER TYPE "AuditActionType" ADD VALUE 'IPC_WITHDRAWN';
ALTER TYPE "AuditActionType" ADD VALUE 'TRANCHE_DECISION_REVERSED';
ALTER TYPE "AuditActionType" ADD VALUE 'TENANT_SETTINGS_UPDATED';

-- AlterEnum
ALTER TYPE "IpcClaimStatus" ADD VALUE 'REJECTED_WITHDRAWN';

-- DropIndex
DROP INDEX "TrancheDecision_valuationReportId_key";

-- DropIndex
DROP INDEX "ValuationReport_ipcClaimId_key";

-- AlterTable
ALTER TABLE "ConditionPrecedent" ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "waivedByUserId" UUID,
ADD COLUMN     "waiverReason" TEXT;

-- AlterTable
ALTER TABLE "IpcClaim" ADD COLUMN     "ratingEngine" TEXT,
ADD COLUMN     "ratingEngineDetail" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "submittedByUserId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "IpcLineItem" ADD COLUMN     "evidenceCoveragePct" DECIMAL(9,2),
ADD COLUMN     "evidenceQuantityTotal" DECIMAL(18,3),
ADD COLUMN     "ratingEngine" TEXT,
ADD COLUMN     "ruleCapsApplied" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "MonitorQuery" ADD COLUMN     "raisedByUserId" UUID,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolvedByUserId" UUID,
ADD COLUMN     "respondedByUserId" UUID;

-- AlterTable
ALTER TABLE "TrancheDecision" ADD COLUMN     "cpSnapshotJson" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reversesDecisionId" UUID;

-- AlterTable
ALTER TABLE "ValuationReport" ADD COLUMN     "revisionNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "totalCertifiedNgn" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "totalClaimedNgn" DECIMAL(18,2) NOT NULL,
ALTER COLUMN "certifierLicenseType" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "evidenceRatingLabels" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "IpcClaim_trancheId_status_idx" ON "IpcClaim"("trancheId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrancheDecision_reversesDecisionId_key" ON "TrancheDecision"("reversesDecisionId");

-- CreateIndex
CREATE INDEX "TrancheDecision_valuationReportId_idx" ON "TrancheDecision"("valuationReportId");

-- CreateIndex
CREATE UNIQUE INDEX "ValuationReport_ipcClaimId_revisionNumber_key" ON "ValuationReport"("ipcClaimId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "ConditionPrecedent" ADD CONSTRAINT "ConditionPrecedent_waivedByUserId_fkey" FOREIGN KEY ("waivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcClaim" ADD CONSTRAINT "IpcClaim_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorQuery" ADD CONSTRAINT "MonitorQuery_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorQuery" ADD CONSTRAINT "MonitorQuery_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorQuery" ADD CONSTRAINT "MonitorQuery_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrancheDecision" ADD CONSTRAINT "TrancheDecision_reversesDecisionId_fkey" FOREIGN KEY ("reversesDecisionId") REFERENCES "TrancheDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

