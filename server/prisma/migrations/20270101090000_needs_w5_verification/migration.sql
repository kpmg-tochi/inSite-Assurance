-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_VERIFICATION_ASSIGNED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_VERIFICATION_CANCELLED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_VERIFICATION_SUBMITTED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_VERIFICATION_REVIEWED';
ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_SITE_COORDINATES_CORRECTED';

-- CreateTable
CREATE TABLE "needs_verifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "officerUserId" UUID NOT NULL,
    "officerName" TEXT NOT NULL,
    "assignedByUserId" UUID NOT NULL,
    "assignedByName" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE NOT NULL,
    "instructions" TEXT,
    "siteNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "formJson" JSONB NOT NULL,
    "formHash" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByName" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "needs_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_verification_submissions" (
    "id" UUID NOT NULL,
    "verificationId" UUID NOT NULL,
    "clientSubmissionId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "formHash" TEXT NOT NULL,
    "answersJson" JSONB NOT NULL,
    "siteLocationsJson" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "submittedByUserId" UUID NOT NULL,
    "submittedByName" TEXT NOT NULL,
    "submittedAtDevice" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" UUID,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "siteCorrectionsJson" JSONB,
    "evidenceDocumentIds" UUID[] DEFAULT ARRAY[]::UUID[],

    CONSTRAINT "needs_verification_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs_verification_captures" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "verificationId" UUID NOT NULL,
    "submissionId" UUID,
    "clientCaptureId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "clientSha256" TEXT NOT NULL,
    "serverSha256" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "altitudeMeters" DOUBLE PRECISION,
    "headingDegrees" DOUBLE PRECISION,
    "isMockLocation" BOOLEAN NOT NULL DEFAULT false,
    "caption" TEXT,
    "signature" TEXT,
    "answerPath" TEXT,
    "capturedAtDevice" TIMESTAMP(3) NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "needs_verification_captures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "needs_verifications_tenantId_officerUserId_status_idx" ON "needs_verifications"("tenantId", "officerUserId", "status");

-- CreateIndex
CREATE INDEX "needs_verifications_proposalId_status_idx" ON "needs_verifications"("proposalId", "status");

-- CreateIndex
CREATE INDEX "needs_verifications_cycleId_idx" ON "needs_verifications"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "needs_verification_submissions_clientSubmissionId_key" ON "needs_verification_submissions"("clientSubmissionId");

-- CreateIndex
CREATE INDEX "needs_verification_submissions_verificationId_status_idx" ON "needs_verification_submissions"("verificationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "needs_verification_captures_clientCaptureId_key" ON "needs_verification_captures"("clientCaptureId");

-- CreateIndex
CREATE INDEX "needs_verification_captures_verificationId_idx" ON "needs_verification_captures"("verificationId");

-- CreateIndex
CREATE INDEX "needs_verification_captures_submissionId_idx" ON "needs_verification_captures"("submissionId");

-- AddForeignKey
ALTER TABLE "needs_verifications" ADD CONSTRAINT "needs_verifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_verifications" ADD CONSTRAINT "needs_verifications_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "needs_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_verifications" ADD CONSTRAINT "needs_verifications_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "needs_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_verifications" ADD CONSTRAINT "needs_verifications_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "needs_assessment_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_verification_submissions" ADD CONSTRAINT "needs_verification_submissions_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "needs_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_verification_captures" ADD CONSTRAINT "needs_verification_captures_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "needs_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs_verification_captures" ADD CONSTRAINT "needs_verification_captures_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "needs_verification_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written (keep when regenerating): at most one live submission per verification.
CREATE UNIQUE INDEX "needs_verification_submissions_one_live_per_verification" ON "needs_verification_submissions"("verificationId") WHERE "status" IN ('SUBMITTED', 'ACCEPTED');
