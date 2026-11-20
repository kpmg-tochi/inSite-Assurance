-- CreateEnum
CREATE TYPE "ApprovalOrganizationScope" AS ENUM ('ANY', 'PROJECT_OWNER', 'PROJECT_OWNER_OR_ANCESTOR', 'FUNDER');

-- CreateEnum
CREATE TYPE "BeneficiaryType" AS ENUM ('SCHOOL', 'COMMUNITY', 'INSTITUTION', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_TYPE_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_TYPE_APPLIED';
ALTER TYPE "AuditActionType" ADD VALUE 'ORGANIZATION_HIERARCHY_CHANGED';
ALTER TYPE "AuditActionType" ADD VALUE 'TERMINOLOGY_UPDATED';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "parentOrganizationId" UUID;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "owningOrganizationId" UUID,
ADD COLUMN     "projectTypeId" UUID,
ADD COLUMN     "projectTypeSnapshotJson" JSONB,
ADD COLUMN     "projectTypeVersion" INTEGER,
ADD COLUMN     "regionId" UUID;

-- AlterTable
ALTER TABLE "approval_steps" ADD COLUMN     "organizationScope" "ApprovalOrganizationScope" NOT NULL DEFAULT 'ANY';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "terminologyLabels" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "project_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "colour" TEXT,
    "workflowTemplateId" UUID NOT NULL,
    "configJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentRegionId" UUID,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_beneficiaries" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "beneficiaryType" "BeneficiaryType" NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "address" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_types_tenantId_idx" ON "project_types"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "project_types_tenantId_code_key" ON "project_types"("tenantId", "code");

-- CreateIndex
CREATE INDEX "regions_tenantId_idx" ON "regions"("tenantId");

-- CreateIndex
CREATE INDEX "regions_parentRegionId_idx" ON "regions"("parentRegionId");

-- CreateIndex
CREATE UNIQUE INDEX "regions_tenantId_code_key" ON "regions"("tenantId", "code");

-- CreateIndex
CREATE INDEX "project_beneficiaries_projectId_idx" ON "project_beneficiaries"("projectId");

-- CreateIndex
CREATE INDEX "Organization_parentOrganizationId_idx" ON "Organization"("parentOrganizationId");

-- CreateIndex
CREATE INDEX "Project_owningOrganizationId_idx" ON "Project"("owningOrganizationId");

-- CreateIndex
CREATE INDEX "Project_projectTypeId_idx" ON "Project"("projectTypeId");

-- CreateIndex
CREATE INDEX "Project_regionId_idx" ON "Project"("regionId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentOrganizationId_fkey" FOREIGN KEY ("parentOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_owningOrganizationId_fkey" FOREIGN KEY ("owningOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_projectTypeId_fkey" FOREIGN KEY ("projectTypeId") REFERENCES "project_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_types" ADD CONSTRAINT "project_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_types" ADD CONSTRAINT "project_types_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "workflow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_parentRegionId_fkey" FOREIGN KEY ("parentRegionId") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_beneficiaries" ADD CONSTRAINT "project_beneficiaries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
