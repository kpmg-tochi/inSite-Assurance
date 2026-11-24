-- CreateEnum
CREATE TYPE "VisitSubmissionStatus" AS ENUM ('PENDING_APPROVAL', 'RETURNED', 'APPROVED');

-- CreateEnum
CREATE TYPE "VisitOverallFinding" AS ENUM ('SATISFACTORY', 'MINOR_ISSUES', 'MAJOR_ISSUES');

-- CreateEnum
CREATE TYPE "SiteLogKind" AS ENUM ('PHOTO', 'VOICE', 'NOTE');

-- AlterTable
ALTER TABLE "FieldEvidenceLog" ADD COLUMN     "facilityUnitId" UUID,
ADD COLUMN     "visitAnswerPath" TEXT,
ADD COLUMN     "visitSubmissionId" UUID;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "checkInAt" TIMESTAMP(3),
ADD COLUMN     "checkInByUserId" UUID,
ADD COLUMN     "checkInGeofenceStatus" "GeofenceStatus",
ADD COLUMN     "checkInGeotag" JSONB,
ADD COLUMN     "clientCheckInId" UUID;

-- CreateTable
CREATE TABLE "visit_submissions" (
    "id" UUID NOT NULL,
    "clientSubmissionId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "submittedByUserId" UUID NOT NULL,
    "fieldSessionId" UUID NOT NULL,
    "reporterName" TEXT NOT NULL,
    "reporterRoleName" TEXT NOT NULL,
    "formSnapshotId" UUID NOT NULL,
    "formHash" TEXT NOT NULL,
    "answersJson" JSONB NOT NULL,
    "overallFinding" "VisitOverallFinding" NOT NULL,
    "summaryText" TEXT NOT NULL,
    "submissionGeotag" JSONB,
    "geofenceStatus" "GeofenceStatus",
    "integrityFlags" JSONB NOT NULL DEFAULT '[]',
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "status" "VisitSubmissionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalChainVersion" INTEGER,
    "currentApprovalStep" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnedNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_comments" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "submissionId" UUID,
    "authorUserId" UUID,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_log_entries" (
    "id" UUID NOT NULL,
    "clientEntryId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "fieldSessionId" UUID NOT NULL,
    "kind" "SiteLogKind" NOT NULL,
    "captureId" UUID,
    "text" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "geofenceStatus" "GeofenceStatus",
    "capturedAtDevice" TIMESTAMP(3) NOT NULL,
    "attachedSubmissionId" UUID,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_submissions_clientSubmissionId_key" ON "visit_submissions"("clientSubmissionId");

-- CreateIndex
CREATE INDEX "visit_submissions_visitId_idx" ON "visit_submissions"("visitId");

-- CreateIndex
CREATE INDEX "visit_submissions_projectId_status_idx" ON "visit_submissions"("projectId", "status");

-- CreateIndex
CREATE INDEX "visit_comments_visitId_createdAt_idx" ON "visit_comments"("visitId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "site_log_entries_clientEntryId_key" ON "site_log_entries"("clientEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "site_log_entries_captureId_key" ON "site_log_entries"("captureId");

-- CreateIndex
CREATE INDEX "site_log_entries_projectId_capturedAtDevice_idx" ON "site_log_entries"("projectId", "capturedAtDevice");

-- CreateIndex
CREATE INDEX "site_log_entries_authorUserId_idx" ON "site_log_entries"("authorUserId");

-- CreateIndex
CREATE INDEX "FieldEvidenceLog_visitSubmissionId_idx" ON "FieldEvidenceLog"("visitSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "visits_clientCheckInId_key" ON "visits"("clientCheckInId");

-- AddForeignKey
ALTER TABLE "FieldEvidenceLog" ADD CONSTRAINT "FieldEvidenceLog_visitSubmissionId_fkey" FOREIGN KEY ("visitSubmissionId") REFERENCES "visit_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_submissions" ADD CONSTRAINT "visit_submissions_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_submissions" ADD CONSTRAINT "visit_submissions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_comments" ADD CONSTRAINT "visit_comments_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_comments" ADD CONSTRAINT "visit_comments_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "visit_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_log_entries" ADD CONSTRAINT "site_log_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_log_entries" ADD CONSTRAINT "site_log_entries_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "FieldEvidenceLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_log_entries" ADD CONSTRAINT "site_log_entries_attachedSubmissionId_fkey" FOREIGN KEY ("attachedSubmissionId") REFERENCES "visit_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written (D-R4.1): at most one live (pending or approved) submission per visit.
CREATE UNIQUE INDEX "visit_submissions_one_live_per_visit" ON "visit_submissions" ("visitId") WHERE "status" IN ('PENDING_APPROVAL', 'APPROVED');
