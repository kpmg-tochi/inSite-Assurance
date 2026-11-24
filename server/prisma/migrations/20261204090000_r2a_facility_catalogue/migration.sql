-- Redesign R2a: the tenant facility catalogue (DEFAULT_FACILITIES is provisioned by the app and the seed).
-- CreateEnum
CREATE TYPE "FacilityArchetype" AS ENUM ('BUILDING_WORKS', 'SUPPLY_INSTALLATION', 'UTILITIES', 'EXTERNAL_WORKS');

-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'FACILITY_SAVED';

-- CreateTable
CREATE TABLE "facilities" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "archetype" "FacilityArchetype" NOT NULL,
    "isRetired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facilities_tenantId_isRetired_idx" ON "facilities"("tenantId", "isRetired");

-- CreateIndex
CREATE UNIQUE INDEX "facilities_tenantId_code_key" ON "facilities"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
