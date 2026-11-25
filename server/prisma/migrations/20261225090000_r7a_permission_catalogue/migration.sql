-- Redesign R7a: permission catalogue named after the new model (redesign_r7_implementation_plan.md
-- sections 5.1, 5.3 and 6; key map also in shared RENAMED_PERMISSION_KEYS).
--
-- Hand-written data section first:
--   (a) a rename keeps the permission row (same id), so every role holding it, default or custom,
--       keeps it;
--   (b) a merge (old key whose new key already exists) moves the grants to the new key, then deletes
--       the old row;
--   (c) removals delete the row (role_permissions cascade);
--   (d) stored keys in columns and JSON are rewritten as quoted strings (permission keys contain ':'
--       and are unique strings, D-R7.19).
-- Every statement is a no-op when its old key is absent. New keys and changed names, descriptions
-- and categories are written by `syncPermissionCatalog` at server start and in the seed (D-R7.3).
-- No hand-written index or CHECK listed in CLAUDE.md is touched.

CREATE FUNCTION pg_temp.r7_move_permission(old_key text, new_key text) RETURNS void AS $$
DECLARE
  old_id uuid;
  new_id uuid;
BEGIN
  SELECT "id" INTO old_id FROM "permissions" WHERE "key" = old_key;
  IF old_id IS NULL THEN
    RETURN;
  END IF;
  SELECT "id" INTO new_id FROM "permissions" WHERE "key" = new_key;
  IF new_id IS NULL THEN
    UPDATE "permissions" SET "key" = new_key WHERE "id" = old_id;
  ELSE
    INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
    SELECT gen_random_uuid(), rp."roleId", new_id FROM "role_permissions" rp WHERE rp."permissionId" = old_id
    ON CONFLICT ("roleId", "permissionId") DO NOTHING;
    DELETE FROM "permissions" WHERE "id" = old_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.r7_rewrite_key(old_key text, new_key text) RETURNS void AS $$
DECLARE
  old_q text := '"' || old_key || '"';
  new_q text := '"' || new_key || '"';
BEGIN
  UPDATE "approval_steps" SET "requiredPermissionKey" = new_key WHERE "requiredPermissionKey" = old_key;
  UPDATE "web_notifications" SET "targetPermissionKey" = new_key WHERE "targetPermissionKey" = old_key;
  UPDATE "document_types" SET "signOffPermissionKey" = new_key WHERE "signOffPermissionKey" = old_key;
  UPDATE "project_contract_milestones" SET "requiresSignOffPermissionKey" = new_key WHERE "requiresSignOffPermissionKey" = old_key;
  UPDATE "workflow_templates" SET "configJson" = replace("configJson"::text, old_q, new_q)::jsonb
    WHERE strpos("configJson"::text, old_q) > 0;
  UPDATE "project_types" SET "configJson" = replace("configJson"::text, old_q, new_q)::jsonb
    WHERE strpos("configJson"::text, old_q) > 0;
  UPDATE "Project" SET "projectTypeSnapshotJson" = replace("projectTypeSnapshotJson"::text, old_q, new_q)::jsonb
    WHERE "projectTypeSnapshotJson" IS NOT NULL AND strpos("projectTypeSnapshotJson"::text, old_q) > 0;
  UPDATE "completion_certificates" SET "slotsJson" = replace("slotsJson"::text, old_q, new_q)::jsonb
    WHERE strpos("slotsJson"::text, old_q) > 0;
END;
$$ LANGUAGE plpgsql;

-- Renames (the old key holds the row; the new key does not exist yet).
SELECT pg_temp.r7_move_permission('boq:view', 'scope:view');
SELECT pg_temp.r7_move_permission('boq:upload_edit', 'scope:edit');
SELECT pg_temp.r7_move_permission('schedule:view_variance', 'sprints:view_status');
SELECT pg_temp.r7_move_permission('contractors:manage_packages', 'contractors:manage');
SELECT pg_temp.r7_move_permission('sessions:revoke_device', 'users:revoke_device');
SELECT pg_temp.r7_move_permission('retention:manage_defects', 'defects:manage');
SELECT pg_temp.r7_move_permission('inspections:manage_findings', 'findings:manage');
SELECT pg_temp.r7_move_permission('reports:approve_completion', 'visits:review');
SELECT pg_temp.r7_move_permission('reports:raise_query', 'incidents:view');
-- Merges (the new key already exists since R4: grants move, the old row goes).
SELECT pg_temp.r7_move_permission('field:submit_report', 'visits:submit');
SELECT pg_temp.r7_move_permission('inspections:submit', 'visits:submit');
SELECT pg_temp.r7_move_permission('reports:view_all', 'visits:view');
SELECT pg_temp.r7_move_permission('inspections:view', 'visits:view');
-- Removals (no call site; no contractor login).
DELETE FROM "permissions" WHERE "key" IN ('field:raise_incident', 'reports:respond_query', 'inspections:manage_templates');

-- Stored keys.
SELECT pg_temp.r7_rewrite_key('boq:view', 'scope:view');
SELECT pg_temp.r7_rewrite_key('boq:upload_edit', 'scope:edit');
SELECT pg_temp.r7_rewrite_key('schedule:view_variance', 'sprints:view_status');
SELECT pg_temp.r7_rewrite_key('contractors:manage_packages', 'contractors:manage');
SELECT pg_temp.r7_rewrite_key('sessions:revoke_device', 'users:revoke_device');
SELECT pg_temp.r7_rewrite_key('retention:manage_defects', 'defects:manage');
SELECT pg_temp.r7_rewrite_key('inspections:manage_findings', 'findings:manage');
SELECT pg_temp.r7_rewrite_key('reports:approve_completion', 'visits:review');
SELECT pg_temp.r7_rewrite_key('reports:raise_query', 'incidents:view');
SELECT pg_temp.r7_rewrite_key('field:submit_report', 'visits:submit');
SELECT pg_temp.r7_rewrite_key('inspections:submit', 'visits:submit');
SELECT pg_temp.r7_rewrite_key('reports:view_all', 'visits:view');
SELECT pg_temp.r7_rewrite_key('inspections:view', 'visits:view');

DROP FUNCTION pg_temp.r7_move_permission(text, text);
DROP FUNCTION pg_temp.r7_rewrite_key(text, text);

-- Categories: map the old values while the column changes type. `syncPermissionCatalog` then sets
-- each key's final category at start-up.
-- AlterEnum
BEGIN;
CREATE TYPE "PermissionCategory_new" AS ENUM ('TENANT_ADMIN', 'FORMS_FACILITIES', 'PORTFOLIO_PROJECTS', 'SCOPE_SPRINTS', 'CONTRACT_KICKOFF', 'VISITS_FINDINGS', 'PAYMENTS', 'COMPLETION_CLOSURE');
ALTER TABLE "permissions" ALTER COLUMN "category" TYPE "PermissionCategory_new" USING (
  CASE "category"::text
    WHEN 'BOQ_SCHEDULE' THEN 'SCOPE_SPRINTS'
    WHEN 'MOBILIZATION_ASSURANCE' THEN 'TENANT_ADMIN'
    WHEN 'FIELD_PRESENCE' THEN 'VISITS_FINDINGS'
    WHEN 'REPORT_APPROVALS' THEN 'VISITS_FINDINGS'
    WHEN 'AUDIT_CLOSEOUT' THEN 'COMPLETION_CLOSURE'
    ELSE "category"::text
  END
)::"PermissionCategory_new";
ALTER TYPE "PermissionCategory" RENAME TO "PermissionCategory_old";
ALTER TYPE "PermissionCategory_new" RENAME TO "PermissionCategory";
DROP TYPE "public"."PermissionCategory_old";
COMMIT;

-- AlterTable
ALTER TABLE "web_notifications" ALTER COLUMN "targetPermissionKey" SET DEFAULT 'visits:view';
