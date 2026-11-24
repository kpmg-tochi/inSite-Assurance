-- Redesign R3e (D-R3.19): checklist template authoring moved to the form library. Roles that could
-- manage checklist templates get `forms:manage`; the old permission is removed (its role grants go
-- with it). The checklist template table, seeded templates and Phase 14 inspections stay until R4.
INSERT INTO "permissions" ("id", "key", "name", "description", "category", "surface")
VALUES (gen_random_uuid(), 'forms:manage', 'Manage Form Library',
        'Build and version the visit form library: fixed sections, facility sub-forms and visit form templates.', 'TENANT_ADMIN', 'WEB')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."roleId", f."id"
FROM "role_permissions" rp
JOIN "permissions" old ON old."id" = rp."permissionId" AND old."key" = 'inspections:manage_templates'
CROSS JOIN "permissions" f
WHERE f."key" = 'forms:manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DELETE FROM "role_permissions" WHERE "permissionId" IN (SELECT "id" FROM "permissions" WHERE "key" = 'inspections:manage_templates');
DELETE FROM "permissions" WHERE "key" = 'inspections:manage_templates';
