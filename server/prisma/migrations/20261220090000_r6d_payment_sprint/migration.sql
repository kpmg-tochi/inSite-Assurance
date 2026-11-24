-- AlterTable
ALTER TABLE "project_payments" ADD COLUMN     "sprintId" UUID;

-- CreateIndex
CREATE INDEX "project_payments_projectId_sprintId_idx" ON "project_payments"("projectId", "sprintId");

-- AddForeignKey
ALTER TABLE "project_payments" ADD CONSTRAINT "project_payments_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "project_sprints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
