-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditActionType" ADD VALUE 'NEEDS_DOCUMENT_ADDED';
ALTER TYPE "AuditActionType" ADD VALUE 'DESIGN_STANDARD_DOCUMENT_ADDED';

-- CreateTable
CREATE TABLE "design_standard_documents" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "facilityCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "supersedesId" UUID,
    "uploadedByUserId" UUID NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_standard_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "design_standard_documents_tenantId_kind_idx" ON "design_standard_documents"("tenantId", "kind");

-- AddForeignKey
ALTER TABLE "design_standard_documents" ADD CONSTRAINT "design_standard_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_standard_documents" ADD CONSTRAINT "design_standard_documents_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "design_standard_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
