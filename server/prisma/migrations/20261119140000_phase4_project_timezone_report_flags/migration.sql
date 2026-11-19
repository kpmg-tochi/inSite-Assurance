-- A project's reporting day is defined in its own time zone (owner decision 2026-11-19).
ALTER TABLE "Project" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos';
UPDATE "Project" p SET "timezone" = t."timezone" FROM "tenants" t WHERE p."tenantId" = t."id";

-- Location and integrity notes on each report (shown as badges).
ALTER TABLE "workday_reports" ADD COLUMN "integrityFlags" JSONB NOT NULL DEFAULT '[]';
