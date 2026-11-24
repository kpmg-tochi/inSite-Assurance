-- AlterTable
ALTER TABLE "completion_certificates" ADD COLUMN     "finalEvaluationVisitId" UUID;

-- AlterTable
ALTER TABLE "facility_units" ADD COLUMN     "progressAsOf" TEXT,
ADD COLUMN     "progressPct" DECIMAL(5,2),
ADD COLUMN     "progressSubmissionId" UUID;

-- AlterTable
ALTER TABLE "inspection_findings" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "facilityId" UUID,
ADD COLUMN     "facilityUnitId" UUID,
ADD COLUMN     "lastRecheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastRecheckedSubmissionId" UUID,
ADD COLUMN     "questionKey" TEXT,
ADD COLUMN     "recheckCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "visitId" UUID,
ADD COLUMN     "visitSubmissionId" UUID,
ALTER COLUMN "inspectionId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "inspection_findings_visitId_idx" ON "inspection_findings"("visitId");

-- Hand-written (D-R4.28): every finding comes from an inspection or a visit submission.
ALTER TABLE "inspection_findings" ADD CONSTRAINT "inspection_findings_source_check" CHECK ("inspectionId" IS NOT NULL OR "visitSubmissionId" IS NOT NULL);
