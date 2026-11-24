-- Redesign R2c: needs-assessment fields on Project (filled from the workbook) and the SCOPE_IMPORTED audit action.
-- AlterEnum
ALTER TYPE "AuditActionType" ADD VALUE 'SCOPE_IMPORTED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "assumptions" TEXT,
ADD COLUMN     "siteAddress" TEXT,
ADD COLUMN     "strategicJustification" TEXT;
