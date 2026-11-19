-- Phase 6: organisation directory, contractor model, project lifecycle, perimeter geofence and
-- tolerance, BOQ revisions. Generated with `prisma migrate diff`, then edited to carry existing data
-- across (decision A allows a reset, but this keeps a running dev database usable).

-- CreateEnum
CREATE TYPE "GeofenceStatus" AS ENUM ('INSIDE', 'WITHIN_TOLERANCE', 'OUTSIDE');

-- CreateEnum
CREATE TYPE "OrgInputMode" AS ENUM ('FREE_TEXT', 'DIRECTORY', 'BOTH');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractorExecutionMode" AS ENUM ('SINGLE_CONTRACTOR', 'MAIN_PLUS_SUBS_UNIFIED_IPC', 'MULTI_PRIME_SEPARATE_IPC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'ORGANIZATION_CREATED';
ALTER TYPE "AuditActionType" ADD VALUE 'ORGANIZATION_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_DRAFT_CREATED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_SETUP_STEP_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_ACTIVATED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_ARCHIVED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_CONTRACTOR_ADDED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_CONTRACTOR_REMOVED';
ALTER TYPE "AuditActionType" ADD VALUE 'BOQ_REVISED';
ALTER TYPE "AuditActionType" ADD VALUE 'PROJECT_DRAFT_DELETED';

-- AlterEnum
ALTER TYPE "GeofenceMode" ADD VALUE 'PERIMETER';

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_contractorOrganizationId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_lenderOrganizationId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_monitorOrganizationId_fkey";

-- DropIndex
DROP INDEX "IpcClaim_projectId_ipcNumber_key";

-- DropIndex
DROP INDEX "Organization_category_idx";

-- DropIndex
DROP INDEX "Project_contractorOrganizationId_idx";

-- AlterTable
ALTER TABLE "BoqItem" ADD COLUMN     "lastRevisionId" UUID,
ADD COLUMN     "projectContractorId" UUID;

-- AlterTable
ALTER TABLE "FieldAgentSession" ADD COLUMN     "projectContractorId" UUID;

-- AlterTable
ALTER TABLE "FieldEvidenceLog" ADD COLUMN     "distanceToBoundaryMeters" DOUBLE PRECISION,
ADD COLUMN     "geofenceStatus" "GeofenceStatus";

-- AlterTable
ALTER TABLE "IpcClaim" ADD COLUMN     "projectContractorId" UUID;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "categories" "OrganizationCategory"[] DEFAULT ARRAY[]::"OrganizationCategory"[],
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationNumber" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "activatedByUserId" UUID,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "contractorExecutionMode" "ContractorExecutionMode",
ADD COLUMN     "createdByUserId" UUID,
ADD COLUMN     "geofenceToleranceMeters" INTEGER,
ADD COLUMN     "setupState" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "stateLocation" DROP NOT NULL,
ALTER COLUMN "totalBudgetNgn" DROP NOT NULL,
ALTER COLUMN "geofenceMode" DROP NOT NULL,
ALTER COLUMN "geofenceGeoJson" DROP NOT NULL,
ALTER COLUMN "monitorOrganizationId" DROP NOT NULL,
ALTER COLUMN "lenderOrganizationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProjectJoinCode" ADD COLUMN     "projectContractorId" UUID;

-- AlterTable
ALTER TABLE "site_telemetry_pings" ADD COLUMN     "distanceToBoundaryMeters" DOUBLE PRECISION,
ADD COLUMN     "geofenceStatus" "GeofenceStatus";

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "defaultGeofenceToleranceMeters" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "enabledGeofenceModes" "GeofenceMode"[] DEFAULT ARRAY['RADIAL', 'LINEAR_CORRIDOR', 'PERIMETER']::"GeofenceMode"[],
ADD COLUMN     "organizationInputMode" "OrgInputMode" NOT NULL DEFAULT 'BOTH';

-- AlterTable
ALTER TABLE "workday_reports" ADD COLUMN     "geofenceStatus" "GeofenceStatus";

-- CreateTable
CREATE TABLE "project_contractors" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tradeCategory" TEXT NOT NULL,
    "tradeCode" TEXT NOT NULL,
    "isMainContractor" BOOLEAN NOT NULL DEFAULT false,
    "allocatedBudgetNgn" DECIMAL(18,2),
    "allowFieldReporting" BOOLEAN NOT NULL DEFAULT true,
    "plannedMobilizationDate" DATE,
    "plannedCompletionDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_revisions" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_contractors_organizationId_idx" ON "project_contractors"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "project_contractors_projectId_organizationId_key" ON "project_contractors"("projectId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "project_contractors_projectId_tradeCode_key" ON "project_contractors"("projectId", "tradeCode");

-- CreateIndex
CREATE UNIQUE INDEX "boq_revisions_projectId_revisionNumber_key" ON "boq_revisions"("projectId", "revisionNumber");

-- CreateIndex
CREATE INDEX "BoqItem_projectId_projectContractorId_idx" ON "BoqItem"("projectId", "projectContractorId");

-- CreateIndex
CREATE INDEX "FieldAgentSession_projectContractorId_idx" ON "FieldAgentSession"("projectContractorId");

-- CreateIndex
CREATE INDEX "IpcClaim_projectContractorId_idx" ON "IpcClaim"("projectContractorId");

-- CreateIndex
CREATE UNIQUE INDEX "IpcClaim_projectId_projectContractorId_ipcNumber_key" ON "IpcClaim"("projectId", "projectContractorId", "ipcNumber");

-- CreateIndex
CREATE INDEX "Project_tenantId_status_idx" ON "Project"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ProjectJoinCode_projectContractorId_idx" ON "ProjectJoinCode"("projectContractorId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_monitorOrganizationId_fkey" FOREIGN KEY ("monitorOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_lenderOrganizationId_fkey" FOREIGN KEY ("lenderOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contractors" ADD CONSTRAINT "project_contractors_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contractors" ADD CONSTRAINT "project_contractors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_revisions" ADD CONSTRAINT "boq_revisions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJoinCode" ADD CONSTRAINT "ProjectJoinCode_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgentSession" ADD CONSTRAINT "FieldAgentSession_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_lastRevisionId_fkey" FOREIGN KEY ("lastRevisionId") REFERENCES "boq_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcClaim" ADD CONSTRAINT "IpcClaim_projectContractorId_fkey" FOREIGN KEY ("projectContractorId") REFERENCES "project_contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Data carried across (hand-written)
-- ---------------------------------------------------------------------------

-- An organisation's single category becomes its first tag.
UPDATE "Organization" SET "categories" = ARRAY["category"]::"OrganizationCategory"[];
ALTER TABLE "Organization" DROP COLUMN "category";

-- Projects that existed before the lifecycle are live.
UPDATE "Project" SET "status" = 'ACTIVE', "activatedAt" = "createdAt", "contractorExecutionMode" = 'SINGLE_CONTRACTOR';

-- The single contractor becomes the main (and only) ProjectContractor.
INSERT INTO "project_contractors" ("id", "projectId", "organizationId", "tradeCategory", "tradeCode", "isMainContractor", "allowFieldReporting", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."id", p."contractorOrganizationId", 'General works', 'GEN', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Project" p;

UPDATE "IpcClaim" i SET "projectContractorId" = pc."id"
FROM "project_contractors" pc WHERE pc."projectId" = i."projectId";

-- Contractor-executor join codes and their sessions belong to that contractor.
UPDATE "ProjectJoinCode" jc SET "projectContractorId" = pc."id"
FROM "project_contractors" pc, "roles" r
WHERE pc."projectId" = jc."projectId" AND r."id" = jc."roleId" AND r."fieldPersonaType" = 'CONTRACTOR_EXECUTOR';

UPDATE "FieldAgentSession" s SET "projectContractorId" = jc."projectContractorId"
FROM "ProjectJoinCode" jc WHERE jc."id" = s."joinCodeId" AND jc."projectContractorId" IS NOT NULL;

ALTER TABLE "Project" DROP COLUMN "contractorOrganizationId";

-- Geofence status for rows evaluated before Phase 6 (no tolerance existed then).
UPDATE "FieldEvidenceLog" SET "geofenceStatus" = CASE WHEN "isWithinGeofence" THEN 'INSIDE'::"GeofenceStatus" ELSE 'OUTSIDE'::"GeofenceStatus" END
WHERE "isWithinGeofence" IS NOT NULL;
UPDATE "site_telemetry_pings" SET "geofenceStatus" = CASE WHEN "isWithinGeofence" THEN 'INSIDE'::"GeofenceStatus" ELSE 'OUTSIDE'::"GeofenceStatus" END
WHERE "isWithinGeofence" IS NOT NULL;

-- One active join code per (project, role, contractor). Rotated-out codes stay as history.
-- Not expressible in schema.prisma: keep this index when generating later migrations.
CREATE UNIQUE INDEX "ProjectJoinCode_active_project_role_contractor_key"
ON "ProjectJoinCode" ("projectId", "roleId", COALESCE("projectContractorId", '00000000-0000-0000-0000-000000000000'::uuid))
WHERE "isActive";
