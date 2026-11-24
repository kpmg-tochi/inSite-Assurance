-- Redesign R2b: sprints, facility units and BoqItem.facilityUnitId (scope lines are BoqItem rows).
-- AlterEnum


ALTER TYPE "AuditActionType" ADD VALUE 'SCOPE_UPDATED';
ALTER TYPE "AuditActionType" ADD VALUE 'SPRINTS_SAVED';

-- AlterTable
ALTER TABLE "BoqItem" ADD COLUMN     "facilityUnitId" UUID;

-- CreateTable
CREATE TABLE "project_sprints" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "deliverables" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_units" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "plannedQuantity" DECIMAL(14,3),
    "quantityUnit" TEXT,
    "startSprintId" UUID,
    "endSprintId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_sprints_projectId_number_key" ON "project_sprints"("projectId", "number");

-- CreateIndex
CREATE INDEX "facility_units_facilityId_idx" ON "facility_units"("facilityId");

-- CreateIndex
CREATE INDEX "facility_units_startSprintId_idx" ON "facility_units"("startSprintId");

-- CreateIndex
CREATE INDEX "facility_units_endSprintId_idx" ON "facility_units"("endSprintId");

-- CreateIndex
CREATE UNIQUE INDEX "facility_units_projectId_code_key" ON "facility_units"("projectId", "code");

-- CreateIndex
CREATE INDEX "BoqItem_facilityUnitId_idx" ON "BoqItem"("facilityUnitId");

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_facilityUnitId_fkey" FOREIGN KEY ("facilityUnitId") REFERENCES "facility_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_sprints" ADD CONSTRAINT "project_sprints_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_units" ADD CONSTRAINT "facility_units_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_units" ADD CONSTRAINT "facility_units_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_units" ADD CONSTRAINT "facility_units_startSprintId_fkey" FOREIGN KEY ("startSprintId") REFERENCES "project_sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_units" ADD CONSTRAINT "facility_units_endSprintId_fkey" FOREIGN KEY ("endSprintId") REFERENCES "project_sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
