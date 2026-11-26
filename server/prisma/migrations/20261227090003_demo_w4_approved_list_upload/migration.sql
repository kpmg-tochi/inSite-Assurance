-- Client demo updates wave 4 (E3): approved list upload. Additive only.

-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'APPROVED_LIST_IMPORTED';

-- AlterTable
ALTER TABLE "approved_lists" ADD COLUMN "sourceFileName" TEXT,
ADD COLUMN "sourceSha256" TEXT,
ADD COLUMN "importedAt" TIMESTAMP(3),
ADD COLUMN "importedById" UUID;

-- Permission row (owned by code, synced at start; inserted here so the grant below has a row)
INSERT INTO "permissions" ("id", "key", "name", "description", "category", "surface") VALUES
  (gen_random_uuid(), 'approved_lists:manage', 'Upload Approved Project Lists', 'Upload an annual approved project list (Approved Projects & Implementation Schedule or Approved BEAP) from the template; replaces the list of the same year, kind and State.', 'PORTFOLIO_PROJECTS', 'WEB')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r, "permissions" p
WHERE p."key" = 'approved_lists:manage' AND r."code" = 'TENANT_SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
