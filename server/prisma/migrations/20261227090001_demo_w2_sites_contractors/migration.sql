-- CreateEnum
CREATE TYPE "ContractorStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'SUSPENDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'SITES_SAVED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_CREATED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_STATUS_CHANGED';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contractorStatus" "ContractorStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "stateCode" TEXT,
ADD COLUMN     "tin" TEXT;

-- AlterTable
ALTER TABLE "facility_units" ADD COLUMN     "siteId" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "contractorPerformanceJson" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "contractor_rating_snapshots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "rated" BOOLEAN NOT NULL,
    "score" DECIMAL(3,1),
    "stars" DECIMAL(2,1),
    "reportCount" INTEGER NOT NULL,
    "projectCount" INTEGER NOT NULL,
    "componentsJson" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_rating_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_sites" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "siteNumber" INTEGER NOT NULL,
    "schoolName" TEXT NOT NULL,
    "schoolLevel" TEXT NOT NULL,
    "lgaCode" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "boundaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contractor_rating_snapshots_tenantId_idx" ON "contractor_rating_snapshots"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_rating_snapshots_organizationId_key" ON "contractor_rating_snapshots"("organizationId");

-- CreateIndex
CREATE INDEX "project_sites_projectId_idx" ON "project_sites"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_sites_projectId_siteNumber_key" ON "project_sites"("projectId", "siteNumber");

-- AddForeignKey
ALTER TABLE "contractor_rating_snapshots" ADD CONSTRAINT "contractor_rating_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_rating_snapshots" ADD CONSTRAINT "contractor_rating_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_units" ADD CONSTRAINT "facility_units_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "project_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Client demo updates F.1 (wave 2): permission backfill for a migrated (not reseeded) database. The
-- catalogue sync adds the row at start too; tenant super admins hold every key. Idempotent.
INSERT INTO "permissions" ("id", "key", "name", "description", "category", "surface") VALUES
  (gen_random_uuid(), 'contractors:view_register', 'View the Contractor Register', 'See every contractor with its status, rating, projects and decisions.', 'CONTRACT_KICKOFF', 'WEB')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r, "permissions" p
WHERE p."key" = 'contractors:view_register' AND r."code" = 'TENANT_SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
