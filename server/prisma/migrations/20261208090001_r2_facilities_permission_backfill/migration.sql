-- Redesign R2a follow-up: permissions reach the database only through the seed, so a database that
-- was migrated but not reseeded lacked `facilities:manage`. Insert it and grant it to the default
-- roles that hold it (Tenant Super Admin, Monitor) in every tenant. Idempotent.
INSERT INTO "permissions" ("id", "key", "name", "description", "category", "surface")
VALUES (gen_random_uuid(), 'facilities:manage', 'Manage Facility Catalogue',
        'Add, rename, re-archetype and retire the facilities that scope lines are tagged with.', 'TENANT_ADMIN', 'WEB')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r, "permissions" p
WHERE p."key" = 'facilities:manage' AND r."code" IN ('TENANT_SUPER_ADMIN', 'MONITOR')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
