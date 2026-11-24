-- CreateEnum
CREATE TYPE "VisitKind" AS ENUM ('MOBILISATION_CHECK', 'BASELINE', 'ROUTINE', 'QUARTERLY_ME', 'FINAL_EVALUATION', 'POST_CLOSURE_EVALUATION', 'AD_HOC');

-- CreateEnum
CREATE TYPE "FormSubFormSubject" AS ENUM ('ARCHETYPE', 'FACILITY');

-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'FORM_COMPONENT_SAVED';

-- AlterTable
ALTER TABLE "facilities" ADD COLUMN     "pluralName" TEXT;

-- CreateTable
CREATE TABLE "form_sections" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fieldsJson" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_subforms" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subject" "FormSubFormSubject" NOT NULL,
    "archetype" "FacilityArchetype",
    "facilityId" UUID,
    "subjectKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldsJson" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_subforms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_form_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "visitKind" "VisitKind" NOT NULL,
    "layoutJson" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_sections_tenantId_isArchived_idx" ON "form_sections"("tenantId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "form_sections_tenantId_code_version_key" ON "form_sections"("tenantId", "code", "version");

-- CreateIndex
CREATE INDEX "facility_subforms_facilityId_idx" ON "facility_subforms"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "facility_subforms_tenantId_subjectKey_version_key" ON "facility_subforms"("tenantId", "subjectKey", "version");

-- CreateIndex
CREATE INDEX "visit_form_templates_tenantId_visitKind_idx" ON "visit_form_templates"("tenantId", "visitKind");

-- CreateIndex
CREATE UNIQUE INDEX "visit_form_templates_tenantId_code_version_key" ON "visit_form_templates"("tenantId", "code", "version");

-- AddForeignKey
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_subforms" ADD CONSTRAINT "facility_subforms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_subforms" ADD CONSTRAINT "facility_subforms_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_form_templates" ADD CONSTRAINT "visit_form_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (keep): a sub-form is about exactly one archetype or one facility.
ALTER TABLE "facility_subforms" ADD CONSTRAINT "facility_subforms_subject_check" CHECK (
  ("subject" = 'ARCHETYPE' AND "archetype" IS NOT NULL AND "facilityId" IS NULL)
  OR ("subject" = 'FACILITY' AND "facilityId" IS NOT NULL AND "archetype" IS NULL)
);

-- Irregular plurals of the default facilities (D-R3.9); tenants may edit them.
UPDATE "facilities" SET "pluralName" = 'Staff quarters' WHERE "code" = 'STAFF_QUARTERS' AND "pluralName" IS NULL;
UPDATE "facilities" SET "pluralName" = 'Solar power systems' WHERE "code" = 'SOLAR_POWER' AND "pluralName" IS NULL;
UPDATE "facilities" SET "pluralName" = 'Landscaping' WHERE "code" = 'LANDSCAPING' AND "pluralName" IS NULL;
UPDATE "facilities" SET "pluralName" = 'Drainage and exterior works' WHERE "code" = 'DRAINAGE' AND "pluralName" IS NULL;

-- Permission backfill (contract register section 3): a migrated, not reseeded database gets
-- `forms:manage`, granted to the default roles that hold it. Idempotent.
INSERT INTO "permissions" ("id", "key", "name", "description", "category", "surface")
VALUES (gen_random_uuid(), 'forms:manage', 'Manage Form Library',
        'Build and version the visit form library: fixed sections, facility sub-forms and visit form templates.', 'TENANT_ADMIN', 'WEB')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r, "permissions" p
WHERE p."key" = 'forms:manage' AND r."code" IN ('TENANT_SUPER_ADMIN', 'MONITOR')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
