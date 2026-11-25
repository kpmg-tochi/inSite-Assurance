-- UBEC IRL items (2026-11-25): register fields (intervention year, funding source, client project ID,
-- bulk-import markers), early-warning alert state, compass heading on captures. Additive only.
-- AlterTable
ALTER TABLE "FieldEvidenceLog" ADD COLUMN     "headingDegrees" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "alertStateJson" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "externalReference" TEXT,
ADD COLUMN     "fundingSource" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "importedProgressPct" DECIMAL(5,2),
ADD COLUMN     "importedStatus" TEXT,
ADD COLUMN     "interventionYear" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_externalReference_key" ON "Project"("tenantId", "externalReference");
