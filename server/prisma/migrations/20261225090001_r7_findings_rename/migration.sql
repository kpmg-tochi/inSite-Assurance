-- Redesign R7: the model InspectionFinding becomes Finding (contract register: "R7 renames the model
-- Finding"). Hand-written: renames in place so every finding survives (a Prisma-generated diff would
-- drop and recreate the table).
--
-- Every finding comes from a visit submission since R5f deleted the Phase 14 inspections, so the
-- always-null "inspectionId" and the CHECK that named it go, and "visitSubmissionId" becomes required
-- (both code paths that create a finding, visit acceptance and the manual raise, set it).
--
-- PostgreSQL 18 also names NOT NULL constraints (inspection_findings_<column>_not_null). They keep
-- their old names: Prisma does not compare them, and renaming them would fail on PostgreSQL < 18.

-- 1. Drop the Phase 14 source CHECK and its column.
ALTER TABLE "inspection_findings" DROP CONSTRAINT "inspection_findings_source_check";
ALTER TABLE "inspection_findings" DROP COLUMN "inspectionId";

-- 2. A finding always names the submission that raised it (fails loudly if a row has none).
ALTER TABLE "inspection_findings" ALTER COLUMN "visitSubmissionId" SET NOT NULL;

-- 3. Enum types.
ALTER TYPE "InspectionFindingSeverity" RENAME TO "FindingSeverity";
ALTER TYPE "InspectionFindingStatus" RENAME TO "FindingStatus";

-- 4. Table, primary key, foreign keys and indexes, to the names Prisma expects for model Finding.
ALTER TABLE "inspection_findings" RENAME TO "findings";
ALTER TABLE "findings" RENAME CONSTRAINT "inspection_findings_pkey" TO "findings_pkey";
ALTER TABLE "findings" RENAME CONSTRAINT "inspection_findings_projectId_fkey" TO "findings_projectId_fkey";
ALTER TABLE "findings" RENAME CONSTRAINT "inspection_findings_projectContractorId_fkey" TO "findings_projectContractorId_fkey";
ALTER INDEX "inspection_findings_projectId_status_idx" RENAME TO "findings_projectId_status_idx";
ALTER INDEX "inspection_findings_visitId_idx" RENAME TO "findings_visitId_idx";
ALTER INDEX "inspection_findings_projectContractorId_status_idx" RENAME TO "findings_projectContractorId_status_idx";
