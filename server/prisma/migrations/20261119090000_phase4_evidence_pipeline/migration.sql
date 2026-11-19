-- CreateEnum
CREATE TYPE "WorkdayReportStatus" AS ENUM ('STAGED_UNVERIFIED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "WorkdayAiCheckStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'SKIPPED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'CAPTURE_REGISTERED';
ALTER TYPE "AuditActionType" ADD VALUE 'CAPTURE_FLAGGED_INTEGRITY';
ALTER TYPE "AuditActionType" ADD VALUE 'TELEMETRY_ANOMALY_SUMMARY';
ALTER TYPE "AuditActionType" ADD VALUE 'WORKDAY_REPORTS_RELEASED';
ALTER TYPE "AuditActionType" ADD VALUE 'DEVICE_KEY_REGISTERED';

-- AlterEnum
BEGIN;
CREATE TYPE "EvidenceLogStatus_new" AS ENUM ('REGISTERED', 'FLAGGED_INTEGRITY');
ALTER TABLE "public"."FieldEvidenceLog" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "FieldEvidenceLog" ALTER COLUMN "status" TYPE "EvidenceLogStatus_new" USING ("status"::text::"EvidenceLogStatus_new");
ALTER TYPE "EvidenceLogStatus" RENAME TO "EvidenceLogStatus_old";
ALTER TYPE "EvidenceLogStatus_new" RENAME TO "EvidenceLogStatus";
DROP TYPE "public"."EvidenceLogStatus_old";
ALTER TABLE "FieldEvidenceLog" ALTER COLUMN "status" SET DEFAULT 'REGISTERED';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaType" ADD VALUE 'IDENTITY_DOCUMENT';
ALTER TYPE "MediaType" ADD VALUE 'IDENTITY_SELFIE';

-- DropIndex
DROP INDEX "EvidenceMedia_perceptualHash_idx";

-- DropIndex
DROP INDEX "EvidenceMedia_sha256FileHash_idx";

-- DropIndex
DROP INDEX "FieldEvidenceLog_projectId_reporterRoleId_idx";

-- AlterTable
ALTER TABLE "EvidenceMedia" DROP COLUMN "fileUrl",
ADD COLUMN     "projectId" UUID NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "FieldAgentSession" DROP COLUMN "deviceSecretHash",
ADD COLUMN     "devicePublicKey" TEXT,
ADD COLUMN     "devicePublicKeyAddedAt" TIMESTAMP(3),
ADD COLUMN     "devicePublicKeyAlg" TEXT,
ADD COLUMN     "devicePublicKeyId" TEXT;

-- AlterTable
ALTER TABLE "FieldEvidenceLog" DROP COLUMN "confirmationSignatureHash",
DROP COLUMN "confirmedAt",
DROP COLUMN "confirmedQuantities",
DROP COLUMN "confirmedSummary",
DROP COLUMN "deviceSignatureHash",
DROP COLUMN "rawTextNote",
DROP COLUMN "rawWhisperTranscript",
DROP COLUMN "siteBlockers",
DROP COLUMN "verificationBadgeText",
DROP COLUMN "visionObservationSummary",
DROP COLUMN "wasEditedByAgent",
ADD COLUMN     "caption" TEXT,
ADD COLUMN     "clientSha256" TEXT,
ADD COLUMN     "devicePublicKeyId" TEXT,
ADD COLUMN     "deviceSignature" TEXT,
ADD COLUMN     "distanceFromSiteMeters" DOUBLE PRECISION,
ADD COLUMN     "locationAvailable" BOOLEAN NOT NULL,
ADD COLUMN     "serverSha256" TEXT,
ADD COLUMN     "signatureVerified" BOOLEAN,
ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcriptionEngine" TEXT,
ADD COLUMN     "transcriptionStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "workdayReportId" UUID,
ALTER COLUMN "status" SET DEFAULT 'REGISTERED',
ALTER COLUMN "latitude" DROP NOT NULL,
ALTER COLUMN "longitude" DROP NOT NULL,
ALTER COLUMN "gpsAccuracyMeters" DROP NOT NULL,
ALTER COLUMN "isWithinGeofence" DROP NOT NULL;

-- AlterTable
ALTER TABLE "incident_reports" ADD COLUMN     "clientIncidentId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "site_telemetry_pings" DROP COLUMN "deviceSignatureHash",
ADD COLUMN     "clientPingId" UUID NOT NULL,
ADD COLUMN     "deviceSignature" TEXT,
ADD COLUMN     "signatureVerified" BOOLEAN,
ALTER COLUMN "pingSource" SET DEFAULT 'FOREGROUND_PRESENCE';

-- AlterTable
ALTER TABLE "wbs_chat_messages" DROP COLUMN "mediaUrls",
ADD COLUMN     "captureId" UUID,
ADD COLUMN     "clientMessageId" UUID,
ADD COLUMN     "senderSessionId" UUID,
ADD COLUMN     "senderUserId" UUID;

-- AlterTable
ALTER TABLE "workday_reports" DROP COLUMN "aiParsedConfidence",
DROP COLUMN "evidenceItems",
DROP COLUMN "voiceNoteUrl",
ADD COLUMN     "aiCheckEngine" TEXT,
ADD COLUMN     "aiCheckStatus" "WorkdayAiCheckStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "clientReportId" UUID NOT NULL,
ADD COLUMN     "delaysOrBlockers" TEXT,
ADD COLUMN     "deviceSignature" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "reporterTimezone" TEXT NOT NULL,
ADD COLUMN     "signatureVerified" BOOLEAN,
ADD COLUMN     "textNotes" JSONB NOT NULL DEFAULT '[]',
DROP COLUMN "status",
ADD COLUMN     "status" "WorkdayReportStatus" NOT NULL DEFAULT 'STAGED_UNVERIFIED';

-- CreateTable
CREATE TABLE "telemetry_anomaly_daily" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fieldSessionId" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "anomalyType" TEXT NOT NULL,
    "pingCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telemetry_anomaly_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telemetry_anomaly_daily_projectId_day_idx" ON "telemetry_anomaly_daily"("projectId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_anomaly_daily_fieldSessionId_day_anomalyType_key" ON "telemetry_anomaly_daily"("fieldSessionId", "day", "anomalyType");

-- CreateIndex
CREATE INDEX "EvidenceMedia_tenantId_sha256FileHash_idx" ON "EvidenceMedia"("tenantId", "sha256FileHash");

-- CreateIndex
CREATE INDEX "EvidenceMedia_tenantId_mediaType_idx" ON "EvidenceMedia"("tenantId", "mediaType");

-- CreateIndex
CREATE INDEX "FieldEvidenceLog_workdayReportId_idx" ON "FieldEvidenceLog"("workdayReportId");

-- CreateIndex
CREATE INDEX "FieldEvidenceLog_fieldSessionId_capturedAtDevice_idx" ON "FieldEvidenceLog"("fieldSessionId", "capturedAtDevice");

-- CreateIndex
CREATE UNIQUE INDEX "incident_reports_clientIncidentId_key" ON "incident_reports"("clientIncidentId");

-- CreateIndex
CREATE UNIQUE INDEX "site_telemetry_pings_clientPingId_key" ON "site_telemetry_pings"("clientPingId");

-- CreateIndex
CREATE UNIQUE INDEX "wbs_chat_messages_clientMessageId_key" ON "wbs_chat_messages"("clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "workday_reports_clientReportId_key" ON "workday_reports"("clientReportId");

-- CreateIndex
CREATE INDEX "workday_reports_projectId_status_idx" ON "workday_reports"("projectId", "status");

-- CreateIndex
CREATE INDEX "workday_reports_aiCheckStatus_updatedAt_idx" ON "workday_reports"("aiCheckStatus", "updatedAt");

-- AddForeignKey
ALTER TABLE "FieldEvidenceLog" ADD CONSTRAINT "FieldEvidenceLog_workdayReportId_fkey" FOREIGN KEY ("workdayReportId") REFERENCES "workday_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_anomaly_daily" ADD CONSTRAINT "telemetry_anomaly_daily_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_anomaly_daily" ADD CONSTRAINT "telemetry_anomaly_daily_fieldSessionId_fkey" FOREIGN KEY ("fieldSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_chat_messages" ADD CONSTRAINT "wbs_chat_messages_senderSessionId_fkey" FOREIGN KEY ("senderSessionId") REFERENCES "FieldAgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_chat_messages" ADD CONSTRAINT "wbs_chat_messages_captureId_fkey" FOREIGN KEY ("captureId") REFERENCES "FieldEvidenceLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
