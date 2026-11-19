-- One report per reporter, WBS item and period (owner rule, 2026-11-19).
-- Partial unique indexes are not expressible in schema.prisma; they live only in this migration.
-- If a later `prisma migrate dev` proposes dropping them, keep them.

-- An original report (not a revision) is unique per reporter, WBS item and period.
CREATE UNIQUE INDEX "workday_reports_one_report_per_period"
  ON "workday_reports" ("reporterSessionId", "wbsItemId", "workdayDate")
  WHERE "parentReportId" IS NULL;

-- A report has at most one direct revision, so the revision chain cannot fork.
CREATE UNIQUE INDEX "workday_reports_one_revision_per_parent"
  ON "workday_reports" ("parentReportId")
  WHERE "parentReportId" IS NOT NULL;
