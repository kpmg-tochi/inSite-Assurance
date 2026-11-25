-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_LOT_CREATED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "batchNumber" INTEGER,
ADD COLUMN     "fundingSourceCode" TEXT,
ADD COLUMN     "lgaCode" TEXT,
ADD COLUMN     "lotId" UUID,
ADD COLUMN     "stateCode" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "project_lots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "interventionYear" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_lots_tenantId_interventionYear_idx" ON "project_lots"("tenantId", "interventionYear");

-- CreateIndex
CREATE UNIQUE INDEX "project_lots_tenantId_interventionYear_number_key" ON "project_lots"("tenantId", "interventionYear", "number");

-- CreateIndex
CREATE INDEX "Project_tenantId_stateCode_idx" ON "Project"("tenantId", "stateCode");

-- CreateIndex
CREATE UNIQUE INDEX "Project_lotId_batchNumber_key" ON "Project"("lotId", "batchNumber");

-- AddForeignKey
ALTER TABLE "project_lots" ADD CONSTRAINT "project_lots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "project_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
