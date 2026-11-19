-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "pendingCadenceEffectiveFrom" TEXT,
ADD COLUMN     "pendingCadenceJson" JSONB;
