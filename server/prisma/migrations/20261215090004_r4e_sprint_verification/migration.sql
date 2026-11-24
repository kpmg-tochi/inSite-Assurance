-- CreateEnum
CREATE TYPE "SprintVerificationOutcome" AS ENUM ('MET', 'PARTLY_MET', 'NOT_MET');

-- AlterTable
ALTER TABLE "project_sprints" ADD COLUMN     "firstVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "verificationDueAlertedAt" TIMESTAMP(3),
ADD COLUMN     "verificationNotes" TEXT,
ADD COLUMN     "verificationOutcome" "SprintVerificationOutcome",
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByUserId" UUID;
