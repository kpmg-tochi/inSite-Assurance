-- AlterTable
ALTER TABLE "FieldEvidenceLog" ADD COLUMN     "resubmittedFromClientCaptureId" UUID,
ADD COLUMN     "resubmittedFromEvidenceLogId" UUID;

