-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_FLAG_RAISED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_FLAG_ACTION_DECIDED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_FLAG_ACTION_LIFTED';
ALTER TYPE "AuditActionType" ADD VALUE 'CONTRACTOR_FLAG_CLOSED';
ALTER TYPE "AuditActionType" ADD VALUE 'APPROVED_LIST_ROW_LINKED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "approvedListRowId" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "budgetMismatchTolerancePct" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "contractor_flags" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ruleJson" JSONB NOT NULL,
    "evidenceJson" JSONB NOT NULL DEFAULT '[]',
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" UUID,
    "closedByName" TEXT,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contractor_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_flag_actions" (
    "id" UUID NOT NULL,
    "flagId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "paramsJson" JSONB NOT NULL DEFAULT '{}',
    "visitIds" UUID[],
    "decidedByUserId" UUID,
    "decidedByName" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedByUserId" UUID,
    "liftedByName" TEXT,
    "liftReason" TEXT,

    CONSTRAINT "contractor_flag_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approved_lists" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "interventionYear" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "stateCode" TEXT,
    "title" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedOn" TEXT NOT NULL,
    "documentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approved_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approved_list_rows" (
    "id" UUID NOT NULL,
    "listId" UUID NOT NULL,
    "rowRef" TEXT NOT NULL,
    "projectTitle" TEXT NOT NULL,
    "schoolNamesJson" JSONB NOT NULL DEFAULT '[]',
    "stateCode" TEXT NOT NULL,
    "lgaCodes" TEXT[],
    "facilityScope" TEXT,
    "costEstimateNgn" DECIMAL(18,2) NOT NULL,
    "lotTitle" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approved_list_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contractor_flags_tenantId_status_idx" ON "contractor_flags"("tenantId", "status");

-- CreateIndex
CREATE INDEX "contractor_flags_organizationId_idx" ON "contractor_flags"("organizationId");

-- CreateIndex
CREATE INDEX "contractor_flags_projectId_idx" ON "contractor_flags"("projectId");

-- CreateIndex
CREATE INDEX "contractor_flag_actions_flagId_idx" ON "contractor_flag_actions"("flagId");

-- CreateIndex
CREATE INDEX "approved_lists_tenantId_interventionYear_idx" ON "approved_lists"("tenantId", "interventionYear");

-- CreateIndex
CREATE INDEX "approved_list_rows_listId_idx" ON "approved_list_rows"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "approved_list_rows_listId_rowRef_key" ON "approved_list_rows"("listId", "rowRef");

-- AddForeignKey
ALTER TABLE "contractor_flags" ADD CONSTRAINT "contractor_flags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_flags" ADD CONSTRAINT "contractor_flags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_flags" ADD CONSTRAINT "contractor_flags_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_flag_actions" ADD CONSTRAINT "contractor_flag_actions_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "contractor_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approved_lists" ADD CONSTRAINT "approved_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approved_list_rows" ADD CONSTRAINT "approved_list_rows_listId_fkey" FOREIGN KEY ("listId") REFERENCES "approved_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_approvedListRowId_fkey" FOREIGN KEY ("approvedListRowId") REFERENCES "approved_list_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Client demo updates F.4 (wave 3), hand-written (the schema cannot express it; keep it when regenerating):
-- one OPEN flag per contractor and project.
CREATE UNIQUE INDEX "contractor_flags_one_open_per_project" ON "contractor_flags" ("organizationId", "projectId") WHERE "status" = 'OPEN';

-- Client demo updates E3 (wave 3): permission backfill (catalogue sync adds the row at start too). Idempotent.
INSERT INTO "permissions" ("id", "key", "name", "description", "category", "surface") VALUES
  (gen_random_uuid(), 'approved_lists:view', 'View Approved Project Lists', 'See the annual approved project lists (Approved Projects & Implementation Schedule, Approved BEAP), their links to projects and budget mismatches.', 'PORTFOLIO_PROJECTS', 'WEB')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r, "permissions" p
WHERE p."key" = 'approved_lists:view' AND r."code" = 'TENANT_SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
